/**
 * 모델 계열 — 모델 허브의 "같은 계열의 다른 크기" 표(10-19). 의존성 0: export 테스트(저장소 루트)도 읽는다.
 *
 * - 계열 = 모델 id 에서 크기 꼬리(`-8b`·`-26b-a4b`·`-15.7b-a3b`·`-30b-a3b-2507`·`-e2b`)를 뗀 앞부분. 크기 꼬리가 없는 id(`phi-4`·`laguna-s-2.1`)는 계열이 없다.
 * - 매일 도는 신모델 자동 추가(`scripts/auto-add-models.ts`)는 `--id` 없이 `slugFromHfId`(packages/data/src/hf.ts)로 id 를 만든다.
 *   그 id 도 같은 계열로 묶이도록 크기 꼬리가 유효 파라미터(`-e2b`, Gemma 3n·4 의 E 크기)와 날짜 앞의 `-instruct`·`-thinking`
 *   (`Qwen3-4B-Instruct-2507` → `qwen3-4b-instruct-2507`)을 받고, R1 Distill 은 `-qwen`·`-llama` 가 붙은 앞부분도 별칭으로 받는다.
 *   실제 HF id 를 `slugFromHfId` 로 바꿔 계열을 확인하는 테스트가 이 약속을 지킨다(`test/model-series.test.ts`). 그 밖의 이름 모양은
 *   자동 추가 PR 을 검토할 때 id 를 고치거나 아래 예외 표에 더한다.
 * - 버전 번호가 다르면 다른 계열이다 — Llama 3.1·3.2·3.3, Qwen3·3.5·3.6·3.8, EXAONE 4.0·4.5, Solar Open·Open 2, Gemma 3·3n·4 는 묶지 않는다
 *   (번호가 바뀌면 학습 데이터·구조가 다른 모델이라 "같은 모델의 다른 크기"가 아니다). 같은 버전의 날짜 갱신(`-2507`)은 같은 계열이다.
 *   이름 줄기가 다른 모델(HyperCLOVA X SEED 와 SEED Think, MiniCPM5 와 MiniCPM-V)도 따로다 — id 앞부분이 다르다.
 * - 예외 두 표: `SERIES_OVERRIDES`(모델 id → 계열 — 크기 꼬리가 없는 Ling-3.0 Tiny·Flash, 이름 줄기가 다른 DeepSeek R1 0528 Qwen3 8B) ·
 *   `SERIES_ALIASES`(뗀 앞부분 → 계열 — R1 Distill 은 손으로 정한 id(`deepseek-r1-distill-14b`)든 자동 id(`deepseek-r1-distill-qwen-7b`)든 'deepseek-r1' 로).
 * - 구성원이 하나뿐인 계열은 표를 그리지 않는다(`seriesMembers` 가 빈 배열).
 */

/** 크기 꼬리 — 전체 파라미터 `-NNb`(유효 파라미터 `-eNNb` 포함), MoE 활성 `-aNNb`, 자동 id 의 `-instruct`·`-thinking`, 날짜 갱신 `-YYMM` */
export const SIZE_SUFFIX = /-e?\d+(?:\.\d+)?b(?:-a\d+(?:\.\d+)?b)?(?:-(?:instruct|thinking))?(?:-\d{4})?$/;

/** 모델 id → 계열 (id 규칙으로 정할 수 없는 모델만) */
export const SERIES_OVERRIDES: Readonly<Record<string, string>> = {
  'deepseek-r1-0528-qwen3-8b': 'deepseek-r1',
  'ling-3.0-tiny': 'ling-3.0',
  'ling-3.0-flash': 'ling-3.0',
};

/** 크기 꼬리를 뗀 앞부분 → 계열 */
export const SERIES_ALIASES: Readonly<Record<string, string>> = {
  'deepseek-r1-distill': 'deepseek-r1',
  'deepseek-r1-distill-qwen': 'deepseek-r1',
  'deepseek-r1-distill-llama': 'deepseek-r1',
};

/**
 * 계열 표 아래 한 줄(`messages` `ModelHub.<message>`) — 같은 계열인데 아직 카탈로그에 없는 크기를 알린다.
 * `untilHfIds` 중 하나라도 카탈로그에 들어오면 사라진다(문장이 거짓이 되기 전에). 그 모델이 자동 추가 id 로 들어와도 이 계열 표에
 * 함께 오르는지는 테스트가 `slugFromHfId` 로 확인한다 — 안내만 사라지고 크기가 빠진 표가 남지 않게.
 * Gemma 4 E2B·E4B: 층별 임베딩 표·KV 공유 층 구조라 10-16 D98 에 add-model 을 보류했다가 10-21 D112 에 카탈로그에 넣었다(`gemma-4-e2b`·
 * `gemma-4-e4b`) — 그래서 이 안내는 지금 나오지 않는다(model-series.test 가 두 크기가 계열 표에 함께 오르는지 본다)
 */
export const SERIES_NOTES: Readonly<Record<string, { readonly message: string; readonly untilHfIds: readonly string[] }>> = {
  'gemma-4': { message: 'seriesNoteGemma4', untilHfIds: ['google/gemma-4-E2B-it', 'google/gemma-4-E4B-it'] },
};

/** 모델 id 의 계열. 크기 꼬리도 예외도 없으면 undefined */
export function modelSeries(id: string): string | undefined {
  const override = SERIES_OVERRIDES[id];
  if (override !== undefined) return override;
  const stem = id.replace(SIZE_SUFFIX, '');
  if (stem === id) return undefined;
  return SERIES_ALIASES[stem] ?? stem;
}

/**
 * `id` 와 같은 계열의 모델 전부(그 모델 포함) — 전체 파라미터 작은 순, 같으면 id 순. 구성원이 둘 미만이면 빈 배열
 */
export function seriesMembers<M extends { readonly id: string; readonly paramsB: number }>(models: readonly M[], id: string): M[] {
  const series = modelSeries(id);
  if (series === undefined) return [];
  const members = models
    .filter((m) => modelSeries(m.id) === series)
    .sort((a, b) => a.paramsB - b.paramsB || a.id.localeCompare(b.id));
  return members.length >= 2 ? members : [];
}

/** 계열 표 아래 한 줄의 메시지 키 — 계열에 안내가 있고, 안내가 말하는 모델이 아직 카탈로그에 없을 때만 */
export function seriesNoteKey(models: ReadonlyArray<{ readonly hfId: string }>, id: string): string | undefined {
  const series = modelSeries(id);
  const note = series === undefined ? undefined : SERIES_NOTES[series];
  const until = new Set(note?.untilHfIds.map((h) => h.toLowerCase()));
  if (!note || models.some((m) => until.has(m.hfId.toLowerCase()))) return undefined;
  return note.message;
}
