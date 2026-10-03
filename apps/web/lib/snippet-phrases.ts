/**
 * 실행 커맨드 각주 문장 — `CommandSnippet`(8k·f16 정적 블록)과 콤보 아일랜드의 셀별 교체 텍스트가
 * 같은 함수를 쓴다 (P1-3 D28). 서버에서만 호출한다(문장은 props 로 내려간다).
 */
import type { CommandPlan } from '@canrun/data';
import { formatCtx, formatGB } from './format';
import type { Translate } from './phrases';

export type SnippetNote = { key: 'ngl' | 'cpuMoe' | 'cpuMoeOom' | 'cpuMoeFit' | 'fa' | 'kv'; text: string };

/** llama.cpp 블록 각주 — `-ngl` 의미 · `--n-cpu-moe` 배치(10-01 D56) · 플래시 어텐션 · KV q8_0 절감 */
export function llamaNotes(t: Translate, locale: string, plan: CommandPlan, kvQ8GB: number): SnippetNote[] {
  const llama = plan.llamaCpp;
  if (!llama) return [];
  const notes: SnippetNote[] = [];
  if (llama.ngl === 'all') notes.push({ key: 'ngl', text: t('nglAll') });
  else if (llama.ngl === 0) notes.push({ key: 'ngl', text: t('nglZero') });
  else notes.push({ key: 'ngl', text: t('nglN', { n: llama.ngl, layers: plan.layers }) });
  if (llama.nCpuMoe !== undefined) {
    // GPU 쪽은 블록 수가 아니라 전문가 층 수로 센다 — 판정 문장과 같은 값(10-03 D63, MoE 블록이 섞인 Nemotron)
    const gpuLayers = llama.gpuExpertLayers ?? 0;
    const [next1, next2] = llama.nCpuMoeNext ?? [];
    if (gpuLayers > 0 && next1 !== undefined) {
      notes.push({ key: 'cpuMoe', text: t('cpuMoePartial', { n: llama.nCpuMoe, gpu: gpuLayers }) });
      // 엔진 배치는 VRAM 을 거의 다 쓴다 — 드라이버·백그라운드 사용량으로 모자랄 때의 대처.
      // 올릴 값은 전문가 층을 하나씩 더 RAM 으로 보내는 값(전문가 없는 블록만 덮는 N+1 은 VRAM 을 줄이지 못한다)
      notes.push({
        key: 'cpuMoeOom',
        text: next2 !== undefined ? t('cpuMoeOom', { next1, next2 }) : t('cpuMoeOomOne', { next: next1 }),
      });
    } else {
      notes.push({ key: 'cpuMoe', text: t('cpuMoe', { n: llama.nCpuMoe }) });
    }
    notes.push({ key: 'cpuMoeFit', text: t('cpuMoeFit') });
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
    ...(plan.ollama.moeAuto ? [t('ollamaMoe')] : []),
    // KV 양자화 셀: 서버 env 로만 바뀌고 전역이다 (Ollama FAQ — snippet.ts 헤더)
    ...(plan.kvQuant !== 'f16' ? [t('ollamaKv')] : []),
  ];
}
