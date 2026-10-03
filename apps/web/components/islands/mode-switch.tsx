'use client';
import { useId } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { CALC_MODES, type CalcMode } from '@/lib/calc/state';

// 라디오는 sr-only — 선택·키보드 포커스 표시는 래퍼가 :has 로 대신한다 (result-list CHIP 과 같은 방식, 탭 대상 44px)
const CHIP =
  'inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 text-sm has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:checked]:font-medium has-[:disabled]:cursor-default has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2';

/**
 * 계산기 방향 전환 (10-03 D65) — 내 GPU로 모델 찾기 / 모델로 GPU 찾기. SSR·첫 렌더는 항상 하드웨어 모드이고
 * 하이드레이션 전엔 비활성(D36) — `?mode=model` 은 복원 뒤에 반영된다(칩의 선택 표시만 바뀌어 레이아웃 이동 없음).
 */
export function ModeSwitch({
  t,
  mode,
  hydrated,
  onChange,
}: {
  t: CalcTranslators;
  mode: CalcMode;
  hydrated: boolean;
  onChange: (mode: CalcMode) => void;
}) {
  const id = useId();
  return (
    <fieldset data-mode-switch className="flex flex-wrap items-center gap-2">
      <legend className="mb-2 text-sm font-medium">{t.calc('modeLegend')}</legend>
      {CALC_MODES.map((m) => (
        <label key={m} className={CHIP}>
          <input
            type="radio"
            name={`${id}-mode`}
            value={m}
            className="sr-only"
            checked={mode === m}
            disabled={!hydrated}
            onChange={() => onChange(m)}
          />
          {m === 'hardware' ? t.calc('modeHardware') : t.calc('modeModel')}
        </label>
      ))}
    </fieldset>
  );
}
