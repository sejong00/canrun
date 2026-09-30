'use client';
import type { GpuCore } from '@canrun/data/client';
import { GPU_GROUPS, gpuGroup, type GpuGroup } from '@/lib/calc/gpu-match';
import { formatInt } from '@/lib/format';
import type { TranslateWithHas } from '@/lib/i18n-lite';
import { gpuName } from '@/lib/phrases';

/** 목록이 쓰는 번역기 — 계산기(`bindTranslators`)와 GPU 선택기가 같은 모양으로 넘긴다 */
export type GpuListTranslators = { calc: TranslateWithHas; names: TranslateWithHas };

export function gpuMemoryLabel(t: GpuListTranslators, locale: string, gpu: GpuCore): string {
  if (gpu.kind === 'dgpu') return t.calc('optionMemoryVram', { vram: formatInt(locale, gpu.vramGB ?? 0) });
  const opts = gpu.ramOptionsGB ?? [];
  if (opts.length === 0) return '';
  return t.calc('optionMemoryRange', { min: formatInt(locale, Math.min(...opts)), max: formatInt(locale, Math.max(...opts)) });
}

/** 둘러보기 그룹 머리글 (D29) — 리터럴 키로 써서 i18n 정적 스캔이 양 로케일 존재를 검사한다 */
function groupLabel(t: GpuListTranslators, group: GpuGroup): string {
  switch (group) {
    case 'nvidia':
      return t.calc('groupNvidia');
    case 'amd':
      return t.calc('groupAmd');
    case 'intel':
      return t.calc('groupIntel');
    case 'apple':
      return t.calc('groupApple');
    case 'apu':
      return t.calc('groupApu');
    case 'cpu':
      return t.calc('groupCpu');
  }
}

/** 둘러보기 순서 — 6그룹(D29) 순으로 묶는다. 그룹 안의 순서는 입력(`rankGpus` 빈 질의 = 인기 먼저·이름순)을 따른다 */
export function browseOrder(ranked: readonly GpuCore[]): GpuCore[] {
  return GPU_GROUPS.flatMap((g) => ranked.filter((gpu) => gpuGroup(gpu) === g));
}

type Props = {
  listId: string;
  label: string;
  locale: string;
  t: GpuListTranslators;
  options: readonly GpuCore[];
  /** 둘러보기(뜻 있는 토큰 없는 질의)면 그룹 머리글을 단다 — `options` 는 `browseOrder` 순이어야 한다 */
  browsing: boolean;
  active: number;
  onChoose: (gpu: GpuCore) => void;
  onActive: (index: number) => void;
};

/**
 * GPU 팝업 목록 (APG listbox — 둘러보기는 grouped listbox). 계산기 하드웨어 폼과 홈·가이드 GPU 선택기가 공유한다.
 * 옵션 id = `${listId}-${gpu.id}` (콤보박스 `aria-activedescendant` 대상).
 */
export function GpuListbox({ listId, label, locale, t, options, browsing, active, onChoose, onActive }: Props) {
  const renderOption = (gpu: GpuCore, i: number) => (
    <li
      key={gpu.id}
      id={`${listId}-${gpu.id}`}
      role="option"
      aria-selected={i === active}
      data-gpu-id={gpu.id}
      className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? 'bg-muted' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onChoose(gpu);
      }}
      onMouseEnter={() => onActive(i)}
    >
      <span>
        {gpuName(t.names, gpu)}
        {gpu.form === 'laptop' && <span className="ml-1 text-xs text-muted-foreground">· {t.calc('optionLaptop')}</span>}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{gpuMemoryLabel(t, locale, gpu)}</span>
    </li>
  );

  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={label}
      // 머리글·여백·스크롤바를 눌러도 입력창 포커스가 떠나지 않게, 스크롤 영역은 Tab 순서에서 뺀다 (재검증)
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      className="absolute left-0 right-0 z-10 mt-1 max-h-[50vh] overflow-auto rounded-md border border-border bg-background shadow-lg"
    >
      {browsing
        ? // 둘러보기: APG "grouped listbox" — group 안의 presentation 머리글 + option
          GPU_GROUPS.map((group) => {
            const items = options.map((gpu, i) => ({ gpu, i })).filter(({ gpu }) => gpuGroup(gpu) === group);
            if (items.length === 0) return null;
            const headingId = `${listId}-group-${group}`;
            return (
              <li key={group} role="presentation">
                <ul role="group" aria-labelledby={headingId}>
                  <li role="presentation" id={headingId} data-gpu-group={group} className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                    {groupLabel(t, group)}
                  </li>
                  {items.map(({ gpu, i }) => renderOption(gpu, i))}
                </ul>
              </li>
            );
          })
        : options.map((gpu, i) => renderOption(gpu, i))}
    </ul>
  );
}
