/**
 * 외부 도구의 동작 사실 (가이드 `<RuntimeFact id>` — P1-4). 도구가 바뀌면 틀려지므로 출처 URL·확인일을 함께 둔다.
 * 레코드 하나가 사실 하나다(10-19): id = 키, 문장 = `messages` 의 `GuideData.<message>` (en/ko), 출처 줄 = 도구별
 * `GuideData.factSource*`. 사실을 더할 때는 여기 한 줄 + 문장 키 두 개(en·ko)만 — id 목록(`RUNTIME_FACT_IDS`)은 키에서 나온다.
 * 분기 재확인(PROGRESS §3)은 `checked` 가 90일을 넘긴 레코드의 `source` 를 다시 읽는다. 집필 규칙: AUTHORING §2.
 */
export const RUNTIME_FACT_TOOLS = ['ollama', 'lmstudio'] as const;
export type RuntimeFactTool = (typeof RUNTIME_FACT_TOOLS)[number];

export type RuntimeFactRecord = {
  /** 1차 출처(공식 문서) https URL */
  readonly source: string;
  /** 출처를 마지막으로 읽은 날 YYYY-MM-DD */
  readonly checked: string;
  /** 출처 줄 이름("Ollama 문서", "LM Studio 문서") */
  readonly tool: RuntimeFactTool;
  /** 문장 키 — `GuideData.<message>` */
  readonly message: `fact${string}`;
};

/** 도구별 출처 줄 키 — `GuideData.<key>`, 인자 {date} */
export const RUNTIME_FACT_SOURCE_KEYS: Readonly<Record<RuntimeFactTool, `factSource${string}`>> = {
  ollama: 'factSourceOllama',
  lmstudio: 'factSourceLmStudio',
};

export const RUNTIME_FACTS = {
  // docs.ollama.com/context-length: < 24 GiB VRAM → 4k, 24–48 GiB → 32k, ≥ 48 GiB → 256k
  'ollama-default-ctx': {
    source: 'https://docs.ollama.com/context-length',
    checked: '2026-09-29',
    tool: 'ollama',
    message: 'factOllamaDefaultCtx',
  },
  // docs.ollama.com/faq "How can I set the quantization type for the K/V cache?" — 서버 전역, 플래시 어텐션 필요
  'ollama-kv-cache-type': {
    source: 'https://docs.ollama.com/faq',
    checked: '2026-09-29',
    tool: 'ollama',
    message: 'factOllamaKvCacheType',
  },
  // docs.ollama.com/windows System Requirements: "Windows 10 22H2 or newer, Home or Pro" ·
  // "NVIDIA 551.61 or newer Drivers if you have an NVIDIA card" — /gpu 의 드라이버 하한(550)과 다르다, 각 문서 그대로 적는다
  'ollama-windows-req': {
    source: 'https://docs.ollama.com/windows',
    checked: '2026-10-19',
    tool: 'ollama',
    message: 'factOllamaWindowsReq',
  },
  // docs.ollama.com/macos System Requirements: "MacOS Sonoma (v14) or newer" · "Apple M series (CPU and GPU support) or x86 (CPU only)"
  'ollama-macos-req': {
    source: 'https://docs.ollama.com/macos',
    checked: '2026-10-19',
    tool: 'ollama',
    message: 'factOllamaMacosReq',
  },
  // docs.ollama.com/gpu Nvidia: "compute capability 5.0+ and driver version 550 and newer" ·
  // "compute capability 5.0 through 6.2 require driver version 570 or newer"
  'ollama-nvidia-req': {
    source: 'https://docs.ollama.com/gpu',
    checked: '2026-10-19',
    tool: 'ollama',
    message: 'factOllamaNvidiaReq',
  },
  // lmstudio.ai/docs/app/system-requirements Windows: "AVX2 instruction set support is required (for x64)" ·
  // "At least 16GB of RAM is recommended" · "at least 4GB of dedicated VRAM is recommended" — Windows 버전은 적혀 있지 않다
  'lmstudio-windows-req': {
    source: 'https://lmstudio.ai/docs/app/system-requirements',
    checked: '2026-10-19',
    tool: 'lmstudio',
    message: 'factLmStudioWindowsReq',
  },
  // 같은 문서 macOS: "Apple Silicon (M1/M2/M3/M4)" · "macOS 14.0 or newer" · "16GB+ RAM recommended" · "Intel-based Macs are currently not supported"
  'lmstudio-mac-req': {
    source: 'https://lmstudio.ai/docs/app/system-requirements',
    checked: '2026-10-19',
    tool: 'lmstudio',
    message: 'factLmStudioMacReq',
  },
} as const satisfies Readonly<Record<string, RuntimeFactRecord>>;

export type RuntimeFactId = keyof typeof RUNTIME_FACTS;

export const isRuntimeFactId = (id: string): id is RuntimeFactId => Object.hasOwn(RUNTIME_FACTS, id);
