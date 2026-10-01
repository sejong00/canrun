/**
 * GGUF 헤더 실측 CLI + 토큰 인증 래퍼 — MoE 텐서 분할(전문가 / GPU 상주 비전문가)을 파일 헤더에서 직접 잰다 (10-01).
 *
 * 파서·분류·Range 읽기 본체는 브라우저 안전 모듈 `packages/data/src/gguf.ts` 로 옮겼다(계산기의 "카탈로그 밖 모델 확인"과
 * 같은 코드). 이 파일은 그 심볼을 다시 내보내고(기존 import 호환), HF_TOKEN 을 Authorization 헤더로 바꿔 넘기는
 * `{ token, fetchImpl }` 옵션 래퍼와 CLI 만 둔다. 분할 규칙은 gguf.ts 머리말 참조.
 *
 * 실행(읽기 전용): pnpm exec tsx scripts/gguf-header.ts <repo> <fileName>  → JSON 출력
 * 시크릿 제로(CLAUDE.md 규칙 7): HF_TOKEN 은 env 로만 — 공개 repo 는 무토큰으로 충분.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchGgufHeader as fetchGgufHeaderCore,
  fetchRange as fetchRangeCore,
  measureSplit as measureSplitCore,
  type GgufFetchOpts,
  type GgufHeader,
  type SplitMeasureWithFile,
} from '../packages/data/src/gguf';
import { authHeaders, type FetchLike } from './hf-common';

export {
  GGML_TYPES,
  GgufNeedMoreBytesError,
  classifySplit,
  parseGgufHeader,
  resolveUrl,
  shardFileNames,
  tensorBytes,
  tensorElements,
} from '../packages/data/src/gguf';
export type {
  GgmlTypeInfo,
  GgufArray,
  GgufHeader,
  GgufScalar,
  GgufTensorInfo,
  GgufValue,
  SplitMeasure,
  SplitMeasureWithFile,
} from '../packages/data/src/gguf';

// ---------------------------------------------------------------------------
// 네트워크 — 토큰 인증 래퍼 (본체는 packages/data/src/gguf.ts)
// ---------------------------------------------------------------------------

export type HeaderFetchOpts = {
  token?: string;
  fetchImpl?: FetchLike;
  /** 첫 Range 크기 (기본 8MB) */
  initialBytes?: number;
  /** 두 배씩 늘리는 상한 (기본 64MB) */
  maxBytes?: number;
};

function coreOpts({ token, fetchImpl, ...rest }: HeaderFetchOpts): GgufFetchOpts {
  return { ...rest, headers: authHeaders(token), ...(fetchImpl ? { fetch: fetchImpl } : {}) };
}

/** [start, end] 바이트 범위. 206 이 정상, 200(Range 무시)은 앞에서 잘라 맞춘다. fileBytes = 파일 전체 크기(알면). */
export const fetchRange = (
  url: string,
  start: number,
  end: number,
  opts: HeaderFetchOpts = {},
): Promise<{ bytes: Uint8Array; fileBytes?: number }> => fetchRangeCore(url, start, end, coreOpts(opts));

/** 헤더가 다 들어올 때까지 Range 를 두 배씩 늘려 읽는다(이미 받은 부분은 다시 받지 않음). */
export const fetchGgufHeader = (
  url: string,
  opts: HeaderFetchOpts = {},
): Promise<{ header: GgufHeader; fileBytes?: number }> => fetchGgufHeaderCore(url, coreOpts(opts));

/** repo 의 GGUF 파일(분할이면 첫 조각 경로) → 분할 실측. 조각마다 헤더를 읽는다(텐서 정보는 조각별). */
export const measureSplit = (
  repo: string,
  fileName: string,
  opts: HeaderFetchOpts = {},
): Promise<SplitMeasureWithFile> => measureSplitCore(repo, fileName, coreOpts(opts));

// ---------------------------------------------------------------------------
// CLI (읽기 전용 — 저장소에 아무것도 쓰지 않는다)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [repo, fileName] = process.argv.slice(2).filter((a) => a !== '--');
  if (!repo || !fileName) throw new Error('usage: tsx scripts/gguf-header.ts <repo> <fileName>');
  const res = await measureSplit(repo, fileName, { token: process.env['HF_TOKEN'] });
  console.log(JSON.stringify({ repo, fileName, ...res }, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
