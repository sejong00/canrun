'use client';
import { usableGB } from '@canrun/engine';
import type { CatalogLite } from '@canrun/data/client';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { HardwareForm } from '@/components/islands/hardware-form';
import { HfModelPanel, type HfPanelStatus } from '@/components/islands/hf-model-panel';
import { ResultList } from '@/components/islands/result-list';
import { ShareButton } from '@/components/islands/share-button';
import { bindTranslators, classKey, localePrefix, makeReducer } from '@/components/islands/calc-shared';
import { formatCtx, formatGB, formatInt, formatMemGB } from '@/lib/format';
import { matchGpu } from '@/lib/calc/gpu-match';
import type { HfLoadResult } from '@/lib/calc/hf-load';
import { assembleResults, type ExtraModel } from '@/lib/calc/run';
import { defaultState, type CalcState } from '@/lib/calc/state';
import { parseCalcQuery, serializeCalcQuery } from '@/lib/calc/url';
import { useHydrated } from '@/lib/hydration';
import type { Dict } from '@/lib/i18n-lite';
import { gpuName } from '@/lib/phrases';

/**
 * 계산기 아일랜드 (docs/01 F1·F4, P1-3). SSR 은 폼만(기본 상태) — 결과·콤보박스 승격·감지 버튼 활성은
 * 하이드레이션 뒤 렌더 분기 (D36). 상태 → URL 은 300ms 디바운스 `replaceState(history.state, …)` (D31).
 */
export function CalculatorIsland({
  locale,
  catalog,
  dict,
  issueUrl,
}: {
  locale: string;
  catalog: CatalogLite;
  dict: Dict;
  issueUrl: string;
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
    dispatch({ type: 'restore', state: parsed });
    setRestored(true);
    const onPop = () => dispatch({ type: 'restore', state: parseCalcQuery(window.location.search, catalog, names) });
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
  const catalogIdFor = (hfId: string) => catalog.models.find((m) => m.hfId.toLowerCase() === hfId.toLowerCase())?.id;
  // 불러오기 차례 번호 — 늦게 끝난 이전 요청(다른 모델·빼기 뒤)의 결과는 버린다 (10-01 리뷰)
  const hfSeq = useRef(0);
  const loadHf = (text: string) => {
    const seq = ++hfSeq.current;
    setHfStatus({ kind: 'loading' });
    void import('@/lib/calc/hf-load')
      .then(({ loadHfModel }) => loadHfModel(text, undefined, { catalogIdFor }))
      .then((result) => {
        if (seq !== hfSeq.current) return;
        if (result.kind === 'catalog') {
          // 이미 목록에 있는 모델 — 불러오지 않고 그 카드를 강조한다(URL 의 m=)
          const name = catalog.models.find((m) => m.id === result.modelId)?.name ?? result.modelId;
          setHfLoad(undefined);
          setHfStatus({ kind: 'catalog', name });
          dispatch({ type: 'hf', hf: undefined });
          dispatch({ type: 'focus', focus: result.modelId });
        } else if (result.kind === 'ok') {
          setHfLoad({ id: result.hfId, result });
          setHfStatus({ kind: 'loaded', name: result.model.name });
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
  const removeHf = () => {
    hfSeq.current += 1;
    setHfLoad(undefined);
    setHfStatus({ kind: 'idle' });
    dispatch({ type: 'hf', hf: undefined });
  };
  // 메모 — 매 렌더 새 객체면 아래 결과 조립(전 모델 평가)이 매번 다시 돈다
  const extra = useMemo<ExtraModel | undefined>(
    () => (hfLoad && hfLoad.result.kind === 'ok' && hfLoad.id === state.hf ? { model: hfLoad.result.model, rows: hfLoad.result.rows } : undefined),
    [hfLoad, state.hf],
  );
  const hfMeta = extra && hfLoad?.result.kind === 'ok' ? { baseId: hfLoad.result.baseId, ggufRepo: hfLoad.result.ggufRepo } : undefined;

  const results = useMemo(
    () => (hydrated && restored ? assembleResults(catalog, state, extra) : undefined),
    [catalog, state, hydrated, restored, extra],
  );
  const prefix = localePrefix(locale);
  const shareUrl = useMemo(() => {
    if (!hydrated) return '';
    return `${window.location.origin}${window.location.pathname}${serializeCalcQuery(state, catalog)}`;
  }, [hydrated, state, catalog]);

  const assumption = results ? assumptionText(t, locale, state, results.hardware) : undefined;

  return (
    <div data-calculator className="flex flex-col gap-8">
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
      {assumption && (
        <p data-assumptions className="text-sm text-muted-foreground">
          {assumption}
        </p>
      )}
      {results && results.hardware.theoretical && (
        <p className="rounded-lg border border-verdict-b-fg/40 bg-verdict-b-bg p-3 text-sm text-verdict-b-fg">{t.calc('customNotice')}</p>
      )}
      {hydrated && results && (
        <ShareButton t={t} url={shareUrl} shareText={shareTextFor(t, locale, state, results.hardware)} />
      )}
      <HfModelPanel
        t={t}
        hydrated={hydrated}
        status={hfStatus}
        hasHardware={results !== undefined}
        canRemove={state.hf !== undefined || hfStatus.kind === 'loading'}
        onLoad={loadHf}
        onRemove={removeHf}
      />
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
        {...(hfMeta ? { hfMeta } : {})}
      />
    </div>
  );
}

/** 공유 문구 — 커스텀 하드웨어는 합성 GPU 이름 대신 제조사 계열·메모리로 (리뷰 반영) */
function shareTextFor(
  t: ReturnType<typeof bindTranslators>,
  locale: string,
  state: CalcState,
  hw: NonNullable<ReturnType<typeof assembleResults>>['hardware'],
): string {
  if (state.hardware.kind === 'custom') {
    const c = state.hardware.custom;
    return t.share('textCustom', {
      class: t.calc(classKey(c.effClass)),
      mem: formatMemGB(locale, c.kind === 'dgpu' ? (c.vramGB ?? 0) : (c.memGB ?? 0)),
    });
  }
  return t.share('text', { gpu: gpuName(t.names, hw.gpu) });
}

function assumptionText(
  t: ReturnType<typeof bindTranslators>,
  locale: string,
  state: CalcState,
  hw: NonNullable<ReturnType<typeof assembleResults>>['hardware'],
): string {
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
          display: config.hw.isDisplayGpu ? t.calc('assumeDisplay') : '',
        })
      : t.calc('assumeCustomUnified', customCommon);
  }
  const name = gpuName(t.names, gpu);
  if (gpu.kind === 'dgpu') {
    return t.calc('assumeDgpu', {
      ...common,
      gpu: name,
      vram: formatInt(locale, gpu.vramGB ?? 0),
      ddr: t.calc(state.ddr),
      display: config.hw.isDisplayGpu ? t.calc('assumeDisplay') : '',
    });
  }
  if (gpu.kind === 'unified') {
    return t.calc('assumeUnified', { ...common, gpu: name, usable: formatGB(locale, usableGB(config.hw)) });
  }
  return t.calc('assumeCpu', { ...common, ddr: t.calc(state.ddr), usable: formatGB(locale, usableGB(config.hw)) });
}

