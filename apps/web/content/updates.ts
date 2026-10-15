/**
 * 업데이트 소식 레지스트리 (10-14 D72) — `/updates` 페이지의 "바뀐 기능과 고친 계산" 항목. 의존성 0: 사이트맵 스크립트·export 테스트(저장소 루트)도 읽는다.
 *
 * - 날짜는 여기에만 둔다. 문장은 로캘별 MDX `content/{en,ko}/pages/updates.mdx` 의 `<Update id="…">` 블록에 따로 쓴다
 *   (두 언어 모두 이 목록의 id 를 이 순서로 한 번씩 — `apps/web/test/updates.test.ts`).
 * - 날짜 = 그 변경이 사이트에 반영된 날의 **UTC 날짜**(main 푸시 = 배포 — Deploy 런 시각, 카탈로그 `addedAt` 과 같은 기준). KST 자정~09시 푸시는 전날이다. 최신이 위.
 * - 사용자가 느낄 변화만 적는다(새 기능·계산 보정·데이터 표시·개인정보처리방침). 리팩터링·운영 자동화 내부·검색엔진용 변경은 넣지 않는다.
 * - 모델 추가는 여기 적지 않는다 — 페이지 아래 목록이 `data/models.json` 의 `addedAt` 으로 그린다.
 */
export type SiteUpdate = { readonly id: string; readonly date: string };

export const SITE_UPDATES = [
  { id: 'moe-fixed-cost', date: '2026-10-15' },
  { id: 'apple-gpu-compute', date: '2026-10-15' },
  { id: 'apple-prompt-speed', date: '2026-10-15' },
  { id: 'm5-ultra', date: '2026-10-15' },
  { id: 'new-guides', date: '2026-10-15' },
  { id: 'apple-dense-speed', date: '2026-10-15' },
  { id: 'hub-intros', date: '2026-10-14' },
  { id: 'calculator-examples', date: '2026-10-14' },
  { id: 'daily-new-models', date: '2026-10-06' },
  { id: 'calculator-sort', date: '2026-10-06' },
  { id: 'visitor-statistics', date: '2026-10-06' },
  { id: 'model-to-gpu', date: '2026-10-03' },
  { id: 'mixed-gpus', date: '2026-10-03' },
  { id: 'manual-model', date: '2026-10-03' },
  { id: 'combo-ram', date: '2026-10-03' },
  { id: 'gpu-weights', date: '2026-10-03' },
  { id: 'hybrid-models', date: '2026-10-03' },
  { id: 'thinking-mode', date: '2026-10-01' },
  { id: 'krw-prices', date: '2026-10-01' },
  { id: 'multi-gpu', date: '2026-10-01' },
  { id: 'hf-models', date: '2026-10-01' },
  { id: 'moe-expert-placement', date: '2026-10-01' },
  { id: 'moe-speed', date: '2026-09-30' },
  { id: 'gemma4-kv', date: '2026-09-30' },
  { id: 'launch', date: '2026-09-30' },
] as const satisfies readonly SiteUpdate[];

export type SiteUpdateId = (typeof SITE_UPDATES)[number]['id'];

/** 가장 최근 항목의 날짜 — 사이트맵 lastmod(`/updates` 는 이 날과 데이터 기준일 중 늦은 날) */
export function latestSiteUpdate(): string {
  return SITE_UPDATES.reduce<string>((latest, u) => (u.date > latest ? u.date : latest), SITE_UPDATES[0].date);
}
