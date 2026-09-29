/**
 * 실행 커맨드 각주 문장 — `CommandSnippet`(8k·f16 정적 블록)과 콤보 아일랜드의 셀별 교체 텍스트가
 * 같은 함수를 쓴다 (P1-3 D28). 서버에서만 호출한다(문장은 props 로 내려간다).
 */
import type { CommandPlan } from '@canrun/data';
import { formatCtx, formatGB } from './format';
import type { Translate } from './phrases';

export type SnippetNote = { key: 'ngl' | 'cpuMoe' | 'cpuMoeMin' | 'fa' | 'kv'; text: string };

/** llama.cpp 블록 각주 — `-ngl` 의미 · N/N_min · 플래시 어텐션 · KV q8_0 절감 */
export function llamaNotes(t: Translate, locale: string, plan: CommandPlan, kvQ8GB: number): SnippetNote[] {
  const llama = plan.llamaCpp;
  if (!llama) return [];
  const notes: SnippetNote[] = [];
  if (llama.ngl === 'all') notes.push({ key: 'ngl', text: t('nglAll') });
  else if (llama.ngl === 0) notes.push({ key: 'ngl', text: t('nglZero') });
  else notes.push({ key: 'ngl', text: t('nglN', { n: llama.ngl, layers: plan.layers }) });
  if (llama.nCpuMoe !== undefined) {
    notes.push({ key: 'cpuMoe', text: t('cpuMoe', { n: llama.nCpuMoe }) });
    if (llama.nCpuMoeMin !== undefined && llama.nCpuMoeMin < llama.nCpuMoe) {
      notes.push({ key: 'cpuMoeMin', text: t('cpuMoeMin', { min: llama.nCpuMoeMin }) });
    }
  }
  notes.push({ key: 'fa', text: t('fa') });
  // KV 양자화 절감 안내는 f16 명령에만 — 이미 q8_0/q4_0 인 셀엔 중복
  if (plan.kvQuant === 'f16') {
    notes.push({ key: 'kv', text: t('kv', { kv: formatGB(locale, kvQ8GB, 2), ctx: formatCtx(plan.ctx) }) });
  }
  return notes;
}

/** Ollama 블록 각주 — 컨텍스트 기본값 안내 · 자동 오프로드 */
export function ollamaNotes(t: Translate, plan: CommandPlan): string[] {
  if (!plan.ollama) return [];
  return [
    t('ctx'),
    ...(plan.ollama.autoOffload ? [t('ollamaAutoOffload')] : []),
    // KV 양자화 셀: 서버 env 로만 바뀌고 전역이다 (Ollama FAQ — snippet.ts 헤더)
    ...(plan.kvQuant !== 'f16' ? [t('ollamaKv')] : []),
  ];
}
