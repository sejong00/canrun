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

import type { ContentLocale } from '../i18n/locales';

/** 장문 로캘 — 의존성 0 인 `i18n/locales.ts` 를 상대 경로로 (zh 는 장문 없음, D109) */
export type GuideLocale = ContentLocale;

/**
 * 그리드 좌표 (D44). 기본은 `gpus` 를 한 줄씩 — 칸은 콤보 페이지와 같은 대표 구성(통합 메모리 칩은 가장 좋은 판정이 나는 가장 작은 메모리, 칸에 "N GB 구성").
 * `rows`(10-23 D119)를 주면 그 순서로 행을 그린다: `'<gpu id>'` = 위와 같은 대표 구성 한 줄, `'<gpu id>@<구성 키>'` = 통합 메모리 기기의 그 구성 한 줄
 * (`configKey` — 메모리 용량 '128', 여러 대 연결 '128x2'. GPU 허브 '메모리 구성별 판정' 표와 같은 칸이고 행 머리에 구성을 적는다).
 * 행의 GPU 는 `gpus` 에 있어야 하고 `gpus` 의 GPU 는 모두 행에 한 번 이상 나온다(유닛 테스트) — `gpus` 가 콤보 커버리지·관련 가이드 역링크의 단일 출처인 것은 그대로
 */
export type GuideGrid = { gpus: readonly string[]; models: readonly string[]; rows?: readonly string[] };

/** 그리드 행 하나 — `'<gpu id>'`(대표 구성) 또는 `'<gpu id>@<구성 키>'`(그 메모리 구성, 10-23 D119) */
export function parseGridRow(row: string): { gpuId: string; config?: string } {
  const at = row.indexOf('@');
  return at < 0 ? { gpuId: row } : { gpuId: row.slice(0, at), config: row.slice(at + 1) };
}

/** 그리드가 그리는 행 — `rows` 가 없으면 `gpus` 순서 그대로 */
export function gridRows(grid: GuideGrid): readonly string[] {
  return grid.rows ?? grid.gpus;
}

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
  // 10-15 D75: 배치 1 새 가이드 초안 4편 — 10-15 사용자 게시 승인(D84)
  'gpu-by-budget',
  'moe-cpu-offload',
  'local-coding-agents',
  'gpu-offload-check',
  // 10-15 D76: 배치 2 새 가이드 초안 4편 — 10-15 사용자 게시 승인(D84)
  'unified-memory-128gb',
  'ollama-vs-llama-cpp-lm-studio',
  'thinking-models',
  'tokens-per-second',
  // 10-15 D77: 배치 3 새 가이드 초안 4편 — 10-15 사용자 게시 승인(D84)
  'amd-intel-gpus',
  'laptop-gpu-llm',
  'multi-gpu',
  'cpu-only-llm',
  // 10-19 D103: 검색 유입용 새 가이드 4편(자동완성 조사 10-16) — 10-19 사용자 게시 승인(D108)
  'gemma-4-models',
  'qwen3.6-vs-qwen3.8',
  'deepseek-local',
  'ollama-lm-studio-requirements',
  // 10-23 D119: DGX Spark 검색용 가이드 초안(자동완성 'dgx spark llm 추천·성능'·'dgx spark 2대 연결'·'dgx spark 64gb') — 게시는 사용자 승인 뒤(D40)
  'dgx-spark-llm',
  // 10-25 D124: 자체 실측(P0-5 첫 측정 — RTX 5060 Ti 16GB · Ollama 0.40.7) 초안 — 게시는 사용자 승인 뒤(D40)
  'rtx-5060-ti-16gb-local-llm',
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

/** 배치 1 모델(docs/04 §3) — vram·mac 그리드가 공유 */
const BATCH1_MODELS = ['llama-3.1-8b', 'gemma-3-12b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3-30b-a3b-2507', 'gpt-oss-120b'] as const;
/** 배치 2 모델(data/publish.json, 10-29 D129 개방) — 배치 2 콤보의 가이드 인바운드(D44) */
const BATCH2_MODELS = [
  'gemma-4-26b-a4b', 'gemma-4-31b', 'gemma-4-12b', 'qwen3.8-27b', 'qwen3.6-35b-a3b', 'qwen3.5-35b-a3b',
  'qwen3.5-9b', 'qwen3.5-27b', 'qwen3.5-122b-a10b', 'qwen3-8b', 'qwen3-32b', 'llama-3.3-70b',
] as const;

/** 09-30 사용자가 채팅으로 6편 모두 게시 승인 (D40) */
const PUBLISHED = { status: 'published', reviewedAt: '2026-09-30', datePublished: '2026-09-30', dateModified: '2026-09-30', author: 'CanRun' } as const;

/** 10-15 D75·D76·D77 배치 1·2·3 — 사용자가 채팅으로 12편 모두 게시 승인(D84, D40). 날짜는 UTC(배포일) */
const PUBLISHED_1015 = { status: 'published', reviewedAt: '2026-10-15', datePublished: '2026-10-15', dateModified: '2026-10-15', author: 'CanRun' } as const;

/** 10-19 D103 — 사용자가 채팅으로 4편 모두 게시 승인(D108, D40). 날짜는 UTC(배포일) */
const PUBLISHED_1019 = { status: 'published', reviewedAt: '2026-10-19', datePublished: '2026-10-19', dateModified: '2026-10-19', author: 'CanRun' } as const;

/** 10-23 D119 — 사용자가 채팅으로 게시 승인(10-23 '다 게시', D122·D40). 날짜는 UTC(배포일) */
const PUBLISHED_1023 = { status: 'published', reviewedAt: '2026-10-23', datePublished: '2026-10-23', dateModified: '2026-10-23', author: 'CanRun' } as const;

/** 10-25 D124 — 사용자가 채팅으로 게시 승인(10-25 '일단 게시하자', D125·D40). 날짜는 UTC(배포일) */
const PUBLISHED_1025 = { status: 'published', reviewedAt: '2026-10-25', datePublished: '2026-10-25', dateModified: '2026-10-25', author: 'CanRun' } as const;

export const GUIDES: Readonly<Record<GuideSlug, GuideEntry>> = {
  'vram-requirements': {
    ...PUBLISHED,
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신. 10-03 D63: en "5090 이 더하는 모델 없음" → Nemotron 3.5 Lightning. 10-19 D105: 2026 모델(Gemma 4·Qwen3.6/3.8)·용량별 카드 표(VramPeers)
    // 10-29 D129: 배치 2 모델 표(tiers2026)
    dateModified: '2026-10-29',
    grids: {
      tiers: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-4070', 'rtx-5070', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: BATCH1_MODELS,
      },
      tiers2026: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-4070', 'rtx-5070', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: BATCH2_MODELS,
      },
    },
    related: ['kv-cache-context', 'gguf-quantization', 'mac-local-llm'],
    locales: {
      en: {
        // 10-27 D127: 제목·설명만 검색어('how much vram for llm'·'llm gpu requirements'·'llm vram requirements')에 맞춰 — dateModified 그대로(D94 관례)
        title: 'How much VRAM do local LLMs need? GPU requirements for 8–32 GB (2026)',
        description:
          'LLM VRAM requirements by card size: what fits on 8, 12, 16, 24 and 32 GB graphics cards, the memory formula, and how context length and quantization change it.',
      },
      ko: {
        // 10-27 D127: '로컬 llm 사양'·'로컬 llm 컴퓨터 사양'·'llm vram 16gb' 자동완성 — 그래픽카드·사양을 앞쪽에
        title: '로컬 LLM 사양 — 그래픽카드 VRAM 8~32GB별로 돌릴 수 있는 모델 (2026)',
        description:
          '로컬 LLM에 필요한 그래픽카드 사양을 VRAM 8·12·16·24·32GB별로 정리했습니다. 용량마다 돌아가는 모델과 필요한 메모리를 계산하는 법, 컨텍스트·양자화에 따라 달라지는 점을 함께 다룹니다.',
      },
    },
  },
  'ollama-context-length': {
    ...PUBLISHED,
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신
    dateModified: '2026-10-03',
    grids: {},
    related: ['kv-cache-context', 'vram-requirements', 'gguf-quantization'],
    locales: {
      en: {
        title: 'Ollama slow or forgetting your prompt? Context length defaults',
        description:
          'Why Ollama trims long conversations or slows down: its default context length by VRAM tier, how to raise it, and what a longer context costs in memory.',
      },
      ko: {
        // 10-16 D94: 한글 표기(올라마)를 제목에 한 번 — 자동완성 조사(모델 한글 이름은 content/ko-names.ts)
        title: '올라마(Ollama)가 느리거나 앞 내용을 잊을 때 — 컨텍스트 기본값',
        description:
          'Ollama가 긴 대화의 앞부분을 버리거나 느려지는 이유를 설명합니다. VRAM별 기본 컨텍스트 길이와 늘리는 방법, 늘렸을 때 더 드는 메모리도 정리했습니다.',
      },
    },
  },
  'gguf-quantization': {
    ...PUBLISHED,
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신
    dateModified: '2026-10-03',
    grids: {},
    related: ['qwen3.6-vs-qwen3.8', 'vram-requirements', 'kv-cache-context'],
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
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신
    dateModified: '2026-10-03',
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
        // 10-16 D94: 네 모델의 한글 표기를 제목에 — 영문 표기는 설명·본문에 있다
        title: '한국 오픈 LLM 정리 — 엑사원·카나나·하이퍼클로바X·솔라 구동 사양',
        description:
          'LG EXAONE, 카카오 Kanana, 네이버 HyperCLOVA X SEED, 업스테이지 Solar를 내 PC에서 돌리려면 무엇이 필요한지 정리했습니다. 모델 사양과 라이선스, 흔한 GPU·맥에서의 판정을 함께 봅니다.',
      },
    },
  },
  'mac-local-llm': {
    ...PUBLISHED,
    // 10-29 D129: 배치 2 모델 표(apple2026)
    dateModified: '2026-10-29',
    grids: {
      apple: {
        gpus: ['apple-m4', 'apple-m4-pro', 'apple-m4-max-40c', 'apple-m5-pro'],
        models: BATCH1_MODELS,
      },
      apple2026: {
        gpus: ['apple-m4', 'apple-m4-pro', 'apple-m4-max-40c', 'apple-m5-pro'],
        models: BATCH2_MODELS,
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
        // 10-16 D97: 맥 제품 이름(맥 미니·맥북·맥 스튜디오)을 제목에 한 번 — 칩보다 제품 이름으로 찾는다(칩 허브 제목은 lib/search-names.ts)
        title: '맥 미니·맥북·맥 스튜디오에서 로컬 LLM 돌리기 — M4·M5 통합 메모리는 얼마나 필요할까',
        description:
          '맥의 통합 메모리 가운데 모델이 실제로 쓸 수 있는 양과 M4·M5 구성별로 돌아가는 모델을 정리했습니다. 속도를 좌우하는 메모리 대역폭도 함께 다룹니다.',
      },
    },
  },
  'kv-cache-context': {
    ...PUBLISHED,
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신. 10-03 D63: Mamba-2·conv·KDA+MLA 하이브리드 KV 세는 법.
    // 10-22 D114 리뷰: 전체 카탈로그 KV 표에 들어간 반복 층 모델(Nanbeige4.2 3B)을 GQA 절에서 설명.
    // 10-25 D124: Gemma 3 12B × RTX 5060 Ti 16GB 표의 8k f16 칸이 자체 실측이 되어 '모두 보정' 문장·행마다 떨어진다는 문장에 예외를 적음
    dateModified: '2026-10-25',
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
  'gpu-by-budget': {
    ...PUBLISHED_1015,
    grids: {
      // 가격대별 카드 8종(이 글을 쓸 때 data/gpus.json 실거래가 낮은 순 — 본문이 "when this guide was written"으로 이 순서를 밝힌다.
      // 가격을 고치면 본문의 가격 순서 문장 4곳과 이 행 순서를 다시 확인한다) × 인기 모델 6
      budget: {
        gpus: ['rtx-3060-12gb', 'rtx-5060', 'rx-9060-xt-16gb', 'rtx-5060-ti-16gb', 'rtx-5070', 'rtx-5070-ti', 'rtx-3090', 'rtx-5090'],
        models: ['llama-3.1-8b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3.8-27b', 'qwen3.5-35b-a3b', 'gpt-oss-120b'],
      },
    },
    related: ['rtx-5060-ti-16gb-local-llm', 'vram-requirements', 'gguf-quantization'],
    locales: {
      en: {
        // 10-15 사용자 결정: 제목에 "Recommended"/"추천" 허용(AUTHORING §2 예외 — 본문은 메모리 기준 데이터로 답하고 제품 구매를 권하지 않는다)
        title: 'Recommended GPUs for local LLMs in 2026: what each budget runs',
        description:
          'Which local LLMs each GPU memory size runs, 8GB to 32GB, with dated street prices: 12GB vs 8GB cards, a new 16GB card vs a 24GB RTX 3090, and when system RAM helps.',
      },
      ko: {
        // 10-16 D94: "AI용 그래픽카드"(자동완성 조사). 10-27 D127: '로컬 llm 그래픽카드 추천'·'llm 그래픽카드 추천' 자동완성 — '로컬 LLM'을 '그래픽카드 추천' 앞에
        title: 'AI·로컬 LLM용 그래픽카드 추천 — 예산별로 돌릴 수 있는 모델 (2026)',
        description:
          '그래픽카드 VRAM 용량별로 돌아가는 로컬 LLM과 실거래가를 정리했습니다. 12GB와 8GB 카드, 신품 16GB와 24GB RTX 3090을 데이터로 비교하고, 시스템 RAM이 도움이 되는 경우도 다룹니다.',
      },
    },
  },
  'moe-cpu-offload': {
    ...PUBLISHED_1015,
    grids: {
      moe: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-5090'],
        models: ['gpt-oss-20b', 'gemma-4-26b-a4b', 'qwen3-30b-a3b-2507', 'qwen3.6-35b-a3b', 'gpt-oss-120b', 'qwen3.5-122b-a10b'],
      },
    },
    related: ['gemma-4-models', 'vram-requirements', 'kv-cache-context'],
    locales: {
      en: {
        title: 'Running MoE models bigger than your GPU: gpt-oss-120b with system RAM',
        description:
          'How much system RAM gpt-oss-120b and other MoE models need on 8–32 GB cards, how llama.cpp and Ollama keep experts in RAM, and why RAM speed sets the pace.',
      },
      ko: {
        title: '그래픽카드보다 큰 MoE 모델 돌리기 — gpt-oss-120b와 시스템 RAM',
        description:
          'gpt-oss-120b 같은 MoE 모델을 8~32GB 그래픽카드로 돌릴 때 필요한 시스템 RAM을 카드별로 정리했습니다. 전문가를 RAM에 두는 llama.cpp·Ollama 설정과 RAM 속도의 영향도 다룹니다.',
      },
    },
  },
  'local-coding-agents': {
    ...PUBLISHED_1015,
    // 10-16 D91: pp 추정이 모델 크기를 반영 — 프롬프트 처리 문단 갱신. 10-25 D124: 속도 그리드 RTX 5060 Ti 16GB 행 첫 칸(자체 실측) 문장
    dateModified: '2026-10-25',
    // ComboGrid 는 8k 고정이라 쓰지 않는다 — 32k·64k·128k 는 CtxTable 로
    grids: {},
    related: ['ollama-context-length', 'kv-cache-context', 'vram-requirements'],
    locales: {
      en: {
        title: 'Local models for OpenClaw and coding agents: context length and VRAM',
        description:
          'How much context OpenClaw and coding agents need on a local model, which coding models hold 64k on 16GB and 24GB GPUs, and why replies can start slowly.',
      },
      ko: {
        title: 'OpenClaw·OpenCode를 로컬 모델로 — 에이전트에 필요한 컨텍스트와 VRAM',
        description:
          'OpenClaw·OpenCode 같은 에이전트를 로컬 모델로 쓸 때 필요한 컨텍스트와, 16GB·24GB 그래픽카드에서 32k·64k가 들어가는 코딩 모델을 정리했습니다. 답이 늦게 시작되는 이유도 다룹니다.',
      },
    },
  },
  'gpu-offload-check': {
    ...PUBLISHED_1015,
    grids: {},
    related: ['ollama-context-length', 'kv-cache-context', 'gguf-quantization'],
    locales: {
      en: {
        title: 'Ollama or LM Studio not using your GPU? Check the split and fix the offload',
        description:
          'Find out where Ollama or LM Studio loaded your model, why it splits between CPU and GPU or ignores the GPU, and what to shrink or fix first.',
      },
      ko: {
        title: 'Ollama·LM Studio가 GPU를 안 쓸 때 — 100% GPU 확인과 오프로드 설정',
        description:
          'Ollama·LM Studio가 모델을 GPU와 CPU에 어떻게 나눠 올렸는지 확인하는 법을 정리했습니다. GPU를 아예 못 잡을 때 볼 드라이버·백엔드 설정과, 메모리 필요량을 줄이는 순서도 다룹니다.',
      },
    },
  },
  'unified-memory-128gb': {
    ...PUBLISHED_1015,
    // 10-23 D117: DGX Spark 의 GPU 몫(공개 부팅 기록 − 데스크톱, 70% 아님)·64GB 구성 — '같은 70%'·'128GB 네 줄이 같다' 문장을 고쳤다
    dateModified: '2026-10-23',
    grids: {
      // 128GB급 통합 메모리 3종 + 맥 스튜디오 Ultra 2종 + 비교용 RTX 5090(시스템 RAM 32GB 기준) × MoE·dense·대형 MoE 5종.
      // 통합 메모리 칸은 "가장 좋은 판정이 나는 가장 작은 구성"이라 본문이 그 점을 설명한다. llama-3.3-70b 는 Strix·M4 Max·M2 Ultra
      // 칸이 64GB CPU 전용으로 그려져 일부러 뺐다(본문에서 ram="128" Expect 로 다룬다)
      unified128: {
        gpus: ['amd-strix-halo', 'nvidia-dgx-spark', 'apple-m4-max-40c', 'apple-m3-ultra', 'apple-m2-ultra', 'rtx-5090'],
        models: ['qwen3.5-35b-a3b', 'gemma-4-31b', 'gpt-oss-120b', 'qwen3.5-122b-a10b', 'solar-open2-250b'],
      },
    },
    related: ['dgx-spark-llm', 'mac-local-llm', 'moe-cpu-offload'],
    locales: {
      en: {
        title: 'Strix Halo vs DGX Spark vs Mac Studio for local LLMs: what 128 GB gets you',
        description:
          'What fits on a 128GB Strix Halo, DGX Spark or Mac Studio, how much memory each GPU can use, and why bandwidth sets the speed, with public gpt-oss-120b results.',
      },
      ko: {
        // 10-16 D94: "미니PC"·"AI Max+ 395"(자동완성 조사 — 한국에선 칩 이름으로 찾는다)
        title: '128GB 통합 메모리 미니PC 비교 — AI Max+ 395(스트릭스 헤일로)·DGX Spark·맥 스튜디오',
        description:
          '128GB 스트릭스 헤일로·DGX Spark·맥 스튜디오에 들어가는 큰 모델과 GPU가 실제로 쓸 수 있는 메모리를 정리했습니다. 속도를 가르는 대역폭과 gpt-oss-120b 공개 벤치마크도 함께 봅니다.',
      },
    },
  },
  'ollama-vs-llama-cpp-lm-studio': {
    ...PUBLISHED_1015,
    // 그리드 없음 — KvPerTokenTable·CtxTable(qwen3-32b × rtx-4090)·MemoryBreakdown·Measured 로 기본값의 메모리 차이를 보인다
    grids: {},
    related: ['ollama-lm-studio-requirements', 'ollama-context-length', 'kv-cache-context'],
    locales: {
      en: {
        title: 'Ollama vs llama.cpp vs LM Studio: same engine, different defaults',
        description:
          'Ollama and LM Studio run GGUF models on llama.cpp. How each tool’s default context, parallel slots and GPU split change memory and speed, and how to match them.',
      },
      ko: {
        // 10-16 D94: 한글 표기(올라마)를 제목에 한 번
        title: '올라마(Ollama)·llama.cpp·LM Studio 차이 — 같은 엔진, 다른 기본값',
        description:
          'Ollama와 LM Studio는 모두 llama.cpp로 GGUF 모델을 돌립니다. 세 도구의 기본 컨텍스트, 동시 요청, GPU 배치가 메모리와 속도를 어떻게 바꾸는지, 같은 조건으로 맞추는 법을 정리했습니다.',
      },
    },
  },
  'thinking-models': {
    ...PUBLISHED_1015,
    // 10-22 ⑧-b 리뷰: '늘 생각' 목록에 GLM-5.3 Flash 와 "among others"·"등"(카탈로그의 always 모델을 다 적지 않는다).
    // `<think>` 강제 권고·건너뛰기 경고는 처음 나온 R1 distill 3종(Qwen 14B·32B·Llama 8B) 카드의 말 — 0528 Qwen3 8B 카드는 필요 없다고 한다
    dateModified: '2026-10-22',
    grids: {
      // 생각 모드 갈래별 모델 6(없음: phi-4·gemma-3-27b · 기본 켜짐: qwen3-14b·qwen3-32b · 기본 꺼짐: gemma-4-26b-a4b · 늘 켜짐: gpt-oss-20b)
      // × NVIDIA 5장. 본문이 말하는 칸은 전부 <Expect> 로 고정
      thinking: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090'],
        models: ['phi-4', 'qwen3-14b', 'gemma-3-27b', 'qwen3-32b', 'gemma-4-26b-a4b', 'gpt-oss-20b'],
      },
    },
    related: ['deepseek-local', 'ollama-context-length', 'kv-cache-context'],
    locales: {
      en: {
        title: 'Thinking models on local hardware: the speed cost and how to turn thinking off',
        description:
          'Why thinking models such as Qwen3 and gpt-oss feel slower on the same GPU, why CanRun rates them 1.5× stricter, and how to turn thinking off in Ollama and llama.cpp.',
      },
      ko: {
        title: '생각 모드(리즈닝) 모델의 속도 비용 — 켜고 끄는 법',
        description:
          'Qwen3·gpt-oss 같은 생각 모드 모델이 같은 GPU에서 더 느리게 느껴지는 이유와 CanRun이 속도 기준을 1.5배 엄격하게 잡는 이유를 정리했습니다. Ollama·llama.cpp에서 끄는 법도 다룹니다.',
      },
    },
  },
  'tokens-per-second': {
    ...PUBLISHED_1015,
    // 10-16 D91: pp 추정이 모델 크기를 반영 — 프롬프트 처리 문단 갱신. 10-25 D124: 속도 그리드 RTX 5060 Ti 16GB 행 첫 칸(자체 실측) 문장
    dateModified: '2026-10-25',
    grids: {
      // 모델 4 × 대역폭 작은 순 8칸(CPU 89.6 → RTX 5090 1792 GB/s). 본문이 이 순서("least memory bandwidth to the most" /
      // "위에서부터 메모리 대역폭이 작은 순서")와 "RTX 4060 행 첫 칸이 4060 Ti 16GB 보다 높은 건 실측이라서"·"RTX 5060 Ti 16GB 행 첫 칸이 5070 보다 높은 건
      // 자체 실측이라서"(10-25 D124)를 말한다 —
      // 카드나 순서를 바꾸면 두 문장을 다시 확인한다
      speed: {
        gpus: ['cpu-ddr5-5600-2ch', 'rtx-4060', 'rtx-4060-ti-16gb', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-5070', 'rtx-3090', 'rtx-5090'],
        models: ['llama-3.1-8b', 'qwen3-14b', 'gemma-3-27b', 'qwen3-30b-a3b-2507'],
      },
    },
    related: ['vram-requirements', 'kv-cache-context', 'gpu-offload-check'],
    locales: {
      en: {
        title: "Tokens per second for local LLMs: what's fast enough and what sets the speed",
        description:
          'What generation and prompt speed mean for local LLMs, the speed each CanRun verdict needs, why bandwidth and VRAM spills set the pace, and how to measure your own.',
      },
      ko: {
        title: '로컬 LLM 속도 읽는 법 — 초당 토큰, 생성과 프롬프트 처리, 몇이면 쓸 만한가',
        description:
          '로컬 LLM의 생성 속도와 프롬프트 처리 속도가 무엇인지, 판정마다 필요한 속도와 메모리 대역폭·VRAM 초과가 속도를 정하는 이유, 내 PC에서 재는 법을 정리했습니다.',
      },
    },
  },
  'amd-intel-gpus': {
    ...PUBLISHED_1015,
    // 10-16 D91: pp 추정이 모델 크기를 반영 — 프롬프트 처리 문단 갱신. 10-25 D124: 속도 그리드 RTX 5060 Ti 16GB 행 첫 칸(자체 실측) 문장
    dateModified: '2026-10-25',
    grids: {
      // 라데온·Arc 카드 바로 아래에 VRAM 이 같은 NVIDIA 카드: 12GB B580/3060 · 16GB 9060 XT/5060 Ti · 16GB 9070 XT/5070 Ti ·
      // 24GB 7900 XTX/3090 × 모델 6. 본문이 이 순서("one row after the other" / "한 줄씩 번갈아")와 12·16·24GB 절의 짝을
      // 말한다 — 카드를 바꾸면 그 문장들을 다시 확인한다
      radeon: {
        gpus: ['arc-b580', 'rtx-3060-12gb', 'rx-9060-xt-16gb', 'rtx-5060-ti-16gb', 'rx-9070-xt', 'rtx-5070-ti', 'rx-7900-xtx', 'rtx-3090'],
        models: ['llama-3.1-8b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3-30b-a3b-2507', 'gemma-3-27b', 'qwen3-32b'],
      },
    },
    related: ['gpu-by-budget', 'gpu-offload-check', 'vram-requirements'],
    locales: {
      en: {
        title: 'AMD Radeon and Intel Arc for local LLMs: ROCm, Vulkan and what runs',
        description:
          'Which local LLMs fit on Radeon RX 9000 and RX 7000 cards and the Intel Arc B580, how ROCm, Vulkan and SYCL differ on Windows and Linux, and why the speeds differ.',
      },
      ko: {
        title: '라데온·인텔 Arc로 로컬 LLM 돌리기 — ROCm·Vulkan과 돌아가는 모델',
        description:
          '라데온 RX 9000·7000 계열과 인텔 Arc B580에서 돌아가는 로컬 LLM을 같은 용량의 NVIDIA 카드와 비교했습니다. Windows·Linux에서 ROCm·Vulkan·SYCL 중 무엇을 쓸 수 있는지도 정리했습니다.',
      },
    },
  },
  'laptop-gpu-llm': {
    ...PUBLISHED_1015,
    grids: {
      // 노트북 GPU 7종 + 이름이 같은 데스크톱 카드를 짝으로(노트북 줄 바로 아래에 데스크톱 줄, 노트북 VRAM 작은 순) × 인기 모델 5.
      // 본문이 "laptop GPU with the desktop card that shares its name" / "바로 아래 줄에 붙였습니다"라고 이 순서를 말한다 —
      // 줄 순서를 바꾸면 두 문장을 다시 확인한다
      laptop: {
        gpus: [
          'rtx-4060-laptop',
          'rtx-4060',
          'rtx-4070-laptop',
          'rtx-4070',
          'rtx-4080-laptop',
          'rtx-4080',
          'rtx-5070-ti-laptop',
          'rtx-5070-ti',
          'rtx-4090-laptop',
          'rtx-4090',
          'rtx-5080-laptop',
          'rtx-5080',
          'rtx-5090-laptop',
          'rtx-5090',
        ],
        models: ['llama-3.1-8b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3.8-27b', 'qwen3.5-35b-a3b'],
      },
    },
    related: ['vram-requirements', 'mac-local-llm', 'moe-cpu-offload'],
    locales: {
      en: {
        title: 'Local LLMs on a gaming laptop: laptop GPUs, VRAM and speed',
        description:
          'Which local LLMs run on RTX 40 and RTX 50 laptop GPUs, why a laptop chip can have less VRAM than its desktop namesake, and what power limits and system RAM change.',
      },
      ko: {
        title: '노트북으로 로컬 LLM — 노트북 GPU는 이름이 같아도 VRAM이 다를 수 있다',
        description:
          'RTX 40·50 노트북 GPU에서 돌아가는 로컬 LLM을 정리했습니다. 이름이 같은 데스크톱 카드보다 VRAM이 적은 경우와, 전력 제한·시스템 RAM에 따라 달라지는 점도 함께 다룹니다.',
      },
    },
  },
  'multi-gpu': {
    ...PUBLISHED_1015,
    grids: {
      // 짝을 이루는 카드(RTX 3060 12GB, RTX 5060 Ti 16GB)와 합계가 같은 한 장짜리 카드(RTX 3090 = 24GB, RTX 5090 = 32GB) × 모델 6.
      // 그리드는 콤보 페이지처럼 한 줄 = 카드 한 장. 두 장 결과는 본문이 계산기 결과(이론 추정)로 말한다 — <Expect> 는 GPU 하나만
      // 받으므로 고정되지 않는다(D77 ②). 본문이 말하는 한 장 칸은 전부 <Expect> 로 고정
      multigpu: {
        gpus: ['rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-5090'],
        models: ['qwen3-14b', 'gemma-3-27b', 'qwen3-30b-a3b-2507', 'qwen3-32b', 'llama-3.3-70b', 'gpt-oss-120b'],
      },
    },
    related: ['dgx-spark-llm', 'vram-requirements', 'gpu-by-budget'],
    locales: {
      en: {
        title: "Two GPUs for local LLMs: memory adds up, speed doesn't",
        description:
          'A second GPU adds room for bigger local LLMs, and speed only when a model stops spilling into RAM. Two RTX 3060 12GB vs one RTX 3090, mixed cards, and setup.',
      },
      ko: {
        title: '그래픽카드 2장으로 로컬 LLM — 메모리는 더해지고 속도는 더해지지 않는다',
        description:
          '그래픽카드를 두 장 꽂으면 로컬 LLM에서 무엇이 달라지는지 정리했습니다. 한 장에 들어가는 모델은 빨라지지 않는 이유, RTX 3060 12GB 두 장과 RTX 3090 비교, llama.cpp·Ollama 설정을 다룹니다.',
      },
    },
  },
  'cpu-only-llm': {
    ...PUBLISHED_1015,
    grids: {
      // CPU 전용 프로필 3종 × 모델 6. 행 순서 = 대역폭이 작은 순(DDR4-3200 51.2 → DDR5-5600 89.6 → DDR5-6000 96 GB/s).
      // 본문이 이 순서("ordered from the least memory bandwidth to the most" / "위에서부터 메모리 대역폭이 작은 순서")를 말한다.
      // CPU 행 칸의 맨 아래 줄(atRam)은 판정을 낸 RAM 구성(그 판정이 나오는 가장 작은 용량, 전부 불가면 가장 큰 용량)이고 본문이
      // 그렇게 설명한다. gemma-3-12b 를 고른 이유: qwen3-14b·gemma-3-27b 는 DDR4 행이 64GB 구성 + Q2_K 제안으로 그려져 RAM 용량을
      // 오해하게 만든다 — 둘은 본문 <Expect> 로만 다룬다
      cpu: {
        gpus: ['cpu-ddr4-3200-2ch', 'cpu-ddr5-5600-2ch', 'cpu-ddr5-6000-2ch'],
        models: ['llama-3.2-3b', 'llama-3.1-8b', 'gemma-3-12b', 'gpt-oss-20b', 'qwen3-30b-a3b-2507', 'gpt-oss-120b'],
      },
    },
    related: ['kv-cache-context', 'gguf-quantization', 'moe-cpu-offload'],
    locales: {
      en: {
        title: 'Running LLMs without a GPU: CPU-only speed and how much RAM you need',
        description:
          'Which local LLMs run on a PC with no graphics card, how much system RAM each needs, and why RAM bandwidth and MoE models decide the speed.',
      },
      ko: {
        title: '그래픽카드 없이 로컬 LLM — CPU와 시스템 RAM만으로 돌릴 수 있는 모델',
        description:
          '그래픽카드 없이 CPU와 시스템 RAM만으로 돌아가는 로컬 LLM과 모델별로 필요한 RAM 용량을 정리했습니다. 속도를 정하는 RAM 대역폭과 CPU에서 유리한 MoE 모델도 다룹니다.',
      },
    },
  },
  'gemma-4-models': {
    ...PUBLISHED_1019,
    // 10-21 D112: E2B·E4B 계산 — Ollama 절의 "아직 계산하지 않음"을 실제 필요량·8GB 카드·노트북·16GB 맥 판정(MemoryBreakdown + <Expect>)으로
    dateModified: '2026-10-21',
    grids: {
      // 8~32GB 데스크톱 dGPU 8종 × Gemma 4 세 크기 — 배치 2 의 Gemma 4 dGPU 콤보를 덮는다. E2B·E4B(10-21 D112 카탈로그)는 그리드 밖 —
      // 제목이 세 크기 비교라 Ollama 절의 MemoryBreakdown·산문 <Expect> 로만
      gemma4: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-4070', 'rtx-5070', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: ['gemma-4-12b', 'gemma-4-26b-a4b', 'gemma-4-31b'],
      },
    },
    related: ['moe-cpu-offload', 'vram-requirements', 'thinking-models'],
    locales: {
      en: {
        title: 'Gemma 4 12B vs 26B-A4B vs 31B: differences, VRAM and which size fits your GPU',
        description:
          'How Gemma 4 12B, 26B-A4B and 31B differ in memory and speed on 8–32GB GPUs, why the MoE model can use system RAM, and what the Ollama gemma4 tags hold.',
      },
      ko: {
        title: '젬마 4(Gemma 4) 모델별 차이 — 12B·26B-A4B·31B 사양과 VRAM 비교',
        description:
          '젬마 4 12B·26B-A4B·31B가 8~32GB 그래픽카드에서 어떻게 다른지 메모리와 속도로 비교했습니다. MoE 모델을 시스템 RAM과 나눠 돌리는 법과 Ollama gemma4 태그도 정리했습니다.',
      },
    },
  },
  'qwen3.6-vs-qwen3.8': {
    ...PUBLISHED_1019,
    grids: {
      // gemma4 와 같은 8종 × Qwen 3.5~3.8 — 9B 는 작은 대안. 배치 2 의 qwen3.5-9b·qwen3.8-27b·qwen3.6-35b-a3b dGPU 콤보를 덮는다
      qwen36: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-4070', 'rtx-5070', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: ['qwen3.5-9b', 'qwen3.6-27b', 'qwen3.8-27b', 'qwen3.6-35b-a3b'],
      },
    },
    related: ['moe-cpu-offload', 'gguf-quantization', 'thinking-models'],
    locales: {
      en: {
        title: 'Qwen3.6 vs Qwen3.8, 27B vs 35B-A3B: differences and the VRAM each needs',
        description:
          'Qwen3.6 27B, Qwen3.8 27B and Qwen3.6 35B-A3B on 8–32GB GPUs: what changes between versions, dense vs MoE memory and speed, and which quant fits a 16GB card.',
      },
      ko: {
        title: 'Qwen3.6·Qwen3.8 비교 — 27B와 35B-A3B 차이, VRAM과 속도',
        description:
          'Qwen3.6 27B·Qwen3.8 27B·Qwen3.6 35B-A3B를 8~32GB 그래픽카드에서 비교했습니다. 버전 사이에 달라진 점, dense와 MoE의 메모리·속도 차이, 16GB에 들어가는 양자화를 정리했습니다.',
      },
    },
  },
  'deepseek-local': {
    ...PUBLISHED_1019,
    // 10-21 D115: 'V4 는 계산하지 않음' → DeepSeek V4 Flash 0731 계산(큰 메모리 맥·여러 장·MoE 전문가 RAM 배치 <Expect>, KV 표·확실성 문단)
    // 10-23 D117: DGX Spark 128GB 의 Q2_K 가 CPU 경로 B → 불가(기기 근거 사용 가능량이 두 경로의 한도) — 문장과 <Expect> 를 고쳤다
    // 10-23 D121: V4 Flash 판정 할인(0.215 — 사용자 결정 'GLM 과 같은 방식', 리뷰 반영으로 DGX Spark #27970 참고점 포함)으로 계산기의 그래픽카드 네 장 MoE 전문가
    // RAM 배치(RTX 5090 네 장 + 64GB MXFP4 · RTX 3090 네 장 + 128GB Q2_K) 원활 → 겨우 가능 — 여러 장 문단·확실성 문단·출처(#27970)를 고쳤다. M3 Ultra·M5 Ultra 8k 는 쾌적 그대로
    dateModified: '2026-10-23',
    grids: {
      // 8~32GB dGPU 6종 × R1 소형 4종 — 0528-qwen3-8b 는 Ollama deepseek-r1 기본 태그, distill-14b 는 :14b (10-19 추가).
      // 원본 R1·V3·V4-Pro 는 카탈로그 밖이라 모델 카드 출처의 산문으로만. V4 Flash 0731(10-21 D115)은 6장 모두 32GB RAM 에서 안 들어가 그리드에 넣지 않고 산문 <Expect> 로
      deepseek: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090', 'rtx-5090'],
        models: ['deepseek-r1-0528-qwen3-8b', 'deepseek-r1-distill-8b', 'deepseek-r1-distill-14b', 'deepseek-r1-distill-32b'],
      },
    },
    related: ['thinking-models', 'kv-cache-context', 'ollama-context-length'],
    locales: {
      en: {
        title: 'Running DeepSeek locally: hardware requirements for the R1 distills and the full model',
        description:
          'Which DeepSeek models run on a home PC: VRAM for the 8B, 14B and 32B distills, context memory for long reasoning, and the memory DeepSeek V4 Flash needs.',
      },
      ko: {
        title: '딥시크(DeepSeek) 로컬 사양 — R1 증류 모델 8B·14B·32B와 원본 R1을 돌리려면',
        description:
          '딥시크 모델을 내 PC에서 돌릴 때 필요한 사양을 정리했습니다. 증류 모델 8B·14B·32B의 VRAM, 긴 추론에 드는 컨텍스트 메모리, DeepSeek V4 Flash에 필요한 메모리를 다룹니다.',
      },
    },
  },
  'ollama-lm-studio-requirements': {
    ...PUBLISHED_1019,
    // 10-21 D112: 빠른 시작 예제 모델 E2B·기본 gemma4 태그 E4B 의 "계산하지 않음" → 8GB 카드 fit(<Expect>)
    dateModified: '2026-10-21',
    grids: {
      // 8·12·16·24·32GB 한 장씩 × 크기 순 모델 6 — gpt-oss-20b·qwen3-14b 칸은 배치 1 이라 링크된다
      ollamaTiers: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-5090'],
        models: ['qwen3-8b', 'gemma-4-12b', 'qwen3-14b', 'gpt-oss-20b', 'gemma-4-26b-a4b', 'qwen3.6-35b-a3b'],
      },
    },
    related: ['ollama-vs-llama-cpp-lm-studio', 'gpu-offload-check', 'vram-requirements'],
    locales: {
      en: {
        title: 'Ollama and LM Studio system requirements: minimum specs, RAM and VRAM by model size',
        description:
          'What Ollama and LM Studio need to install and run: OS, CPU and GPU requirements, how much RAM and VRAM each model size takes, and what to pull on 8–32GB cards.',
      },
      ko: {
        // '추천' — 10-19 사용자 채팅 승인(RECOMMEND_TITLE_APPROVED). 본문은 메모리 기준으로만 쓴다
        // 10-27 D127: 'ollama 그래픽카드'·'ollama 컴퓨터 사양' 자동완성 — 그래픽카드·컴퓨터 사양
        title: '올라마(Ollama)·LM Studio 사양 — 최소·권장 사양과 그래픽카드 VRAM별 추천 모델',
        description:
          'Ollama와 LM Studio를 설치하고 돌리는 데 필요한 컴퓨터 사양(OS·CPU·GPU 조건)과, 모델 크기별로 드는 RAM·VRAM을 정리했습니다. 8~32GB 그래픽카드에서 받을 만한 모델도 함께 봅니다.',
      },
    },
  },
  'dgx-spark-llm': {
    // 10-23 D119 초안 → 10-23 사용자 게시 승인(D122)
    ...PUBLISHED_1023,
    grids: {
      // DGX Spark 구성 6줄(1대 64·128GB, 64·128GB × 2대·4대 — GPU 허브 '메모리 구성별 판정' 표와 같은 칸) × 모델 6
      // (작은 MoE · dense 31B · dense 70B · gpt-oss-120b · 122B MoE · 한 대에 안 들어가는 284B MoE). 본문이 말하는 칸은 전부 <Expect>(여러 대는 nodes)로 고정.
      // 10-23 D121: 같은 메모리 1대에 들어가는 모델의 여러 대 칸은 '1대로 충분'(<Expect oneUnit>) — 연결이 필요한 칸만 판정·속도
      dgxSpark: {
        gpus: ['nvidia-dgx-spark'],
        rows: [
          'nvidia-dgx-spark@64',
          'nvidia-dgx-spark@128',
          'nvidia-dgx-spark@64x2',
          'nvidia-dgx-spark@128x2',
          'nvidia-dgx-spark@64x4',
          'nvidia-dgx-spark@128x4',
        ],
        models: ['qwen3.6-35b-a3b', 'gemma-4-31b', 'llama-3.3-70b', 'gpt-oss-120b', 'qwen3.5-122b-a10b', 'deepseek-v4-flash-0731'],
      },
      // 비교 대상 한 줄씩 — 통합 메모리는 128GB(맥 스튜디오 M5 Ultra 는 256GB) 구성 고정, RTX 5090 은 콤보 페이지와 같은 시스템 RAM 32GB.
      // 본문이 이 순서(DGX Spark → Strix Halo → M5 Max → M5 Ultra → RTX 5090)로 설명한다 — 행을 바꾸면 그 문단을 다시 확인한다
      dgxPeers: {
        gpus: ['nvidia-dgx-spark', 'amd-strix-halo', 'apple-m5-max-40c', 'apple-m5-ultra', 'rtx-5090'],
        rows: ['nvidia-dgx-spark@128', 'amd-strix-halo@128', 'apple-m5-max-40c@128', 'apple-m5-ultra@256', 'rtx-5090'],
        models: ['qwen3.6-35b-a3b', 'gemma-4-31b', 'llama-3.3-70b', 'gpt-oss-120b', 'qwen3.5-122b-a10b'],
      },
    },
    related: ['unified-memory-128gb', 'multi-gpu', 'moe-cpu-offload'],
    locales: {
      en: {
        title: 'DGX Spark for local LLMs: what runs on 64GB, 128GB and two or four linked units',
        description:
          'Which local LLMs run on a 64GB or 128GB DGX Spark, how much memory its GPU can use, and what linking two or four units with llama.cpp or vLLM changes.',
      },
      ko: {
        // 자동완성 'dgx spark llm 추천'·'dgx spark 2대 연결'·'dgx spark 64gb' — '추천'은 10-23 사용자 승인(RECOMMEND_TITLE_APPROVED, D120). 본문은 메모리 기준만
        title: 'DGX Spark LLM 추천 — 64GB·128GB에서 돌아가는 모델과 2대·4대 연결',
        description:
          'DGX Spark 64GB·128GB 한 대에서 돌아가는 로컬 LLM과 GPU가 쓸 수 있는 메모리를 정리했습니다. 두 대·네 대를 이으면 llama.cpp와 vLLM에서 무엇이 달라지는지도 다룹니다.',
      },
    },
  },
  'rtx-5060-ti-16gb-local-llm': {
    // 10-25 D124 초안 — 자체 실측 2점(Llama 3.1 8B·Gemma 3 12B, 카탈로그 행과 같은 파일)과 CanRun 추정 대조 → 10-25 사용자 게시 승인(D125)
    ...PUBLISHED_1025,
    grids: {
      // 이 카드 한 줄 × 모델 8 — 직접 잰 8B~14B 4종 + 16GB 경계를 보여 주는 MoE·27B 4종. 본문이 말하는 칸은 전부 <Expect> 로 고정
      rtx5060tiOwn: {
        gpus: ['rtx-5060-ti-16gb'],
        models: ['llama-3.1-8b', 'qwen3-8b', 'gemma-3-12b', 'qwen3-14b', 'gpt-oss-20b', 'gemma-4-26b-a4b', 'qwen3.8-27b', 'qwen3-30b-a3b-2507'],
      },
    },
    related: ['tokens-per-second', 'ollama-vs-llama-cpp-lm-studio', 'vram-requirements'],
    locales: {
      en: {
        title: 'Local LLMs on an RTX 5060 Ti 16GB: what we measured with Ollama',
        description:
          'Four 8B to 14B models measured with Ollama on an RTX 5060 Ti 16GB: how the test works, how the results compare with CanRun estimates, and what fits in 16GB.',
      },
      ko: {
        title: 'RTX 5060 Ti 16GB에서 직접 돌려 본 로컬 LLM — Ollama로 잰 속도와 CanRun 추정',
        description:
          'RTX 5060 Ti 16GB에서 8B~14B 모델 네 개를 Ollama로 직접 쟀습니다. 측정 방법과 CanRun 추정과의 차이, 16GB 카드에 들어가는 모델을 정리했습니다.',
      },
    },
  },
};
