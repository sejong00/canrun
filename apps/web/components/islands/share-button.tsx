'use client';
import { useId, useState, useSyncExternalStore } from 'react';
import type { CalcTranslators } from '@/components/islands/calc-shared';
import { buttonVariants } from '@/components/ui/button-variants';

const subscribeNoop = () => () => {};
const canShareNow = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
const canShareServer = () => false;

/**
 * 결과 공유 (docs/01 F4) — Web Share 가 있으면 "공유" 버튼(시트 취소는 조용히), "링크 복사"는 항상 클립보드 →
 * 실패 시 읽기 전용 입력(주소 복사) 폴백. 라벨과 동작을 일치시킨다(리뷰 지적).
 */
export function ShareButton({ t, url, shareText }: { t: CalcTranslators; url: string; shareText: string }) {
  const id = useId();
  const [status, setStatus] = useState('');
  const canShare = useSyncExternalStore(subscribeNoop, canShareNow, canShareServer);

  const share = async () => {
    try {
      await navigator.share({ url, text: shareText });
    } catch {
      // 사용자가 공유 시트를 닫은 경우(AbortError) 등 — 아무것도 알리지 않는다
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus(t.share('copied'));
    } catch {
      setStatus(t.share('copyFailed'));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {canShare && (
        <button type="button" data-share className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' min-h-9'} onClick={() => void share()}>
          {t.share('share')}
        </button>
      )}
      <button
        type="button"
        {...(canShare ? { 'data-share-copy': true } : { 'data-share': true })}
        className={buttonVariants({ variant: 'outline', size: 'sm' }) + ' min-h-9'}
        onClick={() => void copy()}
      >
        {t.share('copy')}
      </button>
      <label htmlFor={id} className="sr-only">
        {t.share('urlLabel')}
      </label>
      <input
        id={id}
        data-share-url
        readOnly
        value={url}
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-base sm:h-9 sm:text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <p role="status" aria-live="polite" className="basis-full text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  );
}
