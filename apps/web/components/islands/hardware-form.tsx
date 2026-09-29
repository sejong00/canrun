'use client';
import type { CatalogLite, GpuCore } from '@canrun/data/client';
import { isFp16Crippled } from '@canrun/data/client';
import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { CustomHardwareFields } from '@/components/islands/custom-hardware-fields';
import { DetectButton } from '@/components/islands/detect-button';
import { Pill } from '@/components/pill';
import { formatCtx, formatInt } from '@/lib/format';
import { laptopSibling, matchGpu, rankGpus, type DetectResult, type GpuNames } from '@/lib/calc/gpu-match';
import {
  CTX_OPTIONS,
  DDR_KINDS,
  KV_OPTIONS,
  defaultOs,
  defaultRam,
  findGpu,
  osLocked,
  ramOptions,
  type CalcState,
  type HardwareChoice,
} from '@/lib/calc/state';
import { gpuName } from '@/lib/phrases';
import type { CalcAction, CalcTranslators } from '@/components/islands/calc-shared';

const INPUT = 'h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:h-10 sm:text-sm';
const SELECT = 'h-11 rounded-md border border-border bg-background px-2 text-base sm:h-10 sm:text-sm';

type Props = {
  locale: string;
  catalog: CatalogLite;
  names: GpuNames;
  t: CalcTranslators;
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  hydrated: boolean;
  /** no-JS 폴백 GET action (로케일 경로) */
  action: string;
};

function memoryLabel(t: CalcTranslators, locale: string, gpu: GpuCore): string {
  if (gpu.kind === 'dgpu') return t.calc('optionMemoryVram', { vram: formatInt(locale, gpu.vramGB ?? 0) });
  const opts = gpu.ramOptionsGB ?? [];
  if (opts.length === 0) return '';
  return t.calc('optionMemoryRange', { min: formatInt(locale, Math.min(...opts)), max: formatInt(locale, Math.max(...opts)) });
}

/** 상태의 하드웨어 → 입력창 텍스트 */
function textFor(hardware: HardwareChoice, catalog: CatalogLite, t: CalcTranslators): string {
  if (hardware.kind === 'catalog') {
    const gpu = findGpu(catalog, hardware.gpuId);
    return gpu ? gpuName(t.names, gpu) : hardware.gpuId;
  }
  if (hardware.kind === 'unresolved') return hardware.text;
  return '';
}

/**
 * 하드웨어 폼 (docs/01 F1, D29·D30). SSR/첫 렌더 = `input list` + datalist(홈 폼과 동일), 하이드레이션 뒤 ARIA 콤보박스로 승격.
 */
export function HardwareForm({ locale, catalog, names, t, state, dispatch, hydrated, action }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // 사용자가 타이핑 중인 텍스트 — 상태의 하드웨어가 바뀌면(복원·감지·선택) 상태 텍스트로 돌아간다
  const [draft, setDraft] = useState<{ text: string; hardware: HardwareChoice } | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [candidates, setCandidates] = useState<string[] | undefined>(undefined);
  const [detectMessage, setDetectMessage] = useState<{ text: string; visible: boolean } | undefined>(undefined);

  const stateText = textFor(state.hardware, catalog, t);
  const text = draft && draft.hardware === state.hardware ? draft.text : stateText;
  const selected = state.hardware.kind === 'catalog' ? findGpu(catalog, state.hardware.gpuId) : undefined;

  // URL·홈 폼에서 온 모호한 텍스트(3080·4060 ti·m4 max)도 Enter 경로와 같이 후보 목록 + 안내를 보인다 (렌더 파생, setState 없음)
  const unresolvedMatch =
    hydrated && state.hardware.kind === 'unresolved' && text === state.hardware.text ? matchGpu(text, catalog.gpus, { names }) : undefined;
  const ambiguousIds = candidates ?? (unresolvedMatch?.kind === 'ambiguous' ? unresolvedMatch.candidates : undefined);
  const options = ambiguousIds
    ? ambiguousIds.map((cid) => findGpu(catalog, cid)).filter((g): g is GpuCore => g !== undefined)
    : rankGpus(text, catalog.gpus, names);
  const noMatch = hydrated && text.trim() !== '' && options.length === 0 && !selected;
  // 감지 none 폴백: 포커스만 옮기고 팝업은 열지 않는다 (시각 변화 0, D30)
  const quietFocus = useRef(false);

  const choose = (gpu: GpuCore) => {
    dispatch({ type: 'hardware', hardware: { kind: 'catalog', gpuId: gpu.id } });
    setDraft(undefined);
    setCandidates(undefined);
    setOpen(false);
    setActive(0);
  };

  const onInput = (value: string) => {
    setDraft({ text: value, hardware: state.hardware });
    setCandidates(undefined);
    setOpen(true);
    setActive(0);
  };

  const commitText = () => {
    // 포커스가 떠날 때 텍스트를 해석 — 정확히 1개면 선택, 아니면 unresolved (URL 에 남아 폼에 유지)
    if (!draft || draft.hardware !== state.hardware) return;
    const m = matchGpu(draft.text, catalog.gpus, { names });
    if (m.kind === 'exact') {
      choose(findGpu(catalog, m.id)!);
    } else if (draft.text.trim() === '') {
      dispatch({ type: 'hardware', hardware: { kind: 'none' } });
      setDraft(undefined);
    } else if (state.hardware.kind !== 'unresolved' || state.hardware.text !== draft.text) {
      dispatch({ type: 'hardware', hardware: { kind: 'unresolved', text: draft.text } });
      setDraft(undefined);
    }
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 빈 입력창에서 Enter 는 아무것도 고르지 않는다 (인기 1위가 선택되던 문제)
      const pick = open && text.trim() !== '' ? options[active] : undefined;
      if (pick) choose(pick);
      else commitText();
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(Math.max(0, options.length - 1));
    }
  };

  const onDetect = (result: DetectResult) => {
    if (result.kind === 'exact') {
      const gpu = findGpu(catalog, result.id)!;
      choose(gpu);
      setDetectMessage({ text: t.detect('found', { gpu: gpuName(t.names, gpu) }), visible: true });
      return;
    }
    if (result.kind === 'ambiguous') {
      setDraft({ text: result.text, hardware: state.hardware });
      setCandidates(result.candidates);
      setOpen(true);
      setActive(0);
      setDetectMessage({ text: t.detect('ambiguous', { gpu: result.text }), visible: true });
      inputRef.current?.focus();
      return;
    }
    if (result.kind === 'apple-unknown') {
      setDraft({ text: 'Apple', hardware: state.hardware });
      setCandidates(catalog.gpus.filter((g) => g.vendor === 'apple').map((g) => g.id));
      setOpen(true);
      setActive(0);
      setDetectMessage({ text: t.detect('appleUnknown'), visible: true });
      inputRef.current?.focus();
      return;
    }
    // none: 시각 변화 없이 콤보박스로 포커스(팝업은 열지 않음) — 스크린리더에만 안내 (무소음 폴백, D30)
    setDetectMessage({ text: t.detect('none'), visible: false });
    quietFocus.current = true;
    inputRef.current?.focus();
  };

  const listId = `${id}-gpu-list`;
  const hintId = `${id}-gpu-hint`;
  // 키보드로 옮긴 활성 옵션을 리스트박스(max-h 50vh) 안에서 보이게 — DOM 부작용만, setState 없음
  const activeOptionId = hydrated && open && options[active] ? `${listId}-${options[active].id}` : undefined;
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);
  const locked = osLocked(state.hardware, catalog);
  const os = locked ?? state.os ?? defaultOs(state.hardware, catalog);
  const isDgpu = !selected ? state.hardware.kind !== 'custom' || state.hardware.custom.kind === 'dgpu' : selected.kind === 'dgpu';
  const isCpu = selected?.kind === 'cpu';
  const isUnifiedCatalog = selected?.kind === 'unified';
  const ramList = ramOptions(state.hardware, catalog);
  const ramValue = state.ramGB ?? defaultRam(state.hardware, catalog);
  const sibling = selected ? laptopSibling(selected, catalog.gpus) : undefined;
  const customOpen = state.hardware.kind === 'custom';
  const customKind = state.hardware.kind === 'custom' ? state.hardware.custom.kind : undefined;

  return (
    <form
      data-calc-form
      action={action}
      method="get"
      role="search"
      className="flex flex-col gap-5 rounded-lg border border-border p-4 sm:p-6"
      onSubmit={(e) => {
        if (hydrated) {
          e.preventDefault();
          commitText();
          document.getElementById('results-heading')?.focus();
        }
      }}
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">{t.calc('hardwareLegend')}</legend>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-gpu`} className="text-sm font-medium">
            {t.calc('gpuLabel')}
          </label>
          <div className="relative flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                id={`${id}-gpu`}
                name="gpu"
                className={INPUT}
                placeholder={t.calc('gpuPlaceholder')}
                inputMode="search"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                value={text}
                aria-describedby={hintId}
                {...(hydrated
                  ? {
                      role: 'combobox',
                      'aria-expanded': open && options.length > 0,
                      'aria-controls': listId,
                      'aria-autocomplete': 'list' as const,
                      'aria-activedescendant': open && options[active] ? `${listId}-${options[active].id}` : undefined,
                    }
                  : { list: listId })}
                onChange={(e) => onInput(e.currentTarget.value)}
                onFocus={() => {
                  if (quietFocus.current) {
                    quietFocus.current = false;
                    return;
                  }
                  setOpen(true);
                }}
                onBlur={() => {
                  // 옵션 클릭(mousedown)이 blur 보다 먼저 선택되도록 지연
                  window.setTimeout(commitText, 120);
                }}
                onKeyDown={onKey}
              />
              {hydrated ? (
                open && options.length > 0 ? (
                  <ul
                    id={listId}
                    role="listbox"
                    aria-label={t.calc('gpuLabel')}
                    className="absolute left-0 right-0 z-10 mt-1 max-h-[50vh] overflow-auto rounded-md border border-border bg-background shadow-lg"
                  >
                    {options.map((gpu, i) => (
                      <li
                        key={gpu.id}
                        id={`${listId}-${gpu.id}`}
                        role="option"
                        aria-selected={i === active}
                        data-gpu-id={gpu.id}
                        className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? 'bg-muted' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          choose(gpu);
                        }}
                        onMouseEnter={() => setActive(i)}
                      >
                        <span>
                          {gpuName(t.names, gpu)}
                          {gpu.form === 'laptop' && <span className="ml-1 text-xs text-muted-foreground">· {t.calc('optionLaptop')}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{memoryLabel(t, locale, gpu)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null
              ) : (
                <datalist id={listId}>
                  {catalog.gpus.map((gpu) => (
                    <option key={gpu.id} value={gpuName(t.names, gpu)} />
                  ))}
                </datalist>
              )}
            </div>
            <DetectButton catalog={catalog} names={names} t={t} hydrated={hydrated} onResult={onDetect} />
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {noMatch ? t.calc('gpuNoMatch', { query: text.trim() }) : t.calc('gpuHint')}
          </p>
          {/* live region 은 항상 존재해야 첫 안내(none 의 sr-only 포함)까지 낭독된다 — 조건부 생성이면 첫 메시지가 빠진다 */}
          <p role="status" aria-live="polite" className={detectMessage?.visible ? 'text-sm' : 'sr-only'}>
            {detectMessage?.text ?? ''}
          </p>
          {ambiguousIds && (
            <p className="text-sm text-muted-foreground">{t.calc('gpuAmbiguous', { text: text.trim() })}</p>
          )}
          {selected && (
            <div className="flex flex-wrap gap-2">
              {selected.form === 'laptop' && (
                <Pill tone="caution" badge="laptop">
                  {t.gpuHub('badgeLaptop')}
                </Pill>
              )}
              {selected.kind === 'unified' && (
                <Pill tone="info" badge="unified">
                  {t.gpuHub('badgeUnified')}
                </Pill>
              )}
              {selected.kind === 'cpu' && (
                <Pill tone="info" badge="cpu">
                  {t.gpuHub('badgeCpu')}
                </Pill>
              )}
              {isFp16Crippled(selected) && (
                <Pill tone="caution" badge="fp16">
                  {t.gpuHub('badgeFp16')}
                </Pill>
              )}
            </div>
          )}
          {sibling && <p className="text-xs text-muted-foreground">{t.calc('laptopSibling', { laptop: gpuName(t.names, sibling) })}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!isUnifiedCatalog && customKind !== 'unified' ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-ram`} className="text-sm font-medium">
                {t.calc('ramLabel')}
              </label>
              <select id={`${id}-ram`} name="ram" className={SELECT} value={ramValue} disabled={!hydrated} onChange={(e) => dispatch({ type: 'ram', ramGB: Number(e.currentTarget.value) })}>
                {(ramList.includes(ramValue) ? ramList : [...ramList, ramValue].sort((a, b) => a - b)).map((gb) => (
                  <option key={gb} value={gb}>
                    {t.gpuHub('ramOption', { ram: formatInt(locale, gb) })}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-ram`} className="text-sm font-medium">
                {t.calc('memoryLabel')}
              </label>
              <select id={`${id}-ram`} name="ram" className={SELECT} value={ramValue} disabled={!hydrated || ramList.length <= 1} onChange={(e) => dispatch({ type: 'ram', ramGB: Number(e.currentTarget.value) })}>
                {(ramList.length > 0 ? ramList : [ramValue]).map((gb) => (
                  <option key={gb} value={gb}>
                    {t.gpuHub('ramOption', { ram: formatInt(locale, gb) })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 커스텀 dGPU 도 시스템 RAM 대역폭(DDR)·화면 출력을 평가에 쓴다 — 숨기면 이전 선택이 몰래 남는다 */}
          {(isDgpu || isCpu) && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-ddr`} className="text-sm font-medium">
                {t.calc('ddrLabel')}
              </label>
              <select id={`${id}-ddr`} name="ddr" className={SELECT} value={state.ddr} disabled={!hydrated} onChange={(e) => dispatch({ type: 'ddr', ddr: e.currentTarget.value as CalcState['ddr'] })}>
                {DDR_KINDS.map((ddr) => (
                  <option key={ddr} value={ddr}>
                    {t.calc(ddr)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-os`} className="text-sm font-medium">
              {t.calc('osLabel')}
            </label>
            {locked ? (
              <select id={`${id}-os`} name="os" className={SELECT} value={locked} disabled>
                <option value={locked}>{t.calc(locked === 'macos' ? 'osLockedApple' : 'osLockedDgx')}</option>
              </select>
            ) : (
              <select id={`${id}-os`} name="os" className={SELECT} value={os} disabled={!hydrated} onChange={(e) => dispatch({ type: 'os', os: e.currentTarget.value as CalcState['os'] })}>
                {/* macOS 는 Apple 실리콘(고정)에만 성립 — 그 외 하드웨어의 선택지는 windows|linux (state.ts osOptions) */}
                <option value="windows">{t.calc('osWindows')}</option>
                <option value="linux">{t.calc('osLinux')}</option>
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ctx`} className="text-sm font-medium">
              {t.calc('ctxLabel')}
            </label>
            <select id={`${id}-ctx`} name="ctx" className={SELECT} value={state.ctx} disabled={!hydrated} onChange={(e) => dispatch({ type: 'ctx', ctx: Number(e.currentTarget.value) })}>
              {CTX_OPTIONS.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {formatCtx(ctx)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t.calc('ctxHint')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <fieldset data-kv-toggle className="flex flex-wrap items-center gap-3 text-sm">
            <legend className="mb-1 font-medium">{t.calc('kvLabel')}</legend>
            {KV_OPTIONS.map((kv) => (
              <label key={kv} className="flex min-h-9 items-center gap-1">
                <input type="radio" name="kv" value={kv} checked={state.kv === kv} disabled={!hydrated} onChange={() => dispatch({ type: 'kv', kv })} />
                {kv}
              </label>
            ))}
            <span className="basis-full text-xs text-muted-foreground">{t.calc('kvHint')}</span>
          </fieldset>
          {isDgpu && (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="display" value="1" checked={state.display} disabled={!hydrated} onChange={(e) => dispatch({ type: 'display', display: e.currentTarget.checked })} />
              <span>
                {t.calc('displayLabel')}
                <span className="block text-xs text-muted-foreground">{t.calc('displayHint')}</span>
              </span>
            </label>
          )}
        </div>
      </fieldset>

      <details data-gpu-custom open={customOpen} onToggle={(e) => {
        if (e.currentTarget.open && !customOpen) dispatch({ type: 'custom', patch: {} });
        if (!e.currentTarget.open && customOpen) dispatch({ type: 'hardware', hardware: { kind: 'none' } });
      }}>
        <summary className="cursor-pointer text-sm font-medium">{t.calc('customToggle')}</summary>
        {customOpen && state.hardware.kind === 'custom' && (
          <CustomHardwareFields locale={locale} t={t} custom={state.hardware.custom} dispatch={dispatch} hydrated={hydrated} />
        )}
      </details>

      {!hydrated && (
        <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:h-10">
          {t.calc('resultsHeading')}
        </button>
      )}
    </form>
  );
}
