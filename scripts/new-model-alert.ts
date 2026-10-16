/**
 * 신모델 감지 — docs/03-data-spec.md §5.2 (P0-4).
 *
 * HF trending + 지정 org 신규 릴리스(8일 창)에서 카탈로그(models.json)에 없는 LLM 원본을
 * 골라, 이미 보고된 모델을 뺀 뒤 요약 이슈 1건의 제목·본문을 만든다. 이슈 생성은
 * .github/workflows/new-model-alert.yml 의 gh CLI 몫 — 스크립트는 항상 read-only.
 * 48h 플레이북(docs/04 §8)의 트리거 신호 (출시 전 주 1회 — docs/PROGRESS.md §4 09-28).
 *
 * 실행: pnpm run new-model-alert                          # 후보 표 (로컬 확인용)
 *       pnpm run new-model-alert -- --json                # 후보 JSON
 *       pnpm run new-model-alert -- --digest issues.json  # 요약 이슈 JSON (issues.json = gh issue list --json title,body)
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModels, type Model } from '../packages/data/src/index';
import { authHeaders, fetchWithRetry, type FetchLike } from './hf-common';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'data');

// ---------------------------------------------------------------------------
// 순수 코어 (테스트 대상)
// ---------------------------------------------------------------------------

/** 감시 org — docs/03 §5.2 "지정 org" + 한국 모델(EXAONE/Kanana/HyperCLOVA X, P0-4b 연계). */
export const WATCHED_ORGS = [
  'meta-llama',
  'Qwen',
  'google',
  'mistralai',
  'openai',
  'deepseek-ai',
  'microsoft',
  'LGAI-EXAONE',
  'kakaocorp',
  'naver-hyperclovax',
] as const;

/** trending 노이즈 컷 — 파인튠 잡음 제거용 최소 likes. */
export const TRENDING_MIN_LIKES = 100;

/** org 신규 릴리스 감시 창 (일) — 주 1회 실행 + 스케줄 지연 여유 1일. 겹치는 날은 보고 이력으로 중복 제거. */
export const ORG_RELEASE_WINDOW_DAYS = 8;

/**
 * LLM 파이프라인 — Qwen3.6+ 등 최신 원본은 네이티브 멀티모달이라 image-text-to-text 로 태깅된다.
 * text-generation 만 보면 원본은 빠지고 텍스트 전용 파생만 잡힌다 (09-28 트리아지: Qwen3.8-27B 누락).
 */
export const LLM_PIPELINES = ['text-generation', 'image-text-to-text'] as const;

export type HfApiModel = {
  id: string;
  likes?: number;
  downloads?: number;
  createdAt?: string;
  pipeline_tag?: string;
  tags?: string[];
};

export type Candidate = {
  hfId: string;
  reason: 'trending' | 'org-release';
  likes: number;
  downloads: number;
  createdAt?: string;
  url: string;
};

/** 요약 이슈 — 본문 끝의 마커가 다음 실행의 중복 제거 키. */
export type Digest = {
  title: string;
  body: string;
  hfIds: string[];
};

/** 요약 이슈 본문의 보고 이력 마커. */
export const DIGEST_MARKER = 'new-model-ids:';

/** 카탈로그가 이미 아는 hfId 집합 (소문자) — 본체 + GGUF repo 참조까지. */
export function knownHfIds(models: readonly Model[], ggufRepos: readonly string[]): Set<string> {
  const known = new Set<string>();
  for (const model of models) known.add(model.hfId.toLowerCase());
  for (const repo of ggufRepos) known.add(repo.toLowerCase());
  return known;
}

/**
 * 양자화·포맷 리팩과 검열 제거·드래프트 파생 — 원본이 아니므로 후보 제외
 * (09-28 트리아지 71건 중 절반이 이 부류). BF16 은 NVIDIA 등이 원본 표기로 쓰므로 제외하지 않는다.
 * dspark = 추측 디코딩 드래프트(10-06 자동 추가 작업 중 확인: LiquidAI·skt·LGAI-EXAONE 의 `-DSpark` 저장소, D71).
 * fp4(mxfp4·nvfp4)·onnx = 공식 제작사가 함께 올리는 형식 변형(10-06 리뷰: ibm-granite/granite-4.2-8b-mxfp4·LiquidAI/LFM2.5-2.6B-ONNX).
 */
const REPACK_PATTERN =
  /gguf|awq|gptq|-bnb-|fp8|fp4|mlx|-int[48]\b|w4a16|exl2|onnx|abliterat|uncensor|obliterat|dflash|dspark/i;

export const isRepack = (hfId: string): boolean => REPACK_PATTERN.test(hfId);

/** OCR 전용 VLM — image-text-to-text 로 태깅되지만 LLM 계산기 대상이 아니다 (09-28 첫 요약 드라이런). */
const TASK_ONLY_PATTERN = /ocr/i;

/**
 * 다른 org 모델을 base_model 로 둔 파생(파인튠·양자화·머지·어댑터) 여부 — HF tags 기준.
 * 같은 org 의 Instruct←Base 는 원본으로 본다.
 */
export function isThirdPartyDerivative(model: HfApiModel): boolean {
  const org = model.id.split('/')[0]?.toLowerCase();
  return (model.tags ?? []).some((tag) => {
    const base = /^base_model:(?:finetune|quantized|merge|adapter):([^/]+)\//.exec(tag);
    return base?.[1] !== undefined && base[1].toLowerCase() !== org;
  });
}

function toCandidate(model: HfApiModel, reason: Candidate['reason']): Candidate {
  return {
    hfId: model.id,
    reason,
    likes: model.likes ?? 0,
    downloads: model.downloads ?? 0,
    createdAt: model.createdAt,
    url: `https://huggingface.co/${model.id}`,
  };
}

/**
 * 후보 선별: trending 은 likes 컷, org 릴리스는 시간 창. 기지 모델·GGUF 미러 제외,
 * trending/org 중복은 org-release 우선(더 구체적 사유). now 는 순수성 유지를 위해 주입.
 * windowDays: org 릴리스 창 — 신모델 자동 추가(scripts/auto-add-models.ts, D71)는 14일로 부른다.
 */
export function filterCandidates(
  known: ReadonlySet<string>,
  trending: readonly HfApiModel[],
  orgReleases: readonly HfApiModel[],
  now: Date,
  windowDays: number = ORG_RELEASE_WINDOW_DAYS,
): Candidate[] {
  const byId = new Map<string, Candidate>();
  const windowStart = now.getTime() - windowDays * 24 * 3600 * 1000;

  const pipelines: readonly string[] = LLM_PIPELINES;
  const eligible = (m: HfApiModel): boolean =>
    !known.has(m.id.toLowerCase()) &&
    !isRepack(m.id) &&
    !TASK_ONLY_PATTERN.test(m.id) &&
    !isThirdPartyDerivative(m) &&
    (m.pipeline_tag === undefined || pipelines.includes(m.pipeline_tag));

  for (const m of trending) {
    if (!eligible(m)) continue;
    if ((m.likes ?? 0) < TRENDING_MIN_LIKES) continue;
    byId.set(m.id.toLowerCase(), toCandidate(m, 'trending'));
  }
  for (const m of orgReleases) {
    if (!eligible(m)) continue;
    if (m.createdAt === undefined) continue;
    const created = Date.parse(m.createdAt);
    if (Number.isNaN(created) || created < windowStart) continue;
    byId.set(m.id.toLowerCase(), toCandidate(m, 'org-release'));
  }
  return [...byId.values()];
}

/** 이미 보고된 hfId (소문자) — 구 개별 이슈 제목 `[new-model] <org>/<name>` + 요약 이슈 본문 마커. */
export function reportedHfIds(issues: readonly { title: string; body?: string }[]): Set<string> {
  const ids = new Set<string>();
  const markerRe = new RegExp(`<!-- ${DIGEST_MARKER} ([^>]*) -->`);
  for (const issue of issues) {
    const single = /^\[new-model\] ([^\s/]+\/\S+)$/.exec(issue.title.trim());
    if (single?.[1] !== undefined) ids.add(single[1].toLowerCase());
    const marker = markerRe.exec(issue.body ?? '');
    for (const id of marker?.[1]?.split(',') ?? []) {
      if (id.trim() !== '') ids.add(id.trim().toLowerCase());
    }
  }
  return ids;
}

/** 미보고 후보만 모아 요약 이슈 1건을 만든다. 새 후보가 없으면 null (이슈 생성 안 함). now 는 주입. */
export function buildDigest(
  candidates: readonly Candidate[],
  reported: ReadonlySet<string>,
  now: Date,
): Digest | null {
  const fresh = candidates.filter((c) => !reported.has(c.hfId.toLowerCase()));
  if (fresh.length === 0) return null;
  const hfIds = fresh.map((c) => c.hfId);
  const rows = fresh.map(
    (c) =>
      `| [${c.hfId}](${c.url}) | ${c.reason === 'trending' ? 'HF trending' : 'org 신규 릴리스'} | ${c.likes} | ${c.downloads} | ${c.createdAt?.slice(0, 10) ?? '—'} |`,
  );
  const body = [
    `신모델 후보 ${fresh.length}건 — HF trending + 감시 org 릴리스, 카탈로그·기보고·리팩·타 org 파생 제외.`,
    '',
    '| 모델 | 사유 | likes | downloads | createdAt |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '트리아지: `/canrun-start`에서 Claude가 가치 판정 → 추가할 모델만 카탈로그 태스크로 옮기고 이 이슈를 닫는다.',
    '48h 플레이북 (docs/04 §8): ① config.json·GGUF 크기 수집(sync PR) ② 허브+콤보 페이지 ③ en/ko 가이드 ④ GSC 색인 요청(IndexNow 는 배포 때 자동) ⑤ (선택) 실측 1점 ⑥ 커뮤니티 링크',
    '',
    `<!-- ${DIGEST_MARKER} ${hfIds.join(',')} -->`,
  ];
  return {
    title: `[new-model] 후보 ${now.toISOString().slice(0, 10)} (${fresh.length}건)`,
    body: body.join('\n'),
    hfIds,
  };
}

// ---------------------------------------------------------------------------
// 실행부
// ---------------------------------------------------------------------------

const HF_BASE = 'https://huggingface.co';

async function fetchJson(url: string, headers: Record<string, string>, fetchImpl: FetchLike): Promise<HfApiModel[]> {
  const res = await fetchWithRetry(url, headers, fetchImpl);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as HfApiModel[];
}

/**
 * 탐지 원천 — 파이프라인별 HF trending 50 + org 마다 최근 생성 20. 신모델 자동 추가(D71)가 org 목록을 넓혀 같은 함수를 부른다.
 * 429·5xx 는 1회 재시도(fetchWithRetry), 그래도 실패하면 throw.
 */
export async function fetchDetectionSources(
  orgs: readonly string[],
  opts: { token?: string; fetchImpl?: FetchLike } = {},
): Promise<{ trending: HfApiModel[]; orgReleases: HfApiModel[] }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const headers = authHeaders(opts.token);
  const trending: HfApiModel[] = [];
  const orgReleases: HfApiModel[] = [];
  for (const pipeline of LLM_PIPELINES) {
    trending.push(
      ...(await fetchJson(
        `${HF_BASE}/api/models?sort=trendingScore&direction=-1&limit=50&pipeline_tag=${pipeline}`,
        headers,
        fetchImpl,
      )),
    );
    for (const org of orgs) {
      orgReleases.push(
        ...(await fetchJson(
          `${HF_BASE}/api/models?author=${org}&sort=createdAt&direction=-1&limit=20&pipeline_tag=${pipeline}`,
          headers,
          fetchImpl,
        )),
      );
    }
  }
  return { trending, orgReleases };
}

/** 카탈로그(models.json hfId + model-quants.json ggufRepo)가 아는 id 집합 — 자동 추가(D71)도 같은 기준 */
export function loadKnownHfIds(dir = dataDir): Set<string> {
  const rawModels = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8')) as unknown;
  const rawQuants = JSON.parse(readFileSync(join(dir, 'model-quants.json'), 'utf8')) as { ggufRepo: string }[];
  return knownHfIds(parseModels(rawModels), rawQuants.map((mq) => mq.ggufRepo));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const digestIdx = args.indexOf('--digest');
  const reportedPath = digestIdx >= 0 ? args[digestIdx + 1] : undefined;
  if (digestIdx >= 0 && reportedPath === undefined) throw new Error('--digest 에는 이슈 JSON 경로가 필요');

  const known = loadKnownHfIds();
  const { trending, orgReleases } = await fetchDetectionSources(WATCHED_ORGS);

  const now = new Date();
  const candidates = filterCandidates(known, trending, orgReleases, now);

  if (reportedPath !== undefined) {
    const issues = JSON.parse(readFileSync(reportedPath, 'utf8')) as { title: string; body?: string }[];
    console.log(JSON.stringify(buildDigest(candidates, reportedHfIds(issues), now), null, 2));
    return;
  }
  if (json) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  if (candidates.length === 0) {
    console.log('신규 모델 후보 없음 (trending + org 릴리스 기준)');
    return;
  }
  console.log(`| hfId | 사유 | likes | downloads | createdAt |`);
  console.log(`|---|---|---|---|---|`);
  for (const c of candidates) {
    console.log(`| ${c.hfId} | ${c.reason} | ${c.likes} | ${c.downloads} | ${c.createdAt ?? '—'} |`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
