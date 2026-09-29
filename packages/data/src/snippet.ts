/**
 * 실행 커맨드 스니펫 (docs/04 §4 ⑦, docs/01 F3·§9) — 콤보 페이지의 llama.cpp / Ollama 명령.
 *
 * 플래그는 조합에 의존한다: `-ngl`(부분 오프로드 층 수), `--n-cpu-moe N`(MoE 전문가를 CPU 에 둘 층 수),
 * `-c`(컨텍스트), `--cache-type-k/v`(KV quant). 검증된 사실(P1-2 계획):
 *  - llama-server `-hf <user>/<repo>[:quant]` — quant 는 대소문자 무시, 기본 Q4_K_M, 파일명으로 매칭
 *  - `-ngl` 은 정수·'auto'·'all', `--n-cpu-moe N` = "첫 N 층의 MoE 가중치를 CPU 에", `-fa on|off|auto`
 *  - Ollama `ollama run hf.co/<user>/<repo>:<tag>` — 태그는 파일명 기준, 분할 GGUF 는 미지원(매니페스트 400),
 *    컨텍스트 기본값은 VRAM 티어(24GiB 미만 4k) → `OLLAMA_CONTEXT_LENGTH` 서버 env 또는 `/set parameter num_ctx`,
 *    전문가 CPU 오프로드 플래그 없음
 *  - Ollama KV 캐시 양자화 = 서버 env `OLLAMA_KV_CACHE_TYPE`(f16|q8_0|q4_0, 전역), 플래시 어텐션 필요 —
 *    `OLLAMA_FLASH_ATTENTION=1` 로 강제 (https://docs.ollama.com/faq "How can I set the quantization type for the K/V cache?",
 *    "How can I enable Flash Attention?"). f16(기본)이면 env 를 붙이지 않는다
 * 순수 함수 — 문자열은 사용자 노출 문구가 아니라 명령이므로 여기서 조립한다(i18n 대상 아님).
 */

import {
  computeBufferGB,
  kvGB,
  NATIVE_QUANTS,
  usableGB,
  weightsGB,
  type KvQuant,
  type Mode,
  type Os,
} from '@canrun/engine';
import { toModelQuant, type HwConfig, type QuantAssessment } from './assess';
import type { GpuCore, ModelCore, ModelQuantCore } from './core';

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** `…-00001-of-0000M.gguf` → M, 아니면 1 */
export function shardCount(fileName: string | undefined): number {
  const m = fileName ? SHARD_RE.exec(fileName) : null;
  return m ? Number(m[2]) : 1;
}

/** 파일명에 unsloth Dynamic(`UD-`) 접두가 있는가 */
export function isUdFile(fileName: string | undefined): boolean {
  return fileName !== undefined && /(^|[-_./])UD-/i.test(fileName.split('/').at(-1) ?? fileName);
}

/**
 * HF 다운로드 태그 — 파일명에 실제로 적힌 quant 토큰(`UD-Q4_K_M`·`MXFP4`·`Q4_K_M`).
 * 파일명이 없거나 토큰을 못 찾으면 quant id 그대로 (llama.cpp·Ollama 모두 대소문자 무시).
 */
export function ggufTag(fileName: string | undefined, quant: string): string {
  if (!fileName) return quant;
  const base = fileName.split('/').at(-1) ?? fileName;
  const esc = quant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[-_./])((?:UD-)?${esc})(?=[-./]|$)`, 'i').exec(base);
  return m?.[1] ?? quant;
}

export type CommandFile = {
  repo: string;
  name?: string;
  tag: string;
  shards: number;
  ud: boolean;
  fileGB: number;
};

export type LlamaCppPlan = {
  command: string;
  ngl: 'all' | number;
  /** cpu-moe: 전문가를 CPU 에 둘 층 수 (= 전체 층 — 엔진 §3.3 가정) */
  nCpuMoe?: number;
  /** cpu-moe: VRAM 에 들어가는 최소 N (D23: 네이티브 quant 는 +1 층 여유) */
  nCpuMoeMin?: number;
};

export type OllamaPlan = {
  run: string;
  /** 서버 env 로 컨텍스트 지정 (OS 별 셸 문법) */
  serve: string;
  /** REPL 안에서 세션 단위 지정 */
  replSet: string;
  contextLength: number;
  /** 부분 오프로드: Ollama 가 자동으로 층을 나눈다 */
  autoOffload: boolean;
};

export type OllamaOmitted = 'no-fit' | 'cpu-moe' | 'sharded';

export type CommandPlan = {
  os: Os;
  mode: Mode;
  fits: boolean;
  ctx: number;
  kvQuant: KvQuant;
  layers: number;
  file: CommandFile;
  llamaCpp?: LlamaCppPlan;
  ollama?: OllamaPlan;
  ollamaOmitted?: OllamaOmitted;
};

/** 엔진 §3.3 cpu-moe 가정(전문가 전량 CPU)에 대한 최소 N — VRAM 여유만큼 층을 GPU 로 되돌린다. */
export function nCpuMoeMin(
  config: HwConfig,
  model: ModelCore,
  row: Pick<ModelQuantCore, 'quant' | 'fileGB' | 'fileName'>,
  opts: { ctx: number; kvQuant: KvQuant },
): number | undefined {
  if (model.nonExpertGB === undefined) return undefined;
  const layers = model.arch.layers;
  const mq = toModelQuant(model, row);
  const expertPerLayer = (weightsGB(mq) - model.nonExpertGB) / layers;
  if (expertPerLayer <= 0) return undefined;
  const avail =
    usableGB(config.hw) -
    model.nonExpertGB -
    kvGB(mq.kvBytesPerToken, opts.ctx, opts.kvQuant) -
    computeBufferGB(opts.ctx);
  const base = Math.max(1, layers - Math.floor(avail / expertPerLayer));
  // D23: 네이티브 quant(MXFP4) 는 비전문가 텐서가 Q8_0 이고, Unsloth Dynamic(UD) 파일도 어텐션·공유 텐서를
  // 평균 bpw 보다 높게 두므로 균등 bpw 유도 nonExpertGB 가 과소 → 1층 여유
  const margin = NATIVE_QUANTS.includes(row.quant) || isUdFile(row.fileName) ? 1 : 0;
  return Math.min(layers, base + margin);
}

/** Ollama 서버 기동 명령 — 컨텍스트 + (KV 양자화면) 플래시 어텐션·KV 타입 env. f16 출력은 P1-2 와 바이트 동일 */
function serveCommand(os: Os, ctx: number, kvQuant: KvQuant): string {
  const env: [string, string][] = [['OLLAMA_CONTEXT_LENGTH', String(ctx)]];
  if (kvQuant !== 'f16') env.push(['OLLAMA_FLASH_ATTENTION', '1'], ['OLLAMA_KV_CACHE_TYPE', kvQuant]);
  return os === 'windows'
    ? `${env.map(([k, v]) => `$env:${k}="${v}"`).join('; ')}; ollama serve`
    : `${env.map(([k, v]) => `${k}=${v}`).join(' ')} ollama serve`;
}

/**
 * 조합(구성, 모델, quant 평가)의 실행 계획. `q` 는 보통 display quant; F 페이지는 RAM 힌트의 `q`.
 */
export function commandPlan(
  gpu: Pick<GpuCore, 'kind'>,
  config: HwConfig,
  model: ModelCore,
  row: ModelQuantCore,
  q: Pick<QuantAssessment, 'fits' | 'result' | 'gpuFrac'>,
  opts: { ctx?: number; kvQuant?: KvQuant } = {},
): CommandPlan {
  const ctx = opts.ctx ?? 8192;
  const kvQuant = opts.kvQuant ?? 'f16';
  const layers = model.arch.layers;
  const shards = shardCount(row.fileName);
  const file: CommandFile = {
    repo: row.ggufRepo,
    ...(row.fileName !== undefined ? { name: row.fileName } : {}),
    tag: ggufTag(row.fileName, row.quant),
    shards,
    ud: isUdFile(row.fileName),
    fileGB: row.fileGB,
  };
  const mode = q.result.mode;
  const base: CommandPlan = {
    os: config.hw.os,
    mode,
    fits: q.fits,
    ctx,
    kvQuant,
    layers,
    file,
  };
  if (!q.fits) return { ...base, ollamaOmitted: 'no-fit' };

  let ngl: 'all' | number;
  let nCpuMoe: number | undefined;
  let nMin: number | undefined;
  switch (mode) {
    case 'full-gpu':
      ngl = 'all';
      break;
    case 'cpu-moe':
      ngl = 'all';
      nCpuMoe = layers;
      nMin = nCpuMoeMin(config, model, row, { ctx, kvQuant });
      break;
    case 'partial-offload': {
      // llama.cpp 는 출력층부터 올리고 입력층은 항상 CPU — floor 가 엔진 예산 안에 든다 (P1-2 검증)
      const onGpu = Math.floor((q.gpuFrac ?? 0) * layers);
      ngl = onGpu < 1 ? 0 : onGpu;
      break;
    }
    case 'cpu-only':
      ngl = gpu.kind === 'cpu' ? 0 : 0;
      break;
  }

  const flags = [
    `-hf ${file.repo}:${file.tag}`,
    `-c ${ctx}`,
    `-ngl ${ngl}`,
    ...(nCpuMoe !== undefined ? [`--n-cpu-moe ${nCpuMoe}`] : []),
    '-fa on',
    ...(kvQuant !== 'f16' ? [`--cache-type-k ${kvQuant}`, `--cache-type-v ${kvQuant}`] : []),
  ];
  const llamaCpp: LlamaCppPlan = {
    command: `llama-server ${flags.join(' ')}`,
    ngl,
    ...(nCpuMoe !== undefined ? { nCpuMoe } : {}),
    ...(nMin !== undefined ? { nCpuMoeMin: nMin } : {}),
  };

  let ollamaOmitted: OllamaOmitted | undefined;
  if (mode === 'cpu-moe') ollamaOmitted = 'cpu-moe';
  else if (shards > 1) ollamaOmitted = 'sharded';
  const ollama: OllamaPlan | undefined = ollamaOmitted
    ? undefined
    : {
        run: `ollama run hf.co/${file.repo}:${file.tag}`,
        serve: serveCommand(config.hw.os, ctx, kvQuant),
        replSet: `/set parameter num_ctx ${ctx}`,
        contextLength: ctx,
        autoOffload: mode === 'partial-offload',
      };

  return {
    ...base,
    llamaCpp,
    ...(ollama ? { ollama } : {}),
    ...(ollamaOmitted ? { ollamaOmitted } : {}),
  };
}
