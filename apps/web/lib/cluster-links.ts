/**
 * 여러 대 연결 안내 링크 (10-23 D118 — DGX Spark 클러스터). 계산기 결과 카드의 RPC 명령 각주가 쓴다 — 링크 글자는 messages(`Calculator.clusterLink*`).
 * NVIDIA 공식 문서만: 케이블로 잇기(2·3대) · 스위치로 잇기(4대) · vLLM 여러 대(텐서 병렬 — CanRun 계산 밖, 2~4대)
 */
export const DGX_CLUSTER_LINKS = Object.freeze({
  cable: 'https://build.nvidia.com/spark/connect-multiple-sparks/cable-devices',
  switch: 'https://build.nvidia.com/spark/multi-sparks-through-switch',
  vllm: 'https://build.nvidia.com/spark/vllm-cluster',
});
