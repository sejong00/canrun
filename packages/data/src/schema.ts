/**
 * 데이터 스키마 — docs/03-data-spec.md §1 의 zod 구현.
 *
 * 불변식 (CLAUDE.md 규칙 2):
 *  - 모든 레코드 `sources[]` 필수 (min 1, URL)
 *  - 실거래가는 `priceAsOf` 없이 존재 금지
 *  - 미출시(rumor) 하드웨어 등록 금지 — 스키마로는 강제 불가, PR 리뷰 + research 노트가 게이트
 *
 * 명세 이탈 (docs/03 §1 대비, P0-3 결정):
 *  - Gpu.kind 에 'cpu' 추가 — §2 통합 표의 CPU 프로필 3종 수용, 엔진 Hardware.kind 와 정합
 *  - unified/cpu 는 vramGB 대신 ramOptionsGB[] (PRD "Mac은 칩+RAM 통합 선택")
 *  - BenchPoint.modelId/quant 는 자유 문자열 — 카탈로그 외 캘리브레이션 모델(llama-2-7b 등)과
 *    실측 표기(Q4_0, Q4_K_XL)를 보존 (§4 실측 표가 요구)
 * Submission 스키마는 P2(Workers+D1)에서 구현.
 */

import { z } from 'zod';

const sources = z.array(z.string().url()).min(1);

/** ISO 날짜 (YYYY-MM-DD) */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 실제로 있는 날짜만 (2026-02-30 같은 값 거부) — 형식은 isoDate 와 같다 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const calendarDate = z.string().refine(isCalendarDate, 'must be a real date in YYYY-MM-DD form');

const slug = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/);

export const EffClassSchema = z.enum([
  'nvidia',
  'amd',
  'intel-arc',
  'apple',
  'apple-ultra',
  'strix',
  'dgx-spark',
  'cpu',
]);

export const QuantIdSchema = z.enum([
  'IQ2_M',
  'Q2_K',
  'IQ3_XS',
  'Q3_K_M',
  'IQ4_XS',
  'Q4_K_M',
  'Q5_K_M',
  'Q6_K',
  'Q8_0',
  'MXFP4',
  'UD-Q2_K_XL',
  'UD-IQ2_M',
  'F16',
]);

/** 맥 제품 계열 (10-16 D97) — 표시 이름은 messages `MacProduct`, 이 순서로 나열한다 */
export const MAC_LINES = ['mac-mini', 'macbook-air', 'macbook-pro', 'imac', 'mac-studio', 'mac-pro'] as const;
export type MacLine = (typeof MAC_LINES)[number];

/**
 * 애플 공식 사양(Tech Specs) 페이지 — support.apple.com 사양 문서, apple.com 의 `/specs/` 페이지, 또는 애플이 구성을 내린 뒤의
 * 확인용으로 그 사양 문서의 web.archive.org 사본(M3 Ultra 512GB — 10-15 D80)
 */
const APPLE_SPEC_URL =
  /^https:\/\/(?:support\.apple\.com\/[a-z]{2}-[a-z]{2}\/\d+|www\.apple\.com\/(?:[a-z-]+\/)*specs\/|web\.archive\.org\/web\/\d+\/https:\/\/support\.apple\.com\/[a-z]{2}-[a-z]{2}\/\d+)$/;

/**
 * Apple 칩이 들어가는 맥 한 모델 (10-16 D97) — 애플 사양 페이지 하나가 모델 하나. 페이지에서 확인한 칩·메모리 짝만 적는다(추측 금지).
 * 허브 제목·H1·설명의 제품 이름과 사양의 "이 칩이 들어간 맥" 줄이 읽는다(서버 전용 — 계산기 lite 카탈로그에는 없다)
 */
export const MacProductSchema = z.object({
  line: z.enum(MAC_LINES),
  /** 사양 페이지 제목의 모델 이름 그대로 ("Mac mini (2024)", "MacBook Air (13-inch, M5)") — 기록용, 화면은 line 만 쓴다 */
  model: z.string().min(1),
  /** 이 칩으로 고를 수 있는 통합 메모리 (GB, 오름차순) */
  memoryGB: z.array(z.number().positive()).min(1),
  /** 애플 사양 페이지 — 레코드 sources 에도 있어야 한다 */
  sources: z.array(z.string().regex(APPLE_SPEC_URL, 'must be an Apple tech specs page')).min(1),
});
export type MacProduct = z.infer<typeof MacProductSchema>;

export const GpuSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    vendor: z.enum(['nvidia', 'amd', 'intel', 'apple', 'amd-apu', 'nvidia-dgx', 'generic']),
    kind: z.enum(['dgpu', 'unified', 'cpu']),
    form: z.enum(['desktop', 'laptop']),
    /** dgpu 전용 (decimal GB) */
    vramGB: z.number().positive().optional(),
    /** unified/cpu: 선택 가능한 RAM 구성 (GB) */
    ramOptionsGB: z.array(z.number().positive()).min(1).optional(),
    memBandwidthGBs: z.number().positive(),
    /**
     * 통합 메모리 칩 중 메모리 구성마다 대역폭이 다른 칩의 구성별 값 (10-20 — Apple M6: 16GB 153GB/s · 24·32GB 170GB/s, 애플 사양 128108).
     * memBandwidthGBs 는 가장 높은 구성 값(사양 표·목록 정렬·비교가 쓴다)이고, 여기 적은 구성만 엔진 입력이 이 값으로 바뀐다(`hardwareConfigs`)
     */
    memBandwidthByRam: z
      .array(z.object({ ramGB: z.number().positive(), memBandwidthGBs: z.number().positive() }))
      .min(1)
      .optional(),
    /** GTX 10 시리즈처럼 FP16 크리플이면 실효값(예: 0.18). Apple 은 위키백과 Apple silicon 표의 FP32 이론값 — 애플 미공개, 애플 GPU 는 FP16 이 FP32 와 같은 속도(10-16 D87) */
    fp16Tflops: z.number().positive().optional(),
    /**
     * 행렬 코어 FP16 처리량(dense) — 제조사가 벡터 FP16 과 따로 밝힐 때만(AMD "Peak Half Precision (FP16 Matrix) Performance").
     * pp 추정이 fp16Tflops 대신 쓴다(10-16 D91 — RDNA4 는 카탈로그 fp16Tflops 의 2배, RDNA3 는 같다). 사양 표시는 fp16Tflops 그대로
     */
    fp16MatrixTflops: z.number().positive().optional(),
    effClass: EffClassSchema,
    /**
     * GPU 코어마다 행렬곱 가속기가 있는 칩(Apple M5 계열의 Neural Accelerator — 애플 뉴스룸) — pp 추정이 클래스 계수 대신
     * 엔진 `PP_COEF_NEURAL_ACCEL` 을 쓴다(10-16 D86). 생성 속도(tg)는 대역폭이 정하므로 영향 없음
     */
    neuralAccelerators: z.boolean().optional(),
    launchYear: z.number().int().min(2015).max(2026),
    msrpUSD: z.number().positive().optional(),
    streetUSD: z.number().positive().optional(),
    streetKRW: z.number().positive().optional(),
    /** 실거래가 기준일 — 실거래가 존재 시 필수 (CLAUDE.md 규칙 2) */
    priceAsOf: isoDate.optional(),
    popular: z.boolean(),
    /** 랩톱 SKU 등 UI 경고 배지용 */
    note: z.string().optional(),
    /**
     * Apple 칩 레코드 필수 — 이 칩이 들어가는 맥 (10-16 D97, 애플 사양 페이지로 확인한 모델만). 메모리는 ramOptionsGB 안의 값만,
     * ramOptionsGB 의 구성마다 그 메모리로 파는 모델이 하나 이상 (아래 refine). 출시 확인 전이라 ramOptionsGB 에서 뺀 구성(M5 Ultra 512GB — D85)은 여기서도 뺀다
     */
    products: z.array(MacProductSchema).min(1).optional(),
    sources,
  })
  .superRefine((gpu, ctx) => {
    if ((gpu.streetUSD !== undefined || gpu.streetKRW !== undefined) && !gpu.priceAsOf) {
      ctx.addIssue({
        code: 'custom',
        message: `${gpu.id}: street price requires priceAsOf (CLAUDE.md rule 2)`,
      });
    }
    if (gpu.kind === 'dgpu' && gpu.vramGB === undefined) {
      ctx.addIssue({ code: 'custom', message: `${gpu.id}: dgpu requires vramGB` });
    }
    if (gpu.kind !== 'dgpu' && gpu.ramOptionsGB === undefined) {
      ctx.addIssue({ code: 'custom', message: `${gpu.id}: unified/cpu requires ramOptionsGB` });
    }
    if (gpu.memBandwidthByRam) {
      if (gpu.kind !== 'unified') {
        ctx.addIssue({ code: 'custom', message: `${gpu.id}: memBandwidthByRam is for unified memory chips only` });
      }
      const seen = new Set<number>();
      for (const { ramGB, memBandwidthGBs } of gpu.memBandwidthByRam) {
        const where = `${gpu.id} memBandwidthByRam ${ramGB} GB`;
        if (!(gpu.ramOptionsGB ?? []).includes(ramGB)) ctx.addIssue({ code: 'custom', message: `${where}: not in ramOptionsGB` });
        if (seen.has(ramGB)) ctx.addIssue({ code: 'custom', message: `${where}: listed twice` });
        seen.add(ramGB);
        // memBandwidthGBs 는 가장 높은 구성 값 — 구성별 값은 그보다 낮아야 한다
        if (memBandwidthGBs >= gpu.memBandwidthGBs) {
          ctx.addIssue({ code: 'custom', message: `${where}: must be below memBandwidthGBs (the highest configuration)` });
        }
      }
    }
    if ((gpu.vendor === 'apple') !== (gpu.products !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `${gpu.id}: products (Macs with the chip, D97) are required for Apple chips and only for them`,
      });
    }
    const ram = gpu.ramOptionsGB ?? [];
    const sold = new Set<number>();
    for (const product of gpu.products ?? []) {
      const where = `${gpu.id} products "${product.model}"`;
      if (product.memoryGB.some((gb, i) => i > 0 && gb <= product.memoryGB[i - 1]!)) {
        ctx.addIssue({ code: 'custom', message: `${where}: memoryGB must be ascending without repeats` });
      }
      for (const gb of product.memoryGB) {
        sold.add(gb);
        if (!ram.includes(gb)) ctx.addIssue({ code: 'custom', message: `${where}: ${gb} GB is not in ramOptionsGB` });
      }
      for (const url of product.sources) {
        if (!gpu.sources.includes(url)) ctx.addIssue({ code: 'custom', message: `${where}: source ${url} missing from sources` });
      }
    }
    if (gpu.products && gpu.products.length !== new Set(gpu.products.map((p) => p.model)).size) {
      ctx.addIssue({ code: 'custom', message: `${gpu.id}: products list a model twice` });
    }
    for (const gb of gpu.products ? ram : []) {
      if (!sold.has(gb)) ctx.addIssue({ code: 'custom', message: `${gpu.id}: no product sells the ${gb} GB configuration` });
    }
  });

export const ModelSchema = z
  .object({
    id: slug,
    family: z.string().min(1),
    name: z.string().min(1),
    hfId: z.string().min(1),
    paramsB: z.number().positive(),
    activeParamsB: z.number().positive().optional(),
    arch: z.object({
      layers: z.number().int().positive(),
      kvHeads: z.number().int().positive(),
      headDim: z.number().int().positive(),
      /**
       * compressed(10-22 D115) = 압축 어텐션(DeepSeek V4 — 층마다 KV 를 4·128 토큰씩 묶어 저장하고 최근 토큰은 슬라이딩 창).
       * 비-full 이라 KV 근거는 attnOverrides 에 남긴다(그 모델은 attnOverrides 필수 — validateAll)
       */
      attnType: z.enum(['full', 'swa', 'mla', 'hybrid', 'compressed']),
      /** 사전 계산 (KiB/tok 아님 — 바이트/tok, f16). SWA/MLA/하이브리드/압축 보정 반영값. */
      kvBytesPerTokenF16: z.number().positive(),
      /**
       * MoE 전용: 레이어당 라우팅 전문가 수 · 토큰당 활성 전문가 수 (공유 전문가 제외).
       * 출처 = 원본 config.json(num_experts·num_local_experts·n_routed_experts / num_experts_per_tok·top_k_experts),
       * GGUF 헤더 `<arch>.expert_count`·`expert_used_count` 와 대조. 둘 다 있거나 둘 다 없거나.
       * 모든 MoE 모델 필수·MOE_ARCH 일치는 validateAll 이 강제.
       */
      experts: z.number().int().positive().optional(),
      topK: z.number().int().positive().optional(),
      /**
       * MoE 전용(10-03 D63): 라우팅 전문가가 있는 층 번호(0부터, 트렁크만, 오름차순) — 일부 층에만 있을 때만 적는다.
       * 출처 = config.json(nemotron_h `layers_block_type` 의 moe 블록 · bailing_hybrid `first_k_dense_replace`).
       * 엔진의 전문가 층 수(moeLayers)가 이 길이가 되고, `--n-cpu-moe` 값은 N 번째 전문가 층까지 덮는 블록 수로 바꾼다(snippet.ts).
       */
      expertLayers: z.array(z.number().int().nonnegative()).min(1).optional(),
      /**
       * 층별 임베딩 표(PLE — config `hidden_size_per_layer_input` > 0, Gemma 4 E2B·E4B — 10-21 D112)가 있는 dense 모델.
       * 헤더 실측 행은 `pleGB` 를 갖는다(validateAll). 속도 모델이 검증되지 않은 구조라 추정은 이론 추정(assess `isTheoretical`)
       */
      ple: z.literal(true).optional(),
      /**
       * MoE 전용(10-21 D113): 값 전문가(MoVA — K2-Horizon) 수 · 토큰당 고르는 수. MoE 층마다 V 투영을 값 전문가로 만든다(KV 캐시는 표준 GQA).
       * 출처 = config.json `mova_num_experts`·`mova_num_experts_per_tok`(GGUF `<arch>.attention.value_expert_count`·`value_expert_used_count`).
       * 값 전문가 텐서(attn_v_exps)는 llama.cpp 가 늘 그래픽카드에 두어 헤더 분할이 비전문가로 세고, 행의 `valueExpertGB` 가 그 크기를 따로 둔다 —
       * 엔진은 그중 valueTopK/valueExperts 몫만 토큰마다 읽는다고 본다(엔진 0.11.0). 공개 실측이 없고 값 전문가 라우팅 고정 시간을 따로 세지 않아
       * 추정은 이론 추정(assess `isTheoretical`). 둘 다 있거나 둘 다 없거나, valueTopK < valueExperts, 행은 모두 헤더 분할·valueExpertGB 필수(validateAll)
       */
      valueExperts: z.number().int().positive().optional(),
      valueTopK: z.number().int().positive().optional(),
      /**
       * dense 전용(10-22 D114): 반복 층(looped transformer) 반복 횟수 ≥ 2 — config.json `num_loops`(Nanbeige4.2), GGUF `<arch>.num_loops` 와 대조.
       * llama.cpp 는 물리 층(`layers`)을 loops 번 이어 붙인 논리 층을 돌며 같은 가중치를 다시 쓴다 — KV 는 논리 층마다라 kvBytesPerTokenF16 은
       * `layers × loops × kvHeads × headDim × 4`(validateAll 의 전체 어텐션 공식도 × loops), 토큰당 읽기는 반복 블록(행 `loopGB`)을 loops 번(엔진 0.12.0).
       * 근거 실측이 1점(카탈로그 밖 기기)이라 추정은 이론 추정(assess `isTheoretical`). 헤더 실측 행은 모두 loopGB(validateAll)
       */
      loops: z.number().int().min(2).optional(),
      /**
       * 하이퍼 커넥션(mHC — config `hc_mult` > 1, DeepSeek V4 — 10-22 D115): 층 사이 잔차 흐름을 hc_mult 갈래로 나눠 층마다 섞는다(sinkhorn 반복).
       * 가중치 크기는 헤더 실측에 이미 들어 있지만 층마다 더하는 연산(mHC 혼합·압축기·인덱서)을 속도식이 따로 세지 않는다 — 지금 빌드 공개 실측 1점이
       * 추정보다 25% 느려(docs/02 §7·§9) 추정은 이론 추정(assess `isTheoretical`). 출처 = config.json `hc_mult`, GGUF `<arch>.hyper_connection.count`
       */
      mhc: z.literal(true).optional(),
    }),
    /**
     * 비-full attention(swa/mla/hybrid) KV 수동 고정 — docs/03 §5.1 "수동 필드 우선".
     * 존재 시 sync-models 는 arch.* 를 자동 갱신하지 않는다. kvBytesPerTokenF16 은
     * arch.kvBytesPerTokenF16 과 일치해야 한다(엔진은 계속 arch 만 읽음 — 미러 강제).
     */
    attnOverrides: z
      .object({
        kvBytesPerTokenF16: z.number().positive(),
        /** 보정 근거 (예: "hybrid 3:1 — full attn 12/48 layers") */
        reason: z.string().min(1),
        sources,
      })
      .optional(),
    maxContext: z.number().int().positive(),
    license: z.string().min(1),
    moe: z.boolean(),
    /**
     * MoE: attention+shared 텐서 GB — packages/data/src/derive.ts 유도값 (consistency 테스트로 고정).
     * bpw 균등 근사라 과소 추정 경향 — 행 단위 헤더 실측 `model-quants.nonExpertGB` 가 있으면 그쪽이 정확.
     * 값 전문가 모델(`arch.valueExperts`, 10-21 D113)은 이 유도값이 값 전문가를 FFN 전문가처럼 나눠 그래픽카드 상주 비전문가를 크게 적게 본다
     * (K2-Horizon MoVA Q4_K_M 유도 0.65 vs 실측 6.0) — 행 실측 없이 쓰지 않는다(그 모델 행은 분할 필수 — validateAll).
     */
    nonExpertGB: z.number().positive().optional(),
    category: z.array(z.enum(['chat', 'coding', 'reasoning', 'vision'])).min(1),
    /**
     * 생각(thinking) 모드 — 판정 임계 ×1.5 대상 (docs/02 §5, PROGRESS §4 D59). 공식 모델 카드·채팅 템플릿 기준:
     * always = 늘 생각한다(R1 계열·gpt-oss) · default-on / default-off = 켜고 끌 수 있고 기본이 켜짐/꺼짐 ·
     * auto = 기본값에서 모델이 스스로 정한다. 없으면 생각 모드 없음. category 의 reasoning 은 용도 필터일 뿐 판정과 무관
     */
    thinking: z.enum(['always', 'default-on', 'default-off', 'auto']).optional(),
    korean: z.boolean().optional(),
    /**
     * 사람이 고르는 인기도 1~5 — 홈 "인기 모델"(4 이상)·계산기 추천순·인기순. 새 모델은 `add-model` 이 HF 30일 다운로드로 처음 정하고
     * (`popularityFrom`) 그 뒤로는 손으로 고친다. 10-16 D94: 2026년 출시 모델 중 다운로드가 5 등급 모델과 같은 수준이고 같은 계열·크기의
     * 5 등급 모델이 있는 것을 5 로 올리고, 홈 목록 개수(23)는 4 등급 중 다운로드가 가장 적은 한국 모델 아닌 모델을 3 으로 내려 유지했다
     */
    popularity: z.number().int().min(1).max(5),
    /**
     * 원본 저장소(`hfId`)의 Hugging Face 최근 30일 다운로드 수 — `https://huggingface.co/api/models/<hfId>` 응답의 `downloads`
     * (게이트 저장소도 메타데이터는 토큰 없이 읽힌다). GGUF 저장소 다운로드는 들어 있지 않다. 출처는 sources 의 HF 모델 URL(아래 refine 이
     * 강제 — 값마다 API URL 을 sources 에 늘리지 않는다). 계산기 "다운로드 많은 순" 정렬·카드 줄(PROGRESS §4 D68).
     * `scripts/sync-models.ts` 가 매주 다시 읽어 갱신하고 `add-model` 이 추가할 때 채운다. 기준일 `hfDownloadsAsOf` 와 둘 다 있거나 둘 다 없거나
     */
    hfDownloads30d: z.number().int().nonnegative().optional(),
    hfDownloadsAsOf: isoDate.optional(),
    releasedAt: isoDate,
    /**
     * CanRun 카탈로그에 들어온 날(UTC 날짜, 10-14 D72) — "업데이트 소식" 페이지가 날짜별로 묶어 보인다(출시일 releasedAt 과 다르다).
     * `add-model`(신모델 자동 추가 ① 포함)이 추가한 날로 채운다. 10-14 이전 44종은 data/models.json 에 그 id 가 처음 들어간 커밋 날짜로 채웠다.
     * 출처는 저장소 이력 자체라 sources 에 따로 적지 않는다. releasedAt 보다 이를 수 없다(아래 refine)
     */
    addedAt: calendarDate,
    /** 추정·재확인 플래그 등 데이터 출처 주의사항 (P0-4 sync 가 해소) */
    note: z.string().optional(),
    sources,
  })
  .superRefine((model, ctx) => {
    if (model.moe && model.activeParamsB === undefined) {
      ctx.addIssue({ code: 'custom', message: `${model.id}: moe model requires activeParamsB` });
    }
    if (model.attnOverrides && model.arch.attnType === 'full') {
      ctx.addIssue({
        code: 'custom',
        message: `${model.id}: attnOverrides is only for non-full attention (docs/03 §5.1)`,
      });
    }
    if ((model.hfDownloads30d === undefined) !== (model.hfDownloadsAsOf === undefined)) {
      ctx.addIssue({ code: 'custom', message: `${model.id}: hfDownloads30d and hfDownloadsAsOf must be set together` });
    }
    if (model.addedAt < model.releasedAt) {
      ctx.addIssue({ code: 'custom', message: `${model.id}: addedAt ${model.addedAt} is before releasedAt ${model.releasedAt}` });
    }
    if (model.hfDownloads30d !== undefined && !model.sources.includes(`https://huggingface.co/${model.hfId}`)) {
      ctx.addIssue({
        code: 'custom',
        message: `${model.id}: hfDownloads30d requires the Hugging Face model URL https://huggingface.co/${model.hfId} in sources (CLAUDE.md rule 2)`,
      });
    }
    if ((model.arch.experts === undefined) !== (model.arch.topK === undefined)) {
      ctx.addIssue({ code: 'custom', message: `${model.id}: arch.experts and arch.topK must be set together` });
    }
    if (
      model.arch.experts !== undefined &&
      model.arch.topK !== undefined &&
      model.arch.topK >= model.arch.experts
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${model.id}: arch.topK ${model.arch.topK} must be < arch.experts ${model.arch.experts}`,
      });
    }
    const expertLayers = model.arch.expertLayers;
    if (
      expertLayers !== undefined &&
      (model.arch.experts === undefined ||
        expertLayers.length >= model.arch.layers ||
        expertLayers.some((l, i) => l >= model.arch.layers || (i > 0 && l <= expertLayers[i - 1]!)))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${model.id}: arch.expertLayers must be ascending layer indices < arch.layers, fewer than arch.layers, MoE only`,
      });
    }
    if (
      model.attnOverrides &&
      model.attnOverrides.kvBytesPerTokenF16 !== model.arch.kvBytesPerTokenF16
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${model.id}: attnOverrides.kvBytesPerTokenF16 ${model.attnOverrides.kvBytesPerTokenF16} != arch.kvBytesPerTokenF16 ${model.arch.kvBytesPerTokenF16}`,
      });
    }
  });

export const ModelQuantSchema = z
  .object({
    modelId: slug,
    quant: QuantIdSchema,
    /** 실제 GGUF 파일 크기 (decimal GB, 분할 파일 합산) */
    fileGB: z.number().positive(),
    /**
     * MoE 전용 — GGUF 헤더 실측 텐서 분할 (scripts/gguf-header.ts, 10-01). decimal GB(1e9) 2자리.
     * expertGB: 라우팅 전문가 텐서(`_exps`·`_chexps`) — 트렁크 블록만(MTP/NextN 블록 제외).
     * nonExpertGB: GPU 상주 비전문가 — 어텐션·노름·공유 전문가·라우터·dense FFN·output.
     *   token_embd 는 llama.cpp 가 항상 CPU 에 두므로 제외, 단 output.weight 가 없는(임베딩 공유) 모델은
     *   GPU 출력층 복제분으로 1회 포함. 기본 미적재 MTP 블록 제외.
     * 둘 다 있거나 둘 다 없거나(아래 refine). MoE 모델 행만·0.75×fileGB ≤ 합 ≤ fileGB+0.02 는 validateAll.
     * 없는 행은 모델 단위 nonExpertGB(derive.ts 유도)가 근사값. 합 = dGPU 에 전량 올릴 때 그래픽카드에 상주하는 가중치(10-03 D62).
     */
    expertGB: z.number().positive().optional(),
    nonExpertGB: z.number().positive().optional(),
    /**
     * MoE 전용 — 값 전문가(MoVA — K2-Horizon `attn_v_exps`, 10-21 D113) GB (GGUF 헤더 실측, `classifySplit` 의 valueExpertGB).
     * nonExpertGB 안에 들어 있다 — llama.cpp `--n-cpu-moe`·`--fit` 은 FFN 전문가만 옮겨 값 전문가는 늘 그래픽카드(배치·VRAM 은 비전문가 그대로).
     * 엔진은 토큰마다 고른 몫(valueTopK/valueExperts)만 읽는다고 보고 나머지를 읽기 바이트에서 뺀다(docs/02 §3.1).
     * 같은 헤더 측정의 expertGB·nonExpertGB 와 함께 · ≤ nonExpertGB(아래 refine). 모델 `arch.valueExperts` 인 모델의 행만이고,
     * 그 모델의 행은 모두 분할과 이 값을 가져야 한다(validateAll — 없으면 모델 수준 유도 nonExpertGB 가 값 전문가를 빼고 VRAM 을 적게 센다)
     */
    valueExpertGB: z.number().positive().optional(),
    /**
     * dense 전용 — 파일 중 llama.cpp 가 그래픽카드에 올리지 않는 GB (GGUF 헤더 실측, scripts/gguf-header.ts, 10-03 D62).
     * 입력 임베딩(token_embd — 입력층은 항상 CPU, 임베딩 공유 모델은 출력층 사본이 GPU 에 가서 ≈0)·기본 미적재 MTP/NextN
     * 블록·헤더 메타데이터. dGPU full-gpu 필요량은 fileGB − 이 값(docs/02 §2.4-1). MoE 행은 fileGB − expertGB − nonExpertGB 로
     * 같은 값을 유도하므로 두지 않는다. 없으면 파일 전체(보수). dense 만·0 ≤ 값 ≤ 0.25×fileGB 는 validateAll
     * (층별 임베딩 표가 있는 행은 값 − pleGB 에 상한 — 10-21 D112).
     */
    offGpuGB: z.number().nonnegative().optional(),
    /**
     * dense 전용 — 층별 임베딩 표 `per_layer_token_embd`(PLE, Gemma 4 E2B·E4B — 10-21 D112) GB (GGUF 헤더 실측). 입력층이라
     * llama.cpp 가 늘 시스템 RAM 에 두므로 offGpuGB 안에 들어 있고(아래 refine: offGpuGB 와 함께 · ≤ offGpuGB), 토큰마다 한 줄만
     * 읽어(get_rows) 엔진 속도식이 읽기 바이트에서 뺀다(docs/02 §3.1). GPU 밖 몫 25% 상한은 offGpuGB − 이 값에 건다(validateAll).
     * 모델 `arch.ple` 인 모델의 행만.
     */
    pleGB: z.number().positive().optional(),
    /**
     * MTP/NextN 블록 GB (헤더 실측, 0 보다 클 때만) — llama.cpp 는 `--spec-type draft-mtp` 로 켤 때만 불러온다. 필요량에서는
     * 이미 빠져 있고(offGpuGB·MoE 분할), 화면은 "켜면 이만큼 + 그 KV 가 더 든다"고 안내한다. 측정 행(offGpuGB 또는 분할)에만.
     */
    mtpGB: z.number().positive().optional(),
    /**
     * dense 반복 층 모델 전용(10-22 D114) — 반복 블록 GB: 트렁크 `blk.N.*` 텐서 합(GGUF 헤더 실측, `classifySplit` 의 blockGB — MTP 블록·입력층·출력층 제외).
     * 엔진은 토큰마다 이 블록을 `arch.loops` 번 읽는다고 본다(docs/02 §3.1). 같은 헤더 측정의 offGpuGB 와 함께 · ≤ fileGB − offGpuGB(아래 refine — 블록은
     * 그래픽카드 상주 몫 안). 모델 `arch.loops` 인 모델의 행만이고, 그 모델의 헤더 실측 행은 모두 이 값을 갖는다(validateAll)
     */
    loopGB: z.number().positive().optional(),
    ggufRepo: z.string().min(1),
    /**
     * repo 내 실파일 경로 — 스니펫 태그·다운로드 안내의 정본 (P1-2, docs/03 §1·§5.1 ④).
     * 분할이면 첫 조각(`…-00001-of-0000N.gguf`), UD 변형은 파일명에 `UD-` 가 남는다.
     * zod 는 optional(sync 가 구 시드를 읽어 채워야 하므로) — 전 행 존재는 validateAll 이 강제.
     */
    fileName: z
      .string()
      .regex(/^[^\s/][^\s]*\.gguf$/i, 'fileName must be a repo-relative *.gguf path')
      .optional(),
    sources,
  })
  .superRefine((mq, ctx) => {
    if ((mq.expertGB === undefined) !== (mq.nonExpertGB === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: `${mq.modelId}/${mq.quant}: expertGB and nonExpertGB must be set together`,
      });
    }
    if (mq.pleGB !== undefined && (mq.offGpuGB === undefined || mq.pleGB > mq.offGpuGB)) {
      ctx.addIssue({
        code: 'custom',
        message: `${mq.modelId}/${mq.quant}: pleGB needs offGpuGB from the same header measurement and must not exceed it`,
      });
    }
    if (mq.loopGB !== undefined && (mq.offGpuGB === undefined || mq.loopGB > mq.fileGB - mq.offGpuGB + 0.02)) {
      ctx.addIssue({
        code: 'custom',
        message: `${mq.modelId}/${mq.quant}: loopGB needs offGpuGB from the same header measurement and must fit in fileGB − offGpuGB`,
      });
    }
    if (
      mq.valueExpertGB !== undefined &&
      (mq.expertGB === undefined || mq.nonExpertGB === undefined || mq.valueExpertGB > mq.nonExpertGB)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `${mq.modelId}/${mq.quant}: valueExpertGB needs expertGB/nonExpertGB from the same header measurement and must not exceed nonExpertGB`,
      });
    }
  });

/**
 * 인덱싱 배치 계획 — `data/publish.json` (docs/04 §3, P1-2 결정 D9).
 * 콤보(gpu × model)의 배치 = 그 쌍을 포함하는 항목들의 최소 batch, batch ≤ currentBatch 만 index.
 * 사실 레코드가 아니라 운영 결정이므로 sources 대신 plannedAt·note 로 근거를 남긴다.
 */
/**
 * data/meta.json — 데이터 기준일 (P1-5). 푸터 "데이터 기준일"·사이트맵 lastmod 의 출처 — 빌드 시각이 아니라 데이터에서 온다(D21 결정론).
 * `scripts/sync-models.ts` 가 데이터를 실제로 바꿀 때 갱신하고, 수동 데이터 커밋은 함께 갱신한다(PROGRESS §3).
 */
export const MetaSchema = z.object({ dataUpdated: isoDate }).strict();

/**
 * 원화 환산용 환율 — `data/fx.json` (10-01, PROGRESS §4 D61). 한국어 페이지의 가격은 미국 실거래가 × 이 값의 참고가다
 * (국내 판매가 아님 — 화면에 그렇게 적는다). 출처 = ECB 기준환율(EUR→KRW ÷ EUR→USD), 주간 data-sync 가 갱신.
 */
export const FxSchema = z
  .object({
    usdKrw: z.number().positive(),
    asOf: isoDate,
    sources: z.array(z.string().url()).min(1),
  })
  .strict();

export type FxRate = z.infer<typeof FxSchema>;

export type DataMeta = z.infer<typeof MetaSchema>;

export const PublishSchema = z
  .object({
    currentBatch: z.number().int().min(0),
    batches: z.array(
      z.object({
        batch: z.number().int().min(1),
        gpuIds: z.array(slug).min(1),
        modelIds: z.array(slug).min(1),
        plannedAt: isoDate.optional(),
        note: z.string().optional(),
      }),
    ),
  })
  .superRefine((plan, ctx) => {
    const maxBatch = plan.batches.reduce((max, b) => Math.max(max, b.batch), 0);
    if (plan.currentBatch > maxBatch) {
      ctx.addIssue({
        code: 'custom',
        message: `currentBatch ${plan.currentBatch} exceeds the largest defined batch ${maxBatch}`,
      });
    }
    plan.batches.forEach((entry, i) => {
      for (const key of ['gpuIds', 'modelIds'] as const) {
        const seen = new Set<string>();
        for (const id of entry[key]) {
          if (seen.has(id)) {
            ctx.addIssue({ code: 'custom', message: `batches[${i}].${key}: duplicate id '${id}'` });
          }
          seen.add(id);
        }
      }
    });
  });

export const QuantDefSchema = z.object({
  id: QuantIdSchema,
  /** bits-per-weight — engine QUANT_BPW 와 동일해야 함 (consistency 테스트로 강제) */
  bpw: z.number().positive(),
  tier: z.enum(['safe', 'ok', 'degraded', 'desperate']),
  note: z.string().min(1),
});

export const BenchPointSchema = z
  .object({
    id: slug,
    /** gpus.json FK — 카탈로그 외 하드웨어면 hardwareDesc 사용 */
    gpuId: slug.optional(),
    hardwareDesc: z.string().min(1).optional(),
    /** models.json FK 우선 — 캘리브레이션 전용 id(llama-2-7b 등) 허용 */
    modelId: z.string().min(1),
    /** 실측 표기 보존 (Q4_0, Q4_K_XL, MXFP4 …) */
    quant: z.string().min(1),
    backend: z.enum(['llama.cpp', 'ollama', 'lm-studio', 'mlx', 'llamafile']),
    backendVersion: z.string().optional(),
    /** 측정 컨텍스트 (tg128 단문은 512 표기, 가중 평균은 'weighted' 플래그와 함께) */
    ctx: z.number().int().positive(),
    ppTokS: z.number().positive().optional(),
    tgTokS: z.number().positive(),
    flags: z.string().optional(),
    /** 내부 기록 — 어느 빌드·조건·날짜의 값인지, 출처가 바뀐 이력 (화면에 안 나온다, 10-15 D79) */
    note: z.string().min(1).optional(),
    sourceUrl: z.string().url(),
    sourceType: z.enum(['official-thread', 'localscore', 'community', 'own']),
    verified: z.boolean(),
    measuredAt: isoDate,
  })
  .superRefine((bp, ctx) => {
    if (!bp.gpuId && !bp.hardwareDesc) {
      ctx.addIssue({ code: 'custom', message: `${bp.id}: needs gpuId or hardwareDesc` });
    }
  });

// _redirects 는 공백 구분 포맷 — 공백·?·#·제어문자 인젝션 방어 (scripts/build-redirects.ts 와 동일 규칙)
const redirectPath = z
  .string()
  .regex(/^\/[^\s?#]*$/)
  .refine((path) => {
    // C0 제어문자·DEL 거부 — scripts/build-redirects.ts 의 hasControlChars 와 동일 규칙
    for (let i = 0; i < path.length; i += 1) {
      const code = path.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
  }, 'control characters are not allowed');

export const AliasSchema = z.object({
  /** 요청이 들어오는 alias 경로 */
  from: redirectPath,
  /** canonical 경로 (301 대상) */
  to: redirectPath,
});

/**
 * 신모델 자동 추가의 스킵 목록 — `scripts/new-model-skips.json` (10-06 D71, docs/03 §5.3).
 * 사이트에 나가는 데이터가 아니라 운영 메모라 data/*.json·schemaRegistry 밖에 둔다(sources[] 규칙 대상 아님).
 * skip = 넣지 않음, wait = 엔진 확장·llama.cpp 본선 지원을 기다림 — 둘 다 자동 추가 후보에서 뺀다.
 */
export const NewModelSkipSchema = z
  .object({
    hfId: z.string().regex(/^[^\s/]+\/[^\s/]+$/),
    decision: z.enum(['skip', 'wait']),
    reason: z.string().min(1),
    decidedAt: isoDate,
  })
  .strict();

export type NewModelSkip = z.infer<typeof NewModelSkipSchema>;
export type Gpu = z.infer<typeof GpuSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ModelQuantRecord = z.infer<typeof ModelQuantSchema>;
export type QuantDef = z.infer<typeof QuantDefSchema>;
export type BenchPoint = z.infer<typeof BenchPointSchema>;
export type AliasRecord = z.infer<typeof AliasSchema>;
export type PublishPlan = z.infer<typeof PublishSchema>;
