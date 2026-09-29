'use client';
import { usableGB } from '@canrun/engine';
import type { CatalogLite } from '@canrun/data/client';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { HardwareForm } from '@/components/islands/hardware-form';
import { ResultList } from '@/components/islands/result-list';
import { ShareButton } from '@/components/islands/share-button';
import { bindTranslators, classKey, localePrefix, makeReducer } from '@/components/islands/calc-shared';
import { formatCtx, formatGB, formatInt, formatMemGB } from '@/lib/format';
import { matchGpu } from '@/lib/calc/gpu-match';
import { assembleResults } from '@/lib/calc/run';
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

  const results = useMemo(() => (hydrated && restored ? assembleResults(catalog, state) : undefined), [catalog, state, hydrated, restored]);
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

