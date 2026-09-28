/**
 * 수치 문장 조립 — 표·FAQ·메타 description·JSON-LD 가 **같은 문자열**을 쓰도록 한 곳에서 만든다.
 * 모든 속도 문장은 est. + 밴드 + 신뢰 라벨을 동반한다 (CLAUDE.md 규칙 3).
 */
import type { Mode, Result } from '@canrun/engine';
import type { Gpu, MeasuredJoin, QuantAssessment } from '@canrun/data';
import { formatCtx, formatSpeed, formatTokS } from './format';

/** next-intl translator 의 최소 형태 (네임스페이스가 이미 바인딩된 t) */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 실측 컨텍스트 표기 ("2k" / "2k/4k") — 추정의 기준 8k 와 조건이 다름을 밝힌다 */
export function measuredCtx(measured: MeasuredJoin | undefined): string {
  const ctxs = [...new Set((measured?.points ?? []).map((bp) => bp.ctx))].sort((a, b) => a - b);
  return ctxs.map(formatCtx).join('/');
}

export function confidenceText(
  tConfidence: Translate,
  result: Result,
  measured?: MeasuredJoin,
): string {
  if (result.confidence === 'measured') {
    return tConfidence('measured', {
      n: measured?.values.length ?? 1,
      ctx: measuredCtx(measured),
    });
  }
  return tConfidence(result.confidence, { band: formatSpeed('en', result).band });
}

/**
 * "est. 41.8 tok/s (36.8–46.8, calibrated estimate ±12%)" / 실측이면 측정 컨텍스트 + 8k 추정 밴드·라벨 병기
 */
export function speedPhrase(
  tCommon: Translate,
  tConfidence: Translate,
  locale: string,
  q: Pick<QuantAssessment, 'result' | 'estimate' | 'measured'>,
): string {
  if (q.result.confidence === 'measured') {
    const estimate = formatSpeed(locale, q.estimate);
    return tCommon('speedMeasured', {
      est: formatTokS(locale, q.result.tgTokS.est),
      ctx: measuredCtx(q.measured),
      n: q.measured?.values.length ?? 1,
      estEst: estimate.est,
      estLow: estimate.low,
      estHigh: estimate.high,
      label: confidenceText(tConfidence, q.estimate),
    });
  }
  const s = formatSpeed(locale, q.result);
  return tCommon('speedEst', {
    est: s.est,
    low: s.low,
    high: s.high,
    label: confidenceText(tConfidence, q.result),
  });
}

/** quant 표기 — desperate 티어(2비트)는 "품질 손실 큼" 을 붙인다 (docs/01 §3) */
export function quantText(tHint: Translate, q: Pick<QuantAssessment, 'quant' | 'tier'>): string {
  return q.tier === 'desperate' ? tHint('quantDesperate', { quant: q.quant }) : q.quant;
}

/** 실행 방식 라벨 — 통합 메모리의 full-gpu 는 "통합 메모리" */
export function modeKey(mode: Mode, gpuKind: Gpu['kind']): string {
  switch (mode) {
    case 'full-gpu':
      return gpuKind === 'unified' ? 'fullUnified' : 'fullGpu';
    case 'cpu-moe':
      return 'cpuMoe';
    case 'partial-offload':
      return 'partialOffload';
    case 'cpu-only':
      return 'cpuOnly';
  }
}

/** GPU 표시 이름 — CPU 프로필처럼 설명형 이름은 messages 오버라이드 (규칙 4) */
export function gpuName(tGpuName: Translate & { has?: (key: string) => boolean }, gpu: Gpu): string {
  return tGpuName.has?.(gpu.id) ? tGpuName(gpu.id) : gpu.name;
}
