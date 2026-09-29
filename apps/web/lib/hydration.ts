import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * 하이드레이션 완료 여부 — SSR 과 첫 클라이언트 렌더는 false, 이후 true.
 * effect 안 setState 없이(react-hooks 7 `set-state-in-effect`) 서버·클라이언트 첫 렌더를 동일하게 유지한다 (P1-3 D36).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
