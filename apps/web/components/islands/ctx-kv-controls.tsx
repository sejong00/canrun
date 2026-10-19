'use client';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { comboPreset } from '@/lib/combo-preset';
import { useHydrated } from '@/lib/hydration';

/**
 * 콤보 페이지 ctx 슬라이더 · KV 토글 (docs/01 F3, P1-3 결정 D28) + 시스템 RAM 토글 (10-03 D64) — 엔진 미탑재.
 * 서버가 ctx×KV 셀마다 만든 문장·명령(규칙 3 밴드 포함)을 props 로 받아, 선택한 셀을 정적 표에서 강조하고
 * 요약 문장과 실행 커맨드 블록(llama.cpp·Ollama·각주)을 그 셀의 것으로 바꾼다. URL 은 건드리지 않는다.
 * RAM 토글(맨 위 판정이 RAM 에 따라 바뀌는 dGPU 페이지만)은 정적 스니펫을 8k·f16 으로 되돌리기만 하고 RAM 내용으로
 * 바꾸지 않는다 — 다른 RAM 을 고르면 ctx·KV 를 8k·f16 으로 고정하고, 서버가 만든 그 RAM 의 판정 문장·파일·명령을
 * 아일랜드가 직접 그린다. fieldset 은 기본 min-inline-size 가 min-content 라 min-w-0 으로 풀어 둔다(명령 줄이 폭을 넓히지 않게).
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
  /** Ollama 블록 — serveHint 는 OS 별 안내("PowerShell …"/"터미널:") */
  ollama?: { code: string; replSet: string; notes: string[]; serveHint: string };
  /** llama.cpp 명령은 있는데 Ollama 가 안 되는 셀(분할 GGUF)의 생략 사유 문장 */
  ollamaOmitted?: string;
  notes: { key: string; text: string }[];
};

export type CtxKvLabels = {
  title: string;
  ctx: string;
  /** 슬라이더 위 "컨텍스트: 8k" 의 앞부분 — 구분 기호까지 로캘 문구(zh 는 전각 콜론, 10-19 D109) */
  ctxPrefix: string;
  kv: string;
  reset: string;
  /** 이 설정엔 실행 명령이 없다 — 8k·f16 블록을 그대로 둔다 */
  commandNone: string;
  /** 아래 명령이 이 설정을 따른다 */
  commandFollows: string;
};

/** RAM 단계의 실행 계획 — 들어가는 양자화마다 1개(명령은 RAM 과 무관해 양자화로 중복 제거) */
export type RamPlanView = {
  /** "파일: … (GB, repo)." */
  file: string;
  command: string;
  notes: string[];
  ollama?: { code: string; replSet: string; notes: string[]; serveHint: string };
  ollamaOmitted?: string;
};

export type RamOptionView = {
  ram: number;
  /** "16GB" */
  label: string;
  /** 서버가 완성한 문장 ("시스템 RAM 16GB 기준: {판정 문장}") — 정적 기준 RAM 은 '' */
  summary: string;
  /** plans 인덱스 — 이 RAM 에서 표시 양자화가 들어가지 않으면 -1 */
  plan: number;
  /**
   * plan 이 있을 때만: 그 RAM 을 밝힌 안내("시스템 RAM 16GB에서는 IQ4_XS 파일을 씁니다…")와 코드 영역 이름
   * ("시스템 RAM 16GB용 llama.cpp 명령") — 정적 스니펫의 같은 이름 영역과 구분된다 (리뷰 반영)
   */
  view?: { intro: string; llamaCpp: string; ollama: string };
};

export type CtxKvRam = {
  options: RamOptionView[];
  plans: RamPlanView[];
  /** 정적 표·명령이 계산된 RAM (보통 32GB, RAM 힌트 페이지는 힌트 RAM) */
  initial: number;
  /** 계산기 주소 (`…/calculator?gpu=…&m=…`) — RAM 모드에서만 `&ram=N` 을 붙여 그린다(정적 HTML 에 쿼리 링크 없음) */
  calcHref: string;
  labels: { legend: string; locked: string; calcLink: string; llamaCpp: string; ollama: string };
};

export type CtxKvProps = {
  cells: CtxCellView[];
  ctxs: number[];
  ctxLabels: string[];
  kvQuants: string[];
  initial: { ctx: number; kv: string };
  labels: CtxKvLabels;
  ram?: CtxKvRam;
};

const subscribeNoop = () => () => {};
const readSearch = () => (typeof window === 'undefined' ? '' : window.location.search);
const readServer = () => '';

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

/** 정적 마크업(서버 컴포넌트 출력)에서 `attr` 값이 `value` 인 요소만 aria-current — undefined 면 전부 해제 */
function markCurrent(attr: string, value: string | undefined) {
  for (const el of document.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    if (el.getAttribute(attr) === value) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
}

/** 정적 마크업(서버 컴포넌트 출력, React 가 소유하지 않음)을 셀 값으로 바꾼다 */
function applyCell(cell: CtxCellView, initialCell: CtxCellView | undefined) {
  markCurrent('data-ctx-cell', `${cell.ctx}:${cell.kv}`);
  const source = cell.command ? cell : initialCell;
  if (!source?.command) return;
  setText('[data-snippet-code="llama.cpp"]', source.command);
  setNotes('[data-snippet-notes="llama.cpp"]', source.notes);
  renderOllama(source);
}

/**
 * Ollama 블록을 셀 상태로 다시 그린다 — 양방향(리뷰 반영): 명령·각주(cpu-moe 셀은 Ollama 0.30+ 자동 배치 안내)를 셀 값으로,
 * 생략 셀(분할 GGUF)이면 생략 사유로. 10-01 D56 부터 cpu-moe 도 명령이 있다. 마크업은 서버 `CommandSnippet` 과
 * 같은 구조(figcaption → 안내 p → 코드 영역 → 각주 ul)이고, 코드 영역은 llama.cpp 영역을 복제해 스타일·a11y 속성을 맞춘다.
 */
function renderOllama(source: CtxCellView) {
  const figure = document.querySelector<HTMLElement>('figure[data-snippet="ollama"], figure[data-snippet-omitted="ollama"]');
  const caption = figure?.querySelector('figcaption');
  if (!figure || !caption) return;
  if (source.ollama) {
    const regionTemplate = document.querySelector<HTMLElement>('figure[data-snippet="llama.cpp"] [role="region"]');
    const region = regionTemplate?.cloneNode(true) as HTMLElement | undefined;
    const code = region?.querySelector<HTMLElement>('code');
    if (!region || !code) return;
    region.setAttribute('aria-label', caption.textContent ?? '');
    code.dataset.snippetCode = 'ollama';
    code.textContent = source.ollama.code;
    const hint = document.createElement('p');
    hint.className = 'text-xs text-muted-foreground';
    hint.textContent = source.ollama.serveHint;
    const list = document.createElement('ul');
    list.className = 'list-disc pl-5 text-xs text-muted-foreground';
    list.dataset.snippetNotes = 'ollama';
    for (const text of source.ollama.notes) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
    const replItem = document.createElement('li');
    const repl = document.createElement('code');
    repl.dataset.snippetCode = 'ollama-repl';
    repl.textContent = source.ollama.replSet;
    replItem.append(repl);
    list.append(replItem);
    figure.replaceChildren(caption, hint, region, list);
    figure.removeAttribute('data-snippet-omitted');
    figure.dataset.snippet = 'ollama';
  } else if (source.ollamaOmitted) {
    const note = document.createElement('p');
    note.className = 'text-sm text-muted-foreground';
    note.textContent = source.ollamaOmitted;
    figure.replaceChildren(caption, note);
    figure.removeAttribute('data-snippet');
    figure.dataset.snippetOmitted = 'ollama';
  }
}

const NOTES_CLASS = 'list-disc pl-5 text-xs text-muted-foreground';

/** 아일랜드가 직접 그리는 코드 영역 — 정적 `CommandSnippet` 과 같은 모양, 다른 data 훅(정적 블록 교체와 섞이지 않게) */
function Code({ code, label, name }: { code: string; label: string; name: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-md border border-border bg-muted p-3 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <pre className="text-xs leading-5 whitespace-pre">
        <code data-ram-code={name}>{code}</code>
      </pre>
    </div>
  );
}

/** 다른 RAM 을 골랐을 때의 결과 블록 — 파일·llama.cpp·Ollama 명령(그 RAM 에서 들어갈 때만)과 계산기 링크 */
function RamResult({ ram, option }: { ram: CtxKvRam; option: RamOptionView }) {
  const plan = ram.plans[option.plan];
  const view = option.view;
  // min-w-0: 줄바꿈 없는 명령(<pre>)이 이 블록·바깥 fieldset 을 넓혀 휴대폰에서 페이지가 가로로 밀리지 않게 (리뷰 반영)
  return (
    <div data-ram-result={option.ram} className="flex min-w-0 basis-full flex-col gap-3">
      {plan && view && (
        <>
          <p className="text-muted-foreground">{view.intro}</p>
          <p className="break-all">{plan.file}</p>
          <p className="font-medium">{ram.labels.llamaCpp}</p>
          <Code code={plan.command} label={view.llamaCpp} name="llama.cpp" />
          <ul className={NOTES_CLASS}>
            {plan.notes.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p className="font-medium">{ram.labels.ollama}</p>
          {plan.ollama ? (
            <>
              <p className="text-xs text-muted-foreground">{plan.ollama.serveHint}</p>
              <Code code={plan.ollama.code} label={view.ollama} name="ollama" />
              <ul className={NOTES_CLASS}>
                {plan.ollama.notes.map((text) => (
                  <li key={text}>{text}</li>
                ))}
                <li>
                  <code>{plan.ollama.replSet}</code>
                </li>
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">{plan.ollamaOmitted}</p>
          )}
        </>
      )}
      <a data-ram-calc href={`${ram.calcHref}&ram=${option.ram}`} className="self-start underline underline-offset-4">
        {ram.labels.calcLink}
      </a>
    </div>
  );
}

export function CtxKvControls(p: CtxKvProps) {
  const id = useId();
  const hydrated = useHydrated();
  const search = useSyncExternalStore(subscribeNoop, readSearch, readServer);
  const ram = p.ram;
  const initialPreset = comboPreset(search, {
    ctxs: p.ctxs,
    kvQuants: p.kvQuants,
    initial: p.initial,
    ...(ram ? { ram: { options: ram.options.map((o) => o.ram), initial: ram.initial } } : {}),
  });
  const [picked, setPicked] = useState<{ ctxIdx: number; kv: string } | undefined>(undefined);
  const [ramPicked, setRamPicked] = useState<number | undefined>(undefined);
  const current = picked ?? initialPreset;
  const currentRam = ramPicked ?? initialPreset.ram ?? ram?.initial;
  const ramOption = hydrated && ram && currentRam !== ram.initial ? ram.options.find((o) => o.ram === currentRam) : undefined;
  const initialIdx = p.ctxs.indexOf(p.initial.ctx);
  const ctx = p.ctxs[current.ctxIdx] ?? p.initial.ctx;
  const cell = findCell(p, ctx, current.kv);
  const initialCell = findCell(p, p.initial.ctx, p.initial.kv);
  const isInitial = ctx === p.initial.ctx && current.kv === p.initial.kv;
  const locked = !hydrated || ramOption !== undefined;

  const update = (next: { ctxIdx: number; kv: string }) => {
    setPicked(next);
    const target = findCell(p, p.ctxs[next.ctxIdx] ?? p.initial.ctx, next.kv);
    if (target) applyCell(target, initialCell);
  };

  // 다른 RAM: ctx·KV 를 8k·f16 으로 돌리고(정적 스니펫도 8k·f16 으로) 정적 ctx 표 강조는 지운다 — 표는 정적 RAM 기준이다
  const pickRam = (next: number) => {
    setRamPicked(next);
    const other = next !== ram?.initial;
    markCurrent('data-ram-step', other ? String(next) : undefined);
    if (!other) return;
    setPicked({ ctxIdx: initialIdx, kv: p.initial.kv });
    if (initialCell) applyCell(initialCell, initialCell);
    markCurrent('data-ctx-cell', undefined);
  };

  // 프리셋(?ctx=&kv=&ram=, 계산기 딥링크)은 핸들러 없이 들어오므로 하이드레이션 뒤 정적 마크업만 맞춘다 (setState 없음)
  useEffect(() => {
    if (!hydrated || picked !== undefined || ramPicked !== undefined) return;
    if (ramOption) markCurrent('data-ram-step', String(ramOption.ram));
    else if (cell && !isInitial) applyCell(cell, initialCell);
  }, [hydrated, picked, ramPicked, ramOption, cell, initialCell, isInitial]);
  const live = hydrated && !ramOption && cell && !isInitial ? cell : undefined;
  // 정적 명령 블록이 없는 페이지(8k·f16 미탑재)는 명령을 쓸 곳이 없다 — "아래 명령" 문장을 붙이지 않는다 (재검증)
  const commandNote = !live || !initialCell?.command ? '' : live.command ? p.labels.commandFollows : p.labels.commandNone;

  return (
    <fieldset
      data-ctx-controls
      aria-label={p.labels.title}
      className="flex min-w-0 flex-wrap items-end gap-4 rounded-lg border border-border p-4 text-sm"
    >
      {ram && (
        <fieldset data-ram-toggle className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="mb-1">{ram.labels.legend}</legend>
          {ram.options.map((o) => (
            <label key={o.ram} className="flex min-h-6 items-center gap-1 tabular-nums">
              <input
                type="radio"
                name={`${id}-ram`}
                value={o.ram}
                checked={currentRam === o.ram}
                disabled={!hydrated}
                onChange={() => pickRam(o.ram)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label htmlFor={`${id}-ctx`}>
          {p.labels.ctxPrefix}<output htmlFor={`${id}-ctx`}>{p.ctxLabels[current.ctxIdx]}</output>
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
          disabled={locked}
          onChange={(e) => update({ ctxIdx: Number(e.currentTarget.value), kv: current.kv })}
          className="h-7 w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          {p.ctxLabels.map((label, i) => (
            <button
              key={label}
              type="button"
              data-ctx-tick={p.ctxs[i]}
              disabled={locked}
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
              disabled={locked}
              onChange={() => update({ ctxIdx: current.ctxIdx, kv })}
            />
            {kv}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        data-ctx-reset
        disabled={!hydrated || (isInitial && !ramOption)}
        onClick={() => {
          if (ramOption) pickRam(ram!.initial);
          update({ ctxIdx: initialIdx, kv: p.initial.kv });
        }}
        className="min-h-6 text-xs text-muted-foreground underline-offset-4 hover:underline disabled:invisible"
      >
        {p.labels.reset}
      </button>
      <p
        data-live-summary
        data-ctx={live ? String(live.ctx) : undefined}
        data-kv={live ? live.kv : undefined}
        data-ram={ramOption ? String(ramOption.ram) : undefined}
        aria-live="polite"
        className="basis-full text-muted-foreground"
      >
        {ramOption ? `${ramOption.summary} ${ram!.labels.locked}` : live ? [live.summary, commandNote].filter(Boolean).join(' ') : ''}
      </p>
      {ramOption && <RamResult ram={ram!} option={ramOption} />}
    </fieldset>
  );
}
