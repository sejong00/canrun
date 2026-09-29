/**
 * 숫자 포맷 — 엔진·데이터 레이어는 숫자만 반환하고 반올림·단위·로케일은 여기서만 (CLAUDE.md 규칙 6).
 * 단위 규칙(CLAUDE.md 스타일): 메모리 decimal GB, 속도 tok/s 소수 1자리.
 */
import type { Result } from '@canrun/engine';

function fixed(locale: string, value: number, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** tok/s 값 (소수 1자리) */
export function formatTokS(locale: string, value: number): string {
  return fixed(locale, value, 1);
}

/** 메모리 GB (기본 소수 1자리, 파일 크기는 2자리) */
export function formatGB(locale: string, value: number, digits = 1): string {
  return fixed(locale, value, digits);
}

/** 파라미터 수 (B) — 정수면 소수 없이 */
export function formatParams(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** 컨텍스트 토큰 수 → "8k" / "128k" */
export function formatCtx(ctx: number): string {
  return ctx >= 1024 ? `${Math.round(ctx / 1024)}k` : String(ctx);
}

/** USD 가격 (정수) */
export function formatUSD(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

/** 정수 */
/** 입력한 메모리 크기 그대로 (자릿수 채움 없음): 8 → "8", 3.5 → "3.5" — 커스텀 하드웨어 문장·공유 문구 */
export function formatMemGB(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatInt(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** 추정 밴드 폭 (%, 정수) — est × (1 ± band) 에서 역산 */
export function bandPercent(result: Pick<Result, 'tgTokS'>): number {
  const { est, high } = result.tgTokS;
  return est > 0 ? Math.round(((high - est) / est) * 100) : 0;
}

export type FormattedSpeed = {
  est: string;
  low: string;
  high: string;
  band: number;
};

export function formatSpeed(locale: string, result: Pick<Result, 'tgTokS'>): FormattedSpeed {
  return {
    est: formatTokS(locale, result.tgTokS.est),
    low: formatTokS(locale, result.tgTokS.low),
    high: formatTokS(locale, result.tgTokS.high),
    band: bandPercent(result),
  };
}
