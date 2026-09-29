import type { RuntimeFactId } from './guide-components';

/**
 * 외부 도구의 동작 사실 (가이드 `<RuntimeFact id>` — P1-4). 도구가 바뀌면 틀려지므로 출처 URL·확인일을 함께 둔다.
 * 문장은 `messages` 의 `GuideData.fact_<id>` (en/ko), 여기는 출처만.
 */
export const RUNTIME_FACTS: Readonly<Record<RuntimeFactId, { source: string; checked: string }>> = {
  // docs.ollama.com/context-length: < 24 GiB VRAM → 4k, 24–48 GiB → 32k, ≥ 48 GiB → 256k
  'ollama-default-ctx': { source: 'https://docs.ollama.com/context-length', checked: '2026-09-29' },
  // docs.ollama.com/faq "How can I set the quantization type for the K/V cache?" — 서버 전역, 플래시 어텐션 필요
  'ollama-kv-cache-type': { source: 'https://docs.ollama.com/faq', checked: '2026-09-29' },
};
