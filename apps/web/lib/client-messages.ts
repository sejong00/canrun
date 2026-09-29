import { getMessages } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { pickMessages, type Dict, type MessageSpec } from './i18n-lite';

/**
 * 서버 전용 — 요청 로케일의 메시지에서 아일랜드가 쓰는 부분집합을 잘라 props 로 넘긴다 (P1-3 D27).
 * `request.ts` 가 이미 로드한 JSON 을 재사용하므로 추가 import 가 없다.
 */
export async function clientDict(locale: Locale, spec: MessageSpec): Promise<Dict> {
  const all = (await getMessages({ locale })) as Record<string, unknown>;
  return pickMessages(all, spec);
}
