/**
 * 허브 소개글 레지스트리 (10-14 D74) — 손으로 쓴 소개(2~3문단)가 붙는 GPU·모델 허브. 의존성 0: export 테스트(저장소 루트)도 읽는다.
 *
 * - 본문은 로캘별 MDX `content/{en,ko}/hubs/{gpu,model}/<id>.mdx`(따로 집필 — 번역 금지, 규칙 `content/AUTHORING.md` §10).
 *   로더는 `lib/hub-intros.ts` 의 명시적 맵, 렌더는 허브 페이지 머리말 아래(`[data-hub-intro]`). 여기 없는 허브는 소개 없이 그대로.
 * - 고른 기준(D74): GPU = 인기 GPU 10종(`data/publish.json` 배치 1 — 검색 수요 상위, 공개 콤보가 붙어 방문이 가장 많다),
 *   모델 = `data/models.json` `popularity` 5 인 9종 + HF 30일 다운로드 1위(gemma-4-26b-a4b, 10-06 기준). 10-14 당시 기준이다 —
 *   10-16 D94 에서 인기도를 고쳐 지금 5 는 12종(gemma-4-26b-a4b·qwen3.5-9b·qwen3.6-35b-a3b 추가)이지만 이 목록은 그대로 둔다.
 * - 순서 = 위 기준의 순서(표시에는 쓰지 않는다).
 */

/**
 * 소개글을 마지막으로 고친 날 — 사이트맵 lastmod(레지스트리 허브 = 이 날과 데이터 기준일 중 늦은 날, `scripts/build-sitemaps.ts`).
 * 소개글(en·ko)을 고친 커밋에서 함께 바꾼다. 날짜 기준은 `content/updates.ts` 와 같다: 배포(main 푸시)되는 날의 UTC 날짜 — KST 자정~09시 푸시는 전날.
 */
export const HUB_INTROS_UPDATED = '2026-10-14';
export const GPU_INTRO_IDS = [
  'rtx-4060',
  'rtx-3060-12gb',
  'rtx-4070',
  'rtx-5070',
  'rtx-5060-ti-16gb',
  'rtx-4090',
  'rtx-3090',
  'rtx-5090',
  'apple-m4',
  'apple-m4-pro',
] as const;

export const MODEL_INTRO_IDS = [
  'llama-3.1-8b',
  'qwen3-8b',
  'qwen3-14b',
  'qwen3-30b-a3b-2507',
  'qwen3.5-35b-a3b',
  'qwen3.8-27b',
  'gpt-oss-20b',
  'gpt-oss-120b',
  'gemma-4-31b',
  'gemma-4-26b-a4b',
] as const;

export type GpuIntroId = (typeof GPU_INTRO_IDS)[number];
export type ModelIntroId = (typeof MODEL_INTRO_IDS)[number];
export type HubIntroKind = 'gpu' | 'model';
