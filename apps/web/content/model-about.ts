/**
 * 모델 소개 레지스트리 (10-19 D102) — 모델 허브 맨 위 "어떤 모델인가요" 한 문단이 붙는 모델과 그 글을 마지막으로 고친 날.
 * 의존성 0: 사이트맵 스크립트·export 테스트(저장소 루트)도 읽는다.
 *
 * - 본문은 로캘별 MDX `content/{en,ko}/model-about/<id>.mdx`(따로 집필 — 번역 금지, 규칙 `content/AUTHORING.md` §11).
 *   로더는 `lib/model-about.ts` 의 명시적 맵(타입이 이 목록과 같은 키를 강제), 렌더는 허브 머리말 바로 아래(`[data-model-about]`).
 *   여기 없는 모델은 소개 없이 그대로 그린다 — 카탈로그 전 모델을 요구하지 않는다(신모델은 매일 자동으로 들어오고,
 *   그날 머지하는 ② 정기 작업이 소개를 쓴다 — docs/03 §5.3). 소개가 없는 모델은 유닛 테스트가 목록으로 알린다(실패 아님).
 * - 값 = 그 모델의 소개(en·ko)를 마지막으로 고친 날 — 사이트맵 lastmod 에 들어간다(`scripts/build-sitemaps.ts`).
 *   날짜 기준은 `content/updates.ts` 와 같다: 배포(main 푸시)되는 날의 UTC 날짜 — KST 자정~09시 푸시는 전날.
 * - 순서 = id 알파벳순(표시에는 쓰지 않는다).
 */
export const MODEL_ABOUT = {
  'deepseek-r1-0528-qwen3-8b': '2026-10-19',
  'deepseek-r1-distill-14b': '2026-10-19',
  'deepseek-r1-distill-32b': '2026-10-19',
  'deepseek-r1-distill-8b': '2026-10-19',
  'exaone-4.0-1.2b': '2026-10-19',
  'exaone-4.0-32b': '2026-10-19',
  'exaone-4.5-33b': '2026-10-19',
  'gemma-3-12b': '2026-10-19',
  'gemma-3-27b': '2026-10-19',
  'gemma-4-12b': '2026-10-19',
  'gemma-4-26b-a4b': '2026-10-19',
  'gemma-4-31b': '2026-10-19',
  'gemma-4-e2b': '2026-10-21',
  'gemma-4-e4b': '2026-10-21',
  'gpt-oss-120b': '2026-10-19',
  'gpt-oss-20b': '2026-10-19',
  'granite-4.2-30b': '2026-10-19',
  'hyperclovax-seed-1.5b': '2026-10-19',
  'hyperclovax-seed-think-14b': '2026-10-19',
  'k2-horizon-7b': '2026-10-21',
  'k2-horizon-mova-36b-a4b': '2026-10-21',
  'kanana-1.5-15.7b-a3b': '2026-10-19',
  'kanana-1.5-8b': '2026-10-19',
  'kolibri-1': '2026-10-20',
  'laguna-s-2.1': '2026-10-19',
  'lfm2.5-2.6b': '2026-10-19',
  'ling-3.0-flash': '2026-10-19',
  'ling-3.0-tiny': '2026-10-19',
  'llama-3.1-8b': '2026-10-19',
  'llama-3.2-1b': '2026-10-19',
  'llama-3.2-3b': '2026-10-19',
  'llama-3.3-70b': '2026-10-19',
  'mellum2.1-12b-a2.5b-thinking': '2026-10-20',
  'minicpm-v-4.7-35b-a3b': '2026-10-19',
  'minicpm5-1b': '2026-10-19',
  'minicpm5-2b': '2026-10-19',
  'mistral-small-3.2-24b': '2026-10-19',
  'muse-glimmer-30b': '2026-10-20',
  'nemotron-3.5-lightning-30b-a3b': '2026-10-19',
  'phi-4': '2026-10-19',
  'qwen3-14b': '2026-10-19',
  'qwen3-30b-a3b-2507': '2026-10-19',
  'qwen3-32b': '2026-10-19',
  'qwen3-8b': '2026-10-19',
  'qwen3.5-122b-a10b': '2026-10-19',
  'qwen3.5-27b': '2026-10-19',
  'qwen3.5-35b-a3b': '2026-10-19',
  'qwen3.5-4b': '2026-10-20',
  'qwen3.5-9b': '2026-10-19',
  'qwen3.6-27b': '2026-10-19',
  'qwen3.6-35b-a3b': '2026-10-19',
  'qwen3.8-27b': '2026-10-19',
  'solar-open-100b': '2026-10-19',
  'solar-open2-250b': '2026-10-19',
  'spark-x2.5-4b': '2026-10-19',
} as const satisfies Readonly<Record<string, string>>;

export type ModelAboutId = keyof typeof MODEL_ABOUT;
export const MODEL_ABOUT_IDS = Object.keys(MODEL_ABOUT) as ModelAboutId[];

export function hasModelAbout(id: string): id is ModelAboutId {
  return Object.hasOwn(MODEL_ABOUT, id);
}
