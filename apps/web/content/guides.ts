/**
 * 가이드 레지스트리 (P1-4, D37~D44) — 슬러그·상태·날짜·저자·콤보 그리드·로캘별 제목/설명의 단일 출처.
 *
 * **의존성 0**: `@/` 경로·JSX·`.mdx` import 금지 — export 테스트(`test/`)·유닛 테스트·데이터 브리프 스크립트가 루트 tsconfig
 * (DOM lib·경로 별칭 없음)에서 직접 읽는다. 본문은 `content/{en,ko}/guides/<slug>.mdx`(로캘별 별도 집필 — docs/04 §6),
 * 로드는 `lib/guides.ts` 의 명시적 로더 맵.
 *
 * - `status`: `draft` = noindex + 목차·내비·관련 링크에서 제외(URL 로만 열림). `published` 전환은 **사용자 승인 슬러그만**
 *   (D40 — 인덱싱 스위치, 위임 불가). published 는 `reviewedAt` 필수
 * - 날짜는 `YYYY-MM-DD` 문자열(빌드 시 `Date` 금지 — D21). 표시는 UTC 포맷
 * - `grids`: MDX `<ComboGrid grid="key"/>` 가 그리는 GPU × 모델 좌표. 배치 1 콤보 커버리지의 단일 출처(D44)
 * - 순서 = 우선순위(D37): 감수가 병목이면 아래부터 뺀다(최소 5쌍)
 */

export type GuideLocale = 'en' | 'ko';

export type GuideGrid = { gpus: readonly string[]; models: readonly string[] };

export type GuideStatus = { status: 'draft' } | { status: 'published'; reviewedAt: string };

export type GuideEntry = GuideStatus & {
  datePublished: string;
  dateModified: string;
  /** Article author·publisher — Organization (D41). 실명 전환 시 여기만 바꾼다 */
  author: 'CanRun';
  grids: Readonly<Record<string, GuideGrid>>;
  /** 본문 끝 "관련 가이드" (published 만 링크된다) */
  related: readonly GuideSlug[];
  locales: Readonly<Record<GuideLocale, { title: string; description: string }>>;
};

export const GUIDE_SLUGS = [
  'vram-requirements',
  'ollama-context-length',
  'gguf-quantization',
  'korean-open-llms',
  'mac-local-llm',
  'kv-cache-context',
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

/** 배치 1 모델(docs/04 §3) — vram·mac 그리드가 공유 */
const BATCH1_MODELS = ['llama-3.1-8b', 'gemma-3-12b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3-30b-a3b-2507', 'gpt-oss-120b'] as const;

/** 09-30 사용자가 채팅으로 6편 모두 게시 승인 (D40) */
const PUBLISHED = { status: 'published', reviewedAt: '2026-09-30', datePublished: '2026-09-30', dateModified: '2026-09-30', author: 'CanRun' } as const;

export const GUIDES: Readonly<Record<GuideSlug, GuideEntry>> = {
  'vram-requirements': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {
      tiers: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-4070', 'rtx-5070', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: BATCH1_MODELS,
      },
    },
    related: ['kv-cache-context', 'gguf-quantization', 'mac-local-llm'],
    locales: {
      en: {
        title: 'How much VRAM do local LLMs need? 8–32 GB tiers (2026)',
        description:
          'What fits on 8, 12, 16, 24 and 32 GB graphics cards: the memory formula, model-by-model verdicts, and how context length and quantization change the answer.',
      },
      ko: {
        title: '로컬 LLM 사양 — VRAM 8~32GB로 돌릴 수 있는 모델 (2026)',
        description:
          '그래픽카드 VRAM 8·12·16·24·32GB에서 어떤 모델이 돌아가는지 정리했습니다. 필요한 메모리를 계산하는 법과, 컨텍스트·양자화에 따라 달라지는 점도 함께 다룹니다.',
      },
    },
  },
  'ollama-context-length': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {},
    related: ['kv-cache-context', 'vram-requirements', 'gguf-quantization'],
    locales: {
      en: {
        title: 'Ollama slow or forgetting your prompt? Context length defaults',
        description:
          'Why Ollama trims long conversations or slows down: its default context length by VRAM tier, how to raise it, and what a longer context costs in memory.',
      },
      ko: {
        title: 'Ollama가 느리거나 앞 내용을 잊을 때 — 컨텍스트 기본값',
        description:
          'Ollama가 긴 대화의 앞부분을 버리거나 느려지는 이유를 설명합니다. VRAM별 기본 컨텍스트 길이와 늘리는 방법, 늘렸을 때 더 드는 메모리도 정리했습니다.',
      },
    },
  },
  'gguf-quantization': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {},
    related: ['vram-requirements', 'kv-cache-context', 'korean-open-llms'],
    locales: {
      en: {
        title: 'GGUF quantization: Q4_K_M vs IQ4_XS vs Q8_0 — which to download',
        description:
          'What each GGUF quant level costs in gigabytes, how we group them by quality, and when dropping one level turns a model that does not fit into one that runs.',
      },
      ko: {
        title: 'GGUF 양자화 등급 정리 — Q4_K_M·IQ4_XS·Q8_0 무엇을 받을까',
        description:
          'GGUF 양자화 단계마다 파일 용량이 얼마인지, 품질은 어떻게 나뉘는지 정리했습니다. 한 단계만 낮춰도 못 돌리던 모델이 돌아가는 경우를 데이터로 보여 줍니다.',
      },
    },
  },
  'korean-open-llms': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {
      korean: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-5090', 'apple-m4-pro'],
        models: [
          'exaone-4.0-1.2b',
          'hyperclovax-seed-1.5b',
          'kanana-1.5-8b',
          'hyperclovax-seed-think-14b',
          'kanana-1.5-15.7b-a3b',
          'exaone-4.0-32b',
          'exaone-4.5-33b',
          'solar-open-100b',
        ],
      },
    },
    related: ['vram-requirements', 'gguf-quantization', 'mac-local-llm'],
    locales: {
      en: {
        title: 'Korean open LLMs (EXAONE, Kanana, HyperCLOVA X SEED, Solar): hardware guide',
        description:
          'Specs, licenses and what it takes to run LG EXAONE, Kakao Kanana, NAVER HyperCLOVA X SEED and Upstage Solar locally, with verdicts on common GPUs and Macs.',
      },
      ko: {
        title: '한국 오픈 LLM 정리 — EXAONE·Kanana·HyperCLOVA X·Solar 구동 사양',
        description:
          'LG EXAONE, 카카오 Kanana, 네이버 HyperCLOVA X SEED, 업스테이지 Solar를 내 PC에서 돌리려면 무엇이 필요한지 정리했습니다. 모델 사양과 라이선스, 흔한 GPU·맥에서의 판정을 함께 봅니다.',
      },
    },
  },
  'mac-local-llm': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {
      apple: {
        gpus: ['apple-m4', 'apple-m4-pro', 'apple-m4-max-40c', 'apple-m5-pro'],
        models: BATCH1_MODELS,
      },
    },
    related: ['vram-requirements', 'kv-cache-context', 'korean-open-llms'],
    locales: {
      en: {
        title: 'Running local LLMs on a Mac (M4, M5): how much unified memory?',
        description:
          'How much of a Mac’s unified memory a local model can use, which M4 and M5 configurations fit which models, and why memory bandwidth sets the speed.',
      },
      ko: {
        title: '맥에서 로컬 LLM 돌리기 — M4·M5 통합 메모리는 얼마나 필요할까',
        description:
          '맥의 통합 메모리 가운데 모델이 실제로 쓸 수 있는 양과 M4·M5 구성별로 돌아가는 모델을 정리했습니다. 속도를 좌우하는 메모리 대역폭도 함께 다룹니다.',
      },
    },
  },
  'kv-cache-context': {
    ...PUBLISHED,
    dateModified: '2026-10-01',
    grids: {},
    related: ['ollama-context-length', 'vram-requirements', 'gguf-quantization'],
    locales: {
      en: {
        title: 'KV cache explained: how context length eats VRAM',
        description:
          'Why a longer context needs more memory, how much each model’s KV cache costs per token, and what q8_0 and q4_0 KV cache quantization buy you.',
      },
      ko: {
        title: 'KV 캐시와 컨텍스트 길이 — 컨텍스트를 늘리면 VRAM이 얼마나 더 필요할까',
        description:
          '컨텍스트가 길어지면 왜 메모리가 더 드는지, 모델마다 KV 캐시가 토큰당 얼마나 차지하는지 정리했습니다. KV 캐시를 q8_0·q4_0으로 양자화하면 얼마나 줄어드는지도 다룹니다.',
      },
    },
  },
};
