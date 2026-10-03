'use client';
import { usableGB } from '@canrun/engine';
import { buildManualModel, isManualMoe, type CatalogLite, type ManualSpec } from '@canrun/data/client';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GpuResultList } from '@/components/islands/gpu-result-list';
import { HardwareForm } from '@/components/islands/hardware-form';
import { HfModelPanel, type HfPanelStatus } from '@/components/islands/hf-model-panel';
import { ManualModelFields } from '@/components/islands/manual-model-fields';
import { ModeSwitch } from '@/components/islands/mode-switch';
import { ModelForm } from '@/components/islands/model-form';
import type { PinnedMeta } from '@/components/islands/result-card';
import { ResultList } from '@/components/islands/result-list';
import { ShareButton } from '@/components/islands/share-button';
import { bindTranslators, classKey, gpuSetLabel, gpuSetVram, localePrefix, makeReducer } from '@/components/islands/calc-shared';
import { formatCtx, formatGB, formatInt, formatMemGB, formatParams } from '@/lib/format';
import type { KrwRate } from '@/lib/krw';
import { matchGpu } from '@/lib/calc/gpu-match';
import type { ResolvedHardware } from '@/lib/calc/hardware';
import type { HfLoadResult } from '@/lib/calc/hf-load';
import { assembleResults, type ExtraModel } from '@/lib/calc/run';
import { assembleModelRows, filterGpuRows, myConfigRow } from '@/lib/calc/run-model';
import { defaultState, hasManualNumber, hasManualValue, type CalcState } from '@/lib/calc/state';
import { parseCalcQuery, serializeCalcQuery } from '@/lib/calc/url';
import { useHydrated } from '@/lib/hydration';
import type { Dict } from '@/lib/i18n-lite';
import { gpuName } from '@/lib/phrases';

/** 직접 입력 값이 없을 때 칸에 넘기는 빈 값 — 렌더마다 새 객체면 칸의 검사 메모가 매번 다시 돈다 */
const NO_MANUAL: ManualSpec = {};

/**
 * 계산기 아일랜드 (docs/01 F1·F4, P1-3). SSR 은 폼만(기본 상태) — 결과·콤보박스 승격·감지 버튼 활성은
 * 하이드레이션 뒤 렌더 분기 (D36). 상태 → URL 은 300ms 디바운스 `replaceState(history.state, …)` (D31).
 * 모델 모드(10-03 D65): 같은 아일랜드에서 하드웨어 폼 자리에 모델 폼, 결과 자리에 GPU 목록. SSR·첫 렌더는 하드웨어 모드.
 */
export function CalculatorIsland({
  locale,
  catalog,
  dict,
  issueUrl,
  fx,
}: {
  locale: string;
  catalog: CatalogLite;
  dict: Dict;
  issueUrl: string;
  /** ko 페이지만 — 모델 모드 가격의 원화 참고값(D61) */
  fx?: KrwRate;
}) {
  const hydrated = useHydrated();
  const t = useMemo(() => bindTranslators(dict, locale), [dict, locale]);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) if (k.startsWith('GpuName.')) out[k.slice('GpuName.'.length)] = v;
    return out;
  }, [dict]);
  const reducer = useMemo(() => makeReducer(catalog), [catalog]);
  const [state, dispatch] = useReducer(reducer, undefined, defaultState);
  const [restored, setRestored] = useState(false);
  // 모델 폼이 차지할 최소 높이 — SSR 하드웨어 폼이 화면에 보이던 높이(`?mode=model` 딥링크의 레이아웃 이동 방지, D65)
  const [formSlot, setFormSlot] = useState<number | undefined>(undefined);
  // "모델 값 직접 입력" 펼침·MoE 체크 (D66) — 패널이 모드마다 다른 자리에 다시 그려지므로 여기서 갖는다. 펼치기·체크만으로는 상태를 바꾸지 않는다
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMoe, setManualMoe] = useState(false);
  // 카탈로그 모델 고르기·HF 불러오기가 대신 지운 직접 입력 값 — "입력했던 값 다시 넣기" 로 되살린다 (리뷰 반영: HF 는 입력창 글자가 남는데
  // 직접 입력은 최대 10칸을 다시 쳐야 했다). 방문자가 직접 지우면 버린다
  const [manualStash, setManualStash] = useState<ManualSpec | undefined>(undefined);
  // 늦게 끝나는 불러오기(then)도 지금 값을 보관하게 — 렌더 때의 state 는 낡았을 수 있다
  const manualNow = useRef<ManualSpec | undefined>(undefined);
  useEffect(() => {
    manualNow.current = state.manual;
  }, [state.manual]);

  // 마운트: URL → 상태 (islands/** 한정 set-state-in-effect 예외, D36) + popstate 복원.
  // 하이드레이션 전에 입력창에 타이핑한 텍스트(D29)는 URL 에 GPU 가 없을 때 그대로 해석해 시드한다
  useEffect(() => {
    const parsed = parseCalcQuery(window.location.search, catalog, names);
    const typed = document.querySelector<HTMLInputElement>('form[data-calc-form] input[name="gpu"]')?.value.trim() ?? '';
    if (parsed.hardware.kind === 'none' && typed) {
      const m = matchGpu(typed, catalog.gpus, { names });
      parsed.hardware = m.kind === 'exact' ? { kind: 'catalog', gpuId: m.id } : { kind: 'unresolved', text: typed };
    }
    // 하이드레이션 전에 "사양 직접 입력" 을 열었으면(React 19 는 open 속성 불일치를 패치하지 않는다) 여기서 맞춘다 (재검증):
    // GPU 가 없으면 커스텀으로, URL·타이핑 GPU 가 있으면 그쪽이 이기고 빈 패널은 닫는다
    const details = document.querySelector<HTMLDetailsElement>('form[data-calc-form] details[data-gpu-custom]');
    if (details?.open) {
      if (parsed.hardware.kind === 'none') parsed.hardware = { kind: 'custom', custom: { kind: 'dgpu', effClass: 'nvidia' } };
      else if (parsed.hardware.kind !== 'custom') details.open = false;
    }
    // 직접 입력 값이 있으면(공유 링크) 펼치고, 하이드레이션 전에 펼쳤으면 그대로 둔다 (입력 칸은 하이드레이션 전엔 비활성)
    const manualDetails = document.querySelector<HTMLDetailsElement>('details[data-manual-model]');
    if (parsed.manual || manualDetails?.open) setManualOpen(true);
    if (parsed.manual && isManualMoe(parsed.manual)) setManualMoe(true);
    const form = document.querySelector<HTMLElement>('form[data-calc-form]')?.getBoundingClientRect();
    const visible = form ? Math.min(form.height, window.innerHeight - form.top) : 0;
    if (visible > 0) setFormSlot(Math.round(visible));
    dispatch({ type: 'restore', state: parsed });
    setRestored(true);
    const onPop = () => {
      const restoredState = parseCalcQuery(window.location.search, catalog, names);
      if (restoredState.manual) {
        setManualOpen(true);
        setManualMoe(isManualMoe(restoredState.manual));
      }
      dispatch({ type: 'restore', state: restoredState });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [catalog, names]);

  // 상태 → URL (디바운스) — 로드 직후에도 돌려 홈 폼의 자유 텍스트를 캐노니컬 id 로 바꾸고 스위처 href 에 쿼리를 붙인다(D31).
  // history.state 를 그대로 넘겨 Next 내부 트리(__NA)를 보존한다
  useEffect(() => {
    if (!restored) return;
    const id = window.setTimeout(() => {
      const qs = serializeCalcQuery(state, catalog);
      if (window.location.search !== qs) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs}${window.location.hash}`);
      }
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-locale-switch]')) {
        const href = a.getAttribute('href') ?? '';
        a.setAttribute('href', `${href.split('?')[0]}${qs}`);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [state, restored, catalog]);

  // 카탈로그 밖 모델 (계산기 P2, D57): 불러오기는 사용자가 누르거나 URL 에 hf= 가 있을 때만 — 로더는 dynamic import
  const [hfLoad, setHfLoad] = useState<{ id: string; result: HfLoadResult } | undefined>(undefined);
  const [hfStatus, setHfStatus] = useState<HfPanelStatus>({ kind: 'idle' });
  // 패널 입력창 글자 — 패널은 모드마다 다른 자리에 그려져 다시 마운트되므로 여기서 갖는다 (리뷰 반영)
  const [hfText, setHfText] = useState('');
  const catalogIdFor = (hfId: string) => catalog.models.find((m) => m.hfId.toLowerCase() === hfId.toLowerCase())?.id;
  // 불러오기 차례 번호 — 늦게 끝난 이전 요청(다른 모델·빼기 뒤)의 결과는 버린다 (10-01 리뷰)
  const hfSeq = useRef(0);
  // 다른 모델로 바뀌며 지워질 직접 입력 값을 보관한다 (숫자 칸이 비었으면 이전 보관분을 그대로 둔다)
  const stashManual = () => {
    if (hasManualNumber(manualNow.current)) setManualStash(manualNow.current);
  };
  const loadHf = (text: string) => {
    const seq = ++hfSeq.current;
    setHfStatus({ kind: 'loading' });
    void import('@/lib/calc/hf-load')
      .then(({ loadHfModel }) => loadHfModel(text, undefined, { catalogIdFor }))
      .then((result) => {
        if (seq !== hfSeq.current) return;
        if (result.kind === 'catalog') {
          // 이미 목록에 있는 모델 — 불러오지 않고 그 카드를 강조한다(URL 의 m=). 직접 입력 모델도 내려놓는다: 남아 있으면
          // 고정 카드·모델 모드 대상이 그대로라 상태 문장과 어긋난다 (리뷰 반영)
          const name = catalog.models.find((m) => m.id === result.modelId)?.name ?? result.modelId;
          setHfLoad(undefined);
          setHfStatus({ kind: 'catalog', name });
          stashManual();
          dispatch({ type: 'hf', hf: undefined });
          dispatch({ type: 'manual', patch: null });
          dispatch({ type: 'focus', focus: result.modelId });
        } else if (result.kind === 'ok') {
          setHfLoad({ id: result.hfId, result });
          setHfStatus({ kind: 'loaded', name: result.model.name });
          stashManual();
          dispatch({ type: 'hf', hf: result.hfId });
        } else {
          setHfStatus({ kind: 'error', code: result.code, ...(result.modelType ? { modelType: result.modelType } : {}) });
        }
      })
      .catch(() => {
        if (seq === hfSeq.current) setHfStatus({ kind: 'error', code: 'network' });
      });
  };
  // URL 의 hf= (공유 링크·뒤로 가기) → 불러오기. 이미 같은 id 를 불러왔으면 그대로
  useEffect(() => {
    if (!restored || !state.hf || hfLoad?.id === state.hf) return;
    loadHf(state.hf);
    // loadHf 는 렌더마다 새 함수지만 같은 일을 한다 — state.hf 가 바뀔 때만 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, state.hf]);
  // 불러온 모델 내려놓기 — 차례 번호를 올려 진행 중인 불러오기 결과가 나중에 대상을 되돌리지 못하게 한다 (D65 경합)
  const dropHf = () => {
    hfSeq.current += 1;
    setHfLoad(undefined);
    setHfStatus({ kind: 'idle' });
  };
  // HF 폼의 "빼기" — 불러온(불러오는 중인) 모델만. 직접 입력 값은 펼침 영역의 "입력한 값 지우기"로 (리뷰 반영)
  const removeHf = () => {
    dropHf();
    dispatch({ type: 'hf', hf: undefined });
  };
  // 직접 입력 (D66): 숫자 칸에 값이 생기는 순간 불러온 모델에서 넘어온다 — 진행 중인 불러오기 결과도 버린다(차례 번호). 키를 누를 때마다가
  // 아니라 불러온 모델이 걸려 있거나 불러오는 중일 때만, 또는 이전 불러오기의 안내 문장이 남아 있을 때만
  const patchManual = (patch: Partial<ManualSpec>) => {
    if (hasManualNumber({ ...state.manual, ...patch }) && (state.hf !== undefined || hfStatus.kind !== 'idle')) dropHf();
    dispatch({ type: 'manual', patch });
  };
  const clearManual = () => {
    setManualStash(undefined);
    dispatch({ type: 'manual', patch: null });
  };
  const restoreManual = () => {
    if (!manualStash) return;
    setManualMoe(isManualMoe(manualStash));
    setManualStash(undefined);
    patchManual(manualStash);
  };
  const setMoe = (moe: boolean) => {
    setManualMoe(moe);
    if (!moe) patchManual({ activeParamsB: undefined, experts: undefined, topK: undefined });
  };
  // 모드를 넘기는 버튼 뒤에는 결과 제목으로 포커스(화면이 통째로 바뀐다) — 갱신이 그려진 뒤
  const focusResults = () => window.setTimeout(() => document.getElementById('results-heading')?.focus(), 0);
  const pickModel = (modelId: string) => {
    dropHf();
    stashManual();
    dispatch({ type: 'pickModel', focus: modelId });
  };
  const seeGpus = (modelId?: string) => {
    if (modelId !== undefined) {
      dropHf();
      stashManual();
    }
    dispatch(modelId !== undefined ? { type: 'toModel', focus: modelId } : { type: 'toModel' });
    focusResults();
  };
  const switchToGpu = (gpuId: string, ramGB?: number) => {
    dispatch(ramGB !== undefined ? { type: 'useGpu', gpuId, ramGB } : { type: 'useGpu', gpuId });
    focusResults();
  };
  const mineAll = () => {
    dispatch({ type: 'mode', mode: 'hardware' });
    focusResults();
  };
  // 메모 — 매 렌더 새 객체면 아래 결과 조립(전 모델 평가)이 매번 다시 돈다. 직접 입력 값은 내용(문자열 키)이 바뀔 때만
  // (정규화가 빈 칸을 걷어 내며 객체를 새로 만들어도 다시 계산하지 않게). 이름은 화면 문구 — 빌더는 비워 둔다
  const manualKey = state.manual ? JSON.stringify(state.manual) : '';
  const manualName = t.calc('manualName');
  const manualBuild = useMemo(() => (manualKey ? buildManualModel(JSON.parse(manualKey) as ManualSpec) : undefined), [manualKey]);
  const extra = useMemo<ExtraModel | undefined>(() => {
    if (manualBuild?.kind === 'ok') return { model: { ...manualBuild.model, name: manualName }, rows: manualBuild.rows, origin: 'manual' };
    return hfLoad && hfLoad.result.kind === 'ok' && hfLoad.id === state.hf
      ? { model: hfLoad.result.model, rows: hfLoad.result.rows, origin: 'hf' }
      : undefined;
  }, [manualBuild, manualName, hfLoad, state.hf]);
  const pinnedMeta: PinnedMeta | undefined =
    extra?.origin === 'manual'
      ? { kind: 'manual' }
      : extra && hfLoad?.result.kind === 'ok'
        ? { kind: 'hf', baseId: hfLoad.result.baseId, ggufRepo: hfLoad.result.ggufRepo }
        : undefined;

  const modelMode = state.mode === 'model';
  const results = useMemo(
    () => (hydrated && restored && !modelMode ? assembleResults(catalog, state, extra) : undefined),
    [catalog, state, hydrated, restored, extra, modelMode],
  );
  // 모델 모드: 무거운 평가(GPU 54종 — 대상·ctx·KV 가 바뀔 때만)와 필터·정렬을 따로 메모한다
  const modelRun = useMemo(
    () => (hydrated && restored && modelMode ? assembleModelRows(catalog, { focus: state.focus, ctx: state.ctx, kv: state.kv }, extra) : undefined),
    [catalog, state.focus, state.ctx, state.kv, extra, hydrated, restored, modelMode],
  );
  const gpuView = useMemo(
    () => (modelRun ? filterGpuRows(modelRun, { type: state.type, budget: state.budget, min: state.min, gsort: state.gsort }) : undefined),
    [modelRun, state.type, state.budget, state.min, state.gsort],
  );
  const mine = useMemo(
    () => (hydrated && restored && modelMode ? myConfigRow(catalog, state, extra) : undefined),
    [catalog, state, extra, hydrated, restored, modelMode],
  );
  const prefix = localePrefix(locale);
  const shareUrl = useMemo(() => {
    if (!hydrated) return '';
    return `${window.location.origin}${window.location.pathname}${serializeCalcQuery(state, catalog)}`;
  }, [hydrated, state, catalog]);

  const assumption = results ? assumptionText(t, locale, state, results.hardware) : undefined;
  const shareText = modelRun
    ? modelRun.origin === 'manual'
      ? t.share('textManualModel', { params: formatParams(locale, modelRun.model.paramsB) })
      : t.share('textModel', { model: modelRun.model.name })
    : results
      ? shareTextFor(t, locale, state, results.hardware)
      : undefined;

  const hfPanel = (
    <HfModelPanel
      t={t}
      hydrated={hydrated}
      status={hfStatus}
      hasHardware={results !== undefined}
      modelMode={modelMode}
      canRemove={state.hf !== undefined || hfStatus.kind === 'loading'}
      text={hfText}
      onTextChange={setHfText}
      onLoad={loadHf}
      onRemove={removeHf}
    >
      <ManualModelFields
        locale={locale}
        t={t}
        hydrated={hydrated}
        spec={state.manual ?? NO_MANUAL}
        open={manualOpen}
        onOpenChange={setManualOpen}
        moe={manualMoe}
        onMoeChange={setMoe}
        onPatch={patchManual}
        hfActive={state.hf !== undefined}
        onClear={clearManual}
        {...(manualStash && !hasManualValue(state.manual) ? { onRestore: restoreManual } : {})}
        status={
          extra?.origin === 'manual'
            ? modelMode
              ? t.calc('manualReadyModelMode')
              : `${t.calc('manualReady')}${results ? '' : ` ${t.calc('hfNeedGpu')}`}`
            : ''
        }
      />
    </HfModelPanel>
  );

  return (
    <div data-calculator className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <ModeSwitch t={t} mode={state.mode} hydrated={hydrated} onChange={(mode) => dispatch({ type: 'mode', mode })} />
        {modelMode ? (
          // 모델 모드: 모델 고르기와 "목록에 없는 모델"을 하드웨어 폼 자리에 함께 둔다 — 그 자리는 SSR 하드웨어 폼이 화면에 보이던
          // 높이만큼 잡아 두어 `?mode=model` 딥링크에서 아래 내용이 움직이지 않게 한다(D65)
          <div className="flex flex-col gap-8" style={formSlot ? { minHeight: formSlot } : undefined}>
            <ModelForm
              catalog={catalog}
              t={t}
              state={state}
              dispatch={dispatch}
              hydrated={hydrated}
              ctx={modelRun?.ctx ?? state.ctx}
              {...(extra
                ? { extraLabel: extra.origin === 'manual' ? extra.model.name : t.calc('modelHfOption', { model: extra.model.name }) }
                : {})}
              onPick={pickModel}
            />
            {hfPanel}
          </div>
        ) : (
          <HardwareForm
            locale={locale}
            catalog={catalog}
            names={names}
            t={t}
            state={state}
            dispatch={dispatch}
            hydrated={hydrated}
            action={`${prefix}/calculator`}
          />
        )}
      </div>
      {assumption && (
        <p data-assumptions className="text-sm text-muted-foreground">
          {assumption}
        </p>
      )}
      {results && results.hardware.theoretical && (
        <p className="rounded-lg border border-verdict-b-fg/40 bg-verdict-b-bg p-3 text-sm text-verdict-b-fg">
          {state.hardware.kind === 'custom'
            ? t.calc('customNotice')
            : results.hardware.extras.length > 0
              ? t.calc('heteroNotice')
              : t.calc('multiGpuNotice', { n: results.hardware.gpuCount })}
          {state.hardware.kind === 'custom' && results.hardware.gpuCount > 1 ? ` ${t.calc('multiGpuNotice', { n: results.hardware.gpuCount })}` : ''}
        </p>
      )}
      {hydrated && shareText !== undefined && <ShareButton t={t} url={shareUrl} shareText={shareText} />}
      {!modelMode && hfPanel}
      {modelMode ? (
        <GpuResultList
          locale={locale}
          t={t}
          state={state}
          dispatch={dispatch}
          run={modelRun}
          view={gpuView}
          mine={mine}
          {...(mine ? { mineMeta: assumptionText(t, locale, { ...state, ctx: mine.ctx }, mine.hardware) } : {})}
          total={catalog.gpus.length}
          hydrated={hydrated}
          prefix={prefix}
          {...(fx ? { fx } : {})}
          onUseGpu={switchToGpu}
          onMineAll={mineAll}
        />
      ) : (
        <ResultList
          locale={locale}
          catalog={catalog}
          t={t}
          state={state}
          dispatch={dispatch}
          results={results}
          hydrated={hydrated}
          prefix={prefix}
          issueUrl={issueUrl}
          {...(pinnedMeta ? { pinnedMeta } : {})}
          onSeeGpus={seeGpus}
        />
      )}
    </div>
  );
}

/** 공유 문구 — 커스텀 하드웨어는 합성 GPU 이름 대신 제조사 계열·메모리로 (리뷰 반영) */
function shareTextFor(t: ReturnType<typeof bindTranslators>, locale: string, state: CalcState, hw: ResolvedHardware): string {
  if (state.hardware.kind === 'custom') {
    const c = state.hardware.custom;
    return t.share('textCustom', {
      class: t.calc(classKey(c.effClass)),
      mem: formatMemGB(locale, c.kind === 'dgpu' ? (c.vramGB ?? 0) : (c.memGB ?? 0)),
    });
  }
  return t.share('text', { gpu: gpuSetLabel(t, hw) });
}

function assumptionText(t: ReturnType<typeof bindTranslators>, locale: string, state: CalcState, hw: ResolvedHardware): string {
  const { gpu, config } = hw;
  const osLabel = t.calc(config.hw.os === 'windows' ? 'osWindows' : config.hw.os === 'linux' ? 'osLinux' : 'osMacos');
  const common = { os: osLabel, ctx: formatCtx(state.ctx), kv: state.kv, ram: formatInt(locale, hw.ramGB) };
  if (hw.theoretical && state.hardware.kind === 'custom') {
    const c = state.hardware.custom;
    const customCommon = {
      ...common,
      class: t.calc(classKey(c.effClass)),
      mem: formatMemGB(locale, c.kind === 'dgpu' ? (c.vramGB ?? 0) : (c.memGB ?? 0)),
      bw: formatInt(locale, c.bandwidthGBs ?? 0),
    };
    // 커스텀 dGPU 는 카탈로그 dGPU 와 같은 시스템 RAM 종류·화면 출력 가정을 쓴다 — 문장에도 드러낸다
    return c.kind === 'dgpu'
      ? t.calc('assumeCustomDgpu', {
          ...customCommon,
          ddr: t.calc(state.ddr),
          display: config.hw.isDisplayGpu ? t.calc(hw.gpuCount > 1 ? 'assumeDisplayMulti' : 'assumeDisplay') : '',
        })
      : t.calc('assumeCustomUnified', customCommon);
  }
  const name = gpuName(t.names, gpu);
  if (gpu.kind === 'dgpu') {
    return t.calc('assumeDgpu', {
      ...common,
      gpu: gpuSetLabel(t, hw),
      // 서로 다른 카드면 카드마다 "24 + 24 + 12" (D67 리뷰 반영 — 더하면 합계)
      vram: gpuSetVram(t, (gb) => formatInt(locale, gb), hw),
      ddr: t.calc(state.ddr),
      // 여러 장이면 화면 출력 예약을 지는 카드(1번)를 밝힌다 — 폼의 '첫 번째 GPU로 모니터 출력 중'과 같은 뜻
      display: config.hw.isDisplayGpu ? t.calc(hw.gpuCount > 1 ? 'assumeDisplayMulti' : 'assumeDisplay') : '',
    });
  }
  if (gpu.kind === 'unified') {
    return t.calc('assumeUnified', { ...common, gpu: name, usable: formatGB(locale, usableGB(config.hw)) });
  }
  return t.calc('assumeCpu', { ...common, ddr: t.calc(state.ddr), usable: formatGB(locale, usableGB(config.hw)) });
}

