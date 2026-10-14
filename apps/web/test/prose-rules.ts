/**
 * 손으로 쓴 MDX 산문 검사 공용 규칙 — 가이드(`guides.test.ts`, D43)와 업데이트 소식(`updates.test.ts`, D72 — AUTHORING §9 "산문 숫자 규칙은 여기도 같다").
 * 테스트 파일이 아니라 vitest include(`*.test.ts`) 밖이다.
 */

/** 산문(코드 스팬·컴포넌트 태그를 뺀 텍스트)에 쓰면 안 되는 것 — D43 숫자는 컴포넌트만, 규칙 2·3 */
export const PROSE_BANS: ReadonlyArray<[RegExp, string]> = [
  [/\d[\d.,]*\s*(?:tok\/s|t\/s|tokens?\/s|토큰\/초)/i, 'speed number in prose (use a data component)'],
  [/\d+\.\d+\s*GB/i, 'decimal GB in prose (use <Num>)'],
  [/\d\s*GiB/i, 'GiB threshold in prose (tool behaviour goes through <RuntimeFact>; memory is decimal GB)'],
  [/\$\s?\d|₩\s?\d|\d[\d,]*\s?원(?![가-힣])/, 'price in prose (use <Price>)'],
  [/\b(?:guaranteed|definitely|will run|runs perfectly|no problem|best GPU|fastest|future-proof)\b/i, 'assertive wording'],
  [/무조건|확실히|완벽하게|문제없이|최고의|끝판왕|사세요/, 'assertive wording (ko)'],
  [/(?:쾌적|원활|겨우 가능|불가)(?:입니다|이고|이며|이라|이지만)|(?:쾌적|원활|겨우 가능|불가) 판정을|판정(?:은|이) (?:쾌적|원활|겨우 가능|불가)/, 'verdict name used as a predicate (ko) — write "쾌적하게 돌아갑니다" (AUTHORING §1)'],
];

export const HANGUL = /[ㄱ-ㆎ가-힣]/;

/** 코드 블록·코드 스팬을 뺀 MDX (식 `{…}` 검사용) */
export function outsideCode(src: string): string {
  return src.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** 산문 검사 대상 — 코드·컴포넌트 태그·링크 URL 을 뺀 텍스트 */
export function proseOf(src: string): string {
  return outsideCode(src).replace(/<\/?[A-Z][^>]*\/?>/g, ' ').replace(/\]\([^)]*\)/g, ']');
}

/** 첫 번째 금지 패턴과 앞뒤 문맥 — 없으면 빈 배열 */
export function proseProblems(prose: string, where: string): string[] {
  const problems: string[] = [];
  for (const [re, why] of PROSE_BANS) {
    const m = re.exec(prose);
    if (m) problems.push(`${where}: ${why} — "${prose.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10).trim()}"`);
  }
  return problems;
}
