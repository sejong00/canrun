/**
 * 모델 라이선스 분류 — 모델 허브 라이선스 배지용 (P1-1, docs/PROGRESS.md §4 08-26 "특이 라이선스는 표시 정보").
 *
 * `models.json` 의 `license` 는 자유 문자열이라 UI 가 직접 해석하지 않는다. 여기의 정확 문자열
 * 맵만이 분류 근거다 — 미등록 문자열은 `unknown` 이고, 시드 전수 분류는 테스트가 강제한다
 * (신모델 추가 시 분류 누락을 CI 가 잡는다). 분류는 권리 판단이 아니라 "약관 확인 필요도" 표시다.
 */

export type LicenseClass = 'permissive' | 'custom' | 'nonCommercial' | 'unknown';

// source: docs/01 §3 (policy) — 표시 분류. 약관 원문은 각 모델 HF 카드(models.json sources)
const LICENSE_CLASS: Readonly<Record<string, Exclude<LicenseClass, 'unknown'>>> = Object.freeze({
  'Apache-2.0': 'permissive',
  MIT: 'permissive',
  // Linux Foundation OpenMDW — 모델·데이터·가중치용 허용 라이선스 (Laguna S 2.1·Nemotron 3.5 Lightning, 10-03)
  'OpenMDW-1.1': 'permissive',
  // LiquidAI 자체 약관 — 매출 기준 상업 이용 조건 (LFM2.5, 10-03)
  'LFM Open License 1.0': 'custom',
  'Llama 3.1': 'custom',
  'Llama 3.2': 'custom',
  'Llama 3.3': 'custom',
  Gemma: 'custom',
  'Kanana License': 'custom',
  'HyperCLOVA X SEED': 'custom',
  'Upstage Solar License': 'custom',
  'EXAONE AI Model License 1.2 NC': 'nonCommercial',
});

export function classifyLicense(license: string): LicenseClass {
  return LICENSE_CLASS[license] ?? 'unknown';
}
