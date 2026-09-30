/**
 * 시나리오 고정 모델 집합 (09-30 카탈로그 37종 — 카탈로그 확장 자동화).
 * 대안·인접 조합·판정 분포처럼 "특정 상황의 기대값"을 고정한 테스트는 모델이 늘면 흔들린다. 그런 테스트는
 * 이 집합 위에서만 돌게 해, 새 모델 추가(`scripts/add-model.ts`)가 테스트 수정을 부르지 않게 한다.
 * 새 모델의 페이지는 export 테스트가 전수 검사한다. 기존 모델의 데이터가 바뀌어 기대값이 바뀌면 그건 실제 동작 변화 — 갱신한다.
 */
import type { SeedFiles } from '../src/index';

export const SCENARIO_MODEL_IDS: ReadonlySet<string> = new Set([
  'llama-3.1-8b',
  'llama-3.3-70b',
  'qwen3-8b',
  'qwen3-14b',
  'qwen3-32b',
  'qwen3-30b-a3b-2507',
  'qwen3.5-9b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3.5-122b-a10b',
  'gpt-oss-20b',
  'gpt-oss-120b',
  'gemma-3-12b',
  'gemma-3-27b',
  'gemma-4-12b',
  'gemma-4-26b-a4b',
  'phi-4',
  'mistral-small-3.2-24b',
  'deepseek-r1-distill-32b',
  'deepseek-r1-distill-8b',
  'exaone-4.0-32b',
  'exaone-4.0-1.2b',
  'kanana-1.5-8b',
  'kanana-1.5-15.7b-a3b',
  'hyperclovax-seed-1.5b',
  'hyperclovax-seed-think-14b',
  'solar-open-100b',
  'exaone-4.5-33b',
  'solar-open2-250b',
  'gemma-4-31b',
  'qwen3.8-27b',
  'qwen3.6-35b-a3b',
  'llama-3.2-3b',
  'llama-3.2-1b',
  'minicpm5-2b',
  'minicpm5-1b',
  'granite-4.2-30b',
]);

/** 시드에서 시나리오 모델만 남긴 카탈로그 */
export function scenarioSeed<T extends SeedFiles>(seed: T): T {
  return {
    ...seed,
    models: seed.models.filter((m) => SCENARIO_MODEL_IDS.has(m.id)),
    modelQuants: seed.modelQuants.filter((r) => SCENARIO_MODEL_IDS.has(r.modelId)),
  };
}
