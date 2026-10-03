'use client';
import type { CatalogLite, GpuCore } from '@canrun/data/client';
import { isFp16Crippled, isMixableGpu } from '@canrun/data/client';
import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { CustomHardwareFields } from '@/components/islands/custom-hardware-fields';
import { DetectButton } from '@/components/islands/detect-button';
import { ExtraGpus } from '@/components/islands/extra-gpus';
import { GpuListbox, browseOrder } from '@/components/islands/gpu-listbox';
import { Pill } from '@/components/pill';
import { formatCtx, formatInt } from '@/lib/format';
import { laptopSibling, matchGpu, gpuTokens, rankGpus, variantStem, type DetectResult, type GpuNames } from '@/lib/calc/gpu-match';
import {
  CTX_OPTIONS,
  DDR_KINDS,
  GPU_COUNT_OPTIONS,
  KV_OPTIONS,
  MAX_GPUS,
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
/**
 * 입력이 GPU 하나로 확정되면 이만큼 멈춘 뒤 결과에 반영한다 (10-02 사용자 지적 — 치기만 하면 결과가 그대로라 고장 난 것처럼 보였다).
 * 치는 중간("4070" → "4070 ti")에 결과가 매 글자 바뀌지 않게 짧게 기다린다. 모호한 입력은 지금처럼 목록에서 고른다(D29)
 */
const AUTO_COMMIT_MS = 500;

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
  // -1 = 활성 옵션 없음. 포커스만으로는 어떤 옵션도 활성화하지 않는다(APG) — 빈 입력에서 Enter 가 인기 1위를 고르던 문제
  const [active, setActive] = useState(-1);
  // 감지가 제시한 후보 — 입력 초안처럼 그때의 하드웨어에 묶는다(다른 선택·커스텀으로 바뀌면 자동으로 사라진다).
  // kind: 'variants' = 메모리·코어 변형(확인·선택 필요), 'chips' = Apple 칩 목록(안내 문구 없음)
  const [candidates, setCandidates] = useState<{ ids: string[]; kind: 'variants' | 'chips'; hardware: HardwareChoice } | undefined>(undefined);
  const [detectMessage, setDetectMessage] = useState<{ text: string; visible: boolean } | undefined>(undefined);

  const stateText = textFor(state.hardware, catalog, t);
  const text = draft && draft.hardware === state.hardware ? draft.text : stateText;
  const selected = state.hardware.kind === 'catalog' ? findGpu(catalog, state.hardware.gpuId) : undefined;
  const detected = candidates && candidates.hardware === state.hardware ? candidates : undefined;

  // URL·홈 폼에서 온 모호한 텍스트(3080·4060 ti·m4 max)도 Enter 경로와 같이 후보 목록 + 안내를 보인다 (렌더 파생, setState 없음)
  const unresolvedMatch =
    hydrated && state.hardware.kind === 'unresolved' && text === state.hardware.text ? matchGpu(text, catalog.gpus, { names }) : undefined;
  const ambiguousIds = detected?.ids ?? (unresolvedMatch?.kind === 'ambiguous' ? unresolvedMatch.candidates : undefined);
  // 후보 안내 문장: 1개 = 카탈로그 유일 변형 확인, 같은 이름의 변형들 = "버전이 여러 가지", 그 외(CPU 프로필 등) = "여러 개 해당"
  const ambiguousGpus = (ambiguousIds ?? []).map((cid) => findGpu(catalog, cid)).filter((g): g is GpuCore => g !== undefined);
  const sameStem = new Set(ambiguousGpus.map((g) => variantStem(g.name))).size === 1;
  // 뜻 있는 토큰이 없는 질의(빈 입력·"nvidia"·"AMD Radeon") = 둘러보기: 6그룹(D29) 순서. 제조사 단어면 rankGpus 가 그 제조사만 남긴다
  const browsing = !ambiguousIds && gpuTokens(text).length === 0;
  const ranked = ambiguousIds
    ? ambiguousIds.map((cid) => findGpu(catalog, cid)).filter((g): g is GpuCore => g !== undefined)
    : rankGpus(text, catalog.gpus, names);
  const options = browsing ? browseOrder(ranked) : ranked;
  const noMatch = hydrated && text.trim() !== '' && options.length === 0 && !selected;
  // 감지 none 폴백: 포커스만 옮기고 팝업은 열지 않는다 (시각 변화 0, D30)
  const quietFocus = useRef(false);
  // 지연 blur 확정: 타이머 + 최신 렌더의 commitText (ref 는 effect 에서만 갱신 — react-hooks 7 refs 규칙)
  const blurTimer = useRef<number | undefined>(undefined);
  const commitRef = useRef<(source: 'blur' | 'enter' | 'submit' | 'auto') => void>(() => {});
  // 확정 입력 자동 반영 타이머 (AUTO_COMMIT_MS)
  const autoTimer = useRef<number | undefined>(undefined);
  const cancelBlurCommit = () => {
    window.clearTimeout(blurTimer.current);
    blurTimer.current = undefined;
  };

  const choose = (gpu: GpuCore) => {
    window.clearTimeout(autoTimer.current);
    dispatch({ type: 'hardware', hardware: { kind: 'catalog', gpuId: gpu.id } });
    setDraft(undefined);
    setCandidates(undefined);
    setOpen(false);
    setActive(-1);
  };

  const onInput = (value: string) => {
    setDraft({ text: value, hardware: state.hardware });
    setCandidates(undefined);
    setOpen(true);
    // 첫 후보는 입력이 한 GPU 로 확정될 때만 활성 — 토큰 겹침 폴백("rtx 3060 ti" → RTX 5090)·약한 부분 일치(50)·
    // 메모리 형제(4060 ti)는 Enter 로 고르지 않는다. 명시 선택은 ArrowDown·탭 (재검증)
    const m = matchGpu(value, catalog.gpus, { names });
    const first = m.kind === 'exact' ? rankGpus(value, catalog.gpus, names)[0] : undefined;
    const settled = m.kind === 'exact' && first?.id === m.id;
    setActive(settled ? 0 : -1);
    // 한 GPU 로 확정되는 입력은 잠깐 멈추면 결과에 반영한다 — 입력창 글자는 그대로 두고(치는 중 글자가 바뀌지 않게) 상태만
    window.clearTimeout(autoTimer.current);
    autoTimer.current = settled
      ? window.setTimeout(() => {
          autoTimer.current = undefined;
          commitRef.current('auto');
        }, AUTO_COMMIT_MS)
      : undefined;
  };

  /**
   * 입력 텍스트 해석 — 정확히 1개면 선택, 아니면 unresolved (URL 에 남아 폼에 유지).
   * blur 는 감지가 제시한 후보(확인 대기)를 추측으로 확정하지 않는다 — 옵션 선택·Enter·제출만 확정 (D30, 재검증)
   */
  const commitText = (source: 'blur' | 'enter' | 'submit' | 'auto') => {
    if (source === 'auto') {
      // 그 사이 다른 선택·복원으로 하드웨어가 바뀌었거나 글자가 달라졌으면 하지 않는다
      if (!draft || draft.hardware !== state.hardware || inputRef.current?.value !== draft.text) return;
      const m = matchGpu(draft.text, catalog.gpus, { names });
      if (m.kind !== 'exact' || rankGpus(draft.text, catalog.gpus, names)[0]?.id !== m.id) return;
      if (state.hardware.kind === 'catalog' && state.hardware.gpuId === m.id) return;
      const hardware: HardwareChoice = { kind: 'catalog', gpuId: m.id };
      dispatch({ type: 'hardware', hardware });
      // 초안을 새 하드웨어에 다시 묶는다 — 입력창은 친 글자 그대로, 포커스가 떠나면(blur) 표시명으로 정리된다
      setDraft({ text: draft.text, hardware });
      return;
    }
    window.clearTimeout(autoTimer.current);
    if (source === 'blur' && detected) {
      setOpen(false);
      return;
    }
    if (!draft || draft.hardware !== state.hardware) {
      setOpen(false);
      return;
    }
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

  // 최신 렌더의 commitText 를 지연 blur 타이머에 넘긴다 (effect 안 ref 갱신 — 렌더 중 ref 쓰기 금지 규칙 준수)
  useEffect(() => {
    commitRef.current = commitText;
  });
  // 언마운트: 대기 중인 blur 확정은 버리지 않고 바로 확정한다 — 모드 전환 칩·"이 모델이 돌아가는 GPU 보기"를 누르면
  // 입력창이 blur 된 직후 이 폼이 사라진다(D65). 포커스가 입력창에 남은 채 사라지면(뒤로 가기 복원 등) 예전처럼 버린다 (리뷰 반영)
  useEffect(
    () => () => {
      const pendingBlur = blurTimer.current !== undefined;
      window.clearTimeout(blurTimer.current);
      window.clearTimeout(autoTimer.current);
      blurTimer.current = undefined;
      // 언마운트 시점의 최신 commitText (ref 가 마지막 렌더의 것을 가리킨다)
      if (pendingBlur) commitRef.current('blur');
    },
    [],
  );

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // 맨 위에서 한 번 더 올리면 입력창(활성 없음)으로 돌아간다
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 활성 옵션이 있을 때만 고른다 — 포커스만 주고 누른 Enter 는 입력 텍스트 해석(commitText)만
      const pick = open && active >= 0 ? options[active] : undefined;
      if (pick) choose(pick);
      else commitText('enter');
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
      // 입력창엔 용량을 뺀 표시명("GeForce RTX 4060 Ti"), 후보는 고르게만 한다 — 활성 옵션 없음(Enter 로 추측 선택 금지, D30).
      // 후보가 하나면 카탈로그에 그 용량만 있는 경우(3060 12GB 등): 맞는지 확인하게 한다
      const first = findGpu(catalog, result.candidates[0] ?? '');
      const label = first ? variantStem(gpuName(t.names, first)) : result.text;
      setDraft({ text: label, hardware: state.hardware });
      setCandidates({ ids: result.candidates, kind: 'variants', hardware: state.hardware });
      setOpen(true);
      setActive(-1);
      setDetectMessage({ text: t.detect(result.candidates.length === 1 ? 'confirm' : 'ambiguous', { gpu: label }), visible: true });
      inputRef.current?.focus();
      return;
    }
    if (result.kind === 'apple-unknown') {
      setDraft({ text: 'Apple', hardware: state.hardware });
      setCandidates({ ids: catalog.gpus.filter((g) => g.vendor === 'apple').map((g) => g.id), kind: 'chips', hardware: state.hardware });
      setOpen(true);
      setActive(-1);
      setDetectMessage({ text: t.detect('appleUnknown'), visible: true });
      inputRef.current?.focus();
      return;
    }
    // none: 시각 변화 없이 콤보박스로 포커스(팝업은 열지 않음) — 스크린리더에만 안내 (무소음 폴백, D30)
    setDetectMessage({ text: t.detect('none'), visible: false });
    // 열려 있던 목록도 닫는다 — 감지 버튼을 누르기 전 포커스로 열린 팝업이 남지 않게 (재검증)
    setOpen(false);
    setActive(-1);
    quietFocus.current = true;
    inputRef.current?.focus();
  };

  const listId = `${id}-gpu-list`;
  const hintId = `${id}-gpu-hint`;
  // 키보드로 옮긴 활성 옵션을 리스트박스(max-h 50vh) 안에서 보이게 — DOM 부작용만, setState 없음
  const activeOption = active >= 0 ? options[active] : undefined;
  const activeOptionId = hydrated && open && activeOption ? `${listId}-${activeOption.id}` : undefined;
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
  // 서로 다른 GPU 함께 쓰기 (D67) — 1번이 섞기 자격 카드일 때만. "GPU 수"는 1번 카드 장수라 합계 4장에서 추가 카드 수를 뺀 만큼만
  const mixable = selected !== undefined && isMixableGpu(selected);
  const plusCount = mixable ? (state.plus?.length ?? 0) : 0;
  const multiGpu = (state.gpus ?? 1) + plusCount > 1;

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
          commitText('submit');
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
                      'aria-activedescendant': activeOptionId,
                    }
                  : { list: listId })}
                onChange={(e) => onInput(e.currentTarget.value)}
                onFocus={() => {
                  if (quietFocus.current) {
                    quietFocus.current = false;
                    return;
                  }
                  setOpen(true);
                  setActive(-1);
                }}
                onBlur={() => {
                  // 옵션 클릭(mousedown)이 blur 보다 먼저 선택되도록 지연. 타이머는 blur 시점의 클로저가 아니라 **최신 렌더**의
                  // commitText 를 부른다 — 그 사이 커스텀 열기 등으로 하드웨어가 바뀌면 옛 초안이 그 선택을 덮지 않는다 (재검증)
                  blurTimer.current = window.setTimeout(() => {
                    blurTimer.current = undefined;
                    if (document.activeElement === inputRef.current) return; // 감지 후보 경로가 포커스를 되돌린 경우
                    commitRef.current('blur');
                    setOpen(false);
                    setActive(-1);
                  }, 120);
                }}
                onKeyDown={onKey}
              />
              {hydrated ? (
                open && options.length > 0 ? (
                  <GpuListbox
                    listId={listId}
                    label={t.calc('gpuLabel')}
                    locale={locale}
                    t={t}
                    options={options}
                    browsing={browsing}
                    active={active}
                    onChoose={choose}
                    onActive={setActive}
                  />
                ) : null
              ) : (
                <datalist id={listId}>
                  {catalog.gpus.map((gpu) => (
                    <option key={gpu.id} value={gpuName(t.names, gpu)} />
                  ))}
                </datalist>
              )}
            </div>
            {/* 확인 = 입력 글자 확정 + 결과로 이동. JS 없을 때는 GET 제출 (10-02 — 하이드레이션 뒤에도 보인다: 언제 반영되는지 드러나게) */}
            <button
              type="submit"
              data-calc-submit
              className="h-11 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:h-10"
            >
              {t.calc('apply')}
            </button>
            <DetectButton catalog={catalog} names={names} t={t} hydrated={hydrated} onResult={onDetect} />
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {noMatch ? t.calc('gpuNoMatch', { query: text.trim() }) : t.calc('gpuHint')}
          </p>
          {/* live region 은 항상 존재해야 첫 안내(none 의 sr-only 포함)까지 낭독된다 — 조건부 생성이면 첫 메시지가 빠진다 */}
          <p role="status" aria-live="polite" className={detectMessage?.visible ? 'text-sm' : 'sr-only'}>
            {detectMessage?.text ?? ''}
          </p>
          {/* Apple 칩 목록은 감지 안내("칩을 골라 주세요")로 충분 — 변형 문장을 붙이면 거짓이 된다 (재검증) */}
          {ambiguousIds && detected?.kind !== 'chips' && (
            <p className="text-sm text-muted-foreground">
              {ambiguousIds.length === 1
                ? t.calc('gpuConfirmVariant', { text: text.trim() })
                : sameStem
                  ? t.calc('gpuAmbiguous', { text: text.trim() })
                  : t.calc('gpuAmbiguousPick', { text: text.trim() })}
            </p>
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

          {/* 같은 dGPU 여러 장 (D58, 베타) — VRAM 합산·층 나눠 올리기 */}
          {isDgpu && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-gpus`} className="text-sm font-medium">
                {t.calc(plusCount > 0 ? 'gpuCountLabelSame' : 'gpuCountLabel')}
              </label>
              <select
                id={`${id}-gpus`}
                name="gpus"
                className={SELECT}
                value={state.gpus ?? 1}
                disabled={!hydrated}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  dispatch({ type: 'gpus', gpus: n > 1 ? n : undefined });
                }}
              >
                {GPU_COUNT_OPTIONS.filter((n) => n <= MAX_GPUS - plusCount).map((n) => (
                  <option key={n} value={n}>
                    {t.calc('gpuCountOption', { n })}
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

        {mixable && <ExtraGpus catalog={catalog} t={t} primary={selected} state={state} dispatch={dispatch} hydrated={hydrated} />}

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
                {t.calc(multiGpu ? 'displayLabelMulti' : 'displayLabel')}
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
        {/* 누르는 순간 대기 중인 blur 확정을 취소 — 느린 클릭에서 확정이 먼저 일어나 레이아웃이 밀리고 클릭이 빗나가던 문제 (재검증) */}
        <summary className="cursor-pointer text-sm font-medium" onPointerDown={cancelBlurCommit}>
          {t.calc('customToggle')}
        </summary>
        {customOpen && state.hardware.kind === 'custom' && (
          <CustomHardwareFields locale={locale} t={t} custom={state.hardware.custom} dispatch={dispatch} hydrated={hydrated} />
        )}
      </details>

    </form>
  );
}
