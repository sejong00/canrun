/**
 * 새 모델 추가 — 카탈로그 확장 자동화 (09-30). HF 모델 ID 하나로 models.json·model-quants.json 레코드를 만든다.
 *
 * 실행: pnpm run add-model -- <hfId> [--id <slug>] [--name "<표시명>"] [--gguf <repo>] [--active <B>] [--params <B>]
 *                                    [--category chat,coding] [--thinking always|default-on|default-off|auto]
 *                                    [--popularity 1-5] [--max-context N] [--korean] [--dry]
 *
 * 하는 일:
 *  1) HF 모델 정보(파라미터 수·라이선스·생성일·다운로드)와 config.json 을 받는다. 게이트 모델은 unsloth 미러 config 로 대체하고 출처에 남긴다.
 *  2) 구조를 분류한다 — **선례가 있는 구조만 자동**(PROGRESS §4 D53·D63): 전체 어텐션 · 슬라이딩 윈도(layer_types) · 하이브리드 선형(layer_types)
 *     · 상수 상태 층 하이브리드(nemotron_h Mamba2 · lfm2 short-conv · bailing_hybrid KDA+MLA — 층 지도가 있을 때만).
 *     처음 보는 model_type, 반복 층·디스크 n-gram 임베딩·압축 어텐션 등은 "보류"로 멈춘다 — 엔진이 그 메모리를 모델링하지 않아 판정이 틀린다.
 *  3) GGUF 저장소를 고른다(공식 → ggml-org → bartowski → unsloth → lmstudio-community, 기준 양자화 Q4_K_M — 없으면 MXFP4(10-22 D115) — 가 있는 첫 곳)
 *     — 파일명·크기는 트리에서.
 *  4) 레코드를 쓰고(원본 저장소 최근 30일 다운로드 수·기준일 포함 — D68), MoE 면 MOE_ARCH 에 한 줄 넣어 nonExpertGB 를 유도, data/meta.json 기준일을 오늘로.
 *     처음 보는 Hugging Face 조직이면 apps/web/content/model-makers.ts 에 그 조직의 이름(조직 정보 API 의 fullname)을 한 줄 넣는다(10-19 D101 — 모델 목록 열).
 *     양자화 행마다 GGUF 헤더를 Range 로 읽는다(scripts/gguf-header.ts): MoE 는 expertGB·nonExpertGB(10-01),
 *     dense 는 그래픽카드에 올리지 않는 몫 offGpuGB(10-03 D62), 둘 다 MTP 블록이 있으면 mtpGB. 반복 층 모델(nanbeige num_loops — 10-22 D114)은
 *     반복 블록 loopGB 도 재고, 헤더 `<arch>.num_loops` 가 config 와 다르거나 잴 수 없는 행이 있으면 멈춘다.
 *     MoE 는 arch.experts/topK(config)를 기록하고, 헤더의 expert_count·expert_used_count 가 config 와 다르면 멈춘다.
 * 사람이 확인할 것(출력에 표시): 생각 모드(--thinking, 판정 기준 1.5배 — 모델 카드·채팅 템플릿, D59)·카테고리·표시명·인기도·처음 보는 라이선스 문자열·새 조직 이름.
 * 파라미터 수는 safetensors 총계가 기본이다. 그 값에 GGUF 본 파일에 없는 몫(MTP·투기적 디코딩 모듈)이 섞여 있고 모델 카드가 총 파라미터를 밝히지 않으면
 * `--params <B>` 로 GGUF 헤더 원소 수(llama.cpp 가 실제로 불러오는 파라미터)를 준다(10-22 D115 — DeepSeek V4 Flash 0731).
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
  aliasFileTypeProblem,
  classifyArch,
  displayName,
  familyOf,
  mapLicense,
  popularityFrom,
  quantRowsFrom,
  rankGgufRepos,
  slugFromHfId,
} from '../packages/data/src/hf';
import { hfOrgOf } from '../apps/web/content/model-makers';
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
  /** 층별 임베딩 표(PLE) — 없거나 0 이면 표 없음 (10-21 D112) */
  pleGB?: number;
  /** 값 전문가(MoVA attn_v_exps, nonExpertGB 안) — 없거나 0 이면 값 전문가 없음 (10-21 D113) */
  valueExpertGB?: number;
  /** 트렁크 블록(blk.N.*) 합 — 반복 층 모델 행의 loopGB (10-22 D114) */
  blockGB?: number;
  /** 헤더 `<arch>.num_loops` — 없으면 생략 (10-22 D114) */
  numLoops?: number;
  /** 헤더 `general.file_type`(llama_ftype) — 파일 이름 별칭(`Q4_K` → Q4_K_M, 10-22 엔진 후속 ⑧-b)으로 잡은 행의 대조용. 없으면 생략 */
  fileType?: number;
  mtpGB: number;
  fileGB?: number;
  trunkLayers: number;
  expertCount?: number;
  expertUsed?: number;
};
export type MeasureRowFn = (repo: string, fileName: string) => Promise<RowMeasure>;

/**
 * 행에 헤더 실측을 넣는다 — 키 순서는 시드와 같게 fileGB 바로 뒤(MoE 분할·valueExpertGB | dense offGpuGB·pleGB·loopGB, 그다음 mtpGB).
 * loopGB(반복 블록 — 10-22 D114)는 반복 층 모델(`looped`)의 행에만 쓴다
 */
function withMeasure(row: ModelQuantRecord, m: RowMeasure, moe: boolean, looped = false): ModelQuantRecord {
  const { modelId, quant, fileGB, ggufRepo, fileName, sources } = row;
  const split = moe
    ? { expertGB: m.expertGB, nonExpertGB: m.nonExpertGB, ...((m.valueExpertGB ?? 0) > 0 ? { valueExpertGB: m.valueExpertGB } : {}) }
    : {
        offGpuGB: m.offGpuGB,
        ...((m.pleGB ?? 0) > 0 ? { pleGB: m.pleGB } : {}),
        ...(looped && (m.blockGB ?? 0) > 0 ? { loopGB: m.blockGB } : {}),
      };
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
    // 층별 임베딩 표(PLE)는 상한 밖 — 나머지(입력 임베딩·MTP·헤더)에만 건다 (validateAll 과 같은 규칙, 10-21 D112)
    const ple = m.pleGB ?? 0;
    const other = m.offGpuGB - ple;
    return other > fileGB * MAX_OFF_GPU_FRACTION
      ? `그래픽카드 밖 몫 ${m.offGpuGB}GB${ple > 0 ? `(층별 임베딩 표 ${ple}GB 제외 ${round2(other)}GB)` : ''} > fileGB ${fileGB} 의 25%`
      : undefined;
  }
  const gpu = m.expertGB + m.nonExpertGB;
  if (gpu > fileGB + 0.02) return `측정 합 ${gpu.toFixed(2)}GB > fileGB ${fileGB}`;
  if (gpu < fileGB * (1 - MAX_OFF_GPU_FRACTION)) return `측정 합 ${gpu.toFixed(2)}GB < fileGB ${fileGB} 의 75%`;
  return undefined;
}

/**
 * 행별 GGUF 헤더 실측 + 헤더 대조. MoE(`moe` 있음)는 expertGB·nonExpertGB(값 전문가가 있으면 valueExpertGB), dense 는 offGpuGB(10-03 D62), 둘 다 mtpGB.
 * problems(쓰기 중단): 헤더 expert_count·expert_used_count ≠ config · 파일 이름 별칭으로 잡은 행(`Q4_K` → Q4_K_M — 10-22 ⑧-b)의 헤더 file_type ≠ 15. 값 전문가 모델(`opts.valueExperts` — MoVA, 10-21 D113)은 행마다 실측이
 * 있어야 하므로(없으면 모델 수준 유도 비전문가로 VRAM 을 적게 센다 — validateAll 도 거부) 측정 실패·파일과 안 맞는 값·값 전문가 텐서 없음도 problems.
 * 반복 층 모델(`opts.loops` — 10-22 D114)도 행마다 실측(반복 블록 loopGB)이 있어야 하고, 헤더 `<arch>.num_loops` 가 config 와 다르거나 없으면
 * llama.cpp 가 다른 횟수로 돌리는 파일이라 problems.
 * warnings(진행): 측정 실패·값이 파일과 안 맞음(그 행은 실측 없이 기록 — 다음 sync-models 가 다시 잰다) · 트렁크 층 수 ≠ config layers.
 */
export async function measureRows(
  rows: readonly ModelQuantRecord[],
  moe: { experts: number; topK: number } | undefined,
  layers: number,
  measure: MeasureRowFn,
  opts: { valueExperts?: boolean; loops?: number } = {},
): Promise<{ rows: ModelQuantRecord[]; problems: string[]; warnings: string[] }> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const out: ModelQuantRecord[] = [];
  // 실측 없이 기록할 행 — 값 전문가·반복 층 모델은 쓰지 않는다(중단 사유), 그 밖은 경고만
  const unmeasured = (message: string): void => {
    if (opts.valueExperts) problems.push(`${message} — 값 전문가(MoVA) 모델은 행마다 헤더 실측(분할·valueExpertGB)이 필요해 쓰지 않음`);
    else if (opts.loops !== undefined) problems.push(`${message} — 반복 층 모델은 행마다 헤더 실측(반복 블록 loopGB·num_loops)이 필요해 쓰지 않음`);
    else warnings.push(message);
  };
  for (const row of rows) {
    const label = `${row.quant} ${row.ggufRepo}/${row.fileName ?? ''}`;
    if (row.fileName === undefined) {
      unmeasured(`${label}: 파일명 없음 — 헤더 측정 생략`);
      out.push(row);
      continue;
    }
    let m: RowMeasure;
    try {
      m = await measure(row.ggufRepo, row.fileName);
    } catch (err) {
      unmeasured(`${label}: GGUF 헤더 측정 실패(${err instanceof Error ? err.message : String(err)}) — 실측 없이 기록, 다음 sync-models 가 다시 잰다`);
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
    if (opts.loops !== undefined && m.numLoops !== opts.loops) {
      problems.push(`${label}: 헤더 num_loops ${m.numLoops ?? '없음'} ≠ config num_loops ${opts.loops}`);
    }
    // 파일 이름 별칭(10-22 ⑧-b — `Q4_K` 를 Q4_K_M 행으로): 헤더 file_type 이 그 형식(15)이 아니면 다른 양자화 파일이라 쓰지 않는다
    const aliasProblem = aliasFileTypeProblem(row.quant, row.fileName, m.fileType);
    if (aliasProblem !== undefined) problems.push(`${label}: ${aliasProblem}`);
    const problem =
      implausibleMeasure(m, row.fileGB, moe !== undefined) ??
      (opts.valueExperts && !((m.valueExpertGB ?? 0) > 0) ? '헤더에 값 전문가 텐서(attn_v_exps)가 없음' : undefined) ??
      (opts.loops !== undefined && !((m.blockGB ?? 0) > 0 && m.blockGB! <= row.fileGB - m.offGpuGB + 0.02)
        ? `반복 블록 ${m.blockGB ?? '없음'}GB 가 그래픽카드 상주 몫(fileGB − offGpuGB)에 맞지 않음`
        : undefined);
    if (problem !== undefined) {
      unmeasured(`${label}: ${problem} — 실측 없이 기록`);
      out.push(row);
      continue;
    }
    out.push(withMeasure(row, m, moe !== undefined, opts.loops !== undefined));
  }
  return { rows: out, problems, warnings };
}

// ---------------------------------------------------------------------------
// 개발 조직 이름 (10-19 D101 — apps/web/content/model-makers.ts, 모델 목록 "Hugging Face 조직" 열)
// ---------------------------------------------------------------------------

/** 레지스트리 파일 — 저장소 루트 기준 */
export const MODEL_MAKERS_PATH = 'apps/web/content/model-makers.ts';

/** 조직 정보 API — 조직이 아니면(개인 계정) 사용자 정보 API. 둘 다 `fullname` 을 준다 */
export const orgOverviewUrls = (org: string): string[] => [
  `https://huggingface.co/api/organizations/${org}/overview`,
  `https://huggingface.co/api/users/${org}/overview`,
];

/**
 * 레지스트리에 적는 이름 — model-makers.ts 머리말 규칙: 끝의 장식 문자(`_`·공백)를 빼고("Mistral AI_" → "Mistral AI"),
 * 소문자로만 적힌 이름은 첫 글자를 대문자로("upstage" → "Upstage"). 이름이 없으면 조직 id
 */
export function orgDisplayName(fullname: string | undefined, org: string): string {
  const name = (fullname ?? '').replace(/[\s_]+$/u, '').trim();
  if (name === '') return org;
  return name === name.toLowerCase() && /^[a-z]/.test(name) ? `${name[0]!.toUpperCase()}${name.slice(1)}` : name;
}

const objectKey = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`);

/** 레지스트리에 그 조직 키가 이미 있는지 — 파일 내용으로 본다(한 실행에서 같은 조직의 두 번째 모델이 줄을 또 넣지 않게) */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const makerKeyPattern = (org: string): string => `^\\s*(?:'${escapeRegExp(org)}'|${escapeRegExp(org)})\\s*:`;

export function hasMakerEntry(src: string, org: string): boolean {
  return new RegExp(makerKeyPattern(org), 'm').test(src);
}

/** 레지스트리에 적힌 그 조직의 이름 — 없으면 undefined */
export function makerNameFrom(src: string, org: string): string | undefined {
  const raw = new RegExp(`${makerKeyPattern(org)}\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm').exec(src)?.[1];
  return raw?.replace(/\\(.)/g, '$1');
}

/** MODEL_MAKERS 에 넣을 한 줄 — 출처(조직 정보 API)와 날짜를 주석으로 */
export function makerLine(org: string, name: string, today: string): string {
  const quoted = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  ${objectKey(org)}: '${quoted}', // add-model ${today} — ${orgOverviewUrls(org)[0]}`;
}

/** MODEL_MAKERS 블록 끝(`};`) 앞에 한 줄을 넣는다 */
export function insertMakerLine(src: string, line: string): string {
  const start = src.indexOf('export const MODEL_MAKERS');
  const end = start < 0 ? -1 : src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('MODEL_MAKERS 블록을 찾지 못함');
  return `${src.slice(0, end + 1)}${line}\n${src.slice(end + 1)}`;
}

/** 조직 이름 읽기 — 못 읽으면 undefined(호출자가 조직 id 로 쓰고 경고) */
async function fetchOrgFullname(org: string, headers: Record<string, string>): Promise<string | undefined> {
  for (const url of orgOverviewUrls(org)) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const fullname = ((await res.json()) as { fullname?: unknown }).fullname;
      if (typeof fullname === 'string' && fullname.trim() !== '') return fullname;
    } catch {
      // 다음 주소로
    }
  }
  return undefined;
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
  /** 총 파라미터 B — 주면 safetensors 총계 대신 이 값(10-22 D115). 근거는 레코드 note 에 남는다 */
  params?: number;
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
    else if (arg === '--params') a.params = Number(val());
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

/**
 * 레코드의 두 날짜 — 출시일 = HF `createdAt`(없으면 오늘), 카탈로그 추가일 = 오늘(UTC, 10-14 D72 "업데이트 소식").
 * 키 순서는 releasedAt → addedAt. 신모델 자동 추가 ①도 planAddition 을 거치므로 같은 값(① 이 PR 을 연 날)이 들어간다 —
 * ② 가 그 PR 을 다음 날 이후 머지하면 머지하는 날로 고친다(docs/PROGRESS.md §3, 사이트에 들어온 날이 되게)
 */
export function catalogDates(createdAt: string | undefined, today: string): { releasedAt: string; addedAt: string } {
  return { releasedAt: (createdAt ?? today).slice(0, 10), addedAt: today };
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
  /** 개발 조직(hfId 앞부분)과 레지스트리 이름 — `line` 이 있으면 처음 보는 조직이라 model-makers.ts 에 넣을 한 줄 */
  maker: { org: string; name: string; line?: string };
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
 * throw: 모델 없음 · 이미 카탈로그에 있음 · config 못 받음 · 기준 GGUF(Q4_K_M, 없으면 MXFP4) 없음 · 파라미터 수 없음 · 헤더 MoE 구조 ≠ config · MoE 활성 파라미터 모름 · 스키마 위반.
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
  if (rows.length === 0) throw new Error(`기준 GGUF(Q4_K_M, 없으면 MXFP4)를 찾지 못함 (후보: ${repos.join(', ') || '없음'}) — --gguf 로 지정`);

  const name = opts.name ?? displayName(hfId);
  const safetensorsB = info.safetensors?.total ? round2(info.safetensors.total / 1e9) : undefined;
  if (opts.params !== undefined && !(opts.params > 0)) throw new Error(`--params ${String(opts.params)} — 양수가 아님`);
  const paramsB = opts.params !== undefined ? round2(opts.params) : safetensorsB;
  if (!paramsB) throw new Error('파라미터 수(safetensors.total)를 받지 못함');
  const license = mapLicense(info.cardData?.license, info.cardData?.license_name);
  const vision = arch.vision || info.pipeline_tag === 'image-text-to-text';
  const baseCategory = opts.category ?? ['chat', ...(/coder/i.test(hfId) ? ['coding'] : []), ...(vision ? ['vision'] : [])];
  const category = opts.visionFromConfig && arch.vision && !baseCategory.includes('vision') ? [...baseCategory, 'vision'] : baseCategory;
  const src = mirror ? configUrl(mirror) : configUrl(hfId);

  let moeFields: Record<string, unknown> = {};
  const splitWarnings: string[] = [];
  // 행마다 헤더 실측 — MoE 분할(10-01), dense 그래픽카드 밖 몫(10-03 D62), MTP 블록
  // 값 전문가 모델(MoVA, 10-21 D113)은 행마다 실측(분할·valueExpertGB)이 없으면 쓰지 않는다
  const measured = await measureRows(rows, arch.moe, arch.arch.layers, (repo, fileName) => measureSplit(repo, fileName, { token }), {
    valueExperts: arch.mova !== undefined,
    ...(arch.loops !== undefined ? { loops: arch.loops } : {}),
  });
  if (measured.problems.length > 0) {
    throw new Error(`GGUF 헤더가 config 와 다르거나 필요한 실측이 없음 — 쓰지 않음:\n  ${measured.problems.join('\n  ')}`);
  }
  rows = measured.rows;
  splitWarnings.push(...measured.warnings);
  if (arch.moe) {
    const active = opts.active ?? activeFromName(hfId);
    if (active === undefined) throw new Error('MoE 활성 파라미터를 이름에서 못 읽음 — --active <B> 로 지정(모델 카드 기준)');
    // 모델 수준 nonExpertGB 는 기준 행(Q4_K_M, 없으면 MXFP4 — quantRowsFrom 의 첫 행) 크기로 유도한다(validateAll·sync-models 와 같은 기준)
    const base = rows[0]!;
    const nonExpertGB = round2(deriveNonExpertGB({ totalParamsB: paramsB, activeParamsB: active, experts: arch.moe.experts, topK: arch.moe.topK }, base.fileGB));
    moeFields = { activeParamsB: active, moe: true, nonExpertGB };
  }

  const popularity = opts.popularity ?? popularityFrom(info.downloads);
  const maxContext = opts.maxContext ?? arch.maxContext;

  // 개발 조직 이름(D101) — 레지스트리에 없으면 조직 정보 API 의 fullname 으로 한 줄
  const org = hfOrgOf(hfId);
  const makersSrc = readFileSync(join(repoRoot, MODEL_MAKERS_PATH), 'utf8');
  let maker: AdditionPlan['maker'];
  let makerWarning: string | undefined;
  if (hasMakerEntry(makersSrc, org)) {
    maker = { org, name: makerNameFrom(makersSrc, org) ?? org };
  } else {
    const fullname = await fetchOrgFullname(org, headers);
    const name = orgDisplayName(fullname, org);
    maker = { org, name, line: makerLine(org, name, today) };
    makerWarning =
      fullname === undefined
        ? `조직 "${org}" 의 이름을 Hugging Face 에서 읽지 못해 조직 id 를 그대로 ${MODEL_MAKERS_PATH} 에 넣음 — 조직 페이지 이름으로 고칠 것`
        : `처음 보는 조직 — ${MODEL_MAKERS_PATH} 에 "${name}" (${orgOverviewUrls(org)[0]} fullname "${fullname}") 을 넣음`;
  }
  const record: Record<string, unknown> = {
    id, family: familyOf(name), name, hfId, paramsB,
    ...(moeFields['activeParamsB'] !== undefined ? { activeParamsB: moeFields['activeParamsB'] } : {}),
    arch: {
      layers: arch.arch.layers, kvHeads: arch.arch.kvHeads, headDim: arch.arch.headDim, attnType: arch.attnType, kvBytesPerTokenF16: arch.arch.kvBytesPerTokenF16,
      ...(arch.moe ? { experts: arch.moe.experts, topK: arch.moe.topK } : {}),
      ...(arch.expertLayers ? { expertLayers: arch.expertLayers } : {}),
      // 층별 임베딩 표(PLE — 10-21 D112): 헤더 실측 행이 pleGB 를 갖고, 추정은 이론 추정
      ...(arch.ple ? { ple: true } : {}),
      // 값 전문가(MoVA — 10-21 D113): 헤더 분할은 값 전문가를 비전문가(그래픽카드 상주)로 세고, 추정은 이론 추정
      ...(arch.mova ? { valueExperts: arch.mova.experts, valueTopK: arch.mova.topK } : {}),
      // 반복 층(10-22 D114): KV 는 이미 논리 층(층 × loops) 값, 헤더 실측 행은 반복 블록 loopGB, 추정은 이론 추정
      ...(arch.loops !== undefined ? { loops: arch.loops } : {}),
      // 하이퍼 커넥션(mHC — 10-22 D115): 층마다 더하는 연산을 속도식이 세지 않아 추정은 이론 추정
      ...(arch.mhc ? { mhc: true } : {}),
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
    // 출시일과 카탈로그 추가일(D72 — 업데이트 소식 페이지가 날짜별로 묶는다)
    ...catalogDates(info.createdAt, today),
    note: `add-model 생성(${today}). releasedAt = HF createdAt${mirror ? `. gated — arch 는 ${mirror} 미러 config` : ''}${opts.params !== undefined ? `. paramsB = --params ${paramsB}(safetensors 총계 ${String(safetensorsB ?? '없음')} 대신)` : ''}`,
    // MoE 는 experts/topK, 반복 층 모델은 num_loops 의 출처로 config.json 을 명시 (게이트면 미러 config). 분류기가 구조 근거(llama.cpp 소스)를 주면
    // 덧붙인다(K2-Horizon MoE — D113, Nanbeige 반복 층 — D114)
    sources: [hfUrl(hfId), ...(mirror ? [configUrl(mirror)] : arch.moe || arch.loops !== undefined ? [configUrl(hfId)] : []), ...(arch.refs ?? [])],
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
  if (arch.loops !== undefined) {
    lines.push(`  looped layers ×${arch.loops} — KV 는 논리 층 ${arch.arch.layers * arch.loops}개, 행 loopGB(트렁크 블록)를 토큰마다 ${arch.loops}번 읽는다·이론 추정`);
  }
  if (arch.attnType === 'compressed') {
    lines.push(`  compressed attention — KV 는 압축 캐시(CSA·HCA·인덱서)만, raw SWA 창·압축기 상태는 상수라 연산 버퍼 근사${arch.mhc ? ' · 하이퍼 커넥션(mHC)' : ''}·이론 추정`);
  }
  if (arch.mova) {
    lines.push(`  MoVA value experts ${arch.mova.experts} top-${arch.mova.topK} — attn_v_exps 는 비전문가(그래픽카드 상주, llama.cpp --n-cpu-moe·--fit 이 옮기지 않음), 행 valueExpertGB 로 고른 몫만 읽기 바이트에 넣는다·이론 추정`);
  }
  for (const r of rows) {
    const split =
      r.expertGB !== undefined
        ? `  (expert ${r.expertGB} · non-expert ${String(r.nonExpertGB)} GB)`
        : r.offGpuGB !== undefined
          ? `  (off-GPU ${r.offGpuGB}${r.pleGB !== undefined ? ` · per-layer embedding ${r.pleGB}` : ''}${r.loopGB !== undefined ? ` · loop block ${r.loopGB}` : ''} GB)`
          : '';
    lines.push(`  ${r.quant.padEnd(10)} ${String(r.fileGB).padStart(7)} GB  ${r.ggufRepo}/${r.fileName ?? ''}${split}`);
  }
  const warnings: string[] = [...splitWarnings];
  if (classifyLicense(license) === 'unknown') warnings.push(`라이선스 "${license}" 가 배지 맵(packages/data/src/license.ts)에 없음 — 분류 추가 필요`);
  if (arch.offFileModules && opts.params === undefined) {
    // 10-22 D115 리뷰 — safetensors 총계에 본 GGUF 에 없는 모듈 몫이 섞인다(계산기 불러오기는 헤더 원소 수를 자동으로 쓴다)
    warnings.push(`config 의 ${arch.offFileModules.join('·')} 는 본 GGUF 에 없다 — paramsB ${paramsB} 는 그 몫이 섞인 safetensors 총계, 카드에 총 파라미터가 없으면 --params <GGUF 헤더 원소 수> 로 다시`);
  }
  if (!opts.category) warnings.push('카테고리는 기본값 — 용도 필터용(리즈닝은 --category chat,reasoning)');
  if (!opts.thinking) warnings.push('생각 모드 미지정 — 모델 카드·채팅 템플릿에 thinking(enable_thinking·<think>·reasoning_effort)이 있으면 --thinking always|default-on|default-off|auto 로 다시 (판정 기준 1.5배, D59)');
  if (!opts.maxContext) warnings.push(`최대 컨텍스트 ${arch.maxContext} 는 config 값 — 모델 카드의 기본(네이티브) 길이와 다르면 --max-context 로 (예: Qwen3 은 카드 기준 32768, YaRN 확장 전)`);
  if (!opts.name) warnings.push(`표시명 "${name}" 은 자동 — 어색하면 --name 으로`);
  if (makerWarning) warnings.push(makerWarning);

  const activeParamsB = moeFields['activeParamsB'] as number | undefined;
  return {
    kind: 'ok',
    plan: {
      hfId, id, name, record, rows, ...(moeLine ? { moeLine } : {}), maker, lines, warnings,
      summary: {
        modelType: arch.modelType, attnType: arch.attnType, ...(arch.moe ? { moe: arch.moe } : {}), paramsB,
        ...(activeParamsB !== undefined ? { activeParamsB } : {}),
        ggufRepo: rows[0]!.ggufRepo, license, category, maxContext, popularity, vision,
      },
    },
  };
}

/**
 * 계획을 쓴다 — MOE_ARCH 한 줄(MoE) · 처음 보는 조직 이름(model-makers.ts, D101) · models.json · model-quants.json · meta.json 기준일.
 * 교차 검증(validate-data)은 호출자 몫
 */
export function applyAddition(plan: AdditionPlan, ctx: CatalogRaw & { today: string }, root = repoRoot): void {
  if (plan.maker.line) {
    const makersPath = join(root, MODEL_MAKERS_PATH);
    const src = readFileSync(makersPath, 'utf8');
    if (!hasMakerEntry(src, plan.maker.org)) writeFileSync(makersPath, insertMakerLine(src, plan.maker.line));
  }
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
  console.log(
    `\n추가함: data/models.json · data/model-quants.json(+${plan.rows.length}) · data/meta.json${plan.moeLine ? ' · MOE_ARCH' : ''}${plan.maker.line ? ` · ${MODEL_MAKERS_PATH}` : ''}. 다음: pnpm test → pnpm build → pnpm run test:export`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1; // process.exit 는 열린 fetch 소켓과 부딪혀 Windows 에서 비정상 종료한다(UV_HANDLE_CLOSING)
  });
}
