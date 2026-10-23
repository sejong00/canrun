/**
 * 검색에 쓰이는 다른 이름 (10-16 D94) — 서버 전용(허브·콤보 페이지). 클라이언트 번들이 읽는 `phrases.ts` 와 따로 둔다.
 *
 * - 모델: 한국어 페이지에서 한글로도 찾는 계열이면 "Gemma 4 26B-A4B(젬마 4)" (`content/ko-names.ts` — 쓰는 자리와 횟수 규칙도 거기).
 * - GPU: 허브 사양의 "다른 표기" 줄 — `data/gpus.json` `aliases`(계산기 GPU 선택이 쓰는 소문자 검색어)를 제품 표기 대소문자로.
 * - Apple 칩: 허브 제목·H1·설명의 맥 제품 이름 (10-16 D97) — "맥미니 m4 16gb llm"처럼 칩보다 제품+메모리로 찾는다.
 *   `data/gpus.json` `products`(애플 사양 페이지로 확인한 모델)의 계열을 messages `MacProduct` 이름으로. 콤보 제목에는 넣지 않는다(D94 와 같은 이유).
 */
import { MAC_LINES, type Gpu, type MacLine, type Model } from '@canrun/data';
import { koFamilyName } from '@/content/ko-names';
import type { Translate } from './phrases';

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
  // DGX Spark OEM 판 제품 이름 (10-23 D117)
  'ascent',
  'dell',
  'nano',
  'lenovo',
  'acer',
  'veriton',
  // NVIDIA RTX PRO 6000 Blackwell 제품 이름 (10-23 D120)
  'blackwell',
  'workstation',
  'edition',
]);

/** 대소문자가 섞인 제품 표기 — 첫 글자 대문자·전부 대문자 규칙에 맞지 않는 단어 (10-23 D117 — DGX Spark OEM 판) */
const MIXED_CASE: Readonly<Record<string, string>> = {
  with: 'with',
  thinkstation: 'ThinkStation',
  edgexpert: 'EdgeXpert',
  g1n: 'G1n',
  // RTX PRO 6000 Blackwell Max-Q Workstation Edition (10-23 D120)
  'max-q': 'Max-Q',
};

/** 소문자 별칭 하나 → 표기 ("5070ti" → "5070Ti", "4070tis" → "4070TiS", "ryzen ai max 395" → "Ryzen AI Max 395", "lenovo thinkstation pgx" → "Lenovo ThinkStation PGX") */
export function aliasLabel(alias: string): string {
  return alias
    .split(' ')
    .map((word, i, words) =>
      // NVIDIA 전문가용 'RTX PRO' 는 전부 대문자 (10-23 D120) — 다른 자리의 pro 는 Apple 'M4 Pro' 처럼 첫 글자만
      word === 'pro' && words[i - 1] === 'rtx'
        ? 'PRO'
        : (MIXED_CASE[word] ??
          (CAPITALIZED.has(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word.toUpperCase().replace(/(\d)TI(S?)$/, '$1Ti$2'))),
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

/** 이 칩이 들어가는 맥 계열 — `MAC_LINES` 순서, 같은 계열(13·15형 맥북 에어 등)은 한 번. `ramGB` 를 주면 그 메모리로 파는 계열만 */
export function macLines(gpu: Pick<Gpu, 'products'>, ramGB?: number): MacLine[] {
  const lines = new Set(
    (gpu.products ?? []).filter((p) => ramGB === undefined || p.memoryGB.includes(ramGB)).map((p) => p.line),
  );
  return MAC_LINES.filter((line) => lines.has(line));
}

/** 계열별 메모리 구성 — 허브 사양 "이 칩이 들어간 맥" 줄. 같은 계열 모델들(아이맥 2포트·4포트 등)의 합집합, 오름차순 */
export function macLineMemory(gpu: Pick<Gpu, 'products'>): Array<{ line: MacLine; memoryGB: number[] }> {
  return macLines(gpu).map((line) => ({
    line,
    memoryGB: [...new Set((gpu.products ?? []).filter((p) => p.line === line).flatMap((p) => p.memoryGB))].sort((a, b) => a - b),
  }));
}

/** 계열 이름 나열 — "맥 미니·맥북 에어" / "Mac mini, MacBook Air" (`tMac` = messages `MacProduct`) */
export function macLineList(tMac: Translate, lines: readonly MacLine[]): string {
  return lines.map((line) => tMac(line)).join(tMac('separator'));
}

/**
 * GPU 허브 제목·H1 의 이름 — Apple 칩이면 맥 계열을 붙인다: "Apple M4(맥 미니·맥북 에어·맥북 프로·아이맥)" /
 * "Apple M4 (Mac mini, MacBook Air, MacBook Pro, iMac)". 이름이 이미 괄호로 끝나면("Apple M4 Max (40-core GPU)") 그 괄호 안에 잇는다
 * ("Apple M4 Max (40-core GPU, 맥북 프로·맥 스튜디오)"). 제품이 없는 GPU 는 이름 그대로
 */
export function gpuSearchName(tMac: Translate, name: string, gpu: Pick<Gpu, 'products'>): string {
  const lines = macLines(gpu);
  if (lines.length === 0) return name;
  const products = macLineList(tMac, lines);
  const detail = /^(.*\S) \(([^()]+)\)$/.exec(name);
  return detail
    ? tMac('nameWithProductsDetail', { chip: detail[1]!, detail: detail[2]!, products })
    : tMac('nameWithProducts', { gpu: name, products });
}
