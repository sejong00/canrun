/**
 * 손으로 쓴 MDX 의 데이터 컴포넌트 스캔 공용 — 가이드(`guides.test.ts`, D43)와 허브 소개글(`hub-intros.test.ts`, 10-14 D74).
 * 같은 명세(`lib/guide-components.ts`)로 컴포넌트·prop·블록 위치·문법 금지 항목을 본다. 테스트 파일이 아니라 vitest include(`*.test.ts`) 밖이다.
 */
import { GUIDES, GUIDE_SLUGS } from '../content/guides';
import { EXPECT_CONFIDENCES, EXPECT_MODES, GUIDE_COMPONENTS, MEMORY_KINDS, NUM_KINDS, RUNTIME_FACT_IDS, splitList, type PropKind } from '../lib/guide-components';
import { loadSeed } from '../../../packages/data/test/seed';

export type Usage = { name: string; props: Record<string, string>; line: number; raw: string };

/** `<Name a="b" c="d" />` 사용 목록 — prop 은 문자열 리터럴만 허용(식 `{…}` 은 스캔에서 따로 거부) */
export function componentUsages(src: string): Usage[] {
  const out: Usage[] = [];
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/<([A-Z][A-Za-z]*)\b([^>]*?)\/?>/g)) {
      const props: Record<string, string> = {};
      for (const p of m[2]!.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) props[p[1]!] = p[2]!;
      out.push({ name: m[1]!, props, line: i + 1, raw: m[0] });
    }
  });
  return out;
}

const seed = loadSeed();
export const catalogIds = {
  gpus: new Set(seed.gpus.map((g) => g.id)),
  models: new Set(seed.models.map((m) => m.id)),
  quants: new Set<string>(seed.quantDefs.map((q) => q.id)),
  /** dGPU VRAM 용량(GB) — VramPeers prop */
  dgpuVram: new Set(seed.gpus.filter((g) => g.kind === 'dgpu' && g.vramGB !== undefined).map((g) => g.vramGB as number)),
};

export function validProp(kind: PropKind, value: string): boolean {
  switch (kind) {
    case 'gpu':
      return catalogIds.gpus.has(value);
    case 'model':
      return catalogIds.models.has(value);
    case 'gpuList':
      return splitList(value).length > 0 && splitList(value).every((id) => catalogIds.gpus.has(id));
    case 'modelList':
      return splitList(value).length > 0 && splitList(value).every((id) => catalogIds.models.has(id));
    case 'grid':
      return GUIDE_SLUGS.some((slug) => value in GUIDES[slug].grids);
    case 'slug':
      return (GUIDE_SLUGS as readonly string[]).includes(value);
    case 'quant':
      return catalogIds.quants.has(value);
    case 'ctx':
      return /^\d+$/.test(value) && Number(value) >= 1024;
    case 'ctxList':
      return splitList(value).every((c) => /^\d+$/.test(c) && Number(c) >= 1024);
    case 'kv':
      return ['f16', 'q8_0', 'q4_0'].includes(value);
    case 'verdict':
      return ['S', 'A', 'B', 'F'].includes(value);
    case 'bool':
      return value === 'true' || value === 'false';
    case 'numKind':
      return (NUM_KINDS as readonly string[]).includes(value);
    case 'fact':
      return (RUNTIME_FACT_IDS as readonly string[]).includes(value);
    case 'memoryKind':
      return (MEMORY_KINDS as readonly string[]).includes(value);
    case 'mode':
      return (EXPECT_MODES as readonly string[]).includes(value);
    case 'ram':
      return /^[1-9]\d*$/.test(value);
    case 'confidence':
      return (EXPECT_CONFIDENCES as readonly string[]).includes(value);
    case 'vram':
      return /^[1-9]\d*$/.test(value) && catalogIds.dgpuVram.has(Number(value));
  }
}

/** 문법 금지 항목 — `#` 제목·파이프 표·`<table>`·import/export·내부 링크 리터럴·HTML 주석·frontmatter (식 `{}` 는 호출 쪽에서) */
export function syntaxProblems(src: string, where: string): string[] {
  const problems: string[] = [];
  src.split('\n').forEach((line, i) => {
    const at = `${where}:${i + 1}`;
    if (/^#\s/.test(line)) problems.push(`${at} "#" heading (h1 belongs to the page template)`);
    if (/^\s*\|.*\|\s*$/.test(line)) problems.push(`${at} pipe table (no GFM — use a data component)`);
    if (/<table\b/i.test(line)) problems.push(`${at} raw <table>`);
    if (/^\s*(?:import|export)\s/.test(line)) problems.push(`${at} import/export`);
    if (/\]\(\//.test(line) || /href="\//.test(line)) problems.push(`${at} internal link literal (use HubLink/GuideLink/ComboLink)`);
    if (/<!--/.test(line)) problems.push(`${at} HTML comment (not valid MDX)`);
  });
  if (/^---\s*$/m.test(src.split('\n')[0] ?? '')) problems.push(`${where} frontmatter`);
  return problems;
}

/** 컴포넌트 검사 — 명세에 있는 이름, 필수 prop, 값 종류, 모르는 prop, 블록 컴포넌트는 자기 줄에만 */
export function componentProblems(src: string, where: string): string[] {
  const problems: string[] = [];
  const lines = src.split('\n');
  for (const u of componentUsages(src)) {
    const spec = GUIDE_COMPONENTS[u.name];
    const at = `${where}:${u.line} <${u.name}>`;
    if (!spec) {
      problems.push(`${at} unknown component`);
      continue;
    }
    for (const [prop, { kind, required }] of Object.entries(spec.props)) {
      const value = u.props[prop];
      if (value === undefined) {
        if (required) problems.push(`${at} missing ${prop}`);
        continue;
      }
      if (!validProp(kind, value)) problems.push(`${at} invalid ${prop}="${value}"`);
    }
    for (const prop of Object.keys(u.props)) if (!(prop in spec.props)) problems.push(`${at} unknown prop ${prop}`);
    // 블록 컴포넌트는 자기 줄에만 (문단 속이면 <p><div> → 하이드레이션 불일치)
    if (spec.block && lines[u.line - 1]!.trim() !== u.raw.trim()) problems.push(`${at} block component must be alone on its line`);
  }
  return problems;
}
