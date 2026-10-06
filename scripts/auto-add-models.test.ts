/** 신모델 자동 추가(D71) 순수 코어 — 네트워크·fs 쓰기 없음. 템플릿 픽스처는 10-06 실제 HF 채팅 템플릿에서 해당 줄만 발췌. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNewModelSkips } from '../packages/data/src/index';
import {
  AUTO_MAX_ADD,
  AUTO_MIN_DOWNLOADS,
  AUTO_WINDOW_DAYS,
  REPORT_MARKER,
  allowedOrgs,
  classifyPlanError,
  estimateCategory,
  estimateKorean,
  estimateThinking,
  orgsToQuery,
  renderReport,
  runAdditions,
  selectCandidates,
  type AddedModel,
  type AutoCandidate,
  type ReportInput,
} from './auto-add-models';
import type { Candidate, HfApiModel } from './new-model-alert';

const NOW = new Date('2026-10-06T00:00:00Z');
const DAY = 24 * 3600 * 1000;
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * DAY).toISOString();

const cand = (hfId: string, over: Partial<Candidate> = {}): Candidate => ({
  hfId,
  reason: 'org-release',
  likes: 10,
  downloads: 100,
  createdAt: daysAgo(2),
  url: `https://huggingface.co/${hfId}`,
  ...over,
});

describe('selectCandidates — 허용 목록 또는 다운로드 2만, 스킵·창·드래프트·Base·용도 특화', () => {
  const allowed = allowedOrgs(['openbmb/MiniCPM5-2B']);
  const details = new Map<string, HfApiModel>([
    ['liquidai/lfm3-1b-draft', { id: 'LiquidAI/LFM3-1B-Draft', tags: ['draft-model'] }],
    ['qwen/qwen4-9b', { id: 'Qwen/Qwen4-9B', pipeline_tag: 'image-text-to-text', tags: ['code'] }],
  ]);

  it('takes allowlisted orgs regardless of downloads (catalog owners included), others only from 20,000 — popular first', () => {
    const sel = selectCandidates({
      candidates: [
        cand('Qwen/Qwen4-9B', { downloads: 50 }),
        cand('openbmb/MiniCPM6-1B', { downloads: 900 }),
        cand('someone/Big-Hit-8B', { downloads: AUTO_MIN_DOWNLOADS, reason: 'trending' }),
        cand('someone/Quiet-8B', { downloads: AUTO_MIN_DOWNLOADS - 1, reason: 'trending' }),
      ],
      details,
      skips: [],
      allowed,
      now: NOW,
    });
    expect(sel.eligible.map((c) => [c.hfId, c.official])).toEqual([
      ['someone/Big-Hit-8B', false],
      ['openbmb/MiniCPM6-1B', true],
      ['Qwen/Qwen4-9B', true],
    ]);
    expect(sel.eligible[2]).toMatchObject({ pipelineTag: 'image-text-to-text', tags: ['code'] });
    expect(sel.review).toEqual([expect.objectContaining({ hfId: 'someone/Quiet-8B', reason: '기준 미달' })]);
  });

  it('drops skip-list ids (case-insensitive) and candidates older than the window; routes drafts, Base and task models to review', () => {
    const sel = selectCandidates({
      candidates: [
        cand('Qwen/Qwen3.8-Flash-Next', { createdAt: daysAgo(40) }),
        cand('Qwen/Qwen3.5-4B', { createdAt: daysAgo(AUTO_WINDOW_DAYS + 1), reason: 'trending' }),
        cand('org/no-date', { createdAt: undefined }),
        cand('LiquidAI/LFM3-1B-Draft'),
        cand('poolside/Laguna-M-1-base'),
        cand('google/DiarizationLM-Gemma-4-E4B-v1'),
        cand('meta-llama/Llama-Prompt-Guard-3-86M'),
        cand('Qwen/Qwen4-9B', { createdAt: daysAgo(AUTO_WINDOW_DAYS - 1) }),
      ],
      details,
      skips: [{ hfId: 'qwen/QWEN3.8-flash-next', decision: 'wait', reason: '엔진 후속 ⑥', decidedAt: '2026-10-04' }],
      allowed,
      now: NOW,
    });
    expect(sel.skipped.map((s) => s.hfId)).toEqual(['qwen/QWEN3.8-flash-next']);
    expect(sel.stale).toBe(2);
    expect(sel.review.map((r) => [r.hfId, r.reason])).toEqual([
      ['LiquidAI/LFM3-1B-Draft', '드래프트 모델'],
      ['poolside/Laguna-M-1-base', 'Base 모델'],
      ['google/DiarizationLM-Gemma-4-E4B-v1', '용도 특화 모델'],
      ['meta-llama/Llama-Prompt-Guard-3-86M', '용도 특화 모델'],
    ]);
    expect(sel.eligible.map((c) => c.hfId)).toEqual(['Qwen/Qwen4-9B']);
  });

  it('queries watched orgs, the allowlist and catalog owners once each', () => {
    const orgs = orgsToQuery(['openbmb/MiniCPM5-2B', 'Qwen/Qwen3-8B', 'qwen/other']);
    expect(orgs).toContain('openbmb');
    expect(orgs).toContain('CohereLabs');
    expect(orgs.filter((o) => o.toLowerCase() === 'qwen')).toEqual(['Qwen']);
  });
});

describe('runAdditions — 한 번에 최대 3종, 실패는 확인 필요로', () => {
  const auto = (hfId: string): AutoCandidate => ({ ...cand(hfId), official: true, tags: [] });
  const added = (hfId: string): AddedModel => ({
    hfId, id: hfId.split('/')[1]!.toLowerCase(), name: hfId, structure: 'llama · full', ggufRepo: `${hfId}-GGUF`, paramsB: 8, license: 'Apache-2.0',
    popularity: 1, downloads: 100, maxContext: 131072, category: ['chat'], thinking: { sure: true, basis: '표지 없음' }, categoryBasis: 'chat 기본',
    korean: { value: false, basis: '목록 밖' }, warnings: [],
  });

  it('stops after AUTO_MAX_ADD additions; held/throwing candidates go to review; the rest wait for the next run', async () => {
    const list = ['a/One', 'a/Held', 'a/Throws', 'a/Two', 'a/Three', 'a/Four'].map(auto);
    const res = await runAdditions(list, async (c) => {
      if (c.hfId === 'a/Held') return { kind: 'review', item: { hfId: c.hfId, reason: '보류 구조', detail: 'deepseek_v4' } };
      if (c.hfId === 'a/Throws') throw new Error('Q4_K_M GGUF 를 찾지 못함 (후보: 없음) — --gguf 로 지정');
      return { kind: 'added', added: added(c.hfId) };
    });
    expect(res.added.map((m) => m.hfId)).toEqual(['a/One', 'a/Two', 'a/Three']);
    expect(res.added).toHaveLength(AUTO_MAX_ADD);
    expect(res.review.map((r) => [r.hfId, r.reason])).toEqual([
      ['a/Held', '보류 구조'],
      ['a/Throws', 'GGUF 없음'],
      ['a/Four', '다음 실행으로'],
    ]);
  });

  it('caps attempts so a day of failures stays bounded', async () => {
    const res = await runAdditions(['a/1', 'a/2', 'a/3'].map(auto), () => Promise.reject(new Error('boom')), { maxAdd: 3, maxAttempts: 2 });
    expect(res.review.map((r) => r.reason)).toEqual(['계획 실패', '계획 실패', '다음 실행으로']);
  });

  it('maps add-model stop messages to review reasons', () => {
    expect(classifyPlanError('Q4_K_M GGUF 를 찾지 못함 (후보: 없음)')).toBe('GGUF 없음');
    expect(classifyPlanError('MoE 활성 파라미터를 이름에서 못 읽음 — --active <B> 로 지정')).toBe('추정 실패');
    expect(classifyPlanError('파라미터 수(safetensors.total)를 받지 못함')).toBe('추정 실패');
    expect(classifyPlanError('config 를 받지 못함(게이트)')).toBe('계획 실패');
  });
});

describe('estimateThinking — 채팅 템플릿 (카탈로그 43종으로 맞춤: 확정 36종 전부 일치)', () => {
  const gen = (body: string): string => `{%- if add_generation_prompt %}${body}{%- endif %}`;

  it('reasoning_effort without a way to empty the thinking block → always (gpt-oss)', () => {
    const t = `{%- if reasoning_effort is not defined %}{%- set reasoning_effort = "medium" %}{%- endif %}{{- "Reasoning: " + reasoning_effort + "\\n\\n" }}`;
    expect(estimateThinking(t, 'openai/gpt-oss-20b')).toMatchObject({ value: 'always', sure: true });
  });

  it('reasoning_effort that can empty the block, default high → default-on (Solar Open2)', () => {
    const t = `{%- set reasoning_effort = reasoning_effort if reasoning_effort is defined else "high" %}${gen(
      `{%- if reasoning_effort in ["medium", "high", "xhigh"] -%}{{- "<|im:start|>assistant<|im:content|><|think:start|>" }}{%- else -%}{{- "<|im:start|>assistant<|im:content|><|think:start|><|think:end|>" }}{%- endif -%}`,
    )}`;
    expect(estimateThinking(t, 'upstage/Solar-Open2-250B')).toMatchObject({ value: 'default-on', sure: true });
  });

  it('enable_thinking: off only on request → default-on (Qwen3); on only on request → default-off (EXAONE 4.0)', () => {
    const qwen = gen(`{{- '<|im_start|>assistant\\n' }}{%- if enable_thinking is defined and enable_thinking is false %}{{- '<think>\\n\\n</think>\\n\\n' }}{%- endif %}`);
    expect(estimateThinking(qwen, 'Qwen/Qwen3-8B')).toMatchObject({ value: 'default-on', sure: true });
    const exaone = gen(`{%- if enable_thinking is defined and enable_thinking is true %}{{- '<think>\\n' }}{%- endif %}`);
    expect(estimateThinking(exaone, 'LGAI-EXAONE/EXAONE-4.0-32B')).toMatchObject({ value: 'default-off', sure: true });
  });

  it('enable_thinking with an explicit default wins (Gemma 4 default(false), Granite else True)', () => {
    expect(estimateThinking('{%- set enable_thinking = enable_thinking | default(false) -%}', 'google/gemma-4-31B-it')).toMatchObject({ value: 'default-off', sure: true });
    expect(estimateThinking('{%- set enable_thinking = enable_thinking if enable_thinking is defined else True %}', 'ibm-granite/granite-4.2-30b')).toMatchObject({ value: 'default-on', sure: true });
  });

  it('nested enable_thinking branches → best guess default-on, flagged for review (MiniCPM5 is auto)', () => {
    const t = gen(`{%- if enable_thinking is defined %}{%- if enable_thinking is false %}{{- '<think>\\n\\n</think>\\n\\n' }}{%- elif enable_thinking is true %}{{- '<think>\\n' }}{%- endif %}{%- endif %}`);
    expect(estimateThinking(t, 'openbmb/MiniCPM5-2B')).toMatchObject({ value: 'default-on', sure: false });
  });

  it('<think> opened at the start of every answer → always (R1 Distill); <think> only in history → default-on, flagged', () => {
    expect(estimateThinking(`{% if add_generation_prompt %}{{'<｜Assistant｜><think>\\n'}}{% endif %}`, 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B')).toMatchObject({ value: 'always', sure: true });
    const history = `{%- set content = content.split('</think>')[-1] %}{{- '<think>' + reasoning + '</think>' }}${gen(`{{- '<|im_start|>assistant\\n' }}`)}`;
    expect(estimateThinking(history, 'org/Model-7B')).toMatchObject({ value: 'default-on', sure: false });
  });

  it('no markers → no thinking mode; missing template or a Think name → flagged', () => {
    expect(estimateThinking(gen(`{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}`), 'meta-llama/Llama-3.2-3B-Instruct')).toEqual({ sure: true, basis: '채팅 템플릿에 생각 모드 표지 없음' });
    expect(estimateThinking(undefined, 'mistralai/Mistral-Small-3.2-24B-Instruct-2506')).toEqual({ sure: false, basis: '채팅 템플릿을 받지 못함' });
    expect(estimateThinking('{{ messages }}', 'naver-hyperclovax/HyperCLOVAX-SEED-Think-14B')).toMatchObject({ value: 'default-on', sure: false });
  });
});

describe('estimateCategory · estimateKorean', () => {
  it('chat by default; code names/tags → coding; image input → vision; always-thinking → reasoning (catalog order)', () => {
    expect(estimateCategory({ hfId: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', tags: [] }).value).toEqual(['chat', 'coding']);
    expect(estimateCategory({ hfId: 'org/Model', tags: ['code'], pipelineTag: 'image-text-to-text', thinking: 'always' }).value).toEqual(['chat', 'coding', 'reasoning', 'vision']);
    expect(estimateCategory({ hfId: 'org/Encoder-Model', tags: [], thinking: 'default-on' }).value).toEqual(['chat']);
  });

  it('Korean makers → korean', () => {
    expect(estimateKorean('LGAI-EXAONE/EXAONE-5.0-32B')).toMatchObject({ value: true });
    expect(estimateKorean('kakaocorp/kanana-2-8b')).toMatchObject({ value: true });
    expect(estimateKorean('Qwen/Qwen4-9B')).toMatchObject({ value: false });
  });
});

describe('renderReport — PR 본문', () => {
  const model: AddedModel = {
    hfId: 'Qwen/Qwen4-9B', id: 'qwen4-9b', name: 'Qwen4 9B', structure: 'qwen3_5_text · hybrid', ggufRepo: 'unsloth/Qwen4-9B-GGUF', paramsB: 9.65,
    license: 'Apache-2.0', popularity: 2, downloads: 45210, maxContext: 262144, category: ['chat', 'coding', 'vision'],
    thinking: { value: 'default-on', sure: false, basis: 'enable_thinking 있음 — 템플릿에서 기본값을 확정하지 못함' },
    categoryBasis: 'chat 기본 · 이름·태그에 code', korean: { value: false, basis: '한국 제작사 목록 밖' },
    warnings: ['표시명 "Qwen4 9B" 은 자동 — 어색하면 --name 으로'],
  };
  const base: ReportInput = { date: '2026-10-06', dry: false, added: [model], review: [], skipped: [], stale: 0, gate: { status: 'pass' }, fontRefreshed: false };

  it('lists each model with estimates and their basis, the review checklist and a machine-readable marker', () => {
    const md = renderReport({
      ...base,
      review: [{ hfId: 'org/Small-1B', reason: '기준 미달', detail: '허용 목록 밖', downloads: 120, createdAt: '2026-10-03' }],
      skipped: [{ hfId: 'Qwen/Qwen3.8-Flash-Next', decision: 'wait', reason: '⑥', decidedAt: '2026-10-04' }],
      stale: 5,
      fontRefreshed: true,
    });
    expect(md).toContain('## 신모델 자동 추가 — 2026-10-06');
    expect(md).toContain('### 추가한 모델 (1종)');
    expect(md).toContain('[Qwen/Qwen4-9B](https://huggingface.co/Qwen/Qwen4-9B) → `qwen4-9b` (Qwen4 9B)');
    expect(md).toContain('default-on ⚠확인 필요 — enable_thinking 있음');
    expect(md).toContain('- [ ] **Qwen/Qwen4-9B** 생각 모드 `default-on` (⚠확인 필요)');
    expect(md).toContain('최대 컨텍스트 262,144');
    expect(md).toContain('| [org/Small-1B](https://huggingface.co/org/Small-1B) | 기준 미달 | 허용 목록 밖 | 120 | 2026-10-03 |');
    expect(md).toContain('Qwen/Qwen3.8-Flash-Next(wait)');
    expect(md).toContain('trending 후보 5종');
    expect(md).toContain('scripts/og-font.ts');
    expect(md).toContain('통과했습니다');
    expect(md).toContain(`<!-- ${REPORT_MARKER} Qwen/Qwen4-9B -->`);
  });

  it('empty run and failed final check say no PR is made', () => {
    const empty = renderReport({ ...base, added: [], gate: { status: 'none' } });
    expect(empty).toContain('자동으로 넣은 모델이 없습니다 — PR 을 만들지 않습니다.');
    expect(empty).toContain('### 확인 필요 — 자동으로 넣지 않은 후보 (0건)');
    expect(empty).not.toContain('② 가 확인할 것');
    expect(empty).toContain(`<!-- ${REPORT_MARKER}  -->`);
    const failed = renderReport({ ...base, gate: { status: 'fail', step: 'pnpm build', tail: 'Error: boom' } });
    expect(failed).toContain('마지막 검사 `pnpm build` 가 실패해 PR 을 만들지 않았습니다');
    expect(failed).toContain('Error: boom');
    expect(renderReport({ ...base, dry: true, gate: { status: 'dry' } })).toContain('### 추가할 모델 (1종)');
  });
});

describe('skip list — scripts/new-model-skips.json (zod)', () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'new-model-skips.json');

  it('parses, with unique HF ids and a reason for each decision', () => {
    const skips = parseNewModelSkips(JSON.parse(readFileSync(path, 'utf8')));
    expect(skips.length).toBeGreaterThan(0);
    for (const s of skips) expect(s.reason.length).toBeGreaterThan(0);
  });

  it('rejects unknown decisions, bad dates, non-HF ids, extra keys and duplicates', () => {
    const ok = { hfId: 'org/Model-1B', decision: 'skip', reason: '이유', decidedAt: '2026-10-06' };
    expect(() => parseNewModelSkips([ok])).not.toThrow();
    expect(() => parseNewModelSkips([{ ...ok, decision: 'maybe' }])).toThrow();
    expect(() => parseNewModelSkips([{ ...ok, decidedAt: '10-06' }])).toThrow();
    expect(() => parseNewModelSkips([{ ...ok, hfId: 'Model-1B' }])).toThrow();
    expect(() => parseNewModelSkips([{ ...ok, note: 'x' }])).toThrow();
    expect(() => parseNewModelSkips([ok, { ...ok, hfId: 'ORG/model-1b' }])).toThrow();
  });
});
