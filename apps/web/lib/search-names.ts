/**
 * 검색에 쓰이는 다른 이름 (10-16 D94) — 서버 전용(허브·콤보 페이지). 클라이언트 번들이 읽는 `phrases.ts` 와 따로 둔다.
 *
 * - 모델: 한국어 페이지에서 한글로도 찾는 계열이면 "Gemma 4 26B-A4B(젬마 4)" (`content/ko-names.ts` — 쓰는 자리와 횟수 규칙도 거기).
 * - GPU: 허브 사양의 "다른 표기" 줄 — `data/gpus.json` `aliases`(계산기 GPU 선택이 쓰는 소문자 검색어)를 제품 표기 대소문자로.
 */
import type { Gpu, Model } from '@canrun/data';
import { koFamilyName } from '@/content/ko-names';

/** 모델 허브 제목·H1·설명, 콤보의 모델 허브 링크에 쓰는 이름 — en 은 이름 그대로 */
export function searchModelName(locale: string, model: Pick<Model, 'name' | 'family'>): string {
  const ko = locale === 'ko' ? koFamilyName(model) : undefined;
  return ko ? `${model.name}(${ko})` : model.name;
}

/** 첫 글자만 대문자로 쓰는 단어 — 나머지 토큰은 전부 대문자(RTX5090·9070XT·16GB·B580·M4·GB10·AI) */
const CAPITALIZED = new Set([
  'ti',
  'super',
  'laptop',
  'mobile',
  'pro',
  'max',
  'ultra',
  'arc',
  'strix',
  'halo',
  'ryzen',
  'radeon',
  'framework',
  'desktop',
  'spark',
]);

/** 소문자 별칭 하나 → 표기 ("5070ti" → "5070Ti", "4070tis" → "4070TiS", "ryzen ai max 395" → "Ryzen AI Max 395") */
export function aliasLabel(alias: string): string {
  return alias
    .split(' ')
    .map((word) =>
      CAPITALIZED.has(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word.toUpperCase().replace(/(\d)TI(S?)$/, '$1Ti$2'),
    )
    .join(' ');
}

/**
 * GPU 허브 "다른 표기" — 데이터 순서 그대로, 같은 표기는 한 번. CPU 프로필은 빈 목록: 별칭("ddr5"·"cpu only")이
 * 제품 이름의 다른 표기가 아니라 계산기 검색어다
 */
export function gpuAliasLabels(gpu: Pick<Gpu, 'kind' | 'aliases'>): string[] {
  if (gpu.kind === 'cpu') return [];
  return [...new Set(gpu.aliases.map(aliasLabel))];
}
