'use client';
import type { GpuCore } from '@canrun/data/client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { GpuListbox, browseOrder } from '@/components/islands/gpu-listbox';
import { gpuTokens, matchGpu, rankGpus } from '@/lib/calc/gpu-match';
import { useHydrated } from '@/lib/hydration';
import { makeT, type Dict } from '@/lib/i18n-lite';
import { gpuName } from '@/lib/phrases';

type Props = {
  locale: string;
  gpus: readonly GpuCore[];
  /** `GPU_PICKER_MESSAGE_SPEC` 로 고른 사전 */
  dict: Dict;
  inputId: string;
  label: string;
  placeholder: string;
};

/**
 * 홈·가이드 계산기 위젯의 GPU 입력 (09-30 사용자 요청 — 브라우저 기본 datalist 가 별칭까지 섞여 중구난방).
 * 계산기와 같은 목록(`GpuListbox` — 6그룹 둘러보기·검색 순위)을 쓴다. 폼 자체는 서버 컴포넌트 `CalcWidget` 의 GET 폼 그대로라
 * JS 가 없거나 하이드레이션 전이면 `input list` + datalist(표시명만, 그룹 순)로 동작한다.
 * 목록에서 고르면 숨은 `gpu=<id>` 를 보내고, 직접 친 텍스트는 그대로 보내 계산기가 해석한다(D31).
 */
export function GpuPicker({ locale, gpus, dict, inputId, label, placeholder }: Props) {
  const hydrated = useHydrated();
  const t = useMemo(() => ({ calc: makeT(dict, locale, 'Calculator'), names: makeT(dict, locale, 'GpuName') }), [dict, locale]);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) if (k.startsWith('GpuName.')) out[k.slice('GpuName.'.length)] = v;
    return out;
  }, [dict]);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<GpuCore | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // -1 = 활성 옵션 없음 (APG — 포커스만으로 첫 옵션을 활성화하지 않는다)
  const [active, setActive] = useState(-1);

  // 하이드레이션 전에 친 글자는 DOM 에만 있다 — 마운트 때 상태로 가져온다 (islands/** set-state-in-effect 예외, D36)
  useEffect(() => {
    const typed = inputRef.current?.value ?? '';
    if (typed) setText(typed);
    return () => window.clearTimeout(blurTimer.current);
  }, []);

  const browsing = gpuTokens(text).length === 0;
  const ranked = rankGpus(text, gpus, names);
  const options = browsing ? browseOrder(ranked) : ranked;
  const listId = `${inputId}-list`;
  const picked = chosen && gpuName(t.names, chosen) === text ? chosen : undefined;
  const activeOption = active >= 0 ? options[active] : undefined;
  const activeOptionId = hydrated && open && activeOption ? `${listId}-${activeOption.id}` : undefined;
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  const choose = (gpu: GpuCore) => {
    const name = gpuName(t.names, gpu);
    if (inputRef.current) inputRef.current.value = name;
    setText(name);
    setChosen(gpu);
    setOpen(false);
    setActive(-1);
  };

  const onInput = (value: string) => {
    setText(value);
    setChosen(undefined);
    setOpen(true);
    // 입력이 한 GPU 로 확정될 때만 첫 후보를 활성화 — Enter 가 추측으로 고르지 않게 (계산기와 같은 규칙, D29)
    const m = matchGpu(value, gpus, { names });
    const first = m.kind === 'exact' ? rankGpus(value, gpus, names)[0] : undefined;
    setActive(m.kind === 'exact' && first?.id === m.id ? 0 : -1);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      // 활성 옵션이 있으면 고르고 바로 제출(숨은 gpu=<id> 가 렌더된 뒤). 없으면 폼 기본 제출(텍스트 그대로 또는 고른 GPU id)
      const pick = open && active >= 0 ? options[active] : undefined;
      if (pick) {
        e.preventDefault();
        const form = e.currentTarget.form;
        flushSync(() => choose(pick));
        form?.requestSubmit();
      }
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

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        id={inputId}
        // 목록에서 고른 GPU 는 숨은 입력이 id 로 보낸다 — 표시명 텍스트는 보내지 않는다
        name={picked ? undefined : 'gpu'}
        required={!picked}
        inputMode="search"
        enterKeyHint="go"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        className="h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm"
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
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          // 옵션 클릭(mousedown)이 먼저 처리되도록 지연
          blurTimer.current = window.setTimeout(() => {
            blurTimer.current = undefined;
            if (document.activeElement === inputRef.current) return;
            setOpen(false);
            setActive(-1);
          }, 120);
        }}
        onKeyDown={onKey}
      />
      {picked && <input type="hidden" name="gpu" value={picked.id} />}
      {hydrated ? (
        open && options.length > 0 ? (
          <GpuListbox
            listId={listId}
            label={label}
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
          {browseOrder(rankGpus('', gpus, names)).map((gpu) => (
            <option key={gpu.id} value={gpuName(t.names, gpu)} />
          ))}
        </datalist>
      )}
    </div>
  );
}
