/**
 * 새 모델 추가 — 카탈로그 확장 자동화 (09-30). HF 모델 ID 하나로 models.json·model-quants.json 레코드를 만든다.
 *
 * 실행: pnpm run add-model -- <hfId> [--id <slug>] [--name "<표시명>"] [--gguf <repo>] [--active <B>]
 *                                    [--category chat,coding] [--thinking always|default-on|default-off|auto]
 *                                    [--popularity 1-5] [--max-context N] [--korean] [--dry]
 *
 * 하는 일:
 *  1) HF 모델 정보(파라미터 수·라이선스·생성일·다운로드)와 config.json 을 받는다. 게이트 모델은 unsloth 미러 config 로 대체하고 출처에 남긴다.
 *  2) 구조를 분류한다 — **선례가 있는 구조만 자동**(PROGRESS §4 D53·D63): 전체 어텐션 · 슬라이딩 윈도(layer_types) · 하이브리드 선형(layer_types)
 *     · 상수 상태 층 하이브리드(nemotron_h Mamba2 · lfm2 short-conv · bailing_hybrid KDA+MLA — 층 지도가 있을 때만).
 *     처음 보는 model_type, 반복 층·디스크 n-gram 임베딩·압축 어텐션 등은 "보류"로 멈춘다 — 엔진이 그 메모리를 모델링하지 않아 판정이 틀린다.
 *  3) GGUF 저장소를 고른다(공식 → ggml-org → bartowski → unsloth → lmstudio-community, Q4_K_M 이 있는 첫 곳) — 파일명·크기는 트리에서.
 *  4) 레코드를 쓰고(원본 저장소 최근 30일 다운로드 수·기준일 포함 — D68), MoE 면 MOE_ARCH 에 한 줄 넣어 nonExpertGB 를 유도, data/meta.json 기준일을 오늘로.
 *     양자화 행마다 GGUF 헤더를 Range 로 읽는다(scripts/gguf-header.ts): MoE 는 expertGB·nonExpertGB(10-01),
 *     dense 는 그래픽카드에 올리지 않는 몫 offGpuGB(10-03 D62), 둘 다 MTP 블록이 있으면 mtpGB.
 *     MoE 는 arch.experts/topK(config)를 기록하고, 헤더의 expert_count·expert_used_count 가 config 와 다르면 멈춘다.
 * 사람이 확인할 것(출력에 표시): 생각 모드(--thinking, 판정 기준 1.5배 — 모델 카드·채팅 템플릿, D59)·카테고리·표시명·인기도·처음 보는 라이선스 문자열.
 * 실행 후: pnpm run validate-data → pnpm test → pnpm build → pnpm run test:export.
 * 매일 도는 신모델 자동 추가(scripts/auto-add-models.ts, 10-06 D71)가 planAddition·applyAddition 을 그대로 불러 쓴다.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_OFF_GPU_FRACTION,
  classifyLicense,
  deriveNonExpertGB,
  parseModelQuants,
  parseModels,
  type ModelQuantRecord,
} from '../packages/data/src/index';
import {
  activeFromName,
  classifyArch,
  displayName,
  familyOf,
  mapLicense,
  popularityFrom,
  quantRowsFrom,
  rankGgufRepos,
  slugFromHfId,
} from '../packages/data/src/hf';
import { measureSplit } from './gguf-header';
import { downloadsFields, fetchConfig, fetchTree, serializeRecords } from './hf-common';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const round2 = (x: number): number => Math.round(x * 100) / 100;
const hfUrl = (repo: string): string => `https://huggingface.co/${repo}`;
const configUrl = (repo: string): string => `https://huggingface.co/${repo}/blob/main/config.json`;

// ---------------------------------------------------------------------------
// 순수 코어 (scripts/add-model.test.ts)
// 구조 분류·이름·라이선스·GGUF 저장소 선택·양자화 행은 브라우저 안전 모듈(packages/data/src/hf.ts)로 옮겼다 —
// 계산기의 "카탈로그 밖 모델 확인"과 같은 코드. 기존 import 호환용으로 다시 내보낸다.
// ---------------------------------------------------------------------------

export {
  KNOWN_MODEL_TYPES,
  activeFromName,
  classifyArch,
  displayName,
  familyOf,
  mapLicense,
  popularityFrom,
  quantRowsFrom,
  rankGgufRepos,
  slugFromHfId,
} from '../packages/data/src/hf';
export type { ArchResult } from '../packages/data/src/hf';
export { downloadsFields } from './hf-common';

/** GGUF 헤더 실측 중 add-model 이 쓰는 값 (gguf-header.measureSplit 의 부분집합). fileGB = Content-Range 기준(알면) */
export type RowMeasure = {
  expertGB: number;
  nonExpertGB: number;
  offGpuGB: number;
  mtpGB: number;
  fileGB?: number;
  trunkLayers: number;
  expertCount?: number;
  expertUsed?: number;
};
export type MeasureRowFn = (repo: string, fileName: string) => Promise<RowMeasure>;

/** 행에 헤더 실측을 넣는다 — 키 순서는 시드와 같게 fileGB 바로 뒤(MoE 분할 | dense offGpuGB, 그다음 mtpGB) */
function withMeasure(row: ModelQuantRecord, m: RowMeasure, moe: boolean): ModelQuantRecord {
  const { modelId, quant, fileGB, ggufRepo, fileName, sources } = row;
  const split = moe ? { expertGB: m.expertGB, nonExpertGB: m.nonExpertGB } : { offGpuGB: m.offGpuGB };
  return {
    modelId,
    quant,
    fileGB,
    ...split,
    ...(m.mtpGB > 0 ? { mtpGB: m.mtpGB } : {}),
    ggufRepo,
    ...(fileName !== undefined ? { fileName } : {}),
    sources,
  };
}

/** validateAll 이 거부할 측정(다른 파일을 잰 것) — 그 행은 실측 없이 기록한다. 문제 없으면 undefined */
function implausibleMeasure(m: RowMeasure, fileGB: number, moe: boolean): string | undefined {
  if (m.fileGB !== undefined && Math.abs(m.fileGB - fileGB) > 0.02) return `측정한 파일 크기 ${m.fileGB}GB ≠ fileGB ${fileGB}`;
  if (!moe) {
    return m.offGpuGB > fileGB * MAX_OFF_GPU_FRACTION ? `그래픽카드 밖 몫 ${m.offGpuGB}GB > fileGB ${fileGB} 의 25%` : undefined;
  }
  const gpu = m.expertGB + m.nonExpertGB;
  if (gpu > fileGB + 0.02) return `측정 합 ${gpu.toFixed(2)}GB > fileGB ${fileGB}`;
  if (gpu < fileGB * (1 - MAX_OFF_GPU_FRACTION)) return `측정 합 ${gpu.toFixed(2)}GB < fileGB ${fileGB} 의 75%`;
  return undefined;
}

/**
 * 행별 GGUF 헤더 실측 + 헤더 대조. MoE(`moe` 있음)는 expertGB·nonExpertGB, dense 는 offGpuGB(10-03 D62), 둘 다 mtpGB.
 * problems(쓰기 중단): 헤더 expert_count·expert_used_count ≠ config.
 * warnings(진행): 측정 실패·값이 파일과 안 맞음(그 행은 실측 없이 기록 — 다음 sync-models 가 다시 잰다) · 트렁크 층 수 ≠ config layers.
 */
export async function measureRows(
  rows: readonly ModelQuantRecord[],
  moe: { experts: number; topK: number } | undefined,
  layers: number,
  measure: MeasureRowFn,
): Promise<{ rows: ModelQuantRecord[]; problems: string[]; warnings: string[] }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const out: ModelQuantRecord[] = [];
  for (const row of rows) {
    const label = `${row.quant} ${row.ggufRepo}/${row.fileName ?? ''}`;
    if (row.fileName === undefined) {
      warnings.push(`${label}: 파일명 없음 — 헤더 측정 생략`);
      out.push(row);
      continue;
    }
    let m: RowMeasure;
    try {
      m = await measure(row.ggufRepo, row.fileName);
    } catch (err) {
      warnings.push(`${label}: GGUF 헤더 측정 실패(${err instanceof Error ? err.message : String(err)}) — 실측 없이 기록, 다음 sync-models 가 다시 잰다`);
      out.push(row);
      continue;
    }
    if (moe) {
      if (m.expertCount !== undefined && m.expertCount !== moe.experts) {
        problems.push(`${label}: 헤더 expert_count ${m.expertCount} ≠ config ${moe.experts}`);
      }
      if (m.expertUsed !== undefined && m.expertUsed !== moe.topK) {
        problems.push(`${label}: 헤더 expert_used_count ${m.expertUsed} ≠ config ${moe.topK}`);
      }
      if (m.expertCount === undefined || m.expertUsed === undefined) {
        warnings.push(`${label}: 헤더에 expert_count/expert_used_count 없음 — config 값만 사용`);
      }
    }
    if (m.trunkLayers !== layers) {
      warnings.push(`${label}: 헤더 트렁크 층 ${m.trunkLayers} ≠ config num_hidden_layers ${layers} — arch.layers 확인`);
    }
    const problem = implausibleMeasure(m, row.fileGB, moe !== undefined);
    if (problem !== undefined) {
      warnings.push(`${label}: ${problem} — 실측 없이 기록`);
      out.push(row);
      continue;
    }
    out.push(withMeasure(row, m, moe !== undefined));
  }
  return { rows: out, problems, warnings };
}

// ---------------------------------------------------------------------------
// 실행부 — planAddition(HF 읽기 → 레코드 계획, 쓰지 않음) · applyAddition(파일 쓰기).
// CLI(main)와 신모델 자동 추가(scripts/auto-add-models.ts, 10-06 D71)가 같은 함수를 쓴다.
// ---------------------------------------------------------------------------

export type Thinking = 'always' | 'default-on' | 'default-off' | 'auto';
export const THINKING_VALUES: readonly Thinking[] = ['always', 'default-on', 'default-off', 'auto'];

/**
 * 레코드 옵션 — CLI 플래그와 같은 뜻.
 * visionFromConfig(자동 추가 전용): category 를 넘겨도 config 에 비전 인코더가 있으면 vision 을 더한다(CLI 의 --category 는 그대로 둔다).
 */
export type AddOptions = {
  id?: string;
  name?: string;
  gguf?: string;
  active?: number;
  category?: string[];
  thinking?: Thinking;
  popularity?: number;
  maxContext?: number;
  korean: boolean;
  visionFromConfig?: boolean;
};
type Args = AddOptions & { hfId?: string; dry: boolean };

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { korean: false, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const val = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return v;
    };
    if (arg === '--') continue;
    else if (arg === '--dry') a.dry = true;
    else if (arg === '--korean') a.korean = true;
    else if (arg === '--id') a.id = val();
    else if (arg === '--name') a.name = val();
    else if (arg === '--gguf') a.gguf = val();
    else if (arg === '--active') a.active = Number(val());
    else if (arg === '--category') a.category = val().split(',');
    else if (arg === '--thinking') {
      const v = val();
      if (!(THINKING_VALUES as readonly string[]).includes(v)) throw new Error(`--thinking must be one of ${THINKING_VALUES.join('|')}`);
      a.thinking = v as Thinking;
    }
    else if (arg === '--popularity') a.popularity = Number(val());
    else if (arg === '--max-context') a.maxContext = Number(val());
    else if (!arg.startsWith('--') && a.hfId === undefined) a.hfId = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return a;
}

/** 카탈로그 원본 레코드 — 키 순서 보존을 위해 zod 파싱본이 아닌 raw JSON.parse 결과를 고쳐 직렬화한다 */
export type CatalogRaw = { rawModels: Record<string, unknown>[]; rawQuants: Record<string, unknown>[] };

export function readCatalogRaw(root = repoRoot): CatalogRaw {
  return {
    rawModels: JSON.parse(readFileSync(join(root, 'data/models.json'), 'utf8')) as Record<string, unknown>[],
    rawQuants: JSON.parse(readFileSync(join(root, 'data/model-quants.json'), 'utf8')) as Record<string, unknown>[],
  };
}

/** 쓰기 전 계획 — 레코드·양자화 행·MOE_ARCH 한 줄 + 사람용 출력·확인할 것 + 보고서용 요약 */
export type AdditionPlan = {
  hfId: string;
  id: string;
  name: string;
  record: Record<string, unknown>;
  rows: ModelQuantRecord[];
  /** MoE 면 packages/data/src/index.ts MOE_ARCH 에 넣을 한 줄 */
  moeLine?: string;
  lines: string[];
  warnings: string[];
  summary: {
    modelType: string;
    attnType: string;
    moe?: { experts: number; topK: number };
    paramsB: number;
    activeParamsB?: number;
    ggufRepo: string;
    license: string;
    category: string[];
    maxContext: number;
    popularity: number;
    vision: boolean;
  };
};

/** 보류(선례 없는 구조)는 kind 'held'. 그 밖의 멈춤은 throw — 메시지가 곧 사유 */
export type PlanResult = { kind: 'ok'; plan: AdditionPlan } | { kind: 'held'; reason: string };

/**
 * HF 에서 읽어 레코드를 계획한다 — 파일은 쓰지 않는다(--dry 와 같은 범위: 모델 정보·config·GGUF 트리·헤더 Range 읽기).
 * throw: 모델 없음 · 이미 카탈로그에 있음 · config 못 받음 · Q4_K_M GGUF 없음 · 파라미터 수 없음 · 헤더 MoE 구조 ≠ config · MoE 활성 파라미터 모름 · 스키마 위반.
 */
export async function planAddition(
  hfId: string,
  opts: AddOptions,
  ctx: CatalogRaw & { token?: string; today: string },
): Promise<PlanResult> {
  const { token, today, rawModels, rawQuants } = ctx;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

  const info = (await (await fetch(`https://huggingface.co/api/models/${hfId}`, { headers })).json()) as {
    id?: string; gated?: unknown; createdAt?: string; downloads?: number; pipeline_tag?: string;
    cardData?: { license?: string; license_name?: string }; safetensors?: { total?: number };
  };
  if (!info.id) throw new Error(`HF 모델을 찾지 못함: ${hfId}`);

  const id = opts.id ?? slugFromHfId(hfId);
  if (rawModels.some((m) => m['id'] === id || m['hfId'] === hfId)) throw new Error(`이미 카탈로그에 있음: ${id} / ${hfId}`);

  // config — 게이트면 unsloth 미러
  let cfgRes = await fetchConfig(hfId, { token });
  let mirror: string | undefined;
  if (cfgRes.config === undefined) {
    mirror = `unsloth/${hfId.split('/')[1]}`;
    cfgRes = await fetchConfig(mirror, { token });
    if (cfgRes.config === undefined) throw new Error(`config 를 받지 못함(${cfgRes.gated ? '게이트' : cfgRes.error}) — HF_TOKEN 또는 --수동`);
  }
  const arch = classifyArch(cfgRes.config);
  if (arch.kind === 'unsupported') return { kind: 'held', reason: arch.reason };

  // GGUF repo
  const search = (await (await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(hfId.split('/')[1]!)}&filter=gguf&sort=downloads&limit=40`, { headers })).json()) as Array<{ id: string }>;
  const repos = opts.gguf ? [opts.gguf] : rankGgufRepos(search.map((r) => r.id), hfId);
  let rows: ModelQuantRecord[] = [];
  for (const repo of repos) {
    rows = quantRowsFrom(await fetchTree(repo, { token }), repo, id);
    if (rows.length > 0) break;
  }
  if (rows.length === 0) throw new Error(`Q4_K_M GGUF 를 찾지 못함 (후보: ${repos.join(', ') || '없음'}) — --gguf 로 지정`);

  const name = opts.name ?? displayName(hfId);
  const paramsB = info.safetensors?.total ? round2(info.safetensors.total / 1e9) : undefined;
  if (!paramsB) throw new Error('파라미터 수(safetensors.total)를 받지 못함');
  const license = mapLicense(info.cardData?.license, info.cardData?.license_name);
  const vision = arch.vision || info.pipeline_tag === 'image-text-to-text';
  const baseCategory = opts.category ?? ['chat', ...(/coder/i.test(hfId) ? ['coding'] : []), ...(vision ? ['vision'] : [])];
  const category = opts.visionFromConfig && arch.vision && !baseCategory.includes('vision') ? [...baseCategory, 'vision'] : baseCategory;
  const src = mirror ? configUrl(mirror) : configUrl(hfId);

  let moeFields: Record<string, unknown> = {};
  const splitWarnings: string[] = [];
  // 행마다 헤더 실측 — MoE 분할(10-01), dense 그래픽카드 밖 몫(10-03 D62), MTP 블록
  const measured = await measureRows(rows, arch.moe, arch.arch.layers, (repo, fileName) => measureSplit(repo, fileName, { token }));
  if (measured.problems.length > 0) {
    throw new Error(`GGUF 헤더의 MoE 구조가 config 와 다름 — 쓰지 않음:\n  ${measured.problems.join('\n  ')}`);
  }
  rows = measured.rows;
  splitWarnings.push(...measured.warnings);
  if (arch.moe) {
    const active = opts.active ?? activeFromName(hfId);
    if (active === undefined) throw new Error('MoE 활성 파라미터를 이름에서 못 읽음 — --active <B> 로 지정(모델 카드 기준)');
    const q4 = rows.find((r) => r.quant === 'Q4_K_M')!;
    const nonExpertGB = round2(deriveNonExpertGB({ totalParamsB: paramsB, activeParamsB: active, experts: arch.moe.experts, topK: arch.moe.topK }, q4.fileGB));
    moeFields = { activeParamsB: active, moe: true, nonExpertGB };
  }

  const popularity = opts.popularity ?? popularityFrom(info.downloads);
  const maxContext = opts.maxContext ?? arch.maxContext;
  const record: Record<string, unknown> = {
    id, family: familyOf(name), name, hfId, paramsB,
    ...(moeFields['activeParamsB'] !== undefined ? { activeParamsB: moeFields['activeParamsB'] } : {}),
    arch: {
      layers: arch.arch.layers, kvHeads: arch.arch.kvHeads, headDim: arch.arch.headDim, attnType: arch.attnType, kvBytesPerTokenF16: arch.arch.kvBytesPerTokenF16,
      ...(arch.moe ? { experts: arch.moe.experts, topK: arch.moe.topK } : {}),
      ...(arch.expertLayers ? { expertLayers: arch.expertLayers } : {}),
    },
    // 산식 근거(llama.cpp 가 KV 를 두는 층 — D63)가 있으면 config 출처 뒤에 덧붙인다
    ...(arch.override
      ? { attnOverrides: { kvBytesPerTokenF16: arch.override.kvBytesPerTokenF16, reason: arch.override.reason, sources: [src, ...(arch.override.refs ?? [])] } }
      : {}),
    maxContext, license, moe: arch.moe !== undefined,
    ...(moeFields['nonExpertGB'] !== undefined ? { nonExpertGB: moeFields['nonExpertGB'] } : {}),
    category, ...(opts.thinking ? { thinking: opts.thinking } : {}), ...(opts.korean ? { korean: true } : {}),
    popularity,
    // 원본 저장소 최근 30일 다운로드 수와 기준일(D68 — 계산기 "다운로드 많은 순", 이후 sync-models 가 매주 갱신). 값이 없으면 필드 없이
    ...downloadsFields(info.downloads, today),
    releasedAt: (info.createdAt ?? today).slice(0, 10),
    note: `add-model 생성(${today}). releasedAt = HF createdAt${mirror ? `. gated — arch 는 ${mirror} 미러 config` : ''}`,
    // MoE 는 experts/topK 의 출처로 config.json 을 명시 (게이트면 미러 config)
    sources: [hfUrl(hfId), ...(mirror ? [configUrl(mirror)] : arch.moe ? [configUrl(hfId)] : [])],
  };

  // 스키마 검증 — 쓰기 전에. 교차 검증은 쓴 뒤 validate-data 로(MOE_ARCH 를 새로 읽어야 해서 별도 프로세스)
  parseModels([...rawModels, record]);
  parseModelQuants([...rawQuants, ...rows]);

  const moeLine = arch.moe
    ? `  '${id}': { totalParamsB: ${paramsB}, activeParamsB: ${String(moeFields['activeParamsB'])}, experts: ${arch.moe.experts}, topK: ${arch.moe.topK} }, // add-model ${today} — ${hfId} config`
    : undefined;

  const lines: string[] = [];
  lines.push(`\n${hfId} → ${id} (${name}) · ${arch.modelType} · ${arch.attnType}${arch.moe ? ` · MoE ${arch.moe.experts}E top-${arch.moe.topK}` : ''}`);
  lines.push(`  KV ${arch.override?.kvBytesPerTokenF16 ?? arch.arch.kvBytesPerTokenF16} B/token · maxContext ${arch.maxContext} · params ${paramsB}B · license ${license} · popularity ${popularity} · category ${category.join(',')}`);
  if (arch.override) lines.push(`  ${arch.override.reason}`);
  if (arch.expertLayers) lines.push(`  expert layers ${arch.expertLayers.length}/${arch.arch.layers}: ${arch.expertLayers.join(',')}`);
  for (const r of rows) {
    const split = r.expertGB !== undefined ? `  (expert ${r.expertGB} · non-expert ${String(r.nonExpertGB)} GB)` : '';
    lines.push(`  ${r.quant.padEnd(10)} ${String(r.fileGB).padStart(7)} GB  ${r.ggufRepo}/${r.fileName ?? ''}${split}`);
  }
  const warnings: string[] = [...splitWarnings];
  if (classifyLicense(license) === 'unknown') warnings.push(`라이선스 "${license}" 가 배지 맵(packages/data/src/license.ts)에 없음 — 분류 추가 필요`);
  if (!opts.category) warnings.push('카테고리는 기본값 — 용도 필터용(리즈닝은 --category chat,reasoning)');
  if (!opts.thinking) warnings.push('생각 모드 미지정 — 모델 카드·채팅 템플릿에 thinking(enable_thinking·<think>·reasoning_effort)이 있으면 --thinking always|default-on|default-off|auto 로 다시 (판정 기준 1.5배, D59)');
  if (!opts.maxContext) warnings.push(`최대 컨텍스트 ${arch.maxContext} 는 config 값 — 모델 카드의 기본(네이티브) 길이와 다르면 --max-context 로 (예: Qwen3 은 카드 기준 32768, YaRN 확장 전)`);
  if (!opts.name) warnings.push(`표시명 "${name}" 은 자동 — 어색하면 --name 으로`);

  const activeParamsB = moeFields['activeParamsB'] as number | undefined;
  return {
    kind: 'ok',
    plan: {
      hfId, id, name, record, rows, ...(moeLine ? { moeLine } : {}), lines, warnings,
      summary: {
        modelType: arch.modelType, attnType: arch.attnType, ...(arch.moe ? { moe: arch.moe } : {}), paramsB,
        ...(activeParamsB !== undefined ? { activeParamsB } : {}),
        ggufRepo: rows[0]!.ggufRepo, license, category, maxContext, popularity, vision,
      },
    },
  };
}

/** 계획을 쓴다 — MOE_ARCH 한 줄(MoE) · models.json · model-quants.json · meta.json 기준일. 교차 검증(validate-data)은 호출자 몫 */
export function applyAddition(plan: AdditionPlan, ctx: CatalogRaw & { today: string }, root = repoRoot): void {
  if (plan.moeLine) {
    const idxPath = join(root, 'packages/data/src/index.ts');
    const src2 = readFileSync(idxPath, 'utf8');
    const start = src2.indexOf('export const MOE_ARCH');
    const end = src2.indexOf('});', start);
    if (start < 0 || end < 0) throw new Error('MOE_ARCH 블록을 찾지 못함');
    writeFileSync(idxPath, `${src2.slice(0, end)}${plan.moeLine}\n${src2.slice(end)}`);
  }
  writeFileSync(join(root, 'data/models.json'), serializeRecords([...ctx.rawModels, plan.record]));
  writeFileSync(join(root, 'data/model-quants.json'), serializeRecords([...ctx.rawQuants, ...plan.rows]));
  writeFileSync(join(root, 'data/meta.json'), `${JSON.stringify({ dataUpdated: ctx.today }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.hfId) throw new Error('usage: pnpm run add-model -- <hfId> [options]');
  const today = new Date().toISOString().slice(0, 10);
  const catalog = readCatalogRaw();
  const res = await planAddition(args.hfId, args, { ...catalog, token: process.env['HF_TOKEN'], today });
  if (res.kind === 'held') {
    console.log(`보류: ${args.hfId} — ${res.reason}`);
    process.exitCode = 2;
    return;
  }
  const { plan } = res;
  for (const line of plan.lines) console.log(line);
  for (const w of plan.warnings) console.log(`  ! ${w}`);

  if (args.dry) {
    console.log('\n--dry: 파일을 쓰지 않았다');
    return;
  }
  applyAddition(plan, { ...catalog, today });
  try {
    execSync('pnpm run validate-data', { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error('\n교차 검증 실패 — 파일은 썼으니 git diff 로 확인 후 되돌리거나 고칠 것');
    process.exitCode = 1;
    return;
  }
  console.log(`\n추가함: data/models.json · data/model-quants.json(+${plan.rows.length}) · data/meta.json${plan.moeLine ? ' · MOE_ARCH' : ''}. 다음: pnpm test → pnpm build → pnpm run test:export`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1; // process.exit 는 열린 fetch 소켓과 부딪혀 Windows 에서 비정상 종료한다(UV_HANDLE_CLOSING)
  });
}
