/**
 * 원화 참고 가격의 순수 코어 (D61) — 환율을 인자로 받는다. 서버(`lib/price.ts` — fx.json 을 넣어 위임)와
 * 계산기 아일랜드(모델 모드 GPU 행 — 서버가 ko 페이지에만 환율 props 를 넘긴다, 10-03 D65)가 같이 쓴다.
 * 출시가 문구가 가리키는 메모리 구성(`msrpConfigRamGB`)도 여기 — 서버 페이지와 계산기 목록이 같은 규칙을 쓴다.
 * 의존성은 `lib/format` 뿐 — 클라이언트 청크에 실린다(eslint CLIENT_FILES).
 */
import type { GpuCore } from '@canrun/data/client';
import { formatInt, formatUSD } from './format';
import type { Translate } from './phrases';

/** 환율 한 점 — `data/fx.json` 의 표시에 필요한 값만 */
export type KrwRate = { usdKrw: number; asOf: string };

/** 달러 → 만 원 단위 반올림 (1만 원 미만은 1) */
export function krwMan(usd: number, usdKrw: number): number {
  return Math.max(1, Math.round((usd * usdKrw) / 10_000));
}

/** 가격 문자열 — ko 이고 환율이 있으면 원화 참고값을 붙인다 */
export function formatPriceFx(common: Translate, locale: string, usd: number, fx: KrwRate | undefined): string {
  const price = formatUSD(locale, usd);
  if (locale !== 'ko' || !fx) return price;
  return common('priceKrw', { usd: price, krw: formatInt(locale, krwMan(usd, fx.usdKrw)) });
}

/** 원화 환산 안내 (ko 전용 — en 이거나 환율이 없으면 undefined) */
export function krwNoteFx(common: Translate, locale: string, fx: KrwRate | undefined): string | undefined {
  if (locale !== 'ko' || !fx) return undefined;
  return common('krwNote', { date: fx.asOf, rate: formatInt(locale, fx.usdKrw) });
}

/**
 * 출시가가 가리키는 메모리 구성 GB — 통합 메모리 PC 의 `msrpUSD` 는 가장 큰 메모리 구성 완제품의 출시가라(data/gpus.json note·출처 —
 * DGX Spark 128GB $3,999, Strix Halo 의 Framework Desktop 128GB $1,999) 가격 문구에 그 구성을 함께 적는다(`GpuHub.priceMsrpConfig`).
 * /gpus·비교·GPU 허브·모델 허브 표·계산기 모델 모드 목록이 같은 규칙 — 모델 허브 행이 더 작은 구성(DGX Spark 64GB — OEM 판, 출시가가 다르다)일 때
 * 그 구성의 값처럼 읽히지 않게(10-23 D117 리뷰). 그래픽카드·CPU 프로필은 undefined(출시가 그대로)
 */
export function msrpConfigRamGB(gpu: Pick<GpuCore, 'kind' | 'ramOptionsGB'>): number | undefined {
  return gpu.kind === 'unified' && gpu.ramOptionsGB?.length ? Math.max(...gpu.ramOptionsGB) : undefined;
}
