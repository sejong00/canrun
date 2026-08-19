/**
 * 신모델 감지 — docs/03-data-spec.md §5.2 (P0-4).
 *
 * HF trending + 지정 org 신규 릴리스(7일 창)에서 카탈로그(models.json)·aliases 에 없는
 * text-generation 모델을 골라 GitHub issue 후보로 출력한다. 이슈 생성·중복 제거는
 * .github/workflows/new-model-alert.yml 의 gh CLI 몫 — 스크립트는 항상 read-only.
 * 48h 플레이북(docs/04 §8)의 트리거 신호.
 *
 * 실행: pnpm run new-model-alert [-- --json]   # --json: CI 용 구조화 출력
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModels, type Model } from '../packages/data/src/index';
import type { FetchLike } from './hf-common';

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

/** org 신규 릴리스 감시 창 (일). */
export const ORG_RELEASE_WINDOW_DAYS = 7;

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
  issueTitle: string;
  issueBody: string;
};

/** 카탈로그가 이미 아는 hfId 집합 (소문자) — 본체 + GGUF repo 참조까지. */
export function knownHfIds(models: readonly Model[], ggufRepos: readonly string[]): Set<string> {
  const known = new Set<string>();
  for (const model of models) known.add(model.hfId.toLowerCase());
  for (const repo of ggufRepos) known.add(repo.toLowerCase());
  return known;
}

/** GGUF 미러/양자화 repo 여부 — 원본 모델이 아니므로 후보 제외. */
const isGgufMirror = (hfId: string): boolean => /gguf|awq|gptq|-bnb-/i.test(hfId);

function toCandidate(model: HfApiModel, reason: Candidate['reason']): Candidate {
  const issueTitle = `[new-model] ${model.id}`;
  const bodyLines = [
    `HF: https://huggingface.co/${model.id}`,
    `사유: ${reason === 'trending' ? 'HF trending' : 'org 신규 릴리스'} · likes ${model.likes ?? 0} · downloads ${model.downloads ?? 0}`,
    model.createdAt !== undefined ? `createdAt: ${model.createdAt}` : undefined,
    '',
    '48h 플레이북 (docs/04 §8): ① config.json·GGUF 크기 수집(sync PR) ② 허브+콤보 페이지',
    '③ en/ko 가이드 ④ sitemap ping ⑤ (선택) 실측 1점 ⑥ 커뮤니티 링크',
  ].filter((line): line is string => line !== undefined);
  return {
    hfId: model.id,
    reason,
    likes: model.likes ?? 0,
    downloads: model.downloads ?? 0,
    createdAt: model.createdAt,
    url: `https://huggingface.co/${model.id}`,
    issueTitle,
    issueBody: bodyLines.join('\n'),
  };
}

/**
 * 후보 선별: trending 은 likes 컷, org 릴리스는 시간 창. 기지 모델·GGUF 미러 제외,
 * trending/org 중복은 org-release 우선(더 구체적 사유). now 는 순수성 유지를 위해 주입.
 */
export function filterCandidates(
  known: ReadonlySet<string>,
  trending: readonly HfApiModel[],
  orgReleases: readonly HfApiModel[],
  now: Date,
): Candidate[] {
  const byId = new Map<string, Candidate>();
  const windowStart = now.getTime() - ORG_RELEASE_WINDOW_DAYS * 24 * 3600 * 1000;

  const eligible = (m: HfApiModel): boolean =>
    !known.has(m.id.toLowerCase()) &&
    !isGgufMirror(m.id) &&
    (m.pipeline_tag === undefined || m.pipeline_tag === 'text-generation');

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

// ---------------------------------------------------------------------------
// 실행부
// ---------------------------------------------------------------------------

const HF_BASE = 'https://huggingface.co';

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<HfApiModel[]> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as HfApiModel[];
}

async function main(): Promise<void> {
  const json = process.argv.slice(2).includes('--json');
  const fetchImpl = globalThis.fetch;

  const rawModels = JSON.parse(readFileSync(join(dataDir, 'models.json'), 'utf8')) as unknown;
  const rawQuants = JSON.parse(
    readFileSync(join(dataDir, 'model-quants.json'), 'utf8'),
  ) as { ggufRepo: string }[];
  const models = parseModels(rawModels);
  const known = knownHfIds(models, rawQuants.map((mq) => mq.ggufRepo));

  const trending = await fetchJson(
    `${HF_BASE}/api/models?sort=trendingScore&direction=-1&limit=50&pipeline_tag=text-generation`,
    fetchImpl,
  );
  const orgReleases: HfApiModel[] = [];
  for (const org of WATCHED_ORGS) {
    const page = await fetchJson(
      `${HF_BASE}/api/models?author=${org}&sort=createdAt&direction=-1&limit=20&pipeline_tag=text-generation`,
      fetchImpl,
    );
    orgReleases.push(...page);
  }

  const candidates = filterCandidates(known, trending, orgReleases, new Date());

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
