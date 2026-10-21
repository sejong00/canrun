/**
 * 실행 커맨드 각주 문장 — `CommandSnippet`(8k·f16 정적 블록)과 콤보 아일랜드의 셀별 교체 텍스트가
 * 같은 함수를 쓴다 (P1-3 D28). 서버에서만 호출한다(문장은 props 로 내려간다).
 */
import type { CommandPlan } from '@canrun/data';
import { formatCtx, formatGB } from './format';
import type { Translate } from './phrases';

export type SnippetNote = { key: 'ngl' | 'cpuMoe' | 'cpuMoeOom' | 'cpuMoeFit' | 'np' | 'fa' | 'kv'; text: string };

/** llama.cpp 블록 각주 — `-ngl` 의미 · `--n-cpu-moe` 배치(10-01 D56) · `-np 1`(압축 어텐션, 10-22 D115 리뷰) · 플래시 어텐션 · KV q8_0 절감 */
export function llamaNotes(t: Translate, locale: string, plan: CommandPlan, kvQ8GB: number): SnippetNote[] {
  const llama = plan.llamaCpp;
  if (!llama) return [];
  const notes: SnippetNote[] = [];
  if (llama.ngl === 'all') notes.push({ key: 'ngl', text: t('nglAll') });
  // GPU 여러 장의 cpu-moe(10-03 D67) — 명령에서 두 옵션을 이미 뺐다(--fit 자동 배치). cpuMoeFit("빼고 실행해도")는 두 옵션이 있는
  // 명령의 대안 안내라 뜻이 맞지 않는다(리뷰 반영). 지금 이 함수를 부르는 곳(콤보 페이지)은 1장이라 닿지 않고, 계산기는 fitAutoNote 를 쓴다
  else if (llama.ngl === 'auto') notes.push({ key: 'ngl', text: t('nglFitAuto') });
  else if (llama.ngl === 0) notes.push({ key: 'ngl', text: t('nglZero') });
  else if (plan.loops !== undefined) {
    // 반복 층 모델(10-22 D114): -ngl 이 논리 층(층 × loops)과 출력층을 센다 — GPU 에 가중치가 가는 물리 층 수를 함께 말한다(snippet.ts 헤더)
    const logical = plan.layers * plan.loops;
    const blocks = Math.max(0, llama.ngl - plan.layers * (plan.loops - 1) - 1);
    notes.push({ key: 'ngl', text: t('nglNLoops', { n: llama.ngl, logical, layers: plan.layers, blocks }) });
  } else notes.push({ key: 'ngl', text: t('nglN', { n: llama.ngl, layers: plan.layers }) });
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
  // 압축 어텐션(10-22 D115 리뷰): 압축 캐시가 슬롯마다 따로 잡혀 기본 4슬롯이면 KV 가 4배 — 명령이 -np 1 을 붙인 이유(snippet.ts 헤더)
  if (llama.singleSlot) notes.push({ key: 'np', text: t('np1') });
  notes.push({ key: 'fa', text: t('fa') });
  // KV 양자화 절감 안내는 f16 명령에만 — 이미 q8_0/q4_0 인 셀엔 중복
  if (plan.kvQuant === 'f16') {
    notes.push({ key: 'kv', text: t('kv', { kv: formatGB(locale, kvQ8GB, 2), ctx: formatCtx(plan.ctx) }) });
  }
  return notes;
}

/** 파일 줄 ("파일: … (GB, repo).") — 정적 `CommandSnippet` 과 RAM 토글의 결과 블록(10-03 D64)이 같이 쓴다 */
export function snippetFileText(t: Translate, locale: string, plan: CommandPlan): string {
  const size = formatGB(locale, plan.file.fileGB, 2);
  const file = plan.file.name ?? plan.file.tag;
  return plan.file.shards > 1
    ? t('fileSharded', { file, rest: plan.file.shards - 1, size, repo: plan.file.repo })
    : t('file', { file, size, repo: plan.file.repo });
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
