/**
 * 콤보 아일랜드(ctx·KV·시스템 RAM) 초기값 — URL `?ctx=&kv=&ram=` 는 처음 열 때만 읽는다(상호작용 중엔 URL 을 쓰지 않는다,
 * P1-3 D28 · 10-03 D64). 의존성 없는 순수 함수라 아일랜드와 유닛 테스트가 함께 쓴다.
 */
export type ComboPresetInput = {
  ctxs: readonly number[];
  kvQuants: readonly string[];
  initial: { ctx: number; kv: string };
  /** RAM 토글이 있는 페이지만 — options 는 계단(16·32·64·96·128GB), initial 은 정적 표·명령이 계산된 RAM */
  ram?: { options: readonly number[]; initial: number };
};

/** ram 이 있으면 RAM 모드(ctx·KV 는 8k·f16 고정)로 연다 — 없으면 정적 RAM 기준 그대로 */
export type ComboPreset = { ctxIdx: number; kv: string; ram?: number };

export function comboPreset(search: string, p: ComboPresetInput): ComboPreset {
  const q = new URLSearchParams(search);
  const initialIdx = p.ctxs.indexOf(p.initial.ctx);
  // 유효한 다른 RAM 이면 그 RAM 의 8k·f16 만 보여 줄 수 있다 — ctx·kv 초기값은 버린다
  const ram = Number(q.get('ram'));
  if (p.ram && p.ram.options.includes(ram) && ram !== p.ram.initial) {
    return { ctxIdx: initialIdx, kv: p.initial.kv, ram };
  }
  const ctx = Number(q.get('ctx'));
  const kv = q.get('kv') ?? '';
  return {
    ctxIdx: p.ctxs.includes(ctx) ? p.ctxs.indexOf(ctx) : initialIdx,
    kv: p.kvQuants.includes(kv) ? kv : p.initial.kv,
  };
}
