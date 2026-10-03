/**
 * 가격 표시 — en 은 달러만, ko 는 달러 옆에 원화 참고값 "$299(약 41만 원)" (10-01, PROGRESS §4 D61).
 * 원화는 미국 실거래가(달러)를 `data/fx.json`(ECB 기준환율, 주간 data-sync 가 갱신)으로 단순 환산한 값이다 —
 * 국내 판매가가 아니므로 원화가 보이는 곳에는 `Common.krwNote` 를 함께 단다.
 *
 * 서버 전용: fx.json 을 정적 import 한다(클라이언트 번들 금지 — lib/catalog.ts 와 같은 규칙).
 * 계산은 `lib/krw.ts`(순수 — 계산기 아일랜드도 쓴다, 10-03 D65)에 환율을 넣어 위임한다.
 */
import { parseFx } from '@canrun/data';
import fxJson from '../../../data/fx.json';
import { formatPriceFx, krwMan as krwManAt, krwNoteFx } from './krw';
import type { Translate } from './phrases';

export const FX = parseFx(fxJson);

/** 달러 → 만 원 단위 반올림 (1만 원 미만은 1) */
export function krwMan(usd: number, usdKrw: number = FX.usdKrw): number {
  return krwManAt(usd, usdKrw);
}

/** 가격 문자열 — ko 만 원화 참고값을 붙인다 */
export function formatPrice(common: Translate, locale: string, usd: number): string {
  return formatPriceFx(common, locale, usd, FX);
}

/** 원화 환산 안내 (ko 전용 — en 은 undefined) */
export function krwNote(common: Translate, locale: string): string | undefined {
  return krwNoteFx(common, locale, FX);
}
