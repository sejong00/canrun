import { classifyLicense, type GgufPublisher, type LicenseClass } from '@canrun/data';
import { useTranslations } from 'next-intl';
import { Pill, type PillTone } from '@/components/pill';
import { hfUrl } from '@/lib/links';

export { Pill } from '@/components/pill';

const LICENSE_TONE: Record<LicenseClass, PillTone> = {
  permissive: 'neutral',
  custom: 'caution',
  nonCommercial: 'strong',
  unknown: 'caution',
};

/** 라이선스 분류별 배지 톤 — 계산기 카드(축약 배지)와 공유 */
export const licenseTone = (cls: LicenseClass): PillTone => LICENSE_TONE[cls];

/**
 * 라이선스 배지 — NC·별도 약관을 강조한다. 권리 판단이 아니라 "약관 확인 필요도" 표시이며
 * 원문은 모델 카드 링크로 보낸다 (docs/PROGRESS §4 08-26 "특이 라이선스는 표시 정보").
 */
export function LicenseBadge({ license, hfId }: { license: string; hfId: string }) {
  const t = useTranslations('License');
  const cls = classifyLicense(license);
  return (
    <a href={hfUrl(hfId)} className="no-underline" data-license={cls}>
      <Pill tone={LICENSE_TONE[cls]}>{t(cls, { license })}</Pill>
    </a>
  );
}

const PUBLISHER_TONE: Record<GgufPublisher['kind'], PillTone> = {
  official: 'info',
  llamacpp: 'info',
  community: 'neutral',
};

/** GGUF 출처 3단 배지 (결정 D3) — 저장소로 링크 */
export function GgufSourceBadge({ publisher }: { publisher: GgufPublisher }) {
  const t = useTranslations('GgufSource');
  return (
    <a href={hfUrl(publisher.repo)} className="no-underline" data-gguf-source={publisher.kind}>
      <Pill tone={PUBLISHER_TONE[publisher.kind]}>
        {t(publisher.kind, { owner: publisher.owner })}
      </Pill>
    </a>
  );
}
