/**
 * 한글 모델 이름 레지스트리 (10-16 D94) — 한국 사용자가 한글로도 검색하는 모델 계열의 한글 표기. 의존성 0: export 테스트(저장소 루트)도 읽는다.
 *
 * - 근거: 10-16 자동완성 조사(네이버·구글·다음·빙 제안어 3,855개). 젬마(강함)·엑사원(네이버에선 영문보다 많다)·딥시크("딥시크 로컬")·
 *   라마("라마 3.x" 꼴로만)·하이퍼클로바X·카나나·솔라·미스트랄. **Qwen 은 넣지 않는다** — 큐웬·큐원은 네이버에서 안경·설탕 상표와 겹친다.
 * - 한국어 페이지에만, 페이지마다 한 번 쓴다(키워드 나열·반복은 네이버·구글이 벌점을 준다): 모델 허브 `<title>`·H1·설명의
 *   "Gemma 4 26B-A4B(젬마 4)" 꼴(본문에선 H1 한 번), 콤보 본문의 모델 허브 링크 한 번(`components/adjacent-links.tsx`).
 *   콤보 `<title>` 에는 넣지 않는다 — 지금 구글에서 순위가 붙은 제목이라 배치 2 를 열 때 한 번에 바꾼다.
 * - 키 = `data/models.json` 의 `family`(새 모델은 `familyOf` 가 이름 첫 단어로 정한다). `latin` = 영문 이름이 시작하는 계열 단어,
 *   `ko` = 한글 표기, `versioned` = 이름에 버전 번호가 있을 때만 쓴다(라마 — "라마"만으로는 찾지 않는다).
 * - Ollama 의 한글 표기(올라마)는 모델 계열이 아니라 도구 이름이라 messages(`Snippet.ollamaTitle`)에 둔다.
 * - 표시 조립은 `lib/search-names.ts`.
 */

export type KoFamilyName = { readonly latin: string; readonly ko: string; readonly versioned?: boolean };

export const KO_FAMILY_NAMES: Readonly<Record<string, KoFamilyName>> = {
  gemma: { latin: 'Gemma', ko: '젬마' },
  exaone: { latin: 'EXAONE', ko: '엑사원' },
  deepseek: { latin: 'DeepSeek', ko: '딥시크' },
  llama: { latin: 'Llama', ko: '라마', versioned: true },
  hyperclova: { latin: 'HyperCLOVA X', ko: '하이퍼클로바X' },
  kanana: { latin: 'Kanana', ko: '카나나' },
  solar: { latin: 'Solar', ko: '솔라' },
  mistral: { latin: 'Mistral', ko: '미스트랄' },
};

/** 계열 단어 바로 뒤의 버전 토큰 — "4", "3.1", "4.0", "R1" (크기 "12B"·이름 "Small"·"SEED" 는 아니다) */
const VERSION = /^R?\d+(?:\.\d+)?$/;

/**
 * 영문 모델 이름 → 한글 계열 이름. "Gemma 4 26B-A4B" → "젬마 4", "DeepSeek R1 Distill Qwen 32B" → "딥시크 R1",
 * "HyperCLOVA X SEED 1.5B" → "하이퍼클로바X", "Mistral Small 3.2 24B" → "미스트랄".
 * 레지스트리 밖 계열, 이름이 계열 단어로 시작하지 않는 모델, 버전이 필요한데 없는 모델은 undefined
 */
export function koFamilyName(model: { readonly name: string; readonly family: string }): string | undefined {
  const entry = KO_FAMILY_NAMES[model.family];
  if (!entry || !model.name.startsWith(`${entry.latin} `)) return undefined;
  const next = model.name.slice(entry.latin.length + 1).split(' ')[0] ?? '';
  if (VERSION.test(next)) return `${entry.ko} ${next}`;
  return entry.versioned ? undefined : entry.ko;
}
