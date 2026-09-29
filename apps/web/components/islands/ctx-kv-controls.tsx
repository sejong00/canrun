'use client';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useHydrated } from '@/lib/hydration';

/**
 * 콤보 페이지 ctx 슬라이더 · KV 토글 (docs/01 F3, P1-3 결정 D28) — 엔진 미탑재.
 * 서버가 ctx×KV 셀마다 만든 문장·명령(규칙 3 밴드 포함)을 props 로 받아, 선택한 셀을 정적 표에서 강조하고
 * 요약 문장과 실행 커맨드 블록(llama.cpp·Ollama·각주)을 그 셀의 것으로 바꾼다. URL 은 건드리지 않는다.
 * 상태 갱신은 이벤트 핸들러에서만 (react-hooks 7, D36).
 */
export type CtxCellView = {
  ctx: number;
  kv: string;
  /** 정적 표와 같은 필요량 문자열 ("10.9 GB") */
  need: string;
  fits: boolean;
  verdict: 'S' | 'A' | 'B' | 'F';
  /** 완성된 요약 문장 (fits 여부에 따라 서버가 고른 문장) */
  summary: string;
  command?: string;
  ollama?: { code: string; replSet: string; notes: string[] };
  notes: { key: string; text: string }[];
};

export type CtxKvLabels = {
  title: string;
  ctx: string;
  kv: string;
  reset: string;
  /** 이 설정엔 실행 명령이 없다 — 8k·f16 블록을 그대로 둔다 */
  commandNone: string;
  /** 아래 명령이 이 설정을 따른다 */
  commandFollows: string;
};

export type CtxKvProps = {
  cells: CtxCellView[];
  ctxs: number[];
  ctxLabels: string[];
  kvQuants: string[];
  initial: { ctx: number; kv: string };
  labels: CtxKvLabels;
};

const subscribeNoop = () => () => {};
const readSearch = () => (typeof window === 'undefined' ? '' : window.location.search);
const readServer = () => '';

function preset(search: string, p: CtxKvProps): { ctxIdx: number; kv: string } {
  const q = new URLSearchParams(search);
  const ctx = Number(q.get('ctx'));
  const kv = q.get('kv') ?? '';
  return {
    ctxIdx: p.ctxs.includes(ctx) ? p.ctxs.indexOf(ctx) : p.ctxs.indexOf(p.initial.ctx),
    kv: p.kvQuants.includes(kv) ? kv : p.initial.kv,
  };
}

function findCell(p: CtxKvProps, ctx: number, kv: string): CtxCellView | undefined {
  return p.cells.find((c) => c.ctx === ctx && c.kv === kv);
}

function setText(selector: string, text: string | undefined) {
  if (text === undefined) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (el) el.textContent = text;
}

function setNotes(selector: string, notes: { key: string; text: string }[]) {
  const ul = document.querySelector<HTMLElement>(selector);
  if (!ul) return;
  const keep = ul.querySelector('li:has(code)');
  ul.replaceChildren();
  for (const n of notes) {
    const li = document.createElement('li');
    li.dataset.snippetNote = n.key;
    li.textContent = n.text;
    ul.append(li);
  }
  if (keep) ul.append(keep);
}

/** 정적 마크업(서버 컴포넌트 출력, React 가 소유하지 않음)을 셀 값으로 바꾼다 */
function applyCell(cell: CtxCellView, initialCell: CtxCellView | undefined) {
  for (const td of document.querySelectorAll<HTMLElement>('[data-ctx-cell]')) {
    if (td.dataset.ctxCell === `${cell.ctx}:${cell.kv}`) td.setAttribute('aria-current', 'true');
    else td.removeAttribute('aria-current');
  }
  const source = cell.command ? cell : initialCell;
  if (!source?.command) return;
  setText('[data-snippet-code="llama.cpp"]', source.command);
  setNotes('[data-snippet-notes="llama.cpp"]', source.notes);
  // Ollama 블록: 이 셀에 Ollama 명령이 있으면 코드·각주까지 교체, 없으면(예: 큰 ctx 에서 cpu-moe 로 전환) 블록을 숨긴다 —
  // "아래 명령이 이 설정을 따릅니다" 문장이 8k 기준 Ollama 명령을 가리키지 않도록 (리뷰 지적)
  const ollamaFigure = document.querySelector<HTMLElement>('figure[data-snippet="ollama"]');
  if (source.ollama) {
    setText('[data-snippet-code="ollama"]', source.ollama.code);
    setText('[data-snippet-code="ollama-repl"]', source.ollama.replSet);
    setNotes(
      '[data-snippet-notes="ollama"]',
      source.ollama.notes.map((text, i) => ({ key: `ollama-${i}`, text })),
    );
    if (ollamaFigure) ollamaFigure.hidden = false;
  } else if (ollamaFigure) {
    ollamaFigure.hidden = true;
  }
}

export function CtxKvControls(p: CtxKvProps) {
  const id = useId();
  const hydrated = useHydrated();
  const search = useSyncExternalStore(subscribeNoop, readSearch, readServer);
  const initialPreset = preset(search, p);
  const [picked, setPicked] = useState<{ ctxIdx: number; kv: string } | undefined>(undefined);
  const current = picked ?? initialPreset;
  const ctx = p.ctxs[current.ctxIdx] ?? p.initial.ctx;
  const cell = findCell(p, ctx, current.kv);
  const initialCell = findCell(p, p.initial.ctx, p.initial.kv);
  const isInitial = ctx === p.initial.ctx && current.kv === p.initial.kv;

  const update = (next: { ctxIdx: number; kv: string }) => {
    setPicked(next);
    const target = findCell(p, p.ctxs[next.ctxIdx] ?? p.initial.ctx, next.kv);
    if (target) applyCell(target, initialCell);
  };

  // 프리셋(?ctx=&kv=, 계산기 딥링크)은 핸들러 없이 들어오므로 하이드레이션 뒤 정적 마크업만 맞춘다 (setState 없음)
  useEffect(() => {
    if (hydrated && picked === undefined && cell && !isInitial) applyCell(cell, initialCell);
  }, [hydrated, picked, cell, initialCell, isInitial]);
  const live = hydrated && cell && !isInitial ? cell : undefined;
  const commandNote = live ? (live.command ? p.labels.commandFollows : p.labels.commandNone) : '';

  return (
    <fieldset
      data-ctx-controls
      aria-label={p.labels.title}
      className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-4 text-sm"
    >
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label htmlFor={`${id}-ctx`}>
          {p.labels.ctx}: <output htmlFor={`${id}-ctx`}>{p.ctxLabels[current.ctxIdx]}</output>
        </label>
        <input
          id={`${id}-ctx`}
          data-ctx-slider
          type="range"
          min={0}
          max={p.ctxs.length - 1}
          step={1}
          value={current.ctxIdx}
          aria-valuetext={p.ctxLabels[current.ctxIdx]}
          disabled={!hydrated}
          onChange={(e) => update({ ctxIdx: Number(e.currentTarget.value), kv: current.kv })}
          className="h-7 w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          {p.ctxLabels.map((label, i) => (
            <button
              key={label}
              type="button"
              data-ctx-tick={p.ctxs[i]}
              disabled={!hydrated}
              aria-pressed={i === current.ctxIdx}
              onClick={() => update({ ctxIdx: i, kv: current.kv })}
              className="min-h-6 px-1 aria-pressed:font-semibold aria-pressed:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <fieldset data-kv-toggle className="flex items-center gap-3">
        <legend className="mb-1">{p.labels.kv}</legend>
        {p.kvQuants.map((kv) => (
          <label key={kv} className="flex min-h-6 items-center gap-1">
            <input
              type="radio"
              name={`${id}-kv`}
              value={kv}
              checked={current.kv === kv}
              disabled={!hydrated}
              onChange={() => update({ ctxIdx: current.ctxIdx, kv })}
            />
            {kv}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        data-ctx-reset
        disabled={!hydrated || isInitial}
        onClick={() => update({ ctxIdx: p.ctxs.indexOf(p.initial.ctx), kv: p.initial.kv })}
        className="min-h-6 text-xs text-muted-foreground underline-offset-4 hover:underline disabled:invisible"
      >
        {p.labels.reset}
      </button>
      <p
        data-live-summary
        data-ctx={live ? String(live.ctx) : undefined}
        data-kv={live ? live.kv : undefined}
        aria-live="polite"
        className="basis-full text-muted-foreground"
      >
        {live ? `${live.summary} ${commandNote}` : ''}
      </p>
    </fieldset>
  );
}
