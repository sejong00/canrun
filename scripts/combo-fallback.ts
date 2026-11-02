/**
 * 없어진 조합 주소 → 계산기 (11-02 D130) — `out/404.html` 에 넣는 인라인 스크립트.
 *
 * D130 부터 조합 페이지는 색인 배치에 든 쌍 × en·ko 만 만든다. 예전 noindex 조합(en·ko 약 1만 쪽)과 zh 조합 주소로 들어오면
 * Cloudflare Pages 가 루트 `404.html` 을 상태 404 로 준다 — 이 스크립트가 경로에서 모델·GPU 를 읽어 같은 GPU·모델을 미리 채운
 * 계산기(`/calculator?gpu=…&m=…`, 로캘 프리픽스 유지, 원래 쿼리 `ram`·`ctx` 등은 이어 붙임)로 `location.replace` 한다.
 * 곧바로 넘어가지 못할 때를 위해 같은 곳으로 가는 링크 한 줄을 본문 끝에 붙인다(문구는 messages `CalcWidget.openCombo`).
 *
 * `_redirects` 를 쓰지 않는 이유(Cloudflare Pages 문서 https://developers.cloudflare.com/pages/configuration/redirects/ 확인):
 *  - "Redirects are always followed, regardless of whether or not an asset matches the incoming request" — 자리표시자 규칙
 *    `/can-i-run/:model/on/:gpu` 하나면 남아 있는 색인 조합 360쪽까지 계산기로 보내 버린다.
 *  - 없어진 주소를 하나씩 적으면 1만 줄이 넘어 정적 규칙 한도 2,000줄(동적 100줄)에 들어가지 않는다.
 * 예전 주소는 noindex 였으므로 크롤러가 404 를 받는 것은 괜찮다(색인에 있던 적이 없다).
 *
 * 경로 문자는 슬러그 문자(`[a-z0-9.-]`)만 받아 계산기 쿼리에 그대로 쓴다 — 같은 출처 상대 경로라 다른 사이트로 보내지 못한다.
 * 검증: scripts/combo-fallback.test.ts(스크립트를 그대로 실행), test/export-invariants.spec.ts(404.html 에 들어갔는지)
 */

/** 로캘 프리픽스('' = en) → 링크 문구 */
export type FallbackLabels = Readonly<Record<'' | '/ko' | '/zh', string>>;

/** 404.html 에 넣는 표식 — 두 번 넣지 않게, 검사가 찾을 수 있게 */
export const FALLBACK_MARKER = 'data-combo-fallback';

/** 브라우저에서 도는 인라인 스크립트 본문 (ES2017, 의존성 0). `labels` 는 JSON 으로 박는다 */
export function comboFallbackScript(labels: FallbackLabels): string {
  // `</` 가 문구에 들어가도 스크립트가 끊기지 않게
  const json = JSON.stringify(labels).replace(/</g, '\\u003c');
  return [
    '(function(){',
    'var m=/^(\\/(?:ko|zh))?\\/can-i-run\\/([a-z0-9.-]+)\\/on\\/([a-z0-9.-]+?)(?:\\.html)?\\/?$/.exec(location.pathname);',
    'if(!m)return;',
    'var p=m[1]||"",q=new URLSearchParams();q.set("gpu",m[3]);q.set("m",m[2]);',
    'new URLSearchParams(location.search).forEach(function(v,k){if(k!=="gpu"&&k!=="m")q.append(k,v)});',
    'var u=p+"/calculator?"+q.toString();',
    `var t=${json}[p];`,
    'location.replace(u);',
    'document.addEventListener("DOMContentLoaded",function(){var a=document.createElement("a");a.href=u;a.textContent=t;',
    'var d=document.createElement("p");d.setAttribute("data-combo-fallback-link","");d.style.cssText="text-align:center;font-family:system-ui,sans-serif;margin:16px";',
    'd.appendChild(a);document.body.appendChild(d)});',
    '})();',
  ].join('');
}

/** `<head>` 끝에 스크립트를 넣는다 — Next 기본 404 의 async 청크보다 먼저 돈다. 이미 있으면 그대로 */
export function injectComboFallback(html: string, labels: FallbackLabels): string {
  if (html.includes(FALLBACK_MARKER)) return html;
  const at = html.indexOf('</head>');
  if (at < 0) throw new Error('404.html has no </head> — cannot add the combo fallback script');
  return `${html.slice(0, at)}<script ${FALLBACK_MARKER}="">${comboFallbackScript(labels)}</script>${html.slice(at)}`;
}
