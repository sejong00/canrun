import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui 표준 유틸 — 조건부 클래스 + Tailwind 충돌 해소. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
