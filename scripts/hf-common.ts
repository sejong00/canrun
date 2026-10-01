/**
 * HF API 공용 래퍼 + 시드 직렬화 — docs/03-data-spec.md §5 (데이터 파이프라인).
 *
 * - fetchTree: `GET /api/models/{repo}/tree/main?recursive=true` — Link rel="next"
 *   페이지네이션 순회, 429/5xx 1회 재시도. 공개 repo 는 무토큰으로 충분 (docs/05 §8).
 * - fetchConfig: 원본 repo 의 config.json — gated(401/403)는 오류가 아니라 상태로 반환.
 * - serializeRecords: data/*.json 시드 포맷(레코드당 1줄) 재현 — git diff 최소화.
 *   zod .parse 는 키 순서를 재배열하므로 호출자는 raw JSON.parse 레코드를 넘겨야 한다.
 *
 * 시크릿 제로(CLAUDE.md 규칙 7): HF_TOKEN 은 env 로만 통과 — 코드·데이터에 저장 금지.
 *
 * TreeEntry 타입과 fetchWithRetry(429/5xx 1회 재시도)는 브라우저 안전 모듈(packages/data/src/hf.ts·gguf.ts)로 옮겼다 —
 * 기존 import 호환을 위해 여기서 다시 내보낸다.
 */

import { fetchWithRetry, type FetchLike } from '../packages/data/src/gguf';
import type { TreeEntry } from '../packages/data/src/hf';

export { fetchWithRetry };
export type { FetchLike, TreeEntry };

export type HfFetchOpts = {
  token?: string;
  fetchImpl?: FetchLike;
};

const HF_BASE = 'https://huggingface.co';

export function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `Link: <url>; rel="next"` 헤더에서 다음 페이지 URL 추출. */
export function nextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(linkHeader);
  return match?.[1];
}

/** GGUF repo 파일 트리 전체 (recursive, 전 페이지 합산). 실패 시 throw. */
export async function fetchTree(repo: string, opts: HfFetchOpts = {}): Promise<TreeEntry[]> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const headers = authHeaders(opts.token);
  const entries: TreeEntry[] = [];
  let url: string | undefined = `${HF_BASE}/api/models/${repo}/tree/main?recursive=true`;
  while (url !== undefined) {
    const res: Response = await fetchWithRetry(url, headers, fetchImpl);
    if (!res.ok) throw new Error(`tree ${repo}: HTTP ${res.status}`);
    const page = (await res.json()) as TreeEntry[];
    entries.push(...page);
    url = nextPageUrl(res.headers.get('link'));
  }
  return entries;
}

export type ConfigResult = {
  config?: unknown;
  /** 401/403 — 토큰 없이 접근 불가(meta-llama 등). 오류 아님. */
  gated?: boolean;
  error?: string;
};

/** 원본 repo config.json — gated 는 상태로, 그 외 비정상은 error 문자열로. */
export async function fetchConfig(hfId: string, opts: HfFetchOpts = {}): Promise<ConfigResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `${HF_BASE}/${hfId}/raw/main/config.json`;
  const res = await fetchWithRetry(url, authHeaders(opts.token), fetchImpl);
  if (res.status === 401 || res.status === 403) return { gated: true };
  if (!res.ok) return { error: `config ${hfId}: HTTP ${res.status}` };
  try {
    return { config: (await res.json()) as unknown };
  } catch {
    return { error: `config ${hfId}: invalid JSON` };
  }
}

/**
 * 정수여도 소수점 1자리(.0)로 쓰는 float 필드 — 시드 표기 관행
 * (CLAUDE.md 스타일: 속도 tok/s 소수 1자리; fileGB·expertGB·nonExpertGB/fp16Tflops 는 물리량 표식).
 * 라운드트립 테스트가 시드 전 파일과의 바이트 일치를 강제한다.
 */
const FLOAT_1DP_FIELDS = new Set(['fileGB', 'expertGB', 'nonExpertGB', 'fp16Tflops', 'tgTokS']);

function stringifyInline(value: unknown, key?: string): string {
  if (typeof value === 'number') {
    if (key !== undefined && FLOAT_1DP_FIELDS.has(key) && Number.isInteger(value)) {
      return `${value}.0`;
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyInline(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([entryKey, val]) => `${JSON.stringify(entryKey)}: ${stringifyInline(val, entryKey)}`,
    );
    return `{ ${parts.join(', ')} }`;
  }
  throw new Error(`serializeRecords: unsupported value type '${typeof value}'`);
}

/**
 * 시드 포맷 재현: `[\n  {레코드 1줄},\n  …\n]\n`.
 * 인라인 오브젝트는 `{ "k": v }`(내부 패딩), 배열은 `[a, b]`(패딩 없음), LF 고정.
 */
export function serializeRecords(records: readonly unknown[]): string {
  if (records.length === 0) return '[]\n';
  const lines = records.map((record) => `  ${stringifyInline(record)}`);
  return `[\n${lines.join(',\n')}\n]\n`;
}
