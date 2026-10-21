/**
 * 모델 개발 조직 이름 (10-19 모델 목록 `/models` 의 "개발" 열) — 의존성 0.
 *
 * - 키 = `data/models.json` `hfId` 의 앞부분(원본 가중치를 올린 Hugging Face 조직), 값 = 그 조직이 Hugging Face 에 적은 이름.
 *   출처: `https://huggingface.co/api/organizations/<조직>/overview` 의 `fullname`(10-19 확인). 끝의 장식 문자는 뺐다("Mistral AI_" → "Mistral AI"),
 *   소문자로만 적힌 이름은 첫 글자를 대문자로 썼다("upstage" → "Upstage", "Poolside" 는 원래 대문자).
 * - 회사 이름을 따로 추정하지 않는다(Qwen = 알리바바 같은 연결은 출처를 따로 달아야 하는 사실이라 쓰지 않는다) — 조직 이름 그대로.
 * - 로캘과 무관한 고유명사라 messages 가 아니라 여기에 둔다(모델 이름이 data 에 있는 것과 같다). 레지스트리에 없는 조직은 조직 id 를 그대로 보인다.
 * - 카탈로그의 모든 조직이 여기 있어야 한다(유닛 테스트 apps/web/test/browse.test.ts — 10-19 D101). 처음 보는 조직의 모델은
 *   add-model(신모델 자동 추가 ① 포함)이 조직 정보 API 의 fullname 을 위 규칙대로 정리해 블록 끝에 한 줄 넣는다(scripts/add-model.ts).
 */
export const MODEL_MAKERS: Readonly<Record<string, string>> = {
  'meta-llama': 'Meta Llama',
  Qwen: 'Qwen',
  openai: 'OpenAI',
  google: 'Google',
  microsoft: 'Microsoft',
  mistralai: 'Mistral AI',
  'deepseek-ai': 'DeepSeek',
  'LGAI-EXAONE': 'LG AI Research',
  kakaocorp: 'Kakao Corp.',
  'naver-hyperclovax': 'HyperCLOVA X',
  upstage: 'Upstage',
  openbmb: 'OpenBMB',
  'ibm-granite': 'IBM Granite',
  XHToken: 'SparkLLM',
  poolside: 'Poolside',
  nvidia: 'NVIDIA',
  LiquidAI: 'Liquid AI',
  inclusionAI: 'inclusionAI',
  'meta-models': 'Meta Inc.', // add-model 2026-10-20 — https://huggingface.co/api/organizations/meta-models/overview
  JetBrains: 'JetBrains', // add-model 2026-10-20 — https://huggingface.co/api/organizations/JetBrains/overview
  'Aleph-Alpha': 'Aleph Alpha', // add-model 2026-10-20 — https://huggingface.co/api/organizations/Aleph-Alpha/overview
  IFM: 'Institute of Foundation Models', // add-model 2026-10-21 — https://huggingface.co/api/organizations/IFM/overview
  Nanbeige: 'Nanbeige LLM Lab', // add-model 2026-10-21 — https://huggingface.co/api/organizations/Nanbeige/overview
};

/** `hfId` → Hugging Face 조직 id ("Qwen/Qwen3-8B" → "Qwen") */
export const hfOrgOf = (hfId: string): string => hfId.split('/')[0] ?? hfId;

/** 표시 이름 — 레지스트리에 없으면 조직 id */
export function modelMaker(hfId: string): string {
  const org = hfOrgOf(hfId);
  return MODEL_MAKERS[org] ?? org;
}
