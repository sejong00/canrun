/**
 * export 산출물 "사실(facts)" 추출 — D17 lazy facts.
 *
 * `pnpm test:export` 는 3,300여 HTML 을 다룬다. HTML 문자열을 전부 보유하는 대신,
 * beforeAll 에서 페이지마다 `extractPageFacts` 를 한 번 호출해 테스트가 쓰는 사실만
 * 남기고 HTML 은 즉시 폐기한다. 여기의 함수는 전부 순수(파일 I/O 없음) — I/O 는 spec 담당.
 *
 * 문장 단위(D16)는 `UnitTable` 로 인터닝해 페이지당 id 배열만 보유한다.
 */

import { COMPARE_SLUGS } from '../apps/web/content/compares';
import { koFamilyName } from '../apps/web/content/ko-names';
import { STATIC_PAGE_SLUGS } from '../apps/web/content/pages';

export type Locale = 'en' | 'ko';
export type PageKind =
  | 'home'
  | 'gpu'
  | 'model'
  | 'combo'
  | 'calculator'
  | 'guide'
  | 'guides-index'
  | 'static'
  /** 목록 페이지 (10-19) — `/models`·`/gpus` */
  | 'models-index'
  | 'gpus-index'
  /** GPU 비교 (10-19 D106) — `/compare/{a}-vs-{b}`(레지스트리 슬러그만)·목차 `/compare` */
  | 'compare'
  | 'compare-index'
  | 'other';

export type GpuRecord = {
  id: string;
  name: string;
  aliases?: string[];
  kind?: 'dgpu' | 'unified' | 'cpu';
  ramOptionsGB?: number[];
  /** Apple 칩이 들어가는 맥(10-16 D97) — 허브 제목·H1·설명 검사용 */
  products?: Array<{ line: string; memoryGB: number[] }>;
};
export type ModelRecord = { id: string; name: string; family?: string };

export type PageFacts = {
  /** out/ 기준 상대 파일 경로 (posix) */
  file: string;
  /** 사이트 URL 경로 (`/`, `/ko`, `/gpu/rtx-4060`, `/ko/can-i-run/qwen3-14b/on/rtx-4060` …) */
  urlPath: string;
  locale: Locale;
  kind: PageKind;
  /** 콤보 페이지면 URL 에서 읽은 ids */
  combo?: { modelId: string; gpuId: string };
  /** `<html lang>` */
  lang?: string;
  title?: string;
  /** meta description (엔티티 디코딩) */
  description?: string;
  ogDescription?: string;
  canonical?: string;
  hreflang: Record<string, string>;
  /** 파싱된 JSON-LD 블록 — 파싱 실패는 `jsonLdError` 에 기록 (테스트가 단언) */
  jsonLd: Array<Record<string, unknown>>;
  jsonLdError?: string;
  /** 화면의 FAQ ([data-faq-question]/[data-faq-answer]) — JSON-LD 와 동일 문자열이어야 한다 */
  faq: Array<{ question: string; answer: string }>;
  /** `<a href="/…">` 내부 링크 전부 (localeSwitch = `data-locale-switch` 보유) */
  links: Array<{ href: string; localeSwitch: boolean }>;
  /** `href="/en"` · `href="/en/…"` 출현 수 (HTML 전체) */
  enPrefixedLinkCount: number;
  /** 가시 텍스트의 한글 어절 — en 페이지만 수집 (ko 는 빈 배열) */
  hangulWords: string[];
  /**
   * 규칙 3 검사 대상 문장: description · og:description · FAQ 답 · [data-verdict-sentence] ·
   * [data-alt-card] · 콤보 페이지의 `<dd>` · GPU 비교 속도 요약의 문장 단위 (허브·비교 페이지의 판정 범례 `<dd>` 는
   * 임계값 "20 tok/s or more" 를 밴드 없이 인용하는 정책 문장이라 제외)
   */
  speedTexts: string[];
  /**
   * 실측 라벨 표기 결함 (D46): 0폭 밴드("38.1–38.1") 옆 실측 라벨, 빈 측정 컨텍스트("measured (1 run,  context)").
   * 헤드라인 실측 값을 추정치 자리에 넣으면 생긴다 — 가시 텍스트 전체에서 찾는다
   */
  measuredLabelIssues: string[];
  /** `<meta name="robots">` 에 noindex 포함 */
  robotsNoindex: boolean;
  h1Count: number;
  /** GPU 허브의 h1 텍스트 — Apple 칩 허브의 맥 제품 이름 검사(10-16 D97) */
  hubH1?: string;
  verdictSentence?: string;
  /** `[data-live-summary]` SSR 텍스트 — 상호작용 전엔 비어 있어야 한다 (D28) */
  liveSummary?: string;
  /** `a[data-adjacent]` href */
  adjacentHrefs: string[];
  /** `a[data-combo-link]` href (허브·가이드 그리드의 판정 링크, 홈 "많이 찾는 조합", 가이드 ComboLink, GPU 비교 표) */
  comboLinkHrefs: string[];
  /** `a[data-compare-link]` href — GPU 허브의 "다른 기기와 비교" 블록 (10-19 D106, 게시 쌍만) */
  compareLinkHrefs: string[];
  /** GPU 비교 페이지면 URL 의 슬러그 (레지스트리 슬러그만 — kindOf 와 같은 규칙) */
  compareSlug?: string;
  /** 계산기 서버 렌더 예시(10-14 D73): `[data-start-gpu]` 하드웨어 id(문서 순서) · `a[data-start-pick]` 모델 링크 href(공개 콤보 또는 모델 허브) */
  startGpuIds: string[];
  startPickHrefs: string[];
  /** `figure[data-snippet]` 의 `pre code` 텍스트 */
  snippets: Array<{ kind: string; text: string }>;
  /** `[data-no-run]` — 어떤 구성으로도 실행 명령을 만들 수 없는 콤보(미탑재 + RAM 힌트 없음) */
  noRun: boolean;
  /**
   * 메모리 용량별 판정 행 `[data-ram-step]` (통합·CPU 는 메모리 옵션, dGPU 는 시스템 RAM 계단 — 10-03 D64):
   * verdict = 행 배지(기준 양자화), displayVerdict·quant·fits = 표시 양자화
   */
  ramSteps: Array<{ ram: number; verdict: string; displayVerdict: string; quant: string; fits: boolean; assumed: boolean; commands: boolean }>;
  /** `[data-ram-caption]` 값 ('verdict' | 'file') — dGPU RAM 목록 설명의 갈래 */
  ramCaption?: string;
  /** `[data-ram-same]` — RAM 계단에서 맨 위 판정이 같다는 구절 (RAM 목록이 없는 dGPU 콤보) */
  ramSame: boolean;
  /** 헤더 판정 문장의 배지 `[data-verdict-sentence] [data-verdict]` */
  headerVerdict?: string;
  /** D15 — GPU명 마스킹 후 숫자 토큰 다중집합 (정렬, `|` 결합). 콤보 페이지만 */
  numberFingerprint: string;
  /** D16 — 마스킹된 문장 단위의 인터닝 id (중복 포함, 8자 미만 제외). 콤보 페이지만 */
  textUnitIds: number[];
  /** 보유 단위의 글자 수 합 (비율의 분모) */
  textChars: number;
  /** `<form action>` 전부 (홈 GET 폼·계산기 폼 — P1-3) */
  formActions: string[];
  /**
   * 계산기 위젯 `form[data-calc-widget]`(홈·가이드 D45 · 상세 페이지 10-19 D107) — action(엔티티 디코딩)·홈 폼 여부·숨은 입력(name → value)·
   * GPU 칸(`#…-gpu`)의 SSR 값(미리 고른 GPU 의 표시명, 없으면 '')
   */
  calcWidgetForms: Array<{ action: string; home: boolean; hidden: Record<string, string>; gpuText: string }>;
  /** 위젯 아래 딥 링크 `a[data-calc-deep-link]` — kind(값)·href(엔티티 디코딩), 문서 순서 (10-19 D107) */
  calcDeepLinks: Array<{ kind: string; href: string }>;
  /** 첫 `<datalist>` 의 `<option>` 수 */
  datalistOptionCount: number;
  /** P1-3 마커: `[data-calculator]` · `form[data-calc-form]` · `input[list]` · `[data-result-card]` 수 · `[data-ctx-controls]` · `[data-sort-control]` */
  markers: {
    calculator: boolean;
    calcForm: boolean;
    inputList: boolean;
    resultCards: number;
    ctxControls: boolean;
    sortControl: boolean;
    navCalculator?: string;
    openCalculator?: string;
    /** P1-4: 헤더 `a[data-nav-guides]` href (published 가이드 ≥1 일 때만 렌더) */
    navGuides?: string;
    /** 10-19: 헤더 `a[data-nav-models]`·`a[data-nav-gpus]` href (목록 페이지) */
    navModels?: string;
    navGpus?: string;
    /** 10-19: 목록 페이지 정렬·거르기 아일랜드 `[data-list-controls="models|gpus"]` 의 값 */
    listControls?: string;
    /** `form[data-calc-widget]` 수 (홈·가이드 — D45, 콤보·허브·GPU 비교 — 10-19 D107) */
    calcWidgets: number;
    /** `[data-guide-data]` 수 — 가이드 자체 데이터 인용 (AC, D42) */
    guideData: number;
    /** `[data-guide-draft]` 초안 안내 */
    guideDraft: boolean;
    /** `[data-guides-empty]` 목차 빈 상태 */
    guidesEmpty: boolean;
    /** `[data-compares-empty]` GPU 비교 목차 빈 상태 (10-19 D106) */
    comparesEmpty: boolean;
    /** `[data-compare-summary]` GPU 비교 속도 요약 유무 · 소개글 `[data-compare-intro]` 문단 수(없으면 0) */
    compareSummary: boolean;
    compareIntroParagraphs: number;
    /** `fieldset[data-ram-toggle]` — 콤보 아일랜드의 시스템 RAM 토글 (10-03 D64) */
    ramToggle: boolean;
    /** 모델 허브 `a[data-calc-model-link]` href — 엔티티(`&amp;`) 디코딩 (계산기 모델 모드, 10-03 D65) */
    calcModelLink?: string;
    /** 가이드 본문·허브 소개글·모델 소개·GPU 비교 소개글 안 `<p>` 속 블록 요소 수 (하이드레이션 불일치 원인 — 0 이어야 한다) */
    blockInParagraph: number;
    /** 허브 소개글 `[data-hub-intro]` (10-14 D74) — 문단 `<p>` 수(없으면 0)·소개 안 `[data-guide-data]` 수 */
    hubIntroParagraphs: number;
    hubIntroData: number;
    /**
     * 모델 소개 `[data-model-about]` (10-19 D102) — 문단 `<p>` 수(없으면 0)·소개 안 링크 href(문서 순서)·
     * 허브 소개글(`[data-hub-intro]`)과 모델 정보(`#facts-heading`)보다 앞에 오는지(소개가 없으면 false)
     */
    modelAboutParagraphs: number;
    modelAboutHrefs: string[];
    modelAboutFirst: boolean;
  };
  /** `a[data-related-guide]` href (콤보 → published 가이드, D44) */
  relatedGuideHrefs: string[];
  /** 업데이트 소식(10-14 D72): `[data-update]` 항목 id(문서 순서) · `a[data-added-model]` 카탈로그 추가 목록의 모델 허브 href */
  updateIds: string[];
  addedModelHrefs: string[];
  /**
   * 목록 페이지(10-19): 표 행 `a[data-browse-model]`·`a[data-browse-gpu]` href(문서 순서), 표 행(`tr[data-model-id]`·`tr[data-gpu-id]`, 문서 순서 —
   * id 와 여는 태그의 data-* 값, 키는 `data-` 를 뗀 이름), 홈의 전체 목록 링크 `a[data-browse-all]` href.
   * 모델 허브 GPU 표 행도 `data-gpu-id` 를 가져 listRows 에 들어간다 — 목록 페이지에서만 쓴다
   */
  browseModelHrefs: string[];
  browseGpuHrefs: string[];
  listRows: Array<{ id: string; data: Record<string, string> }>;
  browseAllHrefs: string[];
  /** `<script src>` 중 nomodule 이 아닌 것 (초기 모듈 스크립트 집합 — D34 예산 게이트) */
  scriptSrcs: string[];
  /** `<link rel="preload|modulepreload">` 가 가리키는 스크립트 */
  preloadSrcs: string[];
  /** `<meta property="og:image">` (D60 허브별 · D96 공개 콤보·게시 가이드별 공유 카드) */
  ogImage?: string;
  /** `<meta name="twitter:image">` — Next 가 og:image 를 이어받는다 (D96 에서 같음을 검사) */
  twitterImage?: string;
  /** 가시 텍스트의 원화 참고 가격 "약 41만 원" 수 · 환산 안내("환율(1달러 1,361원)") 유무 (D61) */
  krwPrices: number;
  krwNote: boolean;
  /**
   * 한글 모델 이름(10-16 D94, `content/ko-names.ts`) — ko 모델 허브·콤보 중 한글 계열 이름이 있는 모델만.
   * `body` = `<body>` 가시 텍스트(관련 가이드 링크 `a[data-related-guide]` 제외 — 가이드 제목은 따로 쓴 글이다) 속 출현 수
   */
  koModelName?: { name: string; title: boolean; description: boolean; h1: boolean; body: number };
  /** Qwen 의 한글 표기(큐웬·큐원)가 제목·설명·가시 텍스트에 있다 — 쓰지 않는다(D94) */
  qwenHangul: boolean;
  /**
   * 모델 허브 "같은 계열의 다른 크기" `[data-model-series]`(10-19) — 표 안 링크 href(문서 순서)·현재 모델 행 `[data-series-current]` 수.
   * 표가 없으면 undefined
   */
  modelSeries?: { hrefs: string[]; currentRows: number };
  /**
   * 외부 도구 사실 `[data-runtime-fact]`(가이드 `<RuntimeFact>`, 10-19) — id·안쪽 링크 href(문서 순서)·텍스트(태그를 공백 없이 뗀 것,
   * "문장 (출처 줄)" 그대로)
   */
  runtimeFacts: Array<{ id: string; hrefs: string[]; text: string }>;
};

// ---------------------------------------------------------------------------
// URL · 경로
// ---------------------------------------------------------------------------

/** 파일 경로 → URL 경로 (trailingSlash:false 규약: foo.html → /foo, dir/index.html → /dir) */
export function toUrlPath(relFile: string): string {
  const posix = relFile.replaceAll('\\', '/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'/index.html'.length)}`;
  return `/${posix.slice(0, -'.html'.length)}`;
}

/** 절대 URL → 경로 (루트는 슬래시 유무 무관하게 '/' 로 정규화) */
export function urlToPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname === '' ? '/' : pathname;
}

export const isKoPath = (urlPath: string): boolean => urlPath === '/ko' || urlPath.startsWith('/ko/');

/** 로케일 프리픽스 제거 (`/ko/gpu/x` → `/gpu/x`, `/ko` → `/`) */
export function stripLocale(urlPath: string): string {
  if (urlPath === '/ko') return '/';
  return isKoPath(urlPath) ? urlPath.slice('/ko'.length) : urlPath;
}

export const localeOf = (urlPath: string): Locale => (isKoPath(urlPath) ? 'ko' : 'en');

const COMBO_RE = /^(?:\/ko)?\/can-i-run\/([^/]+)\/on\/([^/]+)$/;

/** 콤보 URL(`/can-i-run/{model}/on/{gpu}`, `/ko/…`) → ids */
export function comboOf(urlPath: string): { modelId: string; gpuId: string } | undefined {
  const m = COMBO_RE.exec(urlPath);
  return m ? { modelId: m[1]!, gpuId: m[2]! } : undefined;
}

export function comboPath(locale: Locale, modelId: string, gpuId: string): string {
  return `${locale === 'ko' ? '/ko' : ''}/can-i-run/${modelId}/on/${gpuId}`;
}

export function hubPath(locale: Locale, kind: 'gpu' | 'model', id: string): string {
  return `${locale === 'ko' ? '/ko' : ''}/${kind}/${id}`;
}

export function localePath(locale: Locale, bare: string): string {
  if (locale === 'en') return bare;
  return bare === '/' ? '/ko' : `/ko${bare}`;
}

/** GPU 비교 URL(`/compare/{slug}`, `/ko/…`) → 레지스트리 슬러그 (레지스트리 밖이면 undefined) */
export function compareSlugOf(urlPath: string): string | undefined {
  const slug = /^(?:\/ko)?\/compare\/([^/]+)$/.exec(urlPath)?.[1];
  return slug !== undefined && (COMPARE_SLUGS as readonly string[]).includes(slug) ? slug : undefined;
}

export function kindOf(urlPath: string): PageKind {
  const bare = stripLocale(urlPath);
  if (bare === '/') return 'home';
  if (bare === '/calculator') return 'calculator';
  if (/^\/gpu\/[^/]+$/.test(bare)) return 'gpu';
  if (/^\/model\/[^/]+$/.test(bare)) return 'model';
  if (COMBO_RE.test(bare)) return 'combo';
  if (bare === '/guides') return 'guides-index';
  if (bare === '/models') return 'models-index';
  if (bare === '/gpus') return 'gpus-index';
  if (/^\/guides\/[^/]+$/.test(bare)) return 'guide';
  if (bare === '/compare') return 'compare-index';
  if (compareSlugOf(urlPath) !== undefined) return 'compare';
  if ((STATIC_PAGE_SLUGS as readonly string[]).includes(bare.slice(1))) return 'static';
  return 'other';
}

// ---------------------------------------------------------------------------
// HTML 텍스트 헬퍼
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script[\s\S]*?<\/script>/g;
const STYLE_RE = /<style[\s\S]*?<\/style>/g;
const TAG_RE = /<[^>]+>/g;
export const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]+/g;

export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** D46 — 실측 라벨 표기 결함 패턴 (en/ko). 공백 정규화된 가시 텍스트를 받는다 */
const MEASURED_LABEL_ISSUES: readonly RegExp[] = [
  // 0폭 밴드 바로 뒤 실측 라벨 — 실측값이 추정 밴드 자리에 들어간 것
  /(\d[\d.,]*)–\1, (?:measured|실측)/g,
  // 측정 컨텍스트가 빈 라벨
  /measured \(\d+ runs?, context\)/g,
  /measured at context/g,
  /실측 \d+건 \( ?컨텍스트\)/g,
  /\( ?컨텍스트, \d+건/g,
];

export function measuredLabelIssuesOf(text: string): string[] {
  const out: string[] = [];
  for (const re of MEASURED_LABEL_ISSUES) for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

/** 스크립트·스타일을 뺀 가시 텍스트 (RSC 인라인 페이로드 제외). 공백은 보존 */
export function visibleText(html: string): string {
  return decodeEntities(html.replace(SCRIPT_RE, ' ').replace(STYLE_RE, ' ').replace(TAG_RE, ' '));
}

/** 요소 내부 HTML → 태그 제거·엔티티 디코딩·공백 정규화 텍스트 */
export function elementText(inner: string): string {
  return decodeEntities(inner.replace(TAG_RE, ' ')).replace(/\s+/g, ' ').trim();
}

export function extractHreflangs(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of html.match(/<link\b[^>]*rel="alternate"[^>]*>/g) ?? []) {
    const hreflang = tag.match(/hreflang="([^"]+)"/i)?.[1];
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (hreflang && href) map[hreflang] = href;
  }
  return map;
}

export function extractCanonical(html: string): string | undefined {
  return html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
}

function metaContent(html: string, selector: RegExp): string | undefined {
  const raw = html.match(selector)?.[1];
  return raw === undefined ? undefined : decodeEntities(raw);
}

function robotsNoindexOf(html: string): boolean {
  for (const tag of html.match(/<meta\b[^>]*\bname="robots"[^>]*>/g) ?? []) {
    const content = tag.match(/content="([^"]*)"/)?.[1] ?? '';
    if (/\bnoindex\b/i.test(content)) return true;
  }
  return false;
}

/** 화면 FAQ — JSON-LD 동일성 검사에 쓰므로 태그 제거 없이 엔티티만 디코딩 (P1-1 의미 유지) */
export function visibleFaq(html: string): Array<{ question: string; answer: string }> {
  const questions = [...html.matchAll(/<h3[^>]*data-faq-question[^>]*>([\s\S]*?)<\/h3>/g)].map((m) =>
    decodeEntities(m[1]!),
  );
  const answers = [...html.matchAll(/<p[^>]*data-faq-answer[^>]*>([\s\S]*?)<\/p>/g)].map((m) =>
    decodeEntities(m[1]!),
  );
  return questions.map((question, i) => ({ question, answer: answers[i] ?? '' }));
}

/** 여는 태그가 `attr` 속성을 갖는지 (`data-x`, `data-x="true"`, `data-x=""` 모두) */
function hasAttr(openTag: string, attr: string): boolean {
  return new RegExp(`\\s${attr}(?=[\\s=>/])`).test(openTag);
}

/**
 * `contentStart` 부터 같은 이름의 태그 중첩을 세어 닫는 태그 위치를 찾는다 (React SSR 출력은 정형).
 * 닫는 태그가 없으면 끝까지.
 */
function innerHtmlFrom(html: string, tag: string, contentStart: number): string {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = contentStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] === '/') {
      depth -= 1;
      if (depth === 0) return html.slice(contentStart, m.index);
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return html.slice(contentStart);
}

type AttrElement = { tag: string; openTag: string; inner: string };

/** `attr` 속성을 가진 요소 전부 (중첩 안전) */
function elementsWithAttr(html: string, attr: string): AttrElement[] {
  const found: AttrElement[] = [];
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*?\\s${attr}(?=[\\s=>/])[^>]*>`, 'g');
  for (const m of html.matchAll(re)) {
    const openTag = m[0];
    const tag = m[1]!.toLowerCase();
    const contentStart = m.index + openTag.length;
    found.push({
      tag,
      openTag,
      inner: openTag.endsWith('/>') ? '' : innerHtmlFrom(html, tag, contentStart),
    });
  }
  return found;
}

function attrValue(openTag: string, attr: string): string | undefined {
  return openTag.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1];
}

/** `<p>` 안에 블록 요소가 열린 횟수 — 브라우저가 `<p>` 를 닫아 DOM 이 서버 트리와 어긋난다(하이드레이션 오류) */
function blockInParagraphCount(html: string): number {
  let count = 0;
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)(p|div|table|ul|ol|figure|section|dl|pre|blockquote|h[1-6])\b[^>]*>/g)) {
    const closing = m[1] === '/';
    const tag = m[2]!;
    if (tag === 'p') depth = closing ? Math.max(0, depth - 1) : depth + 1;
    else if (!closing && depth > 0) count += 1;
  }
  return count;
}

/** D16 문장 단위 요소 */
const UNIT_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'td', 'th', 'dt', 'dd', 'caption', 'figcaption', 'code',
]);

/**
 * 관심 태그 요소들의 내부 HTML 을 한 번의 스캔으로 수집 (스택 기반 — `li` 안의 `li`,
 * `td` 안의 `code` 같은 중첩에서도 각 요소가 제 내용을 갖는다).
 */
function collectElements(html: string, tags: ReadonlySet<string>): Array<{ tag: string; inner: string }> {
  const found: Array<{ tag: string; inner: string }> = [];
  const stack: Array<{ tag: string; start: number }> = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const tag = m[2]!.toLowerCase();
    if (!tags.has(tag)) continue;
    if (m[1] !== '/') {
      if (!m[0].endsWith('/>')) stack.push({ tag, start: m.index + m[0].length });
      continue;
    }
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]!.tag !== tag) continue;
      found.push({ tag, inner: html.slice(stack[i]!.start, m.index) });
      stack.length = i;
      break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 이름 마스킹 · 숫자 지문 (D15 · D16)
// ---------------------------------------------------------------------------

/** 제목용 짧은 GPU명 — apps/web/lib/phrases.ts `shortGpuName` 과 같은 규칙(마스킹용 사본) */
export function shortGpuName(name: string): string {
  return name
    .replace(/^(?:GeForce|Radeon|Intel|NVIDIA|Apple)\s+/, '')
    .replace(/\s*\((\d+)-core GPU\)/, ' $1-core')
    .replace(/\s*\([^)]*\)/, '')
    .replace(/\s+(?:dual-channel|듀얼채널)\s+CPU$/, ' CPU');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 패턴 목록 → 대소문자 무시 대체 정규식 (긴 패턴 우선 — 부분 잔재 방지) */
export function maskRegExp(patterns: readonly string[]): RegExp | undefined {
  const unique = [...new Set(patterns.map((p) => p.trim()).filter((p) => p !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  return unique.length === 0 ? undefined : new RegExp(unique.map(escapeRegExp).join('|'), 'gi');
}

/** GPU 를 가리키는 모든 표기: name · id · aliases · shortGpuName · messages GpuName 오버라이드 */
export function gpuMaskPatterns(gpu: GpuRecord, overrides: readonly string[]): string[] {
  const names = [gpu.name, ...overrides];
  return [gpu.id, ...(gpu.aliases ?? []), ...names, ...names.map(shortGpuName)];
}

export function maskAll(text: string, masks: ReadonlyArray<RegExp | undefined>): string {
  return masks.reduce<string>((acc, re) => (re ? acc.replace(re, '#') : acc), text);
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

/** 숫자 토큰 다중집합 지문 (정렬 후 `|` 결합) */
export function numberFingerprint(text: string): string {
  return (text.match(NUMBER_RE) ?? []).sort().join('|');
}

/** D16 — 8자 미만 단위는 분자·분모 모두에서 제외 */
export const MIN_UNIT_CHARS = 8;

export type UnitTable = {
  intern(text: string): number;
  text(id: number): string;
  readonly size: number;
};

export function createUnitTable(): UnitTable {
  const ids = new Map<string, number>();
  const texts: string[] = [];
  return {
    intern(text) {
      let id = ids.get(text);
      if (id === undefined) {
        id = texts.length;
        ids.set(text, id);
        texts.push(text);
      }
      return id;
    },
    text: (id) => texts[id] ?? '',
    get size() {
      return texts.length;
    },
  };
}

// ---------------------------------------------------------------------------
// 추출 컨텍스트 · 추출기
// ---------------------------------------------------------------------------

export type FactsContext = {
  gpuById: ReadonlyMap<string, GpuRecord>;
  modelById: ReadonlyMap<string, ModelRecord>;
  gpuMask(gpuId: string): RegExp | undefined;
  modelMask(modelId: string): RegExp | undefined;
  units: UnitTable;
};

export function createFactsContext(input: {
  gpus: readonly GpuRecord[];
  models: readonly ModelRecord[];
  /** `messages/{en,ko}.json` 의 `GpuName` 네임스페이스들 (id → 표시명) */
  gpuNameOverrides: ReadonlyArray<Record<string, string>>;
}): FactsContext {
  const gpuById = new Map(input.gpus.map((g) => [g.id, g]));
  const modelById = new Map(input.models.map((m) => [m.id, m]));
  const gpuMasks = new Map<string, RegExp | undefined>();
  const modelMasks = new Map<string, RegExp | undefined>();
  return {
    gpuById,
    modelById,
    gpuMask(gpuId) {
      if (!gpuMasks.has(gpuId)) {
        const gpu = gpuById.get(gpuId);
        const overrides = input.gpuNameOverrides.flatMap((ns) => (ns[gpuId] ? [ns[gpuId]] : []));
        gpuMasks.set(gpuId, gpu ? maskRegExp(gpuMaskPatterns(gpu, overrides)) : undefined);
      }
      return gpuMasks.get(gpuId);
    },
    modelMask(modelId) {
      if (!modelMasks.has(modelId)) {
        const model = modelById.get(modelId);
        modelMasks.set(modelId, model ? maskRegExp([model.name, model.id]) : undefined);
      }
      return modelMasks.get(modelId);
    },
    units: createUnitTable(),
  };
}

const HREF_RE = /href="(\/[^"/][^"]*|\/)"/;

/** HTML 한 장 → PageFacts. 호출 뒤 `html` 은 버려도 된다 */
export function extractPageFacts(html: string, file: string, ctx: FactsContext): PageFacts {
  const urlPath = toUrlPath(file);
  const locale = localeOf(urlPath);
  const kind = kindOf(urlPath);
  const combo = comboOf(urlPath);

  const noScript = html.replace(SCRIPT_RE, ' ').replace(STYLE_RE, ' ');
  const visible = decodeEntities(noScript.replace(TAG_RE, ' '));

  const jsonLd: Array<Record<string, unknown>> = [];
  let jsonLdError: string | undefined;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      jsonLd.push(JSON.parse(m[1]!) as Record<string, unknown>);
    } catch (error) {
      jsonLdError ??= `${file}: JSON-LD parse error — ${String(error)}`;
    }
  }

  const links: PageFacts['links'] = [];
  const adjacentHrefs: string[] = [];
  const comboLinkHrefs: string[] = [];
  const compareLinkHrefs: string[] = [];
  const startPickHrefs: string[] = [];
  let navCalculator: string | undefined;
  let openCalculator: string | undefined;
  let navGuides: string | undefined;
  let navModels: string | undefined;
  let navGpus: string | undefined;
  let calcModelLink: string | undefined;
  const browseModelHrefs: string[] = [];
  const browseGpuHrefs: string[] = [];
  const browseAllHrefs: string[] = [];
  const relatedGuideHrefs: string[] = [];
  const addedModelHrefs: string[] = [];
  const calcDeepLinks: PageFacts['calcDeepLinks'] = [];
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    const href = tag.match(HREF_RE)?.[1];
    if (!href) continue;
    links.push({ href, localeSwitch: hasAttr(tag, 'data-locale-switch') });
    if (hasAttr(tag, 'data-adjacent')) adjacentHrefs.push(href);
    if (hasAttr(tag, 'data-combo-link')) comboLinkHrefs.push(href);
    if (hasAttr(tag, 'data-compare-link')) compareLinkHrefs.push(href);
    if (hasAttr(tag, 'data-start-pick')) startPickHrefs.push(href);
    if (hasAttr(tag, 'data-nav-calculator')) navCalculator = href;
    if (hasAttr(tag, 'data-open-calculator')) openCalculator = href;
    if (hasAttr(tag, 'data-nav-guides')) navGuides = href;
    if (hasAttr(tag, 'data-nav-models')) navModels = href;
    if (hasAttr(tag, 'data-nav-gpus')) navGpus = href;
    if (hasAttr(tag, 'data-browse-model')) browseModelHrefs.push(href);
    if (hasAttr(tag, 'data-browse-gpu')) browseGpuHrefs.push(href);
    if (hasAttr(tag, 'data-browse-all')) browseAllHrefs.push(href);
    if (hasAttr(tag, 'data-calc-model-link')) calcModelLink = decodeEntities(href);
    if (hasAttr(tag, 'data-related-guide')) relatedGuideHrefs.push(href);
    if (hasAttr(tag, 'data-added-model')) addedModelHrefs.push(href);
    if (hasAttr(tag, 'data-calc-deep-link')) calcDeepLinks.push({ kind: attrValue(tag, 'data-calc-deep-link') ?? '', href: decodeEntities(href) });
  }
  const formActions = [...html.matchAll(/<form\b[^>]*\baction="([^"]*)"/g)].map((m) => decodeEntities(m[1]!));
  // 계산기 위젯(10-19 D107) — 숨은 입력과 GPU 칸의 SSR 값 (datalist 의 <option> 은 <input> 이 아니라 섞이지 않는다)
  const calcWidgetForms = elementsWithAttr(noScript, 'data-calc-widget').map((e) => {
    const hidden: Record<string, string> = {};
    let gpuText = '';
    for (const input of e.inner.matchAll(/<input\b[^>]*>/g)) {
      const tag = input[0];
      const name = attrValue(tag, 'name');
      if (attrValue(tag, 'type') === 'hidden') {
        if (name !== undefined) hidden[name] = decodeEntities(attrValue(tag, 'value') ?? '');
      } else if (attrValue(tag, 'id')?.endsWith('-gpu')) {
        gpuText = decodeEntities(attrValue(tag, 'value') ?? '');
      }
    }
    return { action: decodeEntities(attrValue(e.openTag, 'action') ?? ''), home: hasAttr(e.openTag, 'data-home-form'), hidden, gpuText };
  });
  const datalist = html.match(/<datalist\b[^>]*>([\s\S]*?)<\/datalist>/)?.[1] ?? '';
  const datalistOptionCount = (datalist.match(/<option\b/g) ?? []).length;
  const guideBody = elementsWithAttr(noScript, 'data-guide-body')[0]?.inner ?? '';
  const listControlsValue = attrValue(elementsWithAttr(noScript, 'data-list-controls')[0]?.openTag ?? '', 'data-list-controls');
  // 목록 페이지 표 행 — 여는 태그의 data-* 전부 (정렬·거르기 아일랜드가 읽는 값)
  const listRows = [...noScript.matchAll(/<tr\b[^>]*\sdata-(?:model|gpu)-id="[^"]+"[^>]*>/g)].map((m) => {
    const data = Object.fromEntries([...m[0].matchAll(/\sdata-([\w-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    return { id: data['model-id'] ?? data['gpu-id']!, data };
  });
  const hubIntro = elementsWithAttr(noScript, 'data-hub-intro')[0]?.inner ?? '';
  const seriesEl = elementsWithAttr(noScript, 'data-model-series')[0];
  const modelAbout = elementsWithAttr(noScript, 'data-model-about')[0]?.inner ?? '';
  const compareIntro = elementsWithAttr(noScript, 'data-compare-intro')[0]?.inner ?? '';
  const compareSummary = elementsWithAttr(noScript, 'data-compare-summary')[0];
  const aboutAt = noScript.search(/\sdata-model-about(?=[\s=>/])/);
  const laterSections = [noScript.search(/\sdata-hub-intro(?=[\s=>/])/), noScript.indexOf('id="facts-heading"')].filter((i) => i >= 0);
  const markers: PageFacts['markers'] = {
    calculator: elementsWithAttr(noScript, 'data-calculator').length > 0,
    calcForm: elementsWithAttr(noScript, 'data-calc-form').length > 0,
    inputList: /<input\b[^>]*\blist="/.test(noScript),
    resultCards: elementsWithAttr(noScript, 'data-result-card').length,
    ctxControls: elementsWithAttr(noScript, 'data-ctx-controls').length > 0,
    sortControl: elementsWithAttr(noScript, 'data-sort-control').length > 0,
    ...(navCalculator === undefined ? {} : { navCalculator }),
    ...(openCalculator === undefined ? {} : { openCalculator }),
    ...(navGuides === undefined ? {} : { navGuides }),
    ...(navModels === undefined ? {} : { navModels }),
    ...(navGpus === undefined ? {} : { navGpus }),
    ...(listControlsValue === undefined ? {} : { listControls: listControlsValue }),
    calcWidgets: elementsWithAttr(noScript, 'data-calc-widget').length,
    guideData: elementsWithAttr(noScript, 'data-guide-data').length,
    guideDraft: elementsWithAttr(noScript, 'data-guide-draft').length > 0,
    guidesEmpty: elementsWithAttr(noScript, 'data-guides-empty').length > 0,
    comparesEmpty: elementsWithAttr(noScript, 'data-compares-empty').length > 0,
    compareSummary: compareSummary !== undefined,
    compareIntroParagraphs: (compareIntro.match(/<p[\s>]/g) ?? []).length,
    ramToggle: elementsWithAttr(noScript, 'data-ram-toggle').length > 0,
    ...(calcModelLink === undefined ? {} : { calcModelLink }),
    blockInParagraph:
      blockInParagraphCount(guideBody) + blockInParagraphCount(hubIntro) + blockInParagraphCount(modelAbout) + blockInParagraphCount(compareIntro),
    hubIntroParagraphs: (hubIntro.match(/<p[\s>]/g) ?? []).length,
    hubIntroData: elementsWithAttr(hubIntro, 'data-guide-data').length,
    modelAboutParagraphs: (modelAbout.match(/<p[\s>]/g) ?? []).length,
    modelAboutHrefs: [...modelAbout.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]!)),
    modelAboutFirst: aboutAt >= 0 && laterSections.length > 0 && laterSections.every((i) => aboutAt < i),
  };
  // 가이드 본문의 문장 단위 — 규칙 3 검사 대상(임계값 범례 `[data-threshold]` 는 밴드 없는 정책 문장이라 제외)
  const thresholdTexts = new Set(
    elementsWithAttr(guideBody, 'data-threshold').flatMap((e) => collectElements(e.inner, UNIT_TAGS).map((u) => elementText(u.inner))),
  );
  const guideTexts = collectElements(guideBody, UNIT_TAGS)
    .map((u) => elementText(u.inner))
    .filter((text) => !thresholdTexts.has(text));
  // 허브 소개글 문단도 규칙 3 검사 대상 (10-14 D74 — 산문 숫자는 데이터 컴포넌트뿐이지만 렌더 결과로 한 번 더)
  const hubIntroTexts = collectElements(hubIntro, UNIT_TAGS).map((u) => elementText(u.inner));
  // GPU 비교(10-19 D106): 속도 요약 블록의 문장 단위(요약 문장·기준 모델 속도·pp `<dd>` — 블록 통째가 아니라 단위마다)·소개글 문단도 규칙 3 검사 대상.
  // 판정 범례(`VerdictLegend`)의 `<dd>` 는 요약 밖이라 넣지 않는다 — 밴드 없는 정책 문장이다(가이드 `[data-threshold]` 와 같은 이유)
  const compareTexts =
    kind === 'compare'
      ? [
          ...collectElements(compareSummary?.inner ?? '', UNIT_TAGS).map((u) => elementText(u.inner)),
          ...collectElements(compareIntro, UNIT_TAGS).map((u) => elementText(u.inner)),
        ]
      : [];
  const scriptSrcs = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)]
    .filter((m) => !/\bnomodule\b/i.test(`${m[1]} ${m[3]}`))
    .map((m) => m[2]!);
  const preloadSrcs = [...html.matchAll(/<link\b[^>]*\brel="(?:modulepreload|preload)"[^>]*>/g)]
    .map((m) => m[0].match(/\bhref="([^"]+)"/)?.[1])
    .filter((h): h is string => h !== undefined && h.endsWith('.js'));
  const liveSummary = elementsWithAttr(noScript, 'data-live-summary').map((e) => elementText(e.inner))[0];

  const faq = visibleFaq(html);
  const description = metaContent(html, /<meta name="description" content="([^"]*)"/);
  const title = metaContent(html, /<title>([^<]*)<\/title>/);
  const h1 = elementText(noScript.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '');

  // 한글 모델 이름(D94) — 모델 허브는 URL 끝 id, 콤보는 모델 id
  const pageModelId = combo?.modelId ?? (kind === 'model' ? urlPath.split('/').pop() : undefined);
  const pageModel = locale === 'ko' && pageModelId ? ctx.modelById.get(pageModelId) : undefined;
  const koName = pageModel?.family ? koFamilyName({ name: pageModel.name, family: pageModel.family }) : undefined;
  let koModelName: PageFacts['koModelName'];
  if (koName) {
    const body = noScript
      .slice(Math.max(0, noScript.indexOf('<body')))
      .replace(/<a\b[^>]*\sdata-related-guide[^>]*>[\s\S]*?<\/a>/g, ' ');
    koModelName = {
      name: koName,
      title: (title ?? '').includes(koName),
      description: (description ?? '').includes(koName),
      h1: h1.includes(koName),
      body: decodeEntities(body.replace(TAG_RE, ' ')).split(koName).length - 1,
    };
  }
  const ogDescription = metaContent(html, /<meta property="og:description" content="([^"]*)"/);
  const ogImage = metaContent(html, /<meta property="og:image" content="([^"]*)"/);
  const twitterImage = metaContent(html, /<meta name="twitter:image" content="([^"]*)"/);
  const verdictSentence = elementsWithAttr(noScript, 'data-verdict-sentence').map((e) => elementText(e.inner))[0];
  // 쌍둥이 GPU 형제 문장 (D22) — pp 비교가 들어가므로 규칙 3 검사 대상
  const twinText = elementsWithAttr(noScript, 'data-twin').map((e) => elementText(e.inner))[0];
  const altCardTexts = elementsWithAttr(noScript, 'data-alt-card').map((e) => elementText(e.inner));
  const noRun = elementsWithAttr(noScript, 'data-no-run').length > 0;
  const ramStepEls = elementsWithAttr(noScript, 'data-ram-step');
  const ramSteps = ramStepEls.map((e) => ({
    ram: Number(attrValue(e.openTag, 'data-ram-step')),
    verdict: attrValue(e.inner, 'data-verdict') ?? '',
    displayVerdict: attrValue(e.openTag, 'data-display-verdict') ?? '',
    quant: attrValue(e.openTag, 'data-quant') ?? '',
    fits: attrValue(e.openTag, 'data-fits') === 'true',
    assumed: hasAttr(e.openTag, 'data-assumed'),
    commands: hasAttr(e.openTag, 'data-commands'),
  }));
  // 행 문장(용량 · 표시 양자화 판정 · 속도)은 규칙 3 검사 대상
  const ramStepTexts = ramStepEls.map((e) => elementText(e.inner));
  const ramCaption = elementsWithAttr(noScript, 'data-ram-caption').map((e) => attrValue(e.openTag, 'data-ram-caption'))[0];
  const headerVerdict = attrValue(elementsWithAttr(noScript, 'data-verdict-sentence')[0]?.inner ?? '', 'data-verdict');
  const snippets = elementsWithAttr(noScript, 'data-snippet').map((e) => ({
    kind: attrValue(e.openTag, 'data-snippet') ?? '',
    text: decodeEntities((e.inner.match(/<code\b[^>]*>([\s\S]*?)<\/code>/)?.[1] ?? '').replace(TAG_RE, '')).trim(),
  }));

  // --- 콤보 전용 사실: 숫자 지문 (D15) · 문장 단위 (D16) · <dd> 속도 문장 --------------------
  let fingerprint = '';
  const textUnitIds: number[] = [];
  let textChars = 0;
  const ddTexts: string[] = [];
  if (combo) {
    const gpuMask = ctx.gpuMask(combo.gpuId);
    const modelMask = ctx.modelMask(combo.modelId);
    fingerprint = numberFingerprint(maskAll(visible, [gpuMask]));
    for (const el of collectElements(noScript, UNIT_TAGS)) {
      const text = elementText(el.inner);
      if (el.tag === 'dd') ddTexts.push(text);
      const masked = maskAll(text, [gpuMask, modelMask]);
      if (masked.length < MIN_UNIT_CHARS) continue;
      textUnitIds.push(ctx.units.intern(masked));
      textChars += masked.length;
    }
  }

  const speedTexts = [
    description ?? '',
    ogDescription ?? '',
    ...faq.map((q) => q.answer),
    verdictSentence ?? '',
    twinText ?? '',
    liveSummary ?? '',
    ...ramStepTexts,
    ...guideTexts,
    ...hubIntroTexts,
    ...compareTexts,
    ...altCardTexts,
    ...ddTexts,
  ].filter((text) => text !== '');

  return {
    file,
    urlPath,
    locale,
    kind,
    ...(combo ? { combo } : {}),
    lang: html.match(/<html[^>]*\blang="([^"]+)"/)?.[1],
    title,
    description,
    ...(ogDescription === undefined ? {} : { ogDescription }),
    canonical: extractCanonical(html),
    hreflang: extractHreflangs(html),
    jsonLd,
    ...(jsonLdError === undefined ? {} : { jsonLdError }),
    faq,
    links,
    enPrefixedLinkCount: (html.match(/(?:href|action)="\/en(\/|")/g) ?? []).length,
    hangulWords: locale === 'en' ? (visible.match(HANGUL_RE) ?? []) : [],
    speedTexts,
    measuredLabelIssues: measuredLabelIssuesOf(visible.replace(/\s+/g, ' ')),
    robotsNoindex: robotsNoindexOf(html),
    h1Count: (noScript.match(/<h1\b/g) ?? []).length,
    ...(kind === 'gpu' ? { hubH1: h1 } : {}),
    ...(verdictSentence === undefined ? {} : { verdictSentence }),
    adjacentHrefs,
    comboLinkHrefs,
    compareLinkHrefs,
    ...(kind === 'compare' ? { compareSlug: compareSlugOf(urlPath)! } : {}),
    startGpuIds: elementsWithAttr(noScript, 'data-start-gpu').map((e) => attrValue(e.openTag, 'data-start-gpu') ?? ''),
    startPickHrefs,
    snippets,
    noRun,
    ramSteps,
    ...(ramCaption === undefined ? {} : { ramCaption }),
    ramSame: elementsWithAttr(noScript, 'data-ram-same').length > 0,
    ...(headerVerdict === undefined ? {} : { headerVerdict }),
    ...(liveSummary === undefined ? {} : { liveSummary }),
    numberFingerprint: fingerprint,
    textUnitIds,
    textChars,
    formActions,
    calcWidgetForms,
    calcDeepLinks,
    datalistOptionCount,
    relatedGuideHrefs,
    updateIds: elementsWithAttr(noScript, 'data-update').map((e) => attrValue(e.openTag, 'data-update') ?? ''),
    addedModelHrefs,
    browseModelHrefs,
    browseGpuHrefs,
    listRows,
    browseAllHrefs,
    markers,
    scriptSrcs,
    preloadSrcs,
    ...(ogImage === undefined ? {} : { ogImage }),
    ...(twitterImage === undefined ? {} : { twitterImage }),
    krwPrices: (visible.match(/약 [\d,]+만 원/g) ?? []).length,
    krwNote: /환율\(1달러 [\d,]+원\)/.test(visible),
    ...(koModelName ? { koModelName } : {}),
    qwenHangul: /큐웬|큐원/.test(`${title ?? ''} ${description ?? ''} ${visible}`),
    runtimeFacts: elementsWithAttr(noScript, 'data-runtime-fact').map((e) => ({
      id: attrValue(e.openTag, 'data-runtime-fact') ?? '',
      hrefs: [...e.inner.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]!)),
      text: decodeEntities(e.inner.replace(TAG_RE, '')).replace(/\s+/g, ' ').trim(),
    })),
    ...(seriesEl
      ? {
          modelSeries: {
            hrefs: [...seriesEl.inner.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]!)),
            currentRows: elementsWithAttr(seriesEl.inner, 'data-series-current').length,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 인덱싱 게이트 (data/publish.json, D9)
// ---------------------------------------------------------------------------

export type PublishBatch = {
  batch: number;
  gpuIds: string[];
  modelIds: string[];
  plannedAt?: string;
  note?: string;
};

export type PublishPlan = { currentBatch: number; batches: PublishBatch[] };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

/** `data/publish.json` 최소 형태 검증 (zod 는 packages/data 담당 — 여기선 계약만 확인) */
export function parsePublishPlan(raw: unknown): PublishPlan {
  if (typeof raw !== 'object' || raw === null) throw new Error('publish.json: expected an object');
  const { currentBatch, batches } = raw as Record<string, unknown>;
  if (typeof currentBatch !== 'number' || !Number.isInteger(currentBatch) || currentBatch < 0) {
    throw new Error('publish.json: currentBatch must be a non-negative integer');
  }
  if (!Array.isArray(batches)) throw new Error('publish.json: batches must be an array');
  const parsed = batches.map((entry, i): PublishBatch => {
    const b = entry as Record<string, unknown>;
    if (typeof b.batch !== 'number' || !isStringArray(b.gpuIds) || !isStringArray(b.modelIds)) {
      throw new Error(`publish.json: batches[${i}] needs { batch: number, gpuIds: string[], modelIds: string[] }`);
    }
    return {
      batch: b.batch,
      gpuIds: b.gpuIds,
      modelIds: b.modelIds,
      ...(typeof b.plannedAt === 'string' ? { plannedAt: b.plannedAt } : {}),
      ...(typeof b.note === 'string' ? { note: b.note } : {}),
    };
  });
  return { currentBatch, batches: parsed };
}

/** 콤보 배치 = 쌍(gpu·model 둘 다 포함)을 담은 항목들의 최소 batch — 어느 항목에도 없으면 undefined */
export function comboBatch(publish: PublishPlan, gpuId: string, modelId: string): number | undefined {
  let min: number | undefined;
  for (const entry of publish.batches) {
    if (!entry.gpuIds.includes(gpuId) || !entry.modelIds.includes(modelId)) continue;
    if (min === undefined || entry.batch < min) min = entry.batch;
  }
  return min;
}

/** indexable ⇔ batch 정의 && batch ≤ currentBatch */
export function comboIndexable(publish: PublishPlan, gpuId: string, modelId: string): boolean {
  const batch = comboBatch(publish, gpuId, modelId);
  return batch !== undefined && batch <= publish.currentBatch;
}

// ---------------------------------------------------------------------------
// 결정적 표본 · 통계
// ---------------------------------------------------------------------------

/** mulberry32 — 시드 고정 PRNG (깊이 테스트 표본, AC 기록용) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) 에서 서로 다른 k개 인덱스 (호출 순서 고정 → 결정적) */
export function pickDistinct(rng: () => number, n: number, k: number): number[] {
  const picked: number[] = [];
  if (n <= 0) return picked;
  while (picked.length < Math.min(k, n)) {
    const i = Math.floor(rng() * n);
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
