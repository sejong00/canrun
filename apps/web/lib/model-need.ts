/**
 * 모델 하나의 기준 필요 메모리 — 모델 허브(FAQ·메타 설명·행렬)와 모델 목록(10-19 `/models` "필요 메모리" 열)이 같은 값을 쓴다.
 * 메모리 행렬과 같은 식(그래픽카드에 올라가는 가중치 + f16 KV 캐시 + 연산 버퍼, 10-03 D62) — 새 추정이 아니다.
 */
import type { ModelHubData } from '@canrun/data';
import { computeBufferGB, kvGB } from '@canrun/engine';

/** 허브 FAQ·목록이 인용하는 컨텍스트 길이 */
export const REFERENCE_CTX = 8192;

/**
 * 양자화 하나의 8k 필요 메모리 분해. size = 파일, gpu = 그래픽카드 몫(입력 임베딩·MTP 블록 제외),
 * mtp = MTP 블록이 있는 파일인지, total = gpu + kv + buffer
 */
export function needAt8k(hub: Pick<ModelHubData, 'matrix' | 'quants' | 'model'>, quant: string) {
  const row = hub.matrix.rows.find((r) => r.quant === quant)!;
  const record = hub.quants.find((q) => q.row.quant === quant)!.row;
  const kv = kvGB(hub.model.arch.kvBytesPerTokenF16, REFERENCE_CTX);
  const buffer = computeBufferGB(REFERENCE_CTX);
  return {
    size: row.fileGB,
    gpu: row.gpuWeightsGB,
    mtp: record.mtpGB !== undefined,
    kv,
    buffer,
    total: row.gpuWeightsGB + kv + buffer,
  };
}
