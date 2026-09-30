/**
 * 새 모델 추가 — 카탈로그 확장 자동화 (09-30). HF 모델 ID 하나로 models.json·model-quants.json 레코드를 만든다.
 *
 * 실행: pnpm run add-model -- <hfId> [--id <slug>] [--name "<표시명>"] [--gguf <repo>] [--active <B>]
 *                                    [--category chat,coding] [--popularity 1-5] [--max-context N] [--korean] [--dry]
 *
 * 하는 일:
 *  1) HF 모델 정보(파라미터 수·라이선스·생성일·다운로드)와 config.json 을 받는다. 게이트 모델은 unsloth 미러 config 로 대체하고 출처에 남긴다.
 *  2) 구조를 분류한다 — **선례가 있는 구조만 자동**(PROGRESS §4 D53): 전체 어텐션 · 슬라이딩 윈도(layer_types) · 하이브리드 선형(layer_types).
 *     처음 보는 model_type, MLA·압축 어텐션·Mamba·conv 등은 "보류"로 멈춘다 — 엔진이 그 메모리를 모델링하지 않아 판정이 틀린다.
 *  3) GGUF 저장소를 고른다(공식 → ggml-org → bartowski → unsloth → lmstudio-community, Q4_K_M 이 있는 첫 곳) — 파일명·크기는 트리에서.
 *  4) 레코드를 쓰고, MoE 면 MOE_ARCH 에 한 줄 넣어 nonExpertGB 를 유도, data/meta.json 기준일을 오늘로.
 * 사람이 확인할 것(출력에 표시): 카테고리(리즈닝 여부)·표시명·인기도·처음 보는 라이선스 문자열.
 * 실행 후: pnpm run validate-data → pnpm test → pnpm build → pnpm run test:export.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyLicense,
  deriveNonExpertGB,
  parseModelQuants,
  parseModels,
  type ModelQuantRecord,
} from '../packages/data/src/index';
import { fetchConfig, fetchTree, serializeRecords, type TreeEntry } from './hf-common';
import { matchQuantFiles, primaryFile, sumFileGB } from './sync-models';

type QuantId = ModelQuantRecord['quant'];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');
const round2 = (x: number): number => Math.round(x * 100) / 100;
const hfUrl = (repo: string): string => `https://huggingface.co/${repo}`;
const configUrl = (repo: string): string => `https://huggingface.co/${repo}/blob/main/config.json`;

// ---------------------------------------------------------------------------
// 순수 코어 (scripts/add-model.test.ts)
// ---------------------------------------------------------------------------

/**
 * 선례가 있는 텍스트 model_type (09-30 카탈로그 config 에서 수집). 여기 없는 구조는 자동 추가하지 않는다.
 * gpt_oss(MXFP4 네이티브 — 기준 양자화가 다름)·solar_open2(하이브리드 특수)는 의도적으로 제외.
 */
export const KNOWN_MODEL_TYPES: ReadonlySet<string> = new Set([
  'llama',
  'mistral',
  'mixtral',
  'qwen2',
  'qwen3',
  'qwen3_moe',
  'qwen3_5_text',
  'qwen3_5_moe_text',
  'gemma3_text',
  'gemma4_text',
  'gemma4_unified_text',
  'phi3',
  'granite',
  'exaone4',
  'exaone4_5_text',
  'hyperclovax',
  'solar_open',
]);

/** 이 키가 config 에 있으면 엔진이 모델링하지 않는 구조 (MLA·압축 어텐션·SSM·conv) */
const UNSUPPORTED_KEYS = ['kv_lora_rank', 'compress_ratios', 'ssm_state_size', 'mamba_num_heads', 'conv_L_cache', 'hybrid_override_pattern'];
const KNOWN_LAYER_TYPES = new Set(['full_attention', 'sliding_attention', 'linear_attention']);

export type ArchResult =
  | {
      kind: 'ok';
      modelType: string;
      attnType: 'full' | 'swa' | 'hybrid';
      arch: { layers: number; kvHeads: number; headDim: number; kvBytesPerTokenF16: number };
      /** swa·hybrid — 전체 어텐션 층만 KV (선례와 같은 산식) */
      override?: { kvBytesPerTokenF16: number; reason: string };
      maxContext: number;
      moe?: { experts: number; topK: number };
      vision: boolean;
    }
  | { kind: 'unsupported'; reason: string };

const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

export function classifyArch(config: unknown): ArchResult {
  if (typeof config !== 'object' || config === null) return { kind: 'unsupported', reason: 'config 없음' };
  const top = config as Record<string, unknown>;
  const cfg = (typeof top['text_config'] === 'object' && top['text_config'] !== null ? top['text_config'] : top) as Record<string, unknown>;
  const modelType = String(cfg['model_type'] ?? top['model_type'] ?? '');
  if (!KNOWN_MODEL_TYPES.has(modelType)) return { kind: 'unsupported', reason: `처음 보는 구조 model_type=${modelType || '(없음)'} — 선례 없음, 수동 검토` };
  for (const key of UNSUPPORTED_KEYS) {
    if (key in cfg || key in top) return { kind: 'unsupported', reason: `엔진이 모델링하지 않는 구조 (${key})` };
  }
  const layers = posInt(cfg['num_hidden_layers']);
  const heads = posInt(cfg['num_attention_heads']);
  const kvHeads = posInt(cfg['num_key_value_heads']) ?? heads;
  const hidden = posInt(cfg['hidden_size']);
  const headDim = posInt(cfg['head_dim']) ?? (hidden && heads && Number.isInteger(hidden / heads) ? hidden / heads : undefined);
  const maxContext = posInt(cfg['max_position_embeddings'] ?? top['max_position_embeddings']);
  if (!layers || !kvHeads || !headDim || !maxContext) return { kind: 'unsupported', reason: 'config 필드 누락(layers·kv heads·head_dim·max_position_embeddings)' };

  const experts = posInt(cfg['num_experts'] ?? cfg['num_local_experts'] ?? cfg['n_routed_experts']);
  const topK = posInt(cfg['num_experts_per_tok']);
  const moe = experts && topK ? { experts, topK } : undefined;
  const vision = 'vision_config' in top;
  const full = layers * kvHeads * headDim * 4;

  const layerTypes = Array.isArray(cfg['layer_types']) ? (cfg['layer_types'] as unknown[]).map(String) : undefined;
  if (layerTypes && layerTypes.some((t) => !KNOWN_LAYER_TYPES.has(t))) {
    return { kind: 'unsupported', reason: `처음 보는 층 종류 ${[...new Set(layerTypes)].filter((t) => !KNOWN_LAYER_TYPES.has(t)).join(',')}` };
  }
  const nFull = layerTypes?.filter((t) => t === 'full_attention').length;
  const hasSliding = layerTypes?.includes('sliding_attention') ?? false;
  const hasLinear = layerTypes?.includes('linear_attention') ?? false;

  if (hasSliding && hasLinear) return { kind: 'unsupported', reason: '슬라이딩 + 선형 혼합 — 선례 없음' };
  if (hasSliding && nFull !== undefined) {
    const gKv = posInt(cfg['num_global_key_value_heads']) ?? kvHeads;
    const gDim = posInt(cfg['global_head_dim']) ?? headDim;
    const kv = nFull * gKv * gDim * 4;
    const global = gKv !== kvHeads || gDim !== headDim ? ` × global kv ${gKv} × head_dim ${gDim}` : '';
    return {
      kind: 'ok', modelType, attnType: 'swa', vision, maxContext, ...(moe ? { moe } : {}),
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason: `swa — full attn ${nFull}/${layers} layers${global}, sliding win${String(cfg['sliding_window'] ?? '?')} 는 평탄 근사로 제외 (add-model)` },
    };
  }
  if (hasLinear && nFull !== undefined) {
    const kv = nFull * kvHeads * headDim * 4;
    return {
      kind: 'ok', modelType, attnType: 'hybrid', vision, maxContext, ...(moe ? { moe } : {}),
      arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: kv },
      override: { kvBytesPerTokenF16: kv, reason: `hybrid linear — full attn ${nFull}/${layers} layers, KV 는 full 레이어만 계상 (add-model)` },
    };
  }
  // layer_types 가 없거나 전부 full. 모든 층 슬라이딩(use_sliding_window 켜짐)은 선례 없음
  const sw = posInt(cfg['sliding_window']);
  if (!layerTypes && sw !== undefined && cfg['use_sliding_window'] !== false && sw < maxContext) {
    return { kind: 'unsupported', reason: `전 층 슬라이딩 윈도(${sw}) — 선례 없음` };
  }
  return { kind: 'ok', modelType, attnType: 'full', vision, maxContext, ...(moe ? { moe } : {}), arch: { layers, kvHeads, headDim, kvBytesPerTokenF16: full } };
}

const DROP_SUFFIX = /[-_](?:instruct|it|chat|hf)$/i;

/** `google/gemma-4-31B-it` → `gemma-4-31b` */
export function slugFromHfId(hfId: string): string {
  let base = hfId.split('/').pop() ?? hfId;
  while (DROP_SUFFIX.test(base)) base = base.replace(DROP_SUFFIX, '');
  return base.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9.-]/g, '');
}

/** `meta-llama/Llama-3.2-3B-Instruct` → `Llama 3.2 3B`, `ibm-granite/granite-4.2-30b` → `Granite 4.2 30B` */
export function displayName(hfId: string): string {
  let base = hfId.split('/').pop() ?? hfId;
  while (DROP_SUFFIX.test(base)) base = base.replace(DROP_SUFFIX, '');
  return base
    .split(/[-_]/)
    .map((w) => (/^\d+(?:\.\d+)?b$/i.test(w) ? w.toUpperCase() : /^[a-z]/.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/ (A\d+(?:\.\d+)?B)\b/, '-$1'); // 35B A3B → 35B-A3B
}

export const familyOf = (name: string): string => (name.split(' ')[0] ?? name).toLowerCase().replace(/[^a-z]/g, '') || 'other';

/** HF 라이선스 id → 카탈로그 문자열(license.ts 배지 맵과 같은 표기). 모르면 원문 그대로 — 배지 테스트가 잡아 사람이 맵에 추가 */
export function mapLicense(hf: string | undefined): string {
  const map: Record<string, string> = {
    'apache-2.0': 'Apache-2.0',
    mit: 'MIT',
    llama3: 'Llama 3',
    'llama3.1': 'Llama 3.1',
    'llama3.2': 'Llama 3.2',
    'llama3.3': 'Llama 3.3',
    gemma: 'Gemma',
  };
  return hf ? (map[hf.toLowerCase()] ?? hf) : 'unknown';
}

/** 30일 다운로드 → 인기도 1~5 (09-30 카탈로그 분포에 맞춘 기준) */
export function popularityFrom(downloads: number | undefined): number {
  const d = downloads ?? 0;
  return d >= 5_000_000 ? 5 : d >= 1_000_000 ? 4 : d >= 200_000 ? 3 : d >= 30_000 ? 2 : 1;
}

/** 이름의 활성 파라미터 표기(`35B-A3B`) → 3 */
export const activeFromName = (hfId: string): number | undefined => {
  const m = /(?:^|[-_])A(\d+(?:\.\d+)?)B(?:[-_]|$)/i.exec(hfId.split('/').pop() ?? '');
  return m ? Number(m[1]) : undefined;
};

const OWNER_ORDER = ['ggml-org', 'bartowski', 'unsloth', 'lmstudio-community'];

/**
 * GGUF 후보 repo 정렬 — 같은 모델의 변환본만(파인튠·abliterated 제외): basename 이 `<base>-GGUF`·`<owner>_<base>-GGUF`·`<base>-MTP-GGUF`.
 * 순서: 원 저장소 소유자(공식) → ggml-org → bartowski → unsloth → lmstudio-community.
 */
export function rankGgufRepos(candidates: readonly string[], hfId: string): string[] {
  const [owner = '', base = ''] = hfId.split('/');
  const b = base.toLowerCase();
  const same = (repo: string): boolean => {
    let name = (repo.split('/').pop() ?? '').toLowerCase().replace(/-gguf$/, '').replace(/-mtp$/, '');
    if (name.startsWith(`${owner.toLowerCase()}_`)) name = name.slice(owner.length + 1);
    return name === b;
  };
  const rank = (repo: string): number => {
    const o = repo.split('/')[0] ?? '';
    if (o === owner) return 0;
    const i = OWNER_ORDER.indexOf(o);
    return i < 0 ? 99 : i + 1;
  };
  return candidates.filter(same).filter((r) => rank(r) < 99).sort((a, c) => rank(a) - rank(c));
}

/** repo 트리 → 표준 양자화 행 (Q4_K_M 필수 — 없으면 빈 배열). Q2_K 가 없고 UD-Q2_K_XL 만 있으면 그걸 쓴다 */
export function quantRowsFrom(tree: readonly TreeEntry[], repo: string, modelId: string): ModelQuantRecord[] {
  const rows: ModelQuantRecord[] = [];
  const add = (quant: QuantId): boolean => {
    const files = matchQuantFiles(tree, quant);
    if (files.length === 0) return false;
    const primary = primaryFile(files);
    const gb = sumFileGB(files);
    if ('error' in primary || !Number.isFinite(gb)) return false;
    rows.push({ modelId, quant, fileGB: gb, ggufRepo: repo, fileName: primary.path, sources: [hfUrl(repo)] });
    return true;
  };
  if (!add('Q4_K_M')) return [];
  add('IQ4_XS');
  add('Q8_0');
  if (!add('Q2_K')) add('UD-Q2_K_XL');
  return rows;
}

// ---------------------------------------------------------------------------
// 실행부
// ---------------------------------------------------------------------------

type Args = { hfId?: string; id?: string; name?: string; gguf?: string; active?: number; category?: string[]; popularity?: number; maxContext?: number; korean: boolean; dry: boolean };

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
    else if (arg === '--popularity') a.popularity = Number(val());
    else if (arg === '--max-context') a.maxContext = Number(val());
    else if (!arg.startsWith('--') && a.hfId === undefined) a.hfId = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.hfId) throw new Error('usage: pnpm run add-model -- <hfId> [options]');
  const token = process.env['HF_TOKEN'];
  const hfId = args.hfId;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

  const info = (await (await fetch(`https://huggingface.co/api/models/${hfId}`, { headers })).json()) as {
    id?: string; gated?: unknown; createdAt?: string; downloads?: number; pipeline_tag?: string;
    cardData?: { license?: string }; safetensors?: { total?: number };
  };
  if (!info.id) throw new Error(`HF 모델을 찾지 못함: ${hfId}`);

  const rawModels = JSON.parse(readFileSync(join(dataDir, 'models.json'), 'utf8')) as Record<string, unknown>[];
  const rawQuants = JSON.parse(readFileSync(join(dataDir, 'model-quants.json'), 'utf8')) as Record<string, unknown>[];
  const id = args.id ?? slugFromHfId(hfId);
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
  if (arch.kind === 'unsupported') {
    console.log(`보류: ${hfId} — ${arch.reason}`);
    process.exitCode = 2;
    return;
  }

  // GGUF repo
  const search = (await (await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(hfId.split('/')[1]!)}&filter=gguf&sort=downloads&limit=40`, { headers })).json()) as Array<{ id: string }>;
  const repos = args.gguf ? [args.gguf] : rankGgufRepos(search.map((r) => r.id), hfId);
  let rows: ModelQuantRecord[] = [];
  for (const repo of repos) {
    rows = quantRowsFrom(await fetchTree(repo, { token }), repo, id);
    if (rows.length > 0) break;
  }
  if (rows.length === 0) throw new Error(`Q4_K_M GGUF 를 찾지 못함 (후보: ${repos.join(', ') || '없음'}) — --gguf 로 지정`);

  const name = args.name ?? displayName(hfId);
  const paramsB = info.safetensors?.total ? round2(info.safetensors.total / 1e9) : undefined;
  if (!paramsB) throw new Error('파라미터 수(safetensors.total)를 받지 못함');
  const license = mapLicense(info.cardData?.license);
  const category = args.category ?? ['chat', ...(/coder/i.test(hfId) ? ['coding'] : []), ...(arch.vision || info.pipeline_tag === 'image-text-to-text' ? ['vision'] : [])];
  const today = new Date().toISOString().slice(0, 10);
  const src = mirror ? configUrl(mirror) : configUrl(hfId);

  let moeFields: Record<string, unknown> = {};
  if (arch.moe) {
    const active = args.active ?? activeFromName(hfId);
    if (active === undefined) throw new Error('MoE 활성 파라미터를 이름에서 못 읽음 — --active <B> 로 지정(모델 카드 기준)');
    const q4 = rows.find((r) => r.quant === 'Q4_K_M')!;
    const nonExpertGB = round2(deriveNonExpertGB({ totalParamsB: paramsB, activeParamsB: active, experts: arch.moe.experts, topK: arch.moe.topK }, q4.fileGB));
    moeFields = { activeParamsB: active, moe: true, nonExpertGB };
  }

  const record: Record<string, unknown> = {
    id, family: familyOf(name), name, hfId, paramsB,
    ...(moeFields['activeParamsB'] !== undefined ? { activeParamsB: moeFields['activeParamsB'] } : {}),
    arch: { layers: arch.arch.layers, kvHeads: arch.arch.kvHeads, headDim: arch.arch.headDim, attnType: arch.attnType, kvBytesPerTokenF16: arch.arch.kvBytesPerTokenF16 },
    ...(arch.override ? { attnOverrides: { ...arch.override, sources: [src] } } : {}),
    maxContext: args.maxContext ?? arch.maxContext, license, moe: arch.moe !== undefined,
    ...(moeFields['nonExpertGB'] !== undefined ? { nonExpertGB: moeFields['nonExpertGB'] } : {}),
    category, ...(args.korean ? { korean: true } : {}),
    popularity: args.popularity ?? popularityFrom(info.downloads),
    releasedAt: (info.createdAt ?? today).slice(0, 10),
    note: `add-model 생성(${today}). releasedAt = HF createdAt${mirror ? `. gated — arch 는 ${mirror} 미러 config` : ''}`,
    sources: [hfUrl(hfId), ...(mirror ? [configUrl(mirror)] : [])],
  };

  // 스키마 검증 — 쓰기 전에. 교차 검증은 쓴 뒤 validate-data 로(MOE_ARCH 를 새로 읽어야 해서 별도 프로세스)
  parseModels([...rawModels, record]);
  parseModelQuants([...rawQuants, ...rows]);

  const moeLine = arch.moe
    ? `  '${id}': { totalParamsB: ${paramsB}, activeParamsB: ${String(moeFields['activeParamsB'])}, experts: ${arch.moe.experts}, topK: ${arch.moe.topK} }, // add-model ${today} — ${hfId} config`
    : undefined;

  console.log(`\n${hfId} → ${id} (${name}) · ${arch.modelType} · ${arch.attnType}${arch.moe ? ` · MoE ${arch.moe.experts}E top-${arch.moe.topK}` : ''}`);
  console.log(`  KV ${arch.arch.kvBytesPerTokenF16} B/token · maxContext ${arch.maxContext} · params ${paramsB}B · license ${license} · popularity ${String(record['popularity'])} · category ${category.join(',')}`);
  for (const r of rows) console.log(`  ${r.quant.padEnd(10)} ${String(r.fileGB).padStart(7)} GB  ${r.ggufRepo}/${r.fileName ?? ''}`);
  const warnings: string[] = [];
  if (classifyLicense(license) === 'unknown') warnings.push(`라이선스 "${license}" 가 배지 맵(packages/data/src/license.ts)에 없음 — 분류 추가 필요`);
  if (!args.category) warnings.push('카테고리는 기본값 — 리즈닝(사고 토큰) 모델이면 --category chat,reasoning 으로 다시 (판정 기준 1.5배)');
  if (!args.maxContext) warnings.push(`최대 컨텍스트 ${arch.maxContext} 는 config 값 — 모델 카드의 기본(네이티브) 길이와 다르면 --max-context 로 (예: Qwen3 은 카드 기준 32768, YaRN 확장 전)`);
  if (!args.name) warnings.push(`표시명 "${name}" 은 자동 — 어색하면 --name 으로`);
  for (const w of warnings) console.log(`  ! ${w}`);

  if (args.dry) {
    console.log('\n--dry: 파일을 쓰지 않았다');
    return;
  }
  if (moeLine) {
    const idxPath = join(repoRoot, 'packages/data/src/index.ts');
    const src2 = readFileSync(idxPath, 'utf8');
    const start = src2.indexOf('export const MOE_ARCH');
    const end = src2.indexOf('});', start);
    if (start < 0 || end < 0) throw new Error('MOE_ARCH 블록을 찾지 못함');
    writeFileSync(idxPath, `${src2.slice(0, end)}${moeLine}\n${src2.slice(end)}`);
  }
  writeFileSync(join(dataDir, 'models.json'), serializeRecords([...rawModels, record]));
  writeFileSync(join(dataDir, 'model-quants.json'), serializeRecords([...rawQuants, ...rows]));
  writeFileSync(join(dataDir, 'meta.json'), `${JSON.stringify({ dataUpdated: today }, null, 2)}\n`);
  try {
    execSync('pnpm run validate-data', { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error('\n교차 검증 실패 — 파일은 썼으니 git diff 로 확인 후 되돌리거나 고칠 것');
    process.exitCode = 1;
    return;
  }
  console.log(`\n추가함: data/models.json · data/model-quants.json(+${rows.length}) · data/meta.json${moeLine ? ' · MOE_ARCH' : ''}. 다음: pnpm test → pnpm build → pnpm run test:export`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1; // process.exit 는 열린 fetch 소켓과 부딪혀 Windows 에서 비정상 종료한다(UV_HANDLE_CLOSING)
  });
}
