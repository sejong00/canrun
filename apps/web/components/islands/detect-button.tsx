'use client';
import type { CatalogLite } from '@canrun/data/client';
import { useState } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { buttonVariants } from '@/components/ui/button-variants';
import { interpretDetection, type DetectResult, type GpuNames } from '@/lib/calc/gpu-match';

/**
 * GPU 자동 감지 버튼 (docs/01 F1, D30). SSR 에 항상 그려 자리를 잡고(CLS 0), 하이드레이션 뒤 API 가 있으면 활성.
 * 감지 모듈은 클릭 시에만 import() — 클릭 전엔 어떤 GPU API 도 호출하지 않는다. 결과 해석은 순수 함수.
 */
export function DetectButton({
  catalog,
  names,
  t,
  hydrated,
  onResult,
}: {
  catalog: CatalogLite;
  names: GpuNames;
  t: CalcTranslators;
  hydrated: boolean;
  onResult: (result: DetectResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const available =
    hydrated && typeof navigator !== 'undefined' && (Boolean(navigator.gpu) || typeof WebGLRenderingContext !== 'undefined');

  const run = async () => {
    setBusy(true);
    try {
      const mod = await import('@/lib/calc/detect-gpu');
      const input = await mod.detectGpu();
      onResult(interpretDetection(input, catalog.gpus, names));
    } catch {
      onResult({ kind: 'none' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" style={hydrated && !available ? { visibility: 'hidden' } : undefined}>
      <button
        type="button"
        data-detect
        className={buttonVariants({ variant: 'outline' }) + ' h-11 sm:h-10'}
        disabled={!available || busy}
        aria-busy={busy || undefined}
        onClick={() => void run()}
      >
        {busy ? t.detect('working') : t.detect('button')}
      </button>
      <span className="text-xs text-muted-foreground">{t.detect('privacy')}</span>
    </div>
  );
}
