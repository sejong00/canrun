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
    /** GTX 10 시리즈처럼 FP16 크리플이면 실효값(예: 0.18) */
    fp16Tflops: z.number().positive().optional(),
    effClass: EffClassSchema,
    launchYear: z.number().int().min(2015).max(2026),
    msrpUSD: z.number().positive().optional(),
    streetUSD: z.number().positive().optional(),
    streetKRW: z.number().positive().optional(),
    /** 실거래가 기준일 — 실거래가 존재 시 필수 (CLAUDE.md 규칙 2) */
    priceAsOf: isoDate.optional(),
    popular: z.boolean(),
    /** 랩톱 SKU 등 UI 경고 배지용 */
    note: z.string().optional(),
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
      attnType: z.enum(['full', 'swa', 'mla', 'hybrid']),
      /** 사전 계산 (KiB/tok 아님 — 바이트/tok, f16). SWA/MLA/하이브리드 보정 반영값. */
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
     * dense 전용 — 파일 중 llama.cpp 가 그래픽카드에 올리지 않는 GB (GGUF 헤더 실측, scripts/gguf-header.ts, 10-03 D62).
     * 입력 임베딩(token_embd — 입력층은 항상 CPU, 임베딩 공유 모델은 출력층 사본이 GPU 에 가서 ≈0)·기본 미적재 MTP/NextN
     * 블록·헤더 메타데이터. dGPU full-gpu 필요량은 fileGB − 이 값(docs/02 §2.4-1). MoE 행은 fileGB − expertGB − nonExpertGB 로
     * 같은 값을 유도하므로 두지 않는다. 없으면 파일 전체(보수). dense 만·0 ≤ 값 ≤ 0.25×fileGB 는 validateAll.
     */
    offGpuGB: z.number().nonnegative().optional(),
    /**
     * MTP/NextN 블록 GB (헤더 실측, 0 보다 클 때만) — llama.cpp 는 `--spec-type draft-mtp` 로 켤 때만 불러온다. 필요량에서는
     * 이미 빠져 있고(offGpuGB·MoE 분할), 화면은 "켜면 이만큼 + 그 KV 가 더 든다"고 안내한다. 측정 행(offGpuGB 또는 분할)에만.
     */
    mtpGB: z.number().positive().optional(),
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

export type Gpu = z.infer<typeof GpuSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ModelQuantRecord = z.infer<typeof ModelQuantSchema>;
export type QuantDef = z.infer<typeof QuantDefSchema>;
export type BenchPoint = z.infer<typeof BenchPointSchema>;
export type AliasRecord = z.infer<typeof AliasSchema>;
export type PublishPlan = z.infer<typeof PublishSchema>;
