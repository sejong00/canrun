/**
 * GGUF 파일 이름의 양자화 토큰 별칭 (10-22 엔진 후속 ⑧-b — GLM-5.3-Flash).
 *
 * 파일 매칭(`hf.ts` matchQuantFiles — add-model·sync-models·계산기 HF 불러오기)과 실행 명령의 `-hf` 태그(`snippet.ts` ggufTag)가 같은 규칙을 쓴다.
 * 순수·브라우저 안전 — 계산기 메인 번들(snippet)과 HF 수집 모듈(hf) 양쪽에서 값 import 한다(zod·node 없음).
 */

import type { ModelQuantRecord } from './schema';

type QuantId = ModelQuantRecord['quant'];

/**
 * 정확한 토큰의 파일이 하나도 없을 때만 받는 다른 토큰과, 그 파일 헤더 `general.file_type` 의 기대값.
 * llama-quantize 는 `Q4_K` 를 `Q4_K_M` 의 별칭으로 받아 같은 ftype(LLAMA_FTYPE_MOSTLY_Q4_K_M = 15)을 쓴다
 * (https://github.com/ggml-org/llama.cpp/blob/a37cc46104eb50900d5ab4a9ba02a0abdac039db/tools/quantize/quantize.cpp#L62 ·
 * https://github.com/ggml-org/llama.cpp/blob/a37cc46104eb50900d5ab4a9ba02a0abdac039db/include/llama.h#L134) — ggml-org/GLM-5.3-Flash-GGUF 의
 * `GLM-5.3-Flash-Q4_K-0000N-of-00002.gguf` 가 이 꼴이다(헤더 file_type 15). 정확한 `Q4_K_M` 파일(플레인·UD)이 있으면 별칭은 쓰지 않는다 —
 * 기존 카탈로그 행은 바뀌지 않는다
 */
export const QUANT_FILE_ALIASES: Readonly<Partial<Record<QuantId, { token: string; fileType: number }>>> = Object.freeze({
  Q4_K_M: Object.freeze({ token: 'Q4_K', fileType: 15 }),
});

/**
 * 파일 이름 안의 양자화 토큰 — 앞 경계 ^|-|_|.|/ (IQ2_K 의 'I' 는 경계 아님), 뒤 경계 -|.|/ 또는 끝('_' 제외 → Q4_K 는 Q4_K_M 에 맞지 않는다).
 * 대소문자 무시. `ud` 면 unsloth Dynamic 접두(`UD-`)가 붙은 토큰
 */
export function quantTokenRe(token: string, ud = false): RegExp {
  return new RegExp(`(?:^|[-_./])${ud ? 'UD-' : ''}${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[-./]|$)`, 'i');
}

/**
 * 행의 파일이 별칭 토큰으로 잡힌 것인가 — 그렇다면 그 별칭(헤더 file_type 기대값 포함). add-model·sync-models 가 헤더 `general.file_type` 을 대조하고
 * (다르면 그 행을 쓰지 않는다), 스니펫 `-hf` 태그는 파일의 실제 토큰을 쓴다(llama.cpp `-hf repo:Q4_K_M` 은 `Q4_K_M[.-]` 를 찾아 이 파일을 못 고른다 —
 * https://github.com/ggml-org/llama.cpp/blob/a37cc46104eb50900d5ab4a9ba02a0abdac039db/common/download.cpp#L691-L713)
 */
export function quantFileAlias(quant: string, fileName: string | undefined): { token: string; fileType: number } | undefined {
  const alias = QUANT_FILE_ALIASES[quant as QuantId];
  if (!alias || fileName === undefined) return undefined;
  const base = fileName.split('/').at(-1) ?? fileName;
  if (quantTokenRe(quant).test(base) || quantTokenRe(quant, true).test(base)) return undefined;
  return quantTokenRe(alias.token).test(base) ? alias : undefined;
}

/** 별칭으로 잡힌 행의 헤더 file_type 이 기대값과 다르면 사유, 아니면 undefined(별칭 행이 아니거나 일치) */
export function aliasFileTypeProblem(quant: string, fileName: string | undefined, fileType: number | undefined): string | undefined {
  const alias = quantFileAlias(quant, fileName);
  if (!alias || fileType === alias.fileType) return undefined;
  return `파일 이름 토큰 ${alias.token} 을 ${quant} 로 받았는데 헤더 general.file_type ${fileType ?? '없음'} ≠ ${alias.fileType}`;
}
