/**
 * HF 동기화 — docs/03-data-spec.md §5.1 (P0-4).
 *
 * 1) model-quants.json: GGUF repo tree API 로 quant별 실제 파일 크기 갱신(분할 파일 합산,
 *    decimal GB 2자리). Δ>5% 는 적용하되 SUSPICIOUS 표기 — PR 리뷰가 게이트(§5.1③).
 * 2) models.json: 원본 repo config.json 으로 arch(layers/kvHeads/headDim) 재확인.
 *    attnType 'full' 만 kvBytesPerTokenF16 자동 재계산 — swa/mla/hybrid 는 attnOverrides
 *    수동 필드 우선(자동 추출 불가), config 유래 참조값을 manual 로 리포트만 한다.
 *    maxContext 는 큐레이션 값(YaRN 등) — 항상 manual.
 * 3) MoE: 기준 quant(Q4_K_M/MXFP4) 크기 변경 시 nonExpertGB 유도값 연쇄 갱신
 *    (validateAll 허용 오차 0.02GB 유지).
 * 4) 행별 GGUF 헤더 실측(scripts/gguf-header.ts) — MoE 는 텐서 분할(expertGB/nonExpertGB, 10-01), dense 는 그래픽카드에
 *    올리지 않는 몫(offGpuGB, 10-03 D62), 둘 다 MTP 블록 크기(mtpGB, 있을 때만). 값이 없거나 이번 동기화에서 파일 크기·파일명이
 *    바뀐 행, 새 양자화 행은 헤더를 Range 로 읽어 다시 잰다. 실패하면 manual — 값은 그대로.
 *
 * 실행: pnpm run sync-models -- --dry [--report <path>] [--only <modelId>]
 *   --dry 는 data/*.json 을 건드리지 않는다(리포트 파일은 PR body 용도로 작성 허용).
 * PR 생성은 .github/workflows/data-sync.yml 담당 — 스크립트는 로컬 파일까지만.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_OFF_GPU_FRACTION,
  MOE_ARCH,
  deriveNonExpertGB,
  parseModelQuants,
  parseModels,
  type Model,
  type ModelQuantRecord,
} from '../packages/data/src/index';
import { kvBytesPerToken } from '../packages/engine/src/index';
import { extractArch, extractMoe, matchQuantFiles, primaryFile, sumFileGB } from '../packages/data/src/hf';
import { measureSplit } from './gguf-header';
import {
  fetchConfig,
  fetchTree,
  serializeRecords,
  type ConfigResult,
  type TreeEntry,
} from './hf-common';

// 파일 매칭·config 해석은 브라우저 안전 모듈(packages/data/src/hf.ts)로 옮겼다 — 기존 import 호환용 재내보내기
export { extractArch, extractMoe, matchQuantFiles, primaryFile, sumFileGB };
export type { ExtractedArch, PrimaryFile } from '../packages/data/src/hf';

type QuantId = ModelQuantRecord['quant'];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

// ---------------------------------------------------------------------------
// 순수 코어 (테스트 대상 — 네트워크·fs 없음)
// ---------------------------------------------------------------------------

export type Change = {
  file: 'models.json' | 'model-quants.json';
  /** modelId 또는 `${modelId}/${quant}` */
  id: string;
  field: string;
  old?: number | string;
  next?: number | string;
  deltaPct?: number;
  /**
   * auto: 자동 반영 · suspicious: 반영하되 리뷰 요망(Δ>5%) · manual: 사람 판단 필요(리포트만)
   * skipped: 접근 불가(gated) · error: 데이터 문제 — 종료 코드 1
   */
  kind: 'auto' | 'suspicious' | 'manual' | 'skipped' | 'error';
  note?: string;
  /** field 'row' — 새 양자화 행(09-30 카탈로그 확장 자동화). applyChanges 가 그 모델의 마지막 행 뒤에 삽입 */
  newRow?: { ggufRepo: string; fileName: string; fileGB: number };
  /**
   * field 'split'(MoE) · 'offgpu'(dense) — 행별 GGUF 헤더 실측(10-01·10-03). applyChanges 가 fileGB 뒤에
   * expertGB·nonExpertGB 또는 offGpuGB, 그리고 mtpGB(있을 때) 순서로 기록한다
   */
  split?: SplitValues;
};

/** 행에 기록하는 헤더 실측 — MoE: expertGB·nonExpertGB, dense: offGpuGB. mtpGB 는 0 보다 클 때만 */
export type SplitValues = { expertGB?: number; nonExpertGB?: number; offGpuGB?: number; mtpGB?: number };

/** 행 하나의 헤더 측정 결과 (gguf-header.measureSplit 의 부분집합). fileGB = Content-Range 기준 파일 크기(알면) */
export type MeasuredSplit = { expertGB: number; nonExpertGB: number; offGpuGB: number; mtpGB: number; fileGB?: number };

/** 행 하나의 분할 측정 — 실행부는 gguf-header.measureSplit, 테스트는 모킹 */
export type MeasureSplitFn = (repo: string, fileName: string) => Promise<MeasuredSplit>;

/**
 * 기존 모델에 자동으로 붙이는 표준 양자화 (09-30). **Q4_K_M 은 제외** — 판정 기준 양자화라 사람이 고른다
 * (MXFP4 네이티브 모델에 Q4_K_M 이 붙으면 기준이 바뀐다). Q2_K 는 그 모델에 2비트 행이 없을 때만.
 */
export const AUTO_ROW_QUANTS: readonly QuantId[] = ['IQ4_XS', 'Q8_0', 'Q2_K'];

export type SyncInput = {
  /** raw JSON.parse 레코드 — 키 순서 보존을 위해 zod 파싱본이 아닌 이것을 변경·직렬화한다 */
  rawModels: Record<string, unknown>[];
  rawQuants: Record<string, unknown>[];
  /** zod 파싱본 (읽기 전용) — rawModels/rawQuants 와 인덱스 정렬 */
  models: Model[];
  quants: ModelQuantRecord[];
  treeByRepo: ReadonlyMap<string, TreeEntry[] | { error: string }>;
  configByHfId: ReadonlyMap<string, ConfigResult>;
};

const round2 = (x: number): number => Math.round(x * 100) / 100;

const SUSPICIOUS_DELTA_PCT = 5;

const hfUrl = (repo: string): string => `https://huggingface.co/${repo}`;

export function buildSyncPlan(input: SyncInput): Change[] {
  const changes: Change[] = [];
  /** quant 행 인덱스 → 갱신된 fileGB (MoE 연쇄 계산용) */
  const newFileGB = new Map<number, number>();

  // --- 1) quant 파일 크기 -------------------------------------------------
  input.quants.forEach((mq, i) => {
    const id = `${mq.modelId}/${mq.quant}`;
    const tree = input.treeByRepo.get(mq.ggufRepo);
    if (tree === undefined) return; // --only 필터 등으로 미수집
    if (!Array.isArray(tree)) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileGB',
        kind: 'error',
        note: tree.error,
      });
      return;
    }
    const files = matchQuantFiles(tree, mq.quant);
    if (files.length === 0) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileGB',
        kind: 'error',
        note: `no GGUF files matching ${mq.quant} in ${mq.ggufRepo}`,
      });
      return;
    }
    const primary = primaryFile(files);
    if ('error' in primary) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileName',
        kind: 'error',
        note: `${primary.error} in ${mq.ggufRepo}`,
      });
      return;
    }
    if (mq.fileName !== primary.path) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileName',
        old: mq.fileName,
        next: primary.path,
        kind: 'auto',
        note: primary.shards > 1 ? `${primary.shards}개 분할(첫 조각)` : undefined,
      });
    }
    const gb = sumFileGB(files);
    if (!Number.isFinite(gb)) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileGB',
        kind: 'error',
        note: `tree entry missing size in ${mq.ggufRepo}`,
      });
      return;
    }
    if (gb !== round2(mq.fileGB)) {
      const deltaPct = round2(((gb - mq.fileGB) / mq.fileGB) * 100);
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'fileGB',
        old: mq.fileGB,
        next: gb,
        deltaPct,
        kind: Math.abs(deltaPct) > SUSPICIOUS_DELTA_PCT ? 'suspicious' : 'auto',
        note: files.length > 1 ? `${files.length}개 분할 파일 합산` : undefined,
      });
      newFileGB.set(i, gb);
    }
    const expectedSource = hfUrl(mq.ggufRepo);
    if (!mq.sources.includes(expectedSource)) {
      changes.push({
        file: 'model-quants.json',
        id,
        field: 'sources',
        next: expectedSource,
        kind: 'auto',
        note: 'ggufRepo 출처 URL 추가 (CLAUDE.md 규칙 2)',
      });
    }
  });

  // --- 1b) 새 표준 양자화 행 — 기준 행(Q4_K_M, 없으면 첫 행)의 GGUF repo 에 파일이 새로 생기면 추가 ---
  for (const model of input.models) {
    const rows = input.quants.filter((mq) => mq.modelId === model.id);
    const base = rows.find((mq) => mq.quant === 'Q4_K_M') ?? rows[0];
    if (!base) continue;
    const tree = input.treeByRepo.get(base.ggufRepo);
    if (!Array.isArray(tree)) continue;
    const have = new Set(rows.map((mq) => mq.quant));
    const hasTwoBit = rows.some((mq) => /Q2|IQ2/.test(mq.quant));
    for (const quant of AUTO_ROW_QUANTS) {
      if (have.has(quant) || (quant === 'Q2_K' && hasTwoBit)) continue;
      const files = matchQuantFiles(tree, quant);
      if (files.length === 0) continue;
      const primary = primaryFile(files);
      const gb = sumFileGB(files);
      if ('error' in primary || !Number.isFinite(gb)) continue; // 애매한 파일 구성은 추가하지 않는다(기존 행 규칙과 같은 기준)
      changes.push({
        file: 'model-quants.json',
        id: `${model.id}/${quant}`,
        field: 'row',
        next: gb,
        kind: 'auto',
        note: `새 양자화 행 — ${base.ggufRepo} ${primary.path}${primary.shards > 1 ? ` (${primary.shards}개 분할)` : ''}`,
        newRow: { ggufRepo: base.ggufRepo, fileName: primary.path, fileGB: gb },
      });
    }
  }

  // --- 2) MoE nonExpertGB 연쇄 -------------------------------------------
  for (const model of input.models) {
    const moeArch = MOE_ARCH[model.id];
    if (model.moe && !moeArch) {
      // 행마다 헤더 실측 분할이 있으면 모델 단위 유도값은 필요 없다 — 주간 PR 노이즈 생략
      const rows = input.quants.filter((mq) => mq.modelId === model.id);
      if (rows.length > 0 && rows.every((mq) => mq.expertGB !== undefined)) continue;
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'nonExpertGB',
        old: model.nonExpertGB,
        kind: 'manual',
        note: 'MOE_ARCH 미등록이고 헤더 실측 분할이 없는 행이 있음 — 분할 측정 또는 MOE_ARCH 등록 (근거 없는 상수 금지)',
      });
      continue;
    }
    if (!moeArch || model.nonExpertGB === undefined) continue;
    const baseIdx = input.quants.findIndex(
      (mq) => mq.modelId === model.id && (mq.quant === 'Q4_K_M' || mq.quant === 'MXFP4'),
    );
    if (baseIdx < 0) continue;
    const baseQuant = input.quants[baseIdx];
    if (!baseQuant) continue;
    const baseGB = newFileGB.get(baseIdx) ?? baseQuant.fileGB;
    const derived = round2(deriveNonExpertGB(moeArch, baseGB));
    // validateAll 허용 오차(0.02GB) 초과 시에만 갱신 — 미세 반올림 churn 방지
    if (Math.abs(derived - model.nonExpertGB) > 0.02) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'nonExpertGB',
        old: model.nonExpertGB,
        next: derived,
        kind: 'auto',
        note: `기준 quant ${baseQuant.quant} ${baseGB}GB 유도`,
      });
    }
  }

  // --- 3) config.json → arch / maxContext ---------------------------------
  for (const model of input.models) {
    const res = input.configByHfId.get(model.hfId);
    if (res === undefined) continue; // --only 필터 등으로 미수집
    if (res.gated) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'config',
        kind: 'skipped',
        note: 'gated repo — HF_TOKEN 설정 또는 수동 확인 필요',
      });
      continue;
    }
    if (res.error !== undefined || res.config === undefined) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'config',
        kind: 'error',
        note: res.error ?? 'config missing',
      });
      continue;
    }
    const extracted = extractArch(res.config);
    if (!extracted.arch) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'config',
        kind: 'error',
        note: `config 필드 누락: ${extracted.missing.join(', ')}`,
      });
      continue;
    }
    const { arch } = extracted;
    const isFull = model.arch.attnType === 'full';
    const autoArch = isFull && model.attnOverrides === undefined;
    const overrideNote = model.attnOverrides !== undefined ? ' (attnOverrides 존재)' : '';

    for (const field of ['layers', 'kvHeads', 'headDim'] as const) {
      if (arch[field] !== model.arch[field]) {
        changes.push({
          file: 'models.json',
          id: model.id,
          field: `arch.${field}`,
          old: model.arch[field],
          next: arch[field],
          kind: autoArch ? 'auto' : 'manual',
          note: autoArch ? undefined : `비-full attention — 수동 반영 필요${overrideNote}`,
        });
      }
    }

    const kvFull = kvBytesPerToken(arch);
    if (autoArch) {
      if (kvFull !== model.arch.kvBytesPerTokenF16) {
        changes.push({
          file: 'models.json',
          id: model.id,
          field: 'arch.kvBytesPerTokenF16',
          old: model.arch.kvBytesPerTokenF16,
          next: kvFull,
          kind: 'auto',
          note: 'full attention 공식 재계산 (docs/02 §2.2)',
        });
      }
    } else if (!isFull && model.attnOverrides === undefined) {
      // 참조값만 리포트 — swa/mla/hybrid 보정은 attnOverrides 수동 몫 (docs/03 §5.1).
      // override 확정 후엔 반복 노이즈라 생략 (arch 필드 드리프트 행이 변화 감지를 담당).
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'arch.kvBytesPerTokenF16',
        old: model.arch.kvBytesPerTokenF16,
        next: undefined,
        kind: 'manual',
        note: `참조: full-attn 공식값 ${kvFull} — ${model.arch.attnType} 보정은 attnOverrides 로${overrideNote}`,
      });
    }

    // MoE 구조 드리프트 — 출시된 모델의 전문가 수가 바뀌는 건 이상 신호라 자동 반영하지 않는다 (MOE_ARCH 와도 맞춰야 함)
    const moe = model.activeParamsB !== undefined ? extractMoe(res.config) : undefined;
    if (moe) {
      for (const field of ['experts', 'topK'] as const) {
        if (moe[field] !== model.arch[field]) {
          changes.push({
            file: 'models.json',
            id: model.id,
            field: `arch.${field}`,
            old: model.arch[field],
            next: moe[field],
            kind: 'manual',
            note: 'config 의 MoE 구조와 다름 — 확인 후 arch·MOE_ARCH 수동 반영',
          });
        }
      }
    }

    if (extracted.maxContext !== undefined && extracted.maxContext !== model.maxContext) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'maxContext',
        old: model.maxContext,
        next: extracted.maxContext,
        kind: 'manual',
        note: '시드는 큐레이션 값(YaRN 등) — 자동 미반영',
      });
    }
  }

  return changes;
}

const fmtSplit = (v: SplitValues | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const parts =
    v.offGpuGB !== undefined ? [`off-GPU ${v.offGpuGB}`] : [`expert ${String(v.expertGB)}`, `non-expert ${String(v.nonExpertGB)}`];
  if (v.mtpGB !== undefined) parts.push(`MTP ${v.mtpGB}`);
  return parts.join(' / ');
};

const SPLIT_KEYS = ['expertGB', 'nonExpertGB', 'offGpuGB', 'mtpGB'] as const;

const sameSplit = (a: SplitValues, b: SplitValues): boolean => SPLIT_KEYS.every((k) => a[k] === b[k]);

/** 이 행에 기록된 헤더 실측 — MoE 는 분할 둘 다 있을 때, dense 는 offGpuGB 가 있을 때. 없으면 undefined */
function recordedSplit(mq: ModelQuantRecord, moe: boolean): SplitValues | undefined {
  const mtp = mq.mtpGB !== undefined ? { mtpGB: mq.mtpGB } : {};
  if (moe) {
    return mq.expertGB !== undefined && mq.nonExpertGB !== undefined
      ? { expertGB: mq.expertGB, nonExpertGB: mq.nonExpertGB, ...mtp }
      : undefined;
  }
  return mq.offGpuGB !== undefined ? { offGpuGB: mq.offGpuGB, ...mtp } : undefined;
}

/** 측정 결과 → 행에 쓸 값 (MoE/dense 별 필드, MTP 는 있을 때만) */
function toSplitValues(m: MeasuredSplit, moe: boolean): SplitValues {
  const mtp = m.mtpGB > 0 ? { mtpGB: m.mtpGB } : {};
  return moe ? { expertGB: m.expertGB, nonExpertGB: m.nonExpertGB, ...mtp } : { offGpuGB: m.offGpuGB, ...mtp };
}

/** 기록하면 validateAll 이 거부할 측정 — 다른 파일을 잰 것으로 보고 보류한다. 문제 없으면 undefined */
function implausible(v: SplitValues, m: MeasuredSplit, fileGB: number): string | undefined {
  if (m.fileGB !== undefined && Math.abs(m.fileGB - fileGB) > 0.02) {
    return `측정한 파일 크기 ${m.fileGB}GB ≠ fileGB ${fileGB}`;
  }
  if (v.offGpuGB !== undefined) {
    return v.offGpuGB > fileGB * MAX_OFF_GPU_FRACTION ? `그래픽카드 밖 몫 ${v.offGpuGB}GB 가 fileGB ${fileGB} 의 25% 초과` : undefined;
  }
  const gpu = (v.expertGB ?? 0) + (v.nonExpertGB ?? 0);
  if (gpu > fileGB + 0.02) return `측정 합이 fileGB ${fileGB} 초과`;
  if (gpu < fileGB * (1 - MAX_OFF_GPU_FRACTION)) return `측정 합이 fileGB ${fileGB} 의 75% 미만`;
  return undefined;
}

/**
 * 4) 행별 헤더 실측 — buildSyncPlan 결과(파일 크기·파일명 변경, 새 행)를 보고 잴 행을 고른다.
 * MoE 모델(activeParamsB) 행은 'split'(expertGB·nonExpertGB), dense 행은 'offgpu'(offGpuGB, 10-03 D62) — 둘 다 mtpGB 동반.
 * 대상: 실측 값이 없거나 이번 동기화에서 fileGB·fileName 이 바뀐 행 + 새 양자화 행.
 * 측정값이 기존과 같으면 생략. 값이 없던 행의 측정 실패는 manual(다음 동기화가 다시 시도한다 — 그동안 파일 전체로 판정, 보수).
 * 측정 파일 크기가 fileGB 와 다르거나 값이 validateAll 범위를 벗어나면 다른 파일을 잰 것이므로 보류한다.
 * **값이 있던 행의 파일이 바뀌었는데** 재측정이 실패·보류되면 suspicious — 새 fileGB 옆에 옛 파일의 값이 남고
 * 다음 동기화는 크기 변화가 없어 다시 재지 않으므로, 위임 머지(SUSPICIOUS 0)를 멈춰 사람이 재측정하게 한다(10-01 리뷰).
 */
export async function planSplitChanges(
  input: SyncInput,
  changes: readonly Change[],
  measure: MeasureSplitFn,
  opts: { modelIds?: ReadonlySet<string>; concurrency?: number } = {},
): Promise<Change[]> {
  const inScope = new Set(input.models.filter((m) => opts.modelIds?.has(m.id) ?? true).map((m) => m.id));
  const moeIds = new Set(input.models.filter((m) => m.activeParamsB !== undefined).map((m) => m.id));
  type Target = { id: string; moe: boolean; repo: string; fileName?: string; fileGB: number; old?: SplitValues; reason: string };
  const targets: Target[] = [];
  for (const mq of input.quants) {
    if (!inScope.has(mq.modelId)) continue;
    const moe = moeIds.has(mq.modelId);
    const id = `${mq.modelId}/${mq.quant}`;
    const applied = changes.filter(
      (c) => c.file === 'model-quants.json' && c.id === id && (c.kind === 'auto' || c.kind === 'suspicious'),
    );
    const sizeChange = applied.find((c) => c.field === 'fileGB');
    const nameChange = applied.find((c) => c.field === 'fileName');
    const old = recordedSplit(mq, moe);
    if (old && !sizeChange && !nameChange) continue;
    targets.push({
      id,
      moe,
      repo: mq.ggufRepo,
      fileName: typeof nameChange?.next === 'string' ? nameChange.next : mq.fileName,
      fileGB: typeof sizeChange?.next === 'number' ? sizeChange.next : mq.fileGB,
      old,
      reason: !old ? (moe ? '분할 값 없음' : '그래픽카드 밖 몫 없음') : sizeChange ? '파일 크기 변경' : '파일명 변경',
    });
  }
  for (const c of changes) {
    if (c.field !== 'row' || c.kind !== 'auto' || c.newRow === undefined) continue;
    const modelId = c.id.split('/')[0] ?? '';
    if (!inScope.has(modelId)) continue;
    const { ggufRepo, fileName, fileGB } = c.newRow;
    targets.push({ id: c.id, moe: moeIds.has(modelId), repo: ggufRepo, fileName, fileGB, reason: '새 양자화 행' });
  }

  const results: Array<Change | undefined> = new Array<Change | undefined>(targets.length);
  const indexed = targets.map((target, i) => ({ target, i }));
  await mapPool(indexed, opts.concurrency ?? 4, async ({ target: t, i }) => {
    const fields = t.moe ? 'expertGB/nonExpertGB' : 'offGpuGB';
    const base = { file: 'model-quants.json' as const, id: t.id, field: t.moe ? 'split' : 'offgpu', old: fmtSplit(t.old) };
    if (t.fileName === undefined) {
      results[i] = { ...base, kind: 'manual', note: 'fileName 없음 — 헤더 측정 불가' };
      return;
    }
    let m: MeasuredSplit;
    try {
      m = await measure(t.repo, t.fileName);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      results[i] = t.old
        ? { ...base, kind: 'suspicious', note: `${t.reason} 뒤 GGUF 헤더 재측정 실패(${reason}) — 옛 파일의 값이 남음, 머지 전 재측정` }
        : { ...base, kind: 'manual', note: `GGUF 헤더 측정 실패(${reason}) — ${fields} 그대로` };
      return;
    }
    const split = toSplitValues(m, t.moe);
    if (t.old && sameSplit(t.old, split)) return;
    const problem = implausible(split, m, t.fileGB);
    if (problem !== undefined) {
      results[i] = {
        ...base,
        next: fmtSplit(split),
        kind: t.old ? 'suspicious' : 'manual',
        note: `${problem} — 다른 파일을 쟀을 수 있음, 미반영${t.old ? ' (옛 파일의 값이 남음, 머지 전 재측정)' : ''}`,
      };
      return;
    }
    results[i] = { ...base, next: fmtSplit(split), kind: 'auto', note: `GGUF 헤더 실측 — ${t.reason}`, split };
  });
  return results.filter((c): c is Change => c !== undefined);
}

/** `key` 를 `after` 바로 뒤에 두고(이미 있으면 제자리 갱신) 레코드를 재구성한다. */
export function withKeyAfter(
  raw: Record<string, unknown>,
  key: string,
  value: unknown,
  after: string,
): Record<string, unknown> {
  if (key in raw) return { ...raw, [key]: value };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v;
    if (k === after) out[key] = value;
  }
  if (!(key in out)) out[key] = value;
  return out;
}

const isSplitField = (field: string): boolean => field === 'split' || field === 'offgpu';

/** auto/suspicious 변경만 raw 레코드에 반영 (키 순서 보존 — 값 갱신·sources push 만). */
export function applyChanges(changes: readonly Change[], input: SyncInput): void {
  for (const change of changes) {
    if (change.kind !== 'auto' && change.kind !== 'suspicious') continue;
    if (change.field === 'row' || isSplitField(change.field)) continue; // 새 행은 인덱스 정렬을 깨므로 맨 마지막에 삽입, 헤더 실측은 그 뒤
    if (change.file === 'model-quants.json') {
      const idx = input.quants.findIndex((mq) => `${mq.modelId}/${mq.quant}` === change.id);
      const raw = idx >= 0 ? input.rawQuants[idx] : undefined;
      if (!raw) throw new Error(`applyChanges: quant row not found for ${change.id}`);
      if (change.field === 'fileGB' && typeof change.next === 'number') {
        raw['fileGB'] = change.next;
      } else if (change.field === 'fileName' && typeof change.next === 'string') {
        // 키 순서 유지: 없던 키는 ggufRepo 뒤에 삽입 (레코드 재구성 — 대입은 sources 뒤에 붙는다)
        input.rawQuants[idx] = withKeyAfter(raw, 'fileName', change.next, 'ggufRepo');
      } else if (change.field === 'sources' && typeof change.next === 'string') {
        (raw['sources'] as string[]).push(change.next);
      }
    } else {
      const idx = input.models.findIndex((model) => model.id === change.id);
      const raw = idx >= 0 ? input.rawModels[idx] : undefined;
      if (!raw) throw new Error(`applyChanges: model not found for ${change.id}`);
      if (change.field === 'nonExpertGB' && typeof change.next === 'number') {
        raw['nonExpertGB'] = change.next;
      } else if (change.field.startsWith('arch.') && typeof change.next === 'number') {
        const arch = raw['arch'] as Record<string, unknown>;
        arch[change.field.slice('arch.'.length)] = change.next;
      }
    }
  }
  // 새 양자화 행 — 그 모델의 마지막 행 바로 뒤 (파일 안에서 모델별로 묶여 있게)
  for (const change of changes) {
    if (change.field !== 'row' || change.newRow === undefined || change.kind !== 'auto') continue;
    const [modelId, quant] = change.id.split('/') as [string, string];
    let at = -1;
    input.rawQuants.forEach((raw, i) => {
      if (raw['modelId'] === modelId) at = i;
    });
    if (at < 0) throw new Error(`applyChanges: no existing row for ${modelId}`);
    const { ggufRepo, fileName, fileGB } = change.newRow;
    input.rawQuants.splice(at + 1, 0, { modelId, quant, fileGB, ggufRepo, fileName, sources: [hfUrl(ggufRepo)] });
  }
  // 헤더 실측 — 새 행까지 삽입된 뒤라 (modelId, quant) 로 찾는다. 키는 fileGB 바로 뒤
  // (expertGB, nonExpertGB | offGpuGB, mtpGB). 새 측정에 MTP 가 없으면 옛 mtpGB 는 지운다
  for (const change of changes) {
    if (!isSplitField(change.field) || change.split === undefined || change.kind !== 'auto') continue;
    const idx = input.rawQuants.findIndex(
      (raw) => `${String(raw['modelId'])}/${String(raw['quant'])}` === change.id,
    );
    let raw = input.rawQuants[idx];
    if (!raw) throw new Error(`applyChanges: quant row not found for ${change.id}`);
    let after = 'fileGB';
    for (const key of SPLIT_KEYS) {
      const value = change.split[key];
      if (value === undefined) {
        if (key === 'mtpGB' && key in raw) raw = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== key));
        continue;
      }
      raw = withKeyAfter(raw, key, value, after);
      after = key;
    }
    input.rawQuants[idx] = raw;
  }
}

const KIND_LABEL: Record<Change['kind'], string> = {
  auto: 'auto',
  suspicious: 'auto ⚠SUSPICIOUS',
  manual: 'manual',
  skipped: 'skipped',
  error: 'ERROR',
};

const fmt = (v: number | string | undefined): string => (v === undefined ? '—' : String(v));

/** 마크다운 diff 리포트 — PR body 겸용. */
export function renderReport(changes: readonly Change[]): string {
  const lines: string[] = ['# HF sync report', ''];
  for (const file of ['model-quants.json', 'models.json'] as const) {
    const rows = changes.filter((c) => c.file === file);
    if (rows.length === 0) continue;
    lines.push(
      `## ${file}`,
      '',
      '| id | field | seed | actual | Δ% | action | note |',
      '|---|---|---|---|---|---|---|',
    );
    for (const c of rows) {
      const delta = c.deltaPct === undefined ? '—' : `${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%`;
      lines.push(
        `| ${c.id} | ${c.field} | ${fmt(c.old)} | ${fmt(c.next)} | ${delta} | ${KIND_LABEL[c.kind]} | ${c.note ?? ''} |`,
      );
    }
    lines.push('');
  }
  const count = (kind: Change['kind']): number => changes.filter((c) => c.kind === kind).length;
  lines.push(
    `**${count('auto')} auto, ${count('suspicious')} suspicious, ${count('manual')} manual, ${count('skipped')} skipped, ${count('error')} error** — 시드 일치 항목은 표시하지 않음`,
  );
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 실행부 (네트워크·fs)
// ---------------------------------------------------------------------------

/** 동시성 제한 병렬 실행 — HF 공개 API 예의(무토큰) 수준인 4 를 기본으로. */
async function mapPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
}

type CliArgs = { dry: boolean; report?: string; only?: string };

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm run 이 구분자를 그대로 전달하는 케이스
    if (arg === '--dry') args.dry = true;
    else if (arg === '--report' || arg === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--report') args.report = value;
      else args.only = value;
      i += 1;
    } else throw new Error(`unknown argument: ${String(arg)}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env['HF_TOKEN'];

  const rawModels = JSON.parse(
    readFileSync(join(dataDir, 'models.json'), 'utf8'),
  ) as Record<string, unknown>[];
  const rawQuants = JSON.parse(
    readFileSync(join(dataDir, 'model-quants.json'), 'utf8'),
  ) as Record<string, unknown>[];
  const models = parseModels(rawModels);
  const quants = parseModelQuants(rawQuants);

  const targetModels = args.only ? models.filter((m) => m.id === args.only) : models;
  if (targetModels.length === 0) throw new Error(`--only: unknown modelId '${String(args.only)}'`);
  const targetIds = new Set(targetModels.map((m) => m.id));
  const targetQuants = quants.filter((mq) => targetIds.has(mq.modelId));

  const repos = [...new Set(targetQuants.map((mq) => mq.ggufRepo))];
  console.log(
    `fetching ${repos.length} GGUF repo tree(s) + ${targetModels.length} config(s) from HF…`,
  );

  const treeByRepo = new Map<string, TreeEntry[] | { error: string }>();
  await mapPool(repos, 4, async (repo) => {
    try {
      treeByRepo.set(repo, await fetchTree(repo, { token }));
      console.log(`✓ tree ${repo}`);
    } catch (err) {
      treeByRepo.set(repo, { error: err instanceof Error ? err.message : String(err) });
      console.log(`✗ tree ${repo}`);
    }
  });

  const configByHfId = new Map<string, ConfigResult>();
  await mapPool(targetModels, 4, async (model) => {
    const res = await fetchConfig(model.hfId, { token });
    configByHfId.set(model.hfId, res);
    const mark = res.config !== undefined ? '✓' : '✗';
    console.log(`${mark} config ${model.hfId}${res.gated ? ' (gated)' : ''}`);
  });

  const input: SyncInput = { rawModels, rawQuants, models, quants, treeByRepo, configByHfId };
  const planned = buildSyncPlan(input);
  // 행별 헤더 실측(MoE 분할·dense 그래픽카드 밖 몫·MTP) — 헤더만 Range 로 읽는다(행당 수 MB). 측정 실패는 manual 로 리포트
  const splitChanges = await planSplitChanges(
    input,
    planned,
    (repo, fileName) => measureSplit(repo, fileName, { token }),
    { modelIds: targetIds },
  );
  if (splitChanges.length > 0) console.log(`measured ${splitChanges.length} row(s) from GGUF headers`);
  const changes = [...planned, ...splitChanges];
  const report = renderReport(changes);
  console.log(`\n${report}`);
  if (args.report !== undefined) {
    writeFileSync(join(repoRoot, args.report), report);
    console.log(`report written: ${args.report}`);
  }

  if (!args.dry) {
    applyChanges(changes, input);
    // 자가검증: 쓰기 전 zod 재파싱 — 스키마 위반 상태로 디스크에 남기지 않는다
    parseModels(rawModels);
    parseModelQuants(rawQuants);
    const nextModels = serializeRecords(rawModels);
    const nextQuants = serializeRecords(rawQuants);
    const changed =
      nextModels !== readFileSync(join(dataDir, 'models.json'), 'utf8') ||
      nextQuants !== readFileSync(join(dataDir, 'model-quants.json'), 'utf8');
    writeFileSync(join(dataDir, 'models.json'), nextModels);
    writeFileSync(join(dataDir, 'model-quants.json'), nextQuants);
    console.log('data/models.json, data/model-quants.json updated');
    // 데이터 기준일(P1-5) — 내용이 실제로 바뀐 날만 갱신. 스크립트는 빌드가 아니라 Date 사용 가능(D21 은 빌드 결정론)
    if (changed) {
      const today = new Date().toISOString().slice(0, 10);
      writeFileSync(join(dataDir, 'meta.json'), `${JSON.stringify({ dataUpdated: today }, null, 2)}\n`);
      console.log(`data/meta.json dataUpdated = ${today}`);
    }
  } else {
    console.log('--dry: data/*.json untouched');
  }

  if (changes.some((c) => c.kind === 'error')) {
    console.error('\n✗ error rows present — see report');
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
