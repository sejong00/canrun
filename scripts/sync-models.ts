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
 *
 * 실행: pnpm run sync-models -- --dry [--report <path>] [--only <modelId>]
 *   --dry 는 data/*.json 을 건드리지 않는다(리포트 파일은 PR body 용도로 작성 허용).
 * PR 생성은 .github/workflows/data-sync.yml 담당 — 스크립트는 로컬 파일까지만.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOE_ARCH,
  deriveNonExpertGB,
  parseModelQuants,
  parseModels,
  type Model,
  type ModelQuantRecord,
} from '../packages/data/src/index';
import { kvBytesPerToken } from '../packages/engine/src/index';
import {
  fetchConfig,
  fetchTree,
  serializeRecords,
  type ConfigResult,
  type TreeEntry,
} from './hf-common';

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
};

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

/**
 * tree 항목에서 quant 파일 매칭 — 경계 규칙으로 근접 오매칭 차단:
 * 앞 경계 ^|-|_|.|/ (IQ2_K 의 'I' 는 경계 아님 → Q2_K 미매칭),
 * 뒤 경계 -|.|/ 또는 끝 ('_' 제외 → Q4_K_M_L 미매칭). 대소문자 무시(mxfp4).
 * mmproj-*.gguf(비전 프로젝터)는 모델 가중치가 아니므로 제외.
 */
export function matchQuantFiles(entries: readonly TreeEntry[], quant: QuantId): TreeEntry[] {
  const esc = quant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[-_./])${esc}(?:[-./]|$)`, 'i');
  return entries.filter((entry) => {
    if (entry.type !== 'file') return false;
    const path = entry.path;
    if (!path.toLowerCase().endsWith('.gguf')) return false;
    const base = path.split('/').at(-1) ?? path;
    if (base.toLowerCase().startsWith('mmproj')) return false;
    return re.test(path);
  });
}

/** 분할 파일 합산 → decimal GB 2자리. size 누락 항목이 있으면 NaN. */
export function sumFileGB(entries: readonly TreeEntry[]): number {
  let bytes = 0;
  for (const entry of entries) {
    if (entry.size === undefined) return Number.NaN;
    bytes += entry.size;
  }
  return round2(bytes / 1e9);
}

export type ExtractedArch = {
  arch?: { layers: number; kvHeads: number; headDim: number };
  maxContext?: number;
  missing: string[];
};

/**
 * config.json → arch 추출. 멀티모달 래퍼는 text_config 우선.
 * head_dim 폴백 = hidden_size / num_attention_heads, kvHeads 폴백 = num_attention_heads(MHA).
 * 추출 불가 필드는 missing 으로 보고 — 추측 금지(CLAUDE.md 규칙 3).
 */
export function extractArch(config: unknown): ExtractedArch {
  if (typeof config !== 'object' || config === null) {
    return { missing: ['config'] };
  }
  const top = config as Record<string, unknown>;
  const nested = top['text_config'];
  const cfg =
    typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : top;

  const posInt = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

  const layers = posInt(cfg['num_hidden_layers']);
  const attnHeads = posInt(cfg['num_attention_heads']);
  const kvHeads = posInt(cfg['num_key_value_heads']) ?? attnHeads;
  const hiddenSize = posInt(cfg['hidden_size']);
  let headDim = posInt(cfg['head_dim']);
  if (headDim === undefined && hiddenSize !== undefined && attnHeads !== undefined) {
    const derived = hiddenSize / attnHeads;
    if (Number.isInteger(derived) && derived > 0) headDim = derived;
  }
  const maxContext = posInt(cfg['max_position_embeddings'] ?? top['max_position_embeddings']);

  const missing: string[] = [];
  if (layers === undefined) missing.push('num_hidden_layers');
  if (kvHeads === undefined) missing.push('num_key_value_heads');
  if (headDim === undefined) missing.push('head_dim');

  if (layers === undefined || kvHeads === undefined || headDim === undefined) {
    return { maxContext, missing };
  }
  return { arch: { layers, kvHeads, headDim }, maxContext, missing };
}

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

  // --- 2) MoE nonExpertGB 연쇄 -------------------------------------------
  for (const model of input.models) {
    const moeArch = MOE_ARCH[model.id];
    if (model.moe && !moeArch) {
      changes.push({
        file: 'models.json',
        id: model.id,
        field: 'nonExpertGB',
        old: model.nonExpertGB,
        kind: 'manual',
        note: 'experts/topK 미문서 — MOE_ARCH 등록 후 유도 가능 (근거 없는 상수 금지)',
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
    } else if (!isFull) {
      // 참조값만 리포트 — swa/mla/hybrid 보정은 attnOverrides 수동 몫 (docs/03 §5.1)
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

/** auto/suspicious 변경만 raw 레코드에 반영 (키 순서 보존 — 값 갱신·sources push 만). */
export function applyChanges(changes: readonly Change[], input: SyncInput): void {
  for (const change of changes) {
    if (change.kind !== 'auto' && change.kind !== 'suspicious') continue;
    if (change.file === 'model-quants.json') {
      const idx = input.quants.findIndex((mq) => `${mq.modelId}/${mq.quant}` === change.id);
      const raw = idx >= 0 ? input.rawQuants[idx] : undefined;
      if (!raw) throw new Error(`applyChanges: quant row not found for ${change.id}`);
      if (change.field === 'fileGB' && typeof change.next === 'number') {
        raw['fileGB'] = change.next;
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
  const changes = buildSyncPlan(input);
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
    writeFileSync(join(dataDir, 'models.json'), serializeRecords(rawModels));
    writeFileSync(join(dataDir, 'model-quants.json'), serializeRecords(rawQuants));
    console.log('data/models.json, data/model-quants.json updated');
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
