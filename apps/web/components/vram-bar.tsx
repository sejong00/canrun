import type { Gpu, VramBreakdown } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { formatGB } from '@/lib/format';

/**
 * 메모리 분해 바 (docs/04 §4 ②) — 서버 렌더 스택 바 + 같은 수치의 <dl>.
 * 접근성: 바는 role=img + 요약 aria-label(자식 텍스트 없음), 수치·라벨은 <dl> 이 담당해 색만으로 뜻을
 * 전하지 않는다. 요약문과 <dl> 은 같은 수치를 쓴다. 폭은 빌드 타임 인라인 width, 높이 고정 — CLS 0.
 * 호출 측은 fit 인 quant 만 넘긴다(미탑재면 분해할 것이 없다).
 */
type SegmentKey = 'weights' | 'kv' | 'buffer' | 'os' | 'free' | 'unusable' | 'ramWeights';
type Segment = { key: SegmentKey; gb: number; className: string };

const TONE: Record<SegmentKey, string> = {
  weights: 'bg-verdict-a-fg',
  kv: 'bg-verdict-b-fg',
  buffer: 'bg-verdict-f-fg/70',
  os: 'bg-muted-foreground/60',
  free: 'bg-muted',
  unusable: 'bg-border',
  ramWeights: 'bg-verdict-a-fg',
};

const LABEL_KEY: Record<SegmentKey, string> = {
  weights: 'barWeights',
  kv: 'barKv',
  buffer: 'barBuffer',
  os: 'barOs',
  free: 'barFree',
  unusable: 'barUnusable',
  ramWeights: 'barRamWeights',
};

function Bar({ segments, label, summary }: { segments: Segment[]; label: string; summary: string }) {
  const total = segments.reduce((sum, s) => sum + s.gb, 0) || 1;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div
        role="img"
        aria-label={summary}
        className="flex h-5 w-full overflow-hidden rounded-md border border-border"
      >
        {segments
          .filter((s) => s.gb > 0)
          .map((s) => (
            <div
              key={s.key}
              className={s.className}
              style={{ width: `${Math.max(0.5, (s.gb / total) * 100).toFixed(2)}%` }}
            />
          ))}
      </div>
    </div>
  );
}

export function VramBar({
  breakdown,
  gpu,
  mode,
}: {
  breakdown: VramBreakdown;
  gpu: Gpu;
  mode: 'full-gpu' | 'cpu-moe' | 'partial-offload' | 'cpu-only';
}) {
  const locale = useLocale();
  const t = useTranslations('Combo');
  const tCommon = useTranslations('Common');
  const gb = (v: number) => formatGB(locale, v);
  const g = breakdown.gpu;
  const showGpu = gpu.kind !== 'cpu' && mode !== 'cpu-only';
  // 통합 메모리: 한도(전체 RAM) 중 GPU 가 못 쓰는 30% 를 따로 표시 — 여유는 GPU 가용분 안에서만 센다
  const unusable = gpu.kind === 'unified' ? Math.max(0, g.limit - g.usable) : 0;
  const free = Math.max(0, g.limit - g.total - unusable);
  const gpuSegments: Segment[] = [
    { key: 'weights', gb: g.weights, className: TONE.weights },
    { key: 'kv', gb: g.kv, className: TONE.kv },
    { key: 'buffer', gb: g.buffer, className: TONE.buffer },
    { key: 'os', gb: g.osReserve, className: TONE.os },
    { key: 'free', gb: free, className: TONE.free },
    { key: 'unusable', gb: unusable, className: TONE.unusable },
  ];
  const ramSegments: Segment[] = [
    { key: 'ramWeights', gb: breakdown.ram.weights, className: TONE.ramWeights },
    { key: 'free', gb: Math.max(0, breakdown.ram.usable - breakdown.ram.weights), className: TONE.free },
  ];
  const summaryArgs = {
    used: gb(g.total),
    limit: gb(g.limit),
    weights: gb(g.weights),
    kv: gb(g.kv),
    buffer: gb(g.buffer),
    os: gb(g.osReserve),
    free: gb(free),
    unusable: gb(unusable),
  };
  const entries: Segment[] = [
    ...(showGpu ? gpuSegments : []),
    ...(breakdown.ram.weights > 0 ? [ramSegments[0]!] : []),
  ].filter((s) => s.gb > 0);

  return (
    <figure data-vram-bar className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <figcaption className="text-sm text-muted-foreground">{t(showGpu ? 'memoryCaption' : 'memoryCaptionRam')}</figcaption>
      {showGpu && (
        <Bar
          label={gpu.kind === 'unified' ? t('barUnified') : t('barGpu')}
          summary={t(gpu.kind === 'unified' ? 'barSummaryUnified' : 'barSummaryGpu', summaryArgs)}
          segments={gpuSegments}
        />
      )}
      {breakdown.ram.weights > 0 && (
        <Bar
          label={t('barRam')}
          summary={t('barSummaryRam', { weights: gb(breakdown.ram.weights), usable: gb(breakdown.ram.usable) })}
          segments={ramSegments}
        />
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {entries.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden="true" className={`inline-block size-3 rounded-sm ${s.className}`} />
              {t(LABEL_KEY[s.key])}
            </dt>
            <dd className="tabular-nums">{tCommon('gb', { value: gb(s.gb) })}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
