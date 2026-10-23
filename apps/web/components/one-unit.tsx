import { useTranslations } from 'next-intl';

/**
 * 여러 대 연결 칸의 '1대로 충분' 표시 (10-23 D121 — 사용자 결정 '1대로 충분 표시'). 같은 메모리 1대에 이미 들어가는 모델은 2대·4대 칸에
 * 판정 배지·속도 대신 이것을 그린다(`oneUnitEnough` — packages/data/src/assess.ts). GPU 허브 요약·'메모리 구성별 판정' 표, 콤보 '메모리 용량별 판정'
 * 목록, 가이드 그리드가 같은 표시를 쓴다. `data-one-unit` 은 export 테스트가 읽는다. 클라이언트 JS 0
 */
export function OneUnitChip() {
  const t = useTranslations('GpuHub');
  return (
    <span data-one-unit className="inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
      {t('oneUnit')}
    </span>
  );
}
