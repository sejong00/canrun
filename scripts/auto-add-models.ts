/**
 * 신모델 자동 추가 ① — docs/03-data-spec.md §5.3 (10-06 D71).
 *
 * 매일 GitHub Actions(.github/workflows/new-model-add.yml, new-model-alert 다음)가 돌린다:
 *  1) 탐지 — new-model-alert 와 같은 함수(trending + org 신규 릴리스, 리팩·OCR·타 org 파생 제외)로 최근 14일 안에 나온,
 *     카탈로그에 없고 스킵 목록(scripts/new-model-skips.json)에 없는 후보. 이슈 이력의 기보고 제외는 쓰지 않는다 —
 *     출시 직후 다운로드가 적던 모델이 며칠 뒤 기준을 넘을 수 있어 매일 다시 평가한다.
 *  2) 선별 — 공식 제작사 허용 목록 또는 최근 30일 다운로드 ≥ 20,000, 인기 신호(다운로드 → likes) 큰 순으로 한 번에 최대 3종.
 *  3) 추정 — 생각 모드(채팅 템플릿 → 모델 카드)·용도(이름·태그·파이프라인)·한국어(제작사)를 add-model 옵션으로 넘긴다. 표시 이름·인기도는 add-model 기본값.
 *  4) 추가 — add-model 의 planAddition·applyAddition 을 그대로 부르고, 한 종마다 validate-data·pnpm test(공유 카드 글꼴이 모자라면 다시 받음).
 *     깨지면 그 후보만 되돌린다. 마지막에 pnpm build·test:export 한 번.
 *  5) 보고서(PR 본문) — 추가한 모델과 추정 근거, ②(Claude 정기 작업)가 확인할 것, 자동으로 넣지 않은 후보와 이유.
 *     열린 PR 에 ② 가 고친 커밋이 있으면 워크플로가 브랜치를 덮어쓰지 않고 보고서를 그 PR 에 코멘트한다(AUTO_COMMIT_PREFIX).
 * PR 은 워크플로가 만든다(브랜치 data/new-models, 라벨 new-model-add). 자동 머지·main 푸시는 하지 않는다.
 *
 * 실행: pnpm exec tsx scripts/auto-add-models.ts --report new-models-report.md   # 추가 + 검사 (CI)
 *       pnpm exec tsx scripts/auto-add-models.ts --dry --report <경로>            # 파일을 쓰지 않고 오늘 고를 후보만
 * GITHUB_OUTPUT 이 있으면 added=<수> · gate=pass|fail|none|dry · date=<YYYY-MM-DD> 를 남긴다.
 * 시크릿 제로(CLAUDE.md 규칙 7): HF_TOKEN 은 env 로만 받아 요청 헤더에만 쓴다 — 출력·보고서에 넣지 않는다.
 */

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLicense, parseNewModelSkips, type NewModelSkip } from '../packages/data/src/index';
import { applyAddition, planAddition, readCatalogRaw, type AdditionPlan, type CatalogRaw, type Thinking } from './add-model';
import { authHeaders, fetchWithRetry, type FetchLike } from './hf-common';
import {
  WATCHED_ORGS,
  fetchDetectionSources,
  filterCandidates,
  loadKnownHfIds,
  type Candidate,
  type HfApiModel,
} from './new-model-alert';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// 정책 상수 — 실측이 아닌 운영 판단(docs/03 §5.3)
// ---------------------------------------------------------------------------

// source: docs/03 §5.3 (policy) — 출시 후 이 기간 안의 후보만 본다(그보다 오래된 trending 은 요약 이슈 트리아지 몫)
export const AUTO_WINDOW_DAYS = 14;
// source: docs/03 §5.3 (policy) — 허용 목록 밖 제작사는 최근 30일 다운로드가 이만큼 넘어야 자동으로 넣는다
export const AUTO_MIN_DOWNLOADS = 20_000;
// source: docs/03 §5.3 (policy) — 한 번에 넣는 최대 모델 수(PR 을 작게)
export const AUTO_MAX_ADD = 3;
// source: docs/03 §5.3 (policy) — 한 번에 시도하는 최대 후보 수(HF 요청·GGUF 헤더 읽기 상한). 남은 후보는 다음 날
export const AUTO_MAX_ATTEMPTS = 8;

/**
 * 공식 제작사 허용 목록 — 카탈로그의 hfId 제작사는 실행 때 더한다(allowedOrgs).
 * 이름은 HF API(`/api/models?author=<org>`)로 확인한 실제 표기(10-06 — Cohere 는 CohereForAI 가 CohereLabs 로 바뀜).
 */
// source: docs/03 §5.3 (policy)
export const OFFICIAL_ORGS = [
  'Qwen', 'meta-llama', 'google', 'mistralai', 'microsoft', 'openai', 'nvidia', 'deepseek-ai', 'ibm-granite',
  'LGAI-EXAONE', 'naver-hyperclovax', 'kakaocorp', 'upstage', 'skt', 'K-intelligence', 'trillionlabs', 'Motif-Technologies',
  'LiquidAI', 'inclusionAI', 'allenai', 'CohereLabs', 'moonshotai', 'zai-org', 'MiniMaxAI', 'tencent', 'baidu',
  'HuggingFaceTB', 'tiiuae', 'stepfun-ai',
] as const;

/** 한국 제작사 — 이 org 의 모델은 korean: true (ko 차별화 — 카탈로그 한국 모델 관례) */
// source: docs/03 §5.3 (policy)
export const KOREAN_ORGS = [
  'LGAI-EXAONE', 'naver-hyperclovax', 'kakaocorp', 'upstage', 'skt', 'K-intelligence', 'trillionlabs', 'Motif-Technologies',
] as const;

// ---------------------------------------------------------------------------
// 순수 코어 (scripts/auto-add-models.test.ts)
// ---------------------------------------------------------------------------

const orgOf = (hfId: string): string => hfId.split('/')[0] ?? '';
const baseName = (hfId: string): string => hfId.split('/')[1] ?? hfId;

/** 허용 목록(소문자) = OFFICIAL_ORGS ∪ 카탈로그 hfId 제작사 */
export function allowedOrgs(catalogHfIds: readonly string[]): Set<string> {
  return new Set([...OFFICIAL_ORGS, ...catalogHfIds.map(orgOf)].map((o) => o.toLowerCase()));
}

/** 탐지 때 조회할 org — 감시 org(new-model-alert) ∪ 허용 목록 ∪ 카탈로그 제작사, 대소문자 무시로 한 번씩 */
export function orgsToQuery(catalogHfIds: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const org of [...WATCHED_ORGS, ...OFFICIAL_ORGS, ...catalogHfIds.map(orgOf)]) {
    if (org !== '' && !out.has(org.toLowerCase())) out.set(org.toLowerCase(), org);
  }
  return [...out.values()];
}

export type AutoCandidate = Candidate & { official: boolean; pipelineTag?: string; tags: string[] };

export type ReviewReason =
  | '기준 미달'
  | 'Base 모델'
  | '드래프트 모델'
  | '용도 특화 모델'
  | '보류 구조'
  | 'GGUF 없음'
  | '추정 실패'
  | '처음 보는 라이선스'
  | '검사 실패'
  | '계획 실패'
  | '다음 실행으로';

/** 자동으로 넣지 않은 후보 — ② 가 판단한다 */
export type ReviewItem = { hfId: string; reason: ReviewReason; detail: string; downloads?: number; createdAt?: string };

export type Selection = {
  /** 자동 추가를 시도할 후보 — 인기 신호 큰 순 */
  eligible: AutoCandidate[];
  review: ReviewItem[];
  /** 스킵 목록으로 뺀 후보 — hfId 는 후보 이름(형식 변형이면 스킵 목록 이름과 다를 수 있다) */
  skipped: NewModelSkip[];
  /** 학습 중간 단계·교사 모델 저장소 — 보고서에 한 줄로 */
  checkpoints: string[];
  /** 창(14일)보다 오래됐거나 생성일을 모르는 후보 수 — 보고서에 수만 */
  stale: number;
};

const DRAFT_TAGS = new Set(['draft-model', 'speculative-decoding']);
const BASE_NAME = /(?:^|[-_])base(?:[-_]|$)/i;
/** 이름에 Base 가 있어도 대화용인 표기 — K-intelligence/Midm-2.0-Base-Instruct (10-06 리뷰) */
const CHAT_NAME = /instruct|chat|(?:^|[-_])it(?:[-_]|$)/i;
/** 대화용 짝 저장소 접미 — 같은 org 에 `<이름>-Instruct` 등이 있으면 `<이름>` 은 Base 다(google/gemma-3-270m, meta-llama/Llama-3.2-3B) */
const CHAT_SUFFIXES = ['-instruct', '-it', '-chat'] as const;
/**
 * 학습 중간 단계·교사 모델 저장소 — 공식 제작사가 최종 대화용 모델과 함께 올린다(10-06 리뷰: openbmb/MiniCPM5-2B-SFT·-Midtrain,
 * nvidia/NVIDIA-Nemotron-Labs-Teacher-*, google/gemma-3-12b-pt, trillionlabs/Tri-70B-Intermediate-Checkpoints).
 */
const CHECKPOINT_NAME = /(?:^|[-_])(?:sft|dpo|mid-?train(?:ing)?|pre-?train(?:ed|ing)?|pt|teacher|ckpt|checkpoints?|intermediate)(?:[-_]|$)/i;
/** 같은 모델의 형식 변형 접미 — 스킵 목록은 이 접미를 뗀 이름으로 맞춘다(zai-org/GLM-5.3-Flash-BF16 → GLM-5.3-Flash) */
const FORMAT_SUFFIX = /(?:[-_](?:bf16|fp16|fp8|fp4|mxfp4|nvfp4|int4|int8|awq|gptq|onnx|mlx|gguf))+$/i;
export const variantKey = (hfId: string): string => hfId.toLowerCase().replace(FORMAT_SUFFIX, '');
/**
 * 대화용 범용 모델이 아닌 용도 특화 모델 — 화자 분리·안전 분류·보상·임베딩·검색·음성·시계열·로봇 등.
 * 허용 목록 제작사라도 자동으로 넣지 않는다(10-06 드라이런: google/DiarizationLM-Gemma-4-E4B-v1).
 */
const TASK_MODEL =
  /diariz|guard|shield|safety|reward|embed|rerank|retriev|classif|forecast|time-?series|robot|(?:^|[-_.])(?:asr|tts|vla|prm)(?:[-_.\d]|$)/i;

/** 같은 org 에 대화용 짝(`<이름>-Instruct`·`-it`·`-Chat`)이 있는가 — ids 는 소문자 */
const hasChatSibling = (hfId: string, ids: ReadonlySet<string>): boolean =>
  CHAT_SUFFIXES.some((s) => ids.has(`${hfId.toLowerCase()}${s}`));

/**
 * 선별 — 스킵 목록(형식 변형 접미를 뗀 이름으로) → 창(14일) → 드래프트·Base·중간 체크포인트·용도 특화 → 허용 목록 또는 다운로드 ≥ 20,000.
 * candidates 는 filterCandidates(카탈로그·리팩·OCR·타 org 파생 제외) 결과, details 는 그 원본 API 레코드(소문자 id → 태그·파이프라인).
 * siblingIds(소문자)는 Base 판정용 — 조회한 API 레코드 id ∪ 카탈로그·GGUF 저장소 id. 없으면 details 의 id 만 본다.
 */
export function selectCandidates(input: {
  candidates: readonly Candidate[];
  details: ReadonlyMap<string, HfApiModel>;
  skips: readonly NewModelSkip[];
  allowed: ReadonlySet<string>;
  now: Date;
  siblingIds?: ReadonlySet<string>;
}): Selection {
  const skipById = new Map(input.skips.map((s) => [variantKey(s.hfId), s]));
  const siblings = input.siblingIds ?? new Set(input.details.keys());
  const windowStart = input.now.getTime() - AUTO_WINDOW_DAYS * DAY_MS;
  const sel: Selection = { eligible: [], review: [], skipped: [], checkpoints: [], stale: 0 };
  for (const c of input.candidates) {
    const skip = skipById.get(variantKey(c.hfId));
    if (skip) {
      sel.skipped.push({ ...skip, hfId: c.hfId });
      continue;
    }
    const created = c.createdAt === undefined ? Number.NaN : Date.parse(c.createdAt);
    if (Number.isNaN(created) || created < windowStart) {
      sel.stale += 1;
      continue;
    }
    const detail = input.details.get(c.hfId.toLowerCase());
    const tags = detail?.tags ?? [];
    const base = { hfId: c.hfId, downloads: c.downloads, createdAt: c.createdAt?.slice(0, 10) };
    const name = baseName(c.hfId);
    if (tags.some((t) => DRAFT_TAGS.has(t))) {
      sel.review.push({ ...base, reason: '드래프트 모델', detail: '추측 디코딩용 드래프트라 계산기 대상이 아닙니다' });
      continue;
    }
    if ((BASE_NAME.test(name) && !CHAT_NAME.test(name)) || hasChatSibling(c.hfId, siblings)) {
      sel.review.push({ ...base, reason: 'Base 모델', detail: '대화용(Instruct) 모델이 아닙니다 — 같은 제작사의 대화용 모델을 넣습니다' });
      continue;
    }
    if (CHECKPOINT_NAME.test(name)) {
      sel.checkpoints.push(c.hfId);
      continue;
    }
    if (TASK_MODEL.test(name)) {
      sel.review.push({ ...base, reason: '용도 특화 모델', detail: '이름으로 보아 대화용 범용 모델이 아닙니다 — 필요하면 add-model 로 직접 넣습니다' });
      continue;
    }
    const official = input.allowed.has(orgOf(c.hfId).toLowerCase());
    if (!official && c.downloads < AUTO_MIN_DOWNLOADS) {
      sel.review.push({
        ...base,
        reason: '기준 미달',
        detail: `허용 목록 밖 제작사이고 30일 다운로드가 ${c.downloads.toLocaleString('en-US')}회로 기준(${AUTO_MIN_DOWNLOADS.toLocaleString('en-US')}회)보다 적습니다`,
      });
      continue;
    }
    sel.eligible.push({ ...c, official, ...(detail?.pipeline_tag !== undefined ? { pipelineTag: detail.pipeline_tag } : {}), tags });
  }
  sel.eligible.sort((a, b) => b.downloads - a.downloads || b.likes - a.likes || a.hfId.localeCompare(b.hfId));
  return sel;
}

export type ThinkingEstimate = {
  /** add-model --thinking 으로 넘길 값. 없으면 생각 모드 없음 */
  value?: Thinking;
  /** false 면 ② 가 모델 카드로 꼭 확인 — 값은 최선의 추정 */
  sure: boolean;
  basis: string;
};

/** 빈 생각 블록 — `<think></think>`·`<|think|><|end|>`(Solar Open)·`<|think:start|><|think:end|>`(Solar Open2) */
const EMPTY_THINK = /<\|?think(?::start)?\|?>(?:\s|\\n)*<\|?\/?(?:think:)?(?:end|think)\|?>/;

/** 채팅 템플릿에서 응답을 시작하는 부분(add_generation_prompt 마지막 등장 이후) */
const generationTail = (template: string): string => {
  const i = template.lastIndexOf('add_generation_prompt');
  return i < 0 ? '' : template.slice(i);
};

/** 템플릿 변수 `thinking` 으로 켜고 끄는 분기 — `{% if not thinking %}`·`{%- elif thinking %}` (DeepSeek-V3.1·V3.2, Granite 3.3). `message.thinking` 은 아님 */
const THINKING_VAR = /\{%-?\s*(?:el)?if\s+(?:not\s+)?thinking\s*-?%\}/;
/** 생각 블록 표지 — `<think>`·`<thought>`(EXAONE Deep)·`[THINK]`(Magistral)·`/think`·`/no_think` 스위치 */
const THINK_MARKER = /<think>|<thought>|\[THINK\]|\/no_?think\b|(?:^|[\s'"])\/think\b/;
/** 응답 시작에 열어 두는 생각 블록(바로 닫는 빈 블록 제외) */
const OPEN_THINK = /<(think|thought)>(?!(?:\s|\\n)*<\/\1>)|\[THINK\](?!(?:\s|\\n)*\[\/THINK\])/;
/** 모델 카드가 non-thinking 전용이라고 밝힘 — Qwen3-*-Instruct-2507 */
const CARD_NON_THINKING = /only\s+non-thinking|non-thinking\s+mode\s+only|does\s+not\s+generate\s+`*<think>/i;
/**
 * 모델 카드의 생각 모드 표지 — 채팅 템플릿에 표지가 없는 생각 모델(10-06 리뷰: tencent/Hunyuan-A13B·7B "slow-thinking",
 * MiniMaxAI/MiniMax-M1 "reasoning model"). 카탈로그 생각 모드 없는 모델 13종의 카드에는 하나도 없다(10-06 확인).
 */
const CARD_THINKING =
  /thinking[- ]mode|reasoning (?:model|mode)|slow[- ]thinking|hybrid (?:reasoning|thinking)|thinking[ _]budget|enable_thinking|reasoning_effort|<\/?think>|<\/?thought>|\/no_?think\b/i;

/** 템플릿에서 표지를 못 찾았을 때 — 이름 → 모델 카드 순으로 본다 */
function thinkingFallback(templateNote: string, hfId: string, card: string | undefined, templateKnown: boolean): ThinkingEstimate {
  if (/think|reason|(?:^|[-_])r1(?:[-_]|$)/i.test(baseName(hfId))) {
    return { value: 'default-on', sure: false, basis: `${templateNote}, 이름에 생각 모드 표기가 있습니다` };
  }
  if (card === undefined) return { sure: false, basis: `${templateNote}, 모델 카드를 받지 못했습니다` };
  if (CARD_NON_THINKING.test(card)) return { sure: templateKnown, basis: `${templateNote}, 모델 카드에 non-thinking 전용이라고 적혀 있습니다` };
  const hit = CARD_THINKING.exec(card)?.[0];
  if (hit !== undefined) return { value: 'default-on', sure: false, basis: `${templateNote}, 모델 카드에 \`${hit}\` 표현이 있습니다` };
  return { sure: templateKnown, basis: `${templateNote}, 모델 카드에도 생각 모드 표지가 없습니다` };
}

/**
 * 생각 모드 추정 — 채팅 템플릿(tokenizer_config.json 의 chat_template 또는 chat_template.jinja)과 모델 카드(README) 기준.
 * 판정은 생각 모드가 "있는지"만 본다(×1.5, D59 — assess.isReasoning) — 확실하지 않아도 표지가 있으면 최선의 값을 넣고 sure:false 로
 * ② 확인을 건다(미지정은 생각하는 모델을 낙관적으로 판정한다). 카탈로그 43종 + 다른 공식 모델 40여 종 템플릿으로 맞춰 봄(10-06): 확정한 값은 모두 맞다.
 *  - enable_thinking: `| default(true|false)`·`if … is defined else True|False` 가 있으면 그 값. 없으면 "끄라고 할 때만 끈다"
 *    (`is not defined or enable_thinking`·`is defined and enable_thinking is false`) → default-on, "켜라고 할 때만 켠다"
 *    (`is defined and enable_thinking [is true] %}`) → default-off. 둘 다·둘 다 아님(중첩 분기) → default-on + 확인 필요.
 *  - reasoning_effort(enable_thinking 없음): 생각 블록을 비우는 분기가 없으면 always(gpt-oss), 있으면 default-on
 *    (기본 단계가 medium·high·xhigh 로 적혀 있으면 확정 — Solar Open·Open2, 아니면 확인 필요).
 *  - 템플릿 변수 `thinking`(`{% if not thinking %}`): `set thinking = true|false` 가 기본값, 없으면 넘기지 않을 때 꺼짐 → default-off(DeepSeek-V3.1·Granite 3.3).
 *  - `<think>`·`<thought>`·`[THINK]`·`/no_think` 표지만: 응답 시작에 생각 블록을 열어 두면 always(R1 Distill·LFM2.5·EXAONE Deep), 아니면 default-on + 확인 필요.
 *  - 표지 없음: 이름에 think·reason·R1 이 있으면 default-on + 확인 필요(HyperCLOVA X THINK 는 자체 표기). 아니면 모델 카드 —
 *    non-thinking 전용이라고 밝히면 없음, 생각 모드 표지가 있으면 default-on + 확인 필요, 둘 다 없으면 없음. 카드를 못 받으면 확인 필요.
 */
export function estimateThinking(template: string | undefined, hfId: string, card?: string): ThinkingEstimate {
  if (template === undefined) return thinkingFallback('채팅 템플릿을 받지 못했고', hfId, card, false);
  if (/enable_thinking/.test(template)) {
    const explicit =
      /enable_thinking\s*\|\s*default\(\s*(true|false)\s*\)/i.exec(template) ??
      /enable_thinking\s+if\s+enable_thinking\s+is\s+defined\s+else\s+(true|false)\b/i.exec(template);
    if (explicit?.[1] !== undefined) {
      const on = explicit[1].toLowerCase() === 'true';
      return { value: on ? 'default-on' : 'default-off', sure: true, basis: `enable_thinking 기본값이 ${on ? 'true' : 'false'} 입니다` };
    }
    const on =
      /enable_thinking\s+is\s+(?:not\s+defined|undefined)\s+or\s+enable_thinking\b/.test(template) ||
      /enable_thinking\s+is\s+defined\s+and\s+(?:enable_thinking\s+is\s+false|not\s+enable_thinking)\b/.test(template);
    const off = /enable_thinking\s+is\s+defined\s+and\s+enable_thinking(?:\s+is\s+true)?\s*-?%\}/.test(template);
    if (on !== off) {
      return on
        ? { value: 'default-on', sure: true, basis: 'enable_thinking 을 끄라고 할 때만 끕니다' }
        : { value: 'default-off', sure: true, basis: 'enable_thinking 을 켜라고 할 때만 켭니다' };
    }
    return { value: 'default-on', sure: false, basis: 'enable_thinking 이 있지만 템플릿에서 기본값을 확정하지 못했습니다' };
  }
  if (/reasoning_effort/.test(template)) {
    if (!EMPTY_THINK.test(template)) return { value: 'always', sure: true, basis: 'reasoning_effort 만 있고 생각 블록을 비우는 단계가 없습니다(gpt-oss 류)' };
    const def = /reasoning_effort\s+if\s+reasoning_effort\s+is\s+defined\s+else\s+["'](\w+)["']/.exec(template)?.[1];
    if (def !== undefined && /^(?:medium|high|xhigh|max)$/i.test(def)) {
      return { value: 'default-on', sure: true, basis: `reasoning_effort 기본값이 ${def} 이고, 낮추면 생각 블록을 비웁니다` };
    }
    return { value: 'default-on', sure: false, basis: 'reasoning_effort 로 생각 블록을 비울 수 있지만 기본 단계를 확정하지 못했습니다' };
  }
  if (THINKING_VAR.test(template)) {
    const def = /set\s+thinking\s*=\s*(true|false)\b/i.exec(template)?.[1]?.toLowerCase();
    if (def === 'true') return { value: 'default-on', sure: true, basis: '`thinking` 변수 기본값이 true 입니다' };
    return {
      value: 'default-off',
      sure: true,
      basis: def === 'false' ? '`thinking` 변수 기본값이 false 입니다' : '`thinking` 변수를 넘기지 않으면 꺼집니다',
    };
  }
  if (THINK_MARKER.test(template)) {
    return OPEN_THINK.test(generationTail(template))
      ? { value: 'always', sure: true, basis: '응답 시작에 생각 블록(`<think>` 등)을 열어 둡니다 — 끄는 스위치가 없습니다' }
      : { value: 'default-on', sure: false, basis: '`<think>` 같은 생각 표지만 있고 켜고 끄는 스위치를 찾지 못했습니다' };
  }
  return thinkingFallback('채팅 템플릿에 생각 모드 표지가 없고', hfId, card, true);
}

const CATEGORY_ORDER = ['chat', 'coding', 'reasoning', 'vision'] as const;
type Category = (typeof CATEGORY_ORDER)[number];

/**
 * 용도 추정 — chat 기본 + 이름·태그의 code/coder → coding, 파이프라인·태그 image-text-to-text·vision → vision,
 * 늘 생각하는 모델(always) → reasoning(gpt-oss·R1 Distill 관례). config 의 비전 인코더는 add-model 이 더한다(visionFromConfig).
 */
export function estimateCategory(input: { hfId: string; tags: readonly string[]; pipelineTag?: string; thinking?: Thinking }): { value: Category[]; basis: string } {
  const set = new Set<Category>(['chat']);
  const why: string[] = ['chat 기본'];
  if (/(?:^|[^a-z])cod(?:e|er|ing)(?:[^a-z]|$)|codestral/i.test(baseName(input.hfId)) || input.tags.includes('code')) {
    set.add('coding');
    why.push('이름·태그에 code');
  }
  if (input.pipelineTag === 'image-text-to-text' || input.tags.some((t) => t === 'vision' || t === 'image-text-to-text')) {
    set.add('vision');
    why.push('이미지 입력(image-text-to-text)');
  }
  if (input.thinking === 'always') {
    set.add('reasoning');
    why.push('늘 생각하는 모델');
  }
  return { value: CATEGORY_ORDER.filter((c) => set.has(c)), basis: why.join(' · ') };
}

export function estimateKorean(hfId: string): { value: boolean; basis: string } {
  const org = orgOf(hfId).toLowerCase();
  return KOREAN_ORGS.some((o) => o.toLowerCase() === org)
    ? { value: true, basis: `한국 제작사(${orgOf(hfId)})` }
    : { value: false, basis: '한국 제작사 목록 밖' };
}

/** add-model 이 멈춘 메시지 → 확인 필요 이유 */
export function classifyPlanError(message: string): ReviewReason {
  if (/GGUF 를 찾지 못함/.test(message)) return 'GGUF 없음';
  if (/활성 파라미터|파라미터 수/.test(message)) return '추정 실패';
  return '계획 실패';
}

export type AddedModel = {
  hfId: string;
  id: string;
  name: string;
  structure: string;
  ggufRepo: string;
  paramsB: number;
  activeParamsB?: number;
  license: string;
  popularity: number;
  downloads: number;
  maxContext: number;
  category: string[];
  thinking: ThinkingEstimate;
  categoryBasis: string;
  korean: { value: boolean; basis: string };
  warnings: string[];
};

export type Attempt = { kind: 'added'; added: AddedModel } | { kind: 'review'; item: ReviewItem };

/**
 * 후보를 인기 순으로 시도한다 — 추가 AUTO_MAX_ADD 종 또는 시도 AUTO_MAX_ATTEMPTS 번에서 멈추고, 남은 후보는 "다음 실행으로".
 * attempt 가 throw 하면 그 후보만 계획 실패로 돌린다.
 */
export async function runAdditions(
  eligible: readonly AutoCandidate[],
  attempt: (c: AutoCandidate) => Promise<Attempt>,
  limits: { maxAdd: number; maxAttempts: number } = { maxAdd: AUTO_MAX_ADD, maxAttempts: AUTO_MAX_ATTEMPTS },
): Promise<{ added: AddedModel[]; review: ReviewItem[] }> {
  const added: AddedModel[] = [];
  const review: ReviewItem[] = [];
  let tries = 0;
  for (const c of eligible) {
    const base = { hfId: c.hfId, downloads: c.downloads, createdAt: c.createdAt?.slice(0, 10) };
    if (added.length >= limits.maxAdd || tries >= limits.maxAttempts) {
      review.push({ ...base, reason: '다음 실행으로', detail: `한 번에 최대 ${limits.maxAdd}종·시도 ${limits.maxAttempts}번 — 다음 실행에서 다시 봅니다` });
      continue;
    }
    tries += 1;
    try {
      const r = await attempt(c);
      if (r.kind === 'added') added.push(r.added);
      else review.push(r.item);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      review.push({ ...base, reason: classifyPlanError(message), detail: oneLine(message) });
    }
  }
  return { added, review };
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' · ').replace(/\|/g, '\\|').slice(0, 300);

/** 계획 → 보고서용 추가 모델 */
export function toAddedModel(
  plan: AdditionPlan,
  c: Pick<AutoCandidate, 'downloads'>,
  est: { thinking: ThinkingEstimate; categoryBasis: string; korean: { value: boolean; basis: string } },
): AddedModel {
  const s = plan.summary;
  const category = plan.record['category'] as string[];
  const fromConfig = category.includes('vision') && !est.categoryBasis.includes('이미지');
  return {
    hfId: plan.hfId,
    id: plan.id,
    name: plan.name,
    structure: `${s.modelType} · ${s.attnType}${s.moe ? ` · MoE ${s.moe.experts}E top-${s.moe.topK}` : ''}`,
    ggufRepo: s.ggufRepo,
    paramsB: s.paramsB,
    ...(s.activeParamsB !== undefined ? { activeParamsB: s.activeParamsB } : {}),
    license: s.license,
    popularity: s.popularity,
    downloads: c.downloads,
    maxContext: s.maxContext,
    category,
    thinking: est.thinking,
    categoryBasis: fromConfig ? `${est.categoryBasis} · config 비전 인코더` : est.categoryBasis,
    korean: est.korean,
    warnings: plan.warnings,
  };
}

export type GateResult =
  | { status: 'pass' | 'none' | 'dry' }
  | { status: 'fail'; step: string; tail: string };

export type ReportInput = {
  date: string;
  dry: boolean;
  added: readonly AddedModel[];
  review: readonly ReviewItem[];
  skipped: readonly NewModelSkip[];
  /** 학습 중간 단계·교사 모델 저장소로 뺀 후보 */
  checkpoints: readonly string[];
  stale: number;
  gate: GateResult;
  fontRefreshed: boolean;
};

/** PR 본문 마커 — ② 가 추가 모델 목록을 기계적으로 읽는다 */
export const REPORT_MARKER = 'new-model-add:';

/** ① 커밋 제목 접두 — 워크플로가 열린 PR 에 이 제목이 아닌 커밋(② 의 수정)이 있으면 브랜치를 덮어쓰지 않는다 */
export const AUTO_COMMIT_PREFIX = 'feat(catalog): 신모델 자동 추가';

const hf = (repo: string): string => `[${repo}](https://huggingface.co/${repo})`;
const num = (n: number): string => n.toLocaleString('en-US');

/**
 * add-model 경고 중 자동 추가가 이미 다룬 것(옵션 안내 — 생각 모드·카테고리·표시명·최대 컨텍스트)은 보고서에서 뺀다.
 * 같은 내용은 "② 가 확인할 것" 체크리스트에 있다. 나머지(GGUF 헤더 측정 등)는 그대로 싣는다.
 */
export function reportWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((w) => !/^(?:생각 모드 미지정|카테고리는 기본값|최대 컨텍스트 \S+ 는 config 값|표시명 ")/.test(w));
}

/** 보고서(PR 본문·이슈 코멘트) — 합니다체 */
export function renderReport(r: ReportInput): string {
  const out: string[] = [];
  out.push(`## 신모델 자동 추가 — ${r.date}${r.dry ? ' (드라이런: 파일을 쓰지 않았습니다)' : ''}`, '');
  out.push(
    '자동 추가(docs/03 §5.3)가 Hugging Face 신모델 후보를 골라 `add-model` 로 레코드를 만듭니다. ' +
      '생각 모드·용도·한국어 표시는 채팅 템플릿·모델 카드·이름으로 **추정**한 값이라, 머지 전에 모델 카드와 대조해 주세요.',
    '',
  );

  out.push(`### ${r.dry ? '추가할 모델' : '추가한 모델'} (${r.added.length}종)`, '');
  if (r.added.length === 0) {
    out.push(r.dry ? '오늘 자동으로 넣을 모델이 없습니다.' : '자동으로 넣은 모델이 없어 PR 을 만들지 않습니다.', '');
  } else {
    out.push('| 모델 | 구조 | 기준 GGUF | 파라미터 | 생각 모드 (추정) | 용도 (추정) | 한국어 (추정) | 인기도 |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const m of r.added) {
      const params = `${m.paramsB}B${m.activeParamsB !== undefined ? ` (활성 ${m.activeParamsB}B)` : ''}`;
      const thinking = `${m.thinking.value ?? '없음'}${m.thinking.sure ? '' : ' ⚠확인 필요'} — ${m.thinking.basis}`;
      out.push(
        `| ${hf(m.hfId)} → \`${m.id}\` (${m.name}) | ${m.structure} | ${hf(m.ggufRepo)} | ${params} | ${thinking} | ${m.category.join(',')} ⚠확인 필요 — ${m.categoryBasis} | ${m.korean.value ? '예' : '아니오'} — ${m.korean.basis} | ${m.popularity} (30일 ${num(m.downloads)}회) |`,
      );
    }
    out.push('');
    const warned = r.added.map((m) => ({ hfId: m.hfId, warnings: reportWarnings(m.warnings) })).filter((m) => m.warnings.length > 0);
    if (warned.length > 0) {
      out.push('add-model 이 남긴 경고:', '');
      for (const m of warned) for (const w of m.warnings) out.push(`- **${m.hfId}**: ${w}`);
      out.push('');
    }

    out.push('### ② 가 확인할 것', '');
    for (const m of r.added) {
      out.push(
        `- [ ] **${m.hfId}** 생각 모드 \`${m.thinking.value ?? '없음'}\`${m.thinking.sure ? '' : ' (⚠확인 필요)'} — 모델 카드·채팅 템플릿과 대조합니다 (근거: ${m.thinking.basis})`,
        `- [ ] **${m.hfId}** 용도 \`${m.category.join(',')}\` (⚠확인 필요 — 자동 추정은 카탈로그 관례와 절반쯤 다릅니다. 범용 대형 모델의 coding, 생각 모드가 있는 모델의 reasoning 은 카드 기준으로 정합니다)`,
        `- [ ] **${m.hfId}** 표시 이름 "${m.name}" · 최대 컨텍스트 ${num(m.maxContext)}(config 값이라 카드의 기본 길이와 다르면 고칩니다) · 라이선스 "${m.license}" · 인기도 ${m.popularity} — 고칠 값은 \`data/models.json\` 에서 고칩니다`,
      );
    }
    out.push(
      '- [ ] 봇이 연 PR 이라 CI 가 돌지 않습니다 — PR 을 닫았다 다시 열어 CI 가 통과하는지 확인한 뒤 머지합니다',
      '- [ ] 넣지 않기로 한 모델은 이 PR 에서 빼고 `scripts/new-model-skips.json` 에 skip·wait 와 이유를 적습니다',
      `- [ ] 이 PR 에 고친 커밋을 올리면(제목은 \`${AUTO_COMMIT_PREFIX}\` 가 아닌 것으로) 다음 ① 실행이 브랜치를 덮어쓰지 않고 그날 보고서를 코멘트로 남깁니다. 끝내지 못할 PR 은 닫습니다`,
      '- [ ] `data/hf-sync` PR 이 함께 열려 있으면 두 PR 이 `data/models.json` 에서 충돌합니다 — 이 PR 을 머지한 뒤 `gh workflow run data-sync.yml` 로 그 PR 을 main 기준으로 다시 만듭니다',
      '',
    );
  }
  if (r.fontRefreshed) out.push('공유 카드 글꼴 서브셋에 없는 글자가 생겨 `scripts/og-font.ts` 로 다시 받았습니다(`apps/web/assets/og/`).', '');

  out.push(`### 확인 필요 — 자동으로 넣지 않은 후보 (${r.review.length}건)`, '');
  if (r.review.length === 0) out.push('없습니다.', '');
  else {
    out.push(
      '계속 넣을 수 없는 후보(보류 구조·GGUF 없음 등)는 `scripts/new-model-skips.json` 에 wait·skip 으로 적어 주세요 — 적지 않으면 출시 14일 동안 매일 다시 시도해 하루 시도 횟수를 씁니다.',
      '',
    );
    out.push('| 모델 | 이유 | 내용 | 30일 다운로드 | 생성일 |', '|---|---|---|---|---|');
    for (const item of r.review) {
      out.push(`| ${hf(item.hfId)} | ${item.reason} | ${item.detail} | ${item.downloads === undefined ? '—' : num(item.downloads)} | ${item.createdAt ?? '—'} |`);
    }
    out.push('');
  }
  if (r.skipped.length > 0) {
    out.push(`스킵 목록(\`scripts/new-model-skips.json\`)으로 뺀 후보: ${r.skipped.map((s) => `${s.hfId}(${s.decision})`).join(', ')}`, '');
  }
  if (r.checkpoints.length > 0) {
    out.push(`학습 중간 단계·교사 모델 저장소로 보고 뺀 후보 ${r.checkpoints.length}종: ${r.checkpoints.join(', ')}`, '');
  }
  if (r.stale > 0) out.push(`출시 ${AUTO_WINDOW_DAYS}일이 지난 인기 급상승 후보 ${r.stale}종은 보지 않았습니다(그날 요약 이슈에서 따로 판단합니다).`, '');

  out.push('### 검사', '');
  const gate = r.gate;
  if (gate.status === 'fail') {
    out.push(`마지막 검사 \`${gate.step}\` 가 실패해 PR 을 만들지 않았습니다. 출력 끝부분:`, '', '```', gate.tail, '```');
  } else {
    out.push(
      {
        dry: '드라이런이라 검사를 돌리지 않았습니다.',
        none: '추가한 모델이 없어 검사를 돌리지 않았습니다.',
        pass: '후보마다 `pnpm validate-data`·`pnpm test`, 마지막에 `pnpm build`·`pnpm run test:export` 를 통과했습니다.',
      }[gate.status],
    );
  }
  out.push('', `<!-- ${REPORT_MARKER} ${r.added.map((m) => m.hfId).join(',')} -->`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 실행부
// ---------------------------------------------------------------------------

/**
 * 채팅 템플릿 — chat_template.jinja, 없으면 tokenizer_config.json 의 chat_template(문자열 또는 [{name, template}]).
 * 게이트 저장소(401·403)는 unsloth 미러에서. 못 받으면 undefined.
 */
export async function fetchChatTemplate(hfId: string, opts: { token?: string; fetchImpl?: FetchLike } = {}): Promise<string | undefined> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const headers = authHeaders(opts.token);
  for (const repo of [hfId, `unsloth/${baseName(hfId)}`]) {
    let gated = false;
    const jinja = await fetchWithRetry(`https://huggingface.co/${repo}/raw/main/chat_template.jinja`, headers, fetchImpl);
    if (jinja.ok) return await jinja.text();
    if (jinja.status === 401 || jinja.status === 403) gated = true;
    else {
      const tc = await fetchWithRetry(`https://huggingface.co/${repo}/raw/main/tokenizer_config.json`, headers, fetchImpl);
      if (tc.ok) {
        try {
          const t = ((await tc.json()) as { chat_template?: unknown }).chat_template;
          if (typeof t === 'string') return t;
          if (Array.isArray(t)) return t.map((x) => (x as { template?: string }).template ?? '').join('\n');
        } catch {
          // JSON 이 아니면 템플릿 없음으로
        }
      } else if (tc.status === 401 || tc.status === 403) gated = true;
    }
    if (!gated) return undefined;
  }
  return undefined;
}

/** 모델 카드(README.md) — 게이트 저장소(401·403)는 unsloth 미러에서. 못 받으면 undefined */
export async function fetchModelCard(hfId: string, opts: { token?: string; fetchImpl?: FetchLike } = {}): Promise<string | undefined> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const headers = authHeaders(opts.token);
  for (const repo of [hfId, `unsloth/${baseName(hfId)}`]) {
    const res = await fetchWithRetry(`https://huggingface.co/${repo}/raw/main/README.md`, headers, fetchImpl);
    if (res.ok) return await res.text();
    if (res.status !== 401 && res.status !== 403) return undefined;
  }
  return undefined;
}

type CmdResult = { ok: boolean; tail: string };

const tailOf = (text: string, lines = 40): string => text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-lines).join('\n');

function run(cmd: string): CmdResult {
  console.log(`$ ${cmd}`);
  try {
    const out = execSync(cmd, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return { ok: true, tail: tailOf(out) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const tail = tailOf(`${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    console.log(tail);
    return { ok: false, tail };
  }
}

/** 한 종 추가 뒤 되돌릴 수 있게 잡아 두는 파일 — add-model 이 쓰는 것 + 공유 카드 글꼴 */
const SNAPSHOT_PATHS = [
  'data/models.json',
  'data/model-quants.json',
  'data/meta.json',
  'packages/data/src/index.ts',
  'apps/web/assets/og/NotoSansKR-Bold-subset.ttf',
  'apps/web/assets/og/subset-chars.txt',
];

const snapshot = (): Map<string, Buffer> => new Map(SNAPSHOT_PATHS.map((p) => [p, readFileSync(join(repoRoot, p))]));
const restore = (snap: Map<string, Buffer>): void => {
  for (const [p, buf] of snap) writeFileSync(join(repoRoot, p), buf);
};

/**
 * 한 종을 쓰고 검사한다 — 실패하면 그 후보가 쓴 파일(데이터·MOE_ARCH·다시 받은 글꼴)을 되돌린다.
 * 검사: validate-data → 공유 카드 글꼴(서브셋에 없는 글자면 og-font 로 다시 받음) → pnpm test.
 */
export function applyWithGate(plan: AdditionPlan, ctx: CatalogRaw & { today: string }): { ok: boolean; step: string; tail: string; fontRefreshed: boolean } {
  const snap = snapshot();
  applyAddition(plan, ctx);
  const gate = candidateGate();
  if (!gate.ok) restore(snap);
  return gate;
}

function candidateGate(): { ok: boolean; step: string; tail: string; fontRefreshed: boolean } {
  const v = run('pnpm run validate-data');
  if (!v.ok) return { ok: false, step: 'pnpm run validate-data', tail: v.tail, fontRefreshed: false };
  let fontRefreshed = false;
  if (!run('pnpm exec vitest run scripts/og-cards.test.ts').ok) {
    const f = run('pnpm exec tsx scripts/og-font.ts');
    if (!f.ok) return { ok: false, step: 'pnpm exec tsx scripts/og-font.ts', tail: f.tail, fontRefreshed: false };
    fontRefreshed = true;
  }
  const t = run('pnpm test');
  return t.ok ? { ok: true, step: '', tail: '', fontRefreshed } : { ok: false, step: 'pnpm test', tail: t.tail, fontRefreshed };
}

function parseCli(argv: readonly string[]): { dry: boolean; report?: string } {
  const out: { dry: boolean; report?: string } = { dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (arg === '--dry') out.dry = true;
    else if (arg === '--report') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('--report 에는 경로가 필요');
      out.report = v;
      i += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const token = process.env['HF_TOKEN'] || undefined;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const skips = parseNewModelSkips(JSON.parse(readFileSync(join(repoRoot, 'scripts/new-model-skips.json'), 'utf8')));
  const catalogIds = readCatalogRaw().rawModels.map((m) => String(m['hfId']));
  const known = loadKnownHfIds();
  const { trending, orgReleases } = await fetchDetectionSources(orgsToQuery(catalogIds), { token });
  const details = new Map<string, HfApiModel>();
  for (const m of [...trending, ...orgReleases]) details.set(m.id.toLowerCase(), m);
  const candidates = filterCandidates(known, trending, orgReleases, now, AUTO_WINDOW_DAYS);
  const siblingIds = new Set([...details.keys(), ...known]);
  const sel = selectCandidates({ candidates, details, skips, allowed: allowedOrgs(catalogIds), now, siblingIds });
  console.log(
    `후보 ${candidates.length}종 → 시도 대상 ${sel.eligible.length}종 · 확인 필요 ${sel.review.length}종 · 스킵 ${sel.skipped.length}종 · 중간 체크포인트 ${sel.checkpoints.length}종 · 오래됨 ${sel.stale}종`,
  );

  let fontRefreshed = false;
  const result = await runAdditions(sel.eligible, async (c): Promise<Attempt> => {
    const base = { hfId: c.hfId, downloads: c.downloads, createdAt: c.createdAt?.slice(0, 10) };
    const thinking = estimateThinking(await fetchChatTemplate(c.hfId, { token }), c.hfId, await fetchModelCard(c.hfId, { token }));
    const category = estimateCategory({ hfId: c.hfId, tags: c.tags, ...(c.pipelineTag !== undefined ? { pipelineTag: c.pipelineTag } : {}), ...(thinking.value !== undefined ? { thinking: thinking.value } : {}) });
    const korean = estimateKorean(c.hfId);
    const catalog = readCatalogRaw(); // 앞 후보를 추가했으면 그 상태에서
    console.log(`\n시도: ${c.hfId} (30일 ${c.downloads}회, ${c.official ? '허용 목록' : '다운로드 기준'})`);
    const res = await planAddition(
      c.hfId,
      { category: category.value, ...(thinking.value !== undefined ? { thinking: thinking.value } : {}), korean: korean.value, visionFromConfig: true },
      { ...catalog, token, today },
    );
    if (res.kind === 'held') return { kind: 'review', item: { ...base, reason: '보류 구조', detail: oneLine(res.reason) } };
    const { plan } = res;
    for (const line of plan.lines) console.log(line);
    if (classifyLicense(plan.summary.license) === 'unknown') {
      return { kind: 'review', item: { ...base, reason: '처음 보는 라이선스', detail: `"${oneLine(plan.summary.license)}" — packages/data/src/license.ts 배지 맵에 분류를 더한 뒤 add-model 로 넣습니다` } };
    }
    const added = toAddedModel(plan, c, { thinking, categoryBasis: category.basis, korean });
    if (args.dry) return { kind: 'added', added };

    const gate = applyWithGate(plan, { ...catalog, today });
    if (!gate.ok) {
      return { kind: 'review', item: { ...base, reason: '검사 실패', detail: oneLine(`${gate.step}: ${gate.tail.split('\n').slice(-3).join(' ')}`) } };
    }
    fontRefreshed ||= gate.fontRefreshed;
    return { kind: 'added', added };
  });

  let gate: GateResult;
  if (args.dry) gate = { status: 'dry' };
  else if (result.added.length === 0) gate = { status: 'none' };
  else {
    gate = { status: 'pass' };
    for (const cmd of ['pnpm build', 'pnpm run test:export']) {
      const r = run(cmd);
      if (!r.ok) {
        gate = { status: 'fail', step: cmd, tail: r.tail };
        break;
      }
    }
  }

  const report = renderReport({
    date: today,
    dry: args.dry,
    added: result.added,
    review: [...sel.review, ...result.review],
    skipped: sel.skipped,
    checkpoints: sel.checkpoints,
    stale: sel.stale,
    gate,
    fontRefreshed,
  });
  if (args.report) writeFileSync(args.report, report);
  else console.log(`\n${report}`);
  console.log(`\n추가 ${result.added.length}종 (${result.added.map((m) => m.hfId).join(', ') || '없음'}) · 검사 ${gate.status}${args.report ? ` · 보고서 ${args.report}` : ''}`);

  const ghOut = process.env['GITHUB_OUTPUT'];
  if (ghOut) appendFileSync(ghOut, `added=${result.added.length}\ngate=${gate.status}\ndate=${today}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1; // process.exit 는 열린 fetch 소켓과 부딪혀 Windows 에서 비정상 종료한다(UV_HANDLE_CLOSING)
  });
}
