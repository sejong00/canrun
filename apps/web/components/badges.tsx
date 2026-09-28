import { classifyLicense, type GgufPublisher, type LicenseClass } from '@canrun/data';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { hfUrl } from '@/lib/links';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'caution' | 'strong';

const TONE: Record<Tone, string> = {
  neutral: 'border-border text-muted-foreground',
  info: 'border-verdict-a-fg/40 text-verdict-a-fg',
  caution: 'border-verdict-b-fg/50 bg-verdict-b-bg text-verdict-b-fg',
  strong: 'border-verdict-f-fg/50 bg-verdict-f-bg text-verdict-f-fg',
};

/** 정보 배지 (판정 배지와 달리 등급이 아닌 속성 표시) */
export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const LICENSE_TONE: Record<LicenseClass, Tone> = {
  permissive: 'neutral',
  custom: 'caution',
  nonCommercial: 'strong',
  unknown: 'caution',
};

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

const PUBLISHER_TONE: Record<GgufPublisher['kind'], Tone> = {
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
