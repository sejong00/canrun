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
  // 10-15 D75: 배치 1 새 가이드 초안 4편 — 사용자 감수 대기(draft = noindex·미링크)
  'gpu-by-budget',
  'moe-cpu-offload',
  'local-coding-agents',
  'gpu-offload-check',
  // 10-15 D76: 배치 2 새 가이드 초안 4편 — 사용자 감수 대기(draft = noindex·미링크)
  'unified-memory-128gb',
  'ollama-vs-llama-cpp-lm-studio',
  'thinking-models',
  'tokens-per-second',
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

/** 배치 1 모델(docs/04 §3) — vram·mac 그리드가 공유 */
const BATCH1_MODELS = ['llama-3.1-8b', 'gemma-3-12b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3-30b-a3b-2507', 'gpt-oss-120b'] as const;

/** 09-30 사용자가 채팅으로 6편 모두 게시 승인 (D40) */
const PUBLISHED = { status: 'published', reviewedAt: '2026-09-30', datePublished: '2026-09-30', dateModified: '2026-09-30', author: 'CanRun' } as const;

/** 10-15 D75·D76 배치 1·2 초안 — 게시 전환은 사용자가 슬러그별로 승인한 뒤(D40, reviewedAt·날짜 갱신과 함께) */
const DRAFT_1015 = { status: 'draft', datePublished: '2026-10-15', dateModified: '2026-10-15', author: 'CanRun' } as const;

export const GUIDES: Readonly<Record<GuideSlug, GuideEntry>> = {
  'vram-requirements': {
    ...PUBLISHED,
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신. 10-03 D63: en "5090 이 더하는 모델 없음" → Nemotron 3.5 Lightning
    dateModified: '2026-10-03',
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
        title: 'Ollama가 느리거나 앞 내용을 잊을 때 — 컨텍스트 기본값',
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
    // 10-03 D62: 필요량 정의(그래픽카드에 올라가는 가중치)·여유 문장 갱신. 10-03 D63: Mamba-2·conv·KDA+MLA 하이브리드 KV 세는 법
    dateModified: '2026-10-03',
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
    ...DRAFT_1015,
    grids: {
      // 가격대별 카드 8종(이 글을 쓸 때 data/gpus.json 실거래가 낮은 순 — 본문이 "when this guide was written"으로 이 순서를 밝힌다.
      // 가격을 고치면 본문의 가격 순서 문장 4곳과 이 행 순서를 다시 확인한다) × 인기 모델 6
      budget: {
        gpus: ['rtx-3060-12gb', 'rtx-5060', 'rx-9060-xt-16gb', 'rtx-5060-ti-16gb', 'rtx-5070', 'rtx-5070-ti', 'rtx-3090', 'rtx-5090'],
        models: ['llama-3.1-8b', 'qwen3-14b', 'gpt-oss-20b', 'qwen3.8-27b', 'qwen3.5-35b-a3b', 'gpt-oss-120b'],
      },
    },
    related: ['vram-requirements', 'gguf-quantization', 'kv-cache-context'],
    locales: {
      en: {
        // 10-15 사용자 결정: 제목에 "Recommended"/"추천" 허용(AUTHORING §2 예외 — 본문은 메모리 기준 데이터로 답하고 제품 구매를 권하지 않는다)
        title: 'Recommended GPUs for local LLMs in 2026: what each budget runs',
        description:
          'Which local LLMs each GPU memory size runs, 8GB to 32GB, with dated street prices: 12GB vs 8GB cards, a new 16GB card vs a 24GB RTX 3090, and when system RAM helps.',
      },
      ko: {
        title: '로컬 LLM 그래픽카드 추천 — 예산별로 돌릴 수 있는 모델 (2026)',
        description:
          '그래픽카드 VRAM 용량별로 돌아가는 로컬 LLM과 실거래가를 정리했습니다. 12GB와 8GB 카드, 신품 16GB와 24GB RTX 3090을 데이터로 비교하고, 시스템 RAM이 도움이 되는 경우도 다룹니다.',
      },
    },
  },
  'moe-cpu-offload': {
    ...DRAFT_1015,
    grids: {
      moe: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-5090'],
        models: ['gpt-oss-20b', 'gemma-4-26b-a4b', 'qwen3-30b-a3b-2507', 'qwen3.6-35b-a3b', 'gpt-oss-120b', 'qwen3.5-122b-a10b'],
      },
    },
    related: ['vram-requirements', 'kv-cache-context', 'gguf-quantization'],
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
    ...DRAFT_1015,
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
    ...DRAFT_1015,
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
    ...DRAFT_1015,
    grids: {
      // 128GB급 통합 메모리 3종 + 맥 스튜디오 Ultra 2종 + 비교용 RTX 5090(시스템 RAM 32GB 기준) × MoE·dense·대형 MoE 5종.
      // 통합 메모리 칸은 "가장 좋은 판정이 나는 가장 작은 구성"이라 본문이 그 점을 설명한다. llama-3.3-70b 는 Strix·M4 Max·M2 Ultra
      // 칸이 64GB CPU 전용으로 그려져 일부러 뺐다(본문에서 ram="128" Expect 로 다룬다)
      unified128: {
        gpus: ['amd-strix-halo', 'nvidia-dgx-spark', 'apple-m4-max-40c', 'apple-m3-ultra', 'apple-m2-ultra', 'rtx-5090'],
        models: ['qwen3.5-35b-a3b', 'gemma-4-31b', 'gpt-oss-120b', 'qwen3.5-122b-a10b', 'solar-open2-250b'],
      },
    },
    related: ['mac-local-llm', 'moe-cpu-offload', 'kv-cache-context'],
    locales: {
      en: {
        title: 'Strix Halo vs DGX Spark vs Mac Studio for local LLMs: what 128 GB gets you',
        description:
          'What fits on a 128GB Strix Halo, DGX Spark or Mac Studio, how much memory each GPU can use, and why bandwidth sets the speed, with public gpt-oss-120b results.',
      },
      ko: {
        title: '128GB 통합 메모리 기기 비교 — 스트릭스 헤일로·DGX Spark·맥 스튜디오',
        description:
          '128GB 스트릭스 헤일로·DGX Spark·맥 스튜디오에 들어가는 큰 모델과 GPU가 실제로 쓸 수 있는 메모리를 정리했습니다. 속도를 가르는 대역폭과 gpt-oss-120b 공개 벤치마크도 함께 봅니다.',
      },
    },
  },
  'ollama-vs-llama-cpp-lm-studio': {
    ...DRAFT_1015,
    // 그리드 없음 — KvPerTokenTable·CtxTable(qwen3-32b × rtx-4090)·MemoryBreakdown·Measured 로 기본값의 메모리 차이를 보인다
    grids: {},
    related: ['ollama-context-length', 'kv-cache-context', 'gpu-offload-check'],
    locales: {
      en: {
        title: 'Ollama vs llama.cpp vs LM Studio: same engine, different defaults',
        description:
          'Ollama and LM Studio run GGUF models on llama.cpp. How each tool’s default context, parallel slots and GPU split change memory and speed, and how to match them.',
      },
      ko: {
        title: 'Ollama·llama.cpp·LM Studio 차이 — 같은 엔진, 다른 기본값',
        description:
          'Ollama와 LM Studio는 모두 llama.cpp로 GGUF 모델을 돌립니다. 세 도구의 기본 컨텍스트, 동시 요청, GPU 배치가 메모리와 속도를 어떻게 바꾸는지, 같은 조건으로 맞추는 법을 정리했습니다.',
      },
    },
  },
  'thinking-models': {
    ...DRAFT_1015,
    grids: {
      // 생각 모드 갈래별 모델 6(없음: phi-4·gemma-3-27b · 기본 켜짐: qwen3-14b·qwen3-32b · 기본 꺼짐: gemma-4-26b-a4b · 늘 켜짐: gpt-oss-20b)
      // × NVIDIA 5장. 본문이 말하는 칸은 전부 <Expect> 로 고정
      thinking: {
        gpus: ['rtx-4060', 'rtx-3060-12gb', 'rtx-5060-ti-16gb', 'rtx-3090', 'rtx-4090'],
        models: ['phi-4', 'qwen3-14b', 'gemma-3-27b', 'qwen3-32b', 'gemma-4-26b-a4b', 'gpt-oss-20b'],
      },
    },
    related: ['ollama-context-length', 'kv-cache-context', 'vram-requirements'],
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
    ...DRAFT_1015,
    grids: {
      // 모델 4 × 대역폭 작은 순 8칸(CPU 89.6 → RTX 5090 1792 GB/s). 본문이 이 순서("least memory bandwidth to the most" /
      // "위에서부터 메모리 대역폭이 작은 순서")와 "RTX 4060 행 첫 칸이 4060 Ti 16GB 보다 높은 건 실측이라서"를 말한다 —
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
};
