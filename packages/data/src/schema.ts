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
    /** MoE: attention+shared 텐서 GB — packages/data/src/derive.ts 유도값 (consistency 테스트로 고정) */
    nonExpertGB: z.number().positive().optional(),
    category: z.array(z.enum(['chat', 'coding', 'reasoning', 'vision'])).min(1),
    korean: z.boolean().optional(),
    popularity: z.number().int().min(1).max(5),
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

export const ModelQuantSchema = z.object({
  modelId: slug,
  quant: QuantIdSchema,
  /** 실제 GGUF 파일 크기 (decimal GB, 분할 파일 합산) */
  fileGB: z.number().positive(),
  ggufRepo: z.string().min(1),
  sources,
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
