/**
 * 파생 계산 — docs/05 §2 "packages/data: 파생 계산(kvBytesPerToken 등)".
 *
 * MoE nonExpertGB 유도 (P0-3에서 확정, P0-2 잠정값 대체):
 *   total = N(비전문가: attention+공유/상시활성) + E(전문가 전체)
 *   active = N + E × (topK / experts)          // 공유 전문가는 N 에 합산
 *   → E = (total − active) / (1 − topK/experts),  N = total − E
 *   nonExpertGB = N × (fileGB / totalParamsB)   // 파일 내 bpw 균등 근사
 *
 * 근사 한계: 임베딩·라우터의 비트폭 차이는 무시(±수백 MB) — fit 판정 임계 용도로 충분.
 * 전문가 수/topK 미문서 모델(gemma-4-26b-a4b 등)은 값 생략이 원칙(근거 없는 상수 금지).
 * 시드 값과 이 유도식의 일치는 consistency 테스트가 강제한다.
 */

export type MoeArch = {
  totalParamsB: number;
  activeParamsB: number;
  /** 레이어당 전문가 수 */
  experts: number;
  /** 토큰당 활성 전문가 수 */
  topK: number;
};

/** 비전문가(attention+공유) 파라미터 B 유도. */
export function deriveNonExpertParamsB(arch: MoeArch): number {
  const activeFrac = arch.topK / arch.experts;
  const expertParamsB = (arch.totalParamsB - arch.activeParamsB) / (1 - activeFrac);
  return arch.totalParamsB - expertParamsB;
}

/** 비전문가 텐서의 파일 내 크기 GB (bpw 균등 근사). */
export function deriveNonExpertGB(arch: MoeArch, fileGB: number): number {
  return deriveNonExpertParamsB(arch) * (fileGB / arch.totalParamsB);
}
