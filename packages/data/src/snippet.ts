/**
 * 실행 커맨드 스니펫 (docs/04 §4 ⑦, docs/01 F3·§9) — 콤보 페이지의 llama.cpp / Ollama 명령.
 *
 * 플래그는 조합에 의존한다: `-ngl`(부분 오프로드 층 수), `--n-cpu-moe N`(MoE 전문가를 CPU 에 둘 층 수),
 * `-c`(컨텍스트), `--cache-type-k/v`(KV quant). 검증된 사실(P1-2 계획):
 *  - llama-server `-hf <user>/<repo>[:quant]` — quant 는 대소문자 무시, 기본 Q4_K_M, 파일명으로 매칭
 *  - `-ngl` 은 정수·'auto'·'all', `--n-cpu-moe N` = "첫 N 층의 MoE 가중치를 CPU 에", `-fa on|off|auto`
 *  - Ollama `ollama run hf.co/<user>/<repo>:<tag>` — 태그는 파일명 기준, 분할 GGUF 는 미지원(매니페스트 400),
 *    컨텍스트 기본값은 VRAM 티어(24GiB 미만 4k) → `OLLAMA_CONTEXT_LENGTH` 서버 env 또는 `/set parameter num_ctx`.
 *    0.30(2026-06) 이후는 llama-server 를 `-ngl` 없이 띄워 llama.cpp `--fit` 이 MoE 전문가 일부를 RAM 에 자동 배치
 *    (ollama/ollama llm/llama_server.go "NumGPU == -1 (default): don't pass -ngl") — 층 수 지정 옵션은 없다
 *  - llama.cpp b7410(2025-12-15, PR #16653) 이후 `--fit on` 기본: `-ngl`·`--n-cpu-moe` 를 생략하면 같은 방향으로
 *    자동 배치(뒤쪽 층 전문가를 CPU 로). 명시하면 fit 의 가중치 배치는 꺼진다 — 우리 명령은 추정과 같은 N 을 명시한다.
 *    예외: GPU 가 여러 장이면(같은 카드 D58·서로 다른 카드 D67) cpu-moe 명령에서 두 옵션을 뺀다(10-03 D67). 층은 카드마다 남은
 *    메모리 비율로 나뉘는데 `--n-cpu-moe N` 은 앞쪽 N 층만 CPU 로 보내 GPU 전문가가 뒤쪽 층을 맡은 마지막 카드에 몰린다 — 엔진은
 *    합산 용량만 보므로 그 카드가 메모리 부족이 될 수 있다. `--fit` 은 장치마다 여유(기본 1024MiB)를 두고 카드를 차례로 채운다
 *    (https://github.com/ggml-org/llama.cpp/blob/2145525a4081d66ff1a87cf43ef809f95a85ac0c/common/fit.cpp#L660-L750, 사용자가
 *    -ngl·텐서 배치를 주면 fit 이 멈춘다 #L463-L485)
 *  - 반복 층 모델(10-22 D114 — Nanbeige4.2 `arch.loops`)의 `-ngl` 은 논리 층(물리 층 × loops) + 출력층을 센다 — llama.cpp 는
 *    `i_gpu_start = n_layer_all + 1 − ngl` 부터 GPU 에 두고(https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/src/llama-model.cpp#L1670-L1695),
 *    물리 층 가중치는 텐서의 블록 번호(0 ~ 층 − 1 — 첫 반복)로 장치를 고른다(`dev_layer.at(tn.bid)`, 같은 커밋 src/llama-model.cpp#L2378-L2386 — nanbeige 는
 *    blk.0 ~ 층 − 1 만 만들고 논리 층이 가리키게 한다, src/models/nanbeige.cpp#L48-L73). 그래서 물리 k 층의 가중치를 GPU 에 두려면
 *    `-ngl = 층 × (loops − 1) + 1 + k` 다(그보다 작으면 KV 일부·출력층만 GPU 에 가고 가중치는 하나도 가지 않는다). 그 논리 층들의 KV 도 GPU 에 간다
 *    (KV 는 논리 층마다 그 층의 장치 — src/llama-kv-cache.cpp#L216-L219): 엔진은 부분 오프로드 배치에서 KV 전체를 GPU 에 두고 세므로 필요량은 그보다 작고(보수),
 *    속도식은 KV 읽기의 GPU 몫을 이 배치대로 본다(engine `partialKvGpuShare`, 10-22 D114 리뷰).
 *    GPU 가 여러 장이면 반복 모델은 `-ngl` 을 빼고 `--fit` 에 맡긴다(10-22 D114 리뷰): 층 분할은 논리 층을 카드마다 나누는데 물리 가중치는 첫 반복 층을
 *    맡은 앞쪽 카드에 몰린다 — 2장이면 블록 전부가 1번 카드(논리 0~22층)에. 엔진은 합산 용량만 봐서 긴 컨텍스트(64k 이상)에서 그 카드가 넘칠 수 있고,
 *    `--fit` 은 후보 배치마다 장치별 할당량을 실제로 재서 나눈다(같은 커밋 common/fit.cpp#L588-L600 — `-c` 를 주면 컨텍스트는 줄이지 않는다)
 *  - Ollama KV 캐시 양자화 = 서버 env `OLLAMA_KV_CACHE_TYPE`(f16|q8_0|q4_0, 전역), 플래시 어텐션 필요 —
 *    `OLLAMA_FLASH_ATTENTION=1` 로 강제 (https://docs.ollama.com/faq "How can I set the quantization type for the K/V cache?",
 *    "How can I enable Flash Attention?"). f16(기본)이면 env 를 붙이지 않는다
 * 순수 함수 — 문자열은 사용자 노출 문구가 아니라 명령이므로 여기서 조립한다(i18n 대상 아님).
 */

import {
  gpuCountOf,
  type KvQuant,
  type Mode,
  type Os,
} from '@canrun/engine';
import type { HwConfig, QuantAssessment } from './assess';
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

/**
 * 엔진 cpu-moe 배치(`result.cpuMoeLayers` — 전문가 층 단위) → llama.cpp `--n-cpu-moe` 값("앞 N 블록의 MoE 가중치를 CPU 에").
 * 전문가가 일부 블록에만 있으면(arch.expertLayers — Mamba 블록 사이에 섞인 MoE 블록·앞쪽 dense 층, 10-03 D63) N 번째 전문가 층까지
 * 덮는 블록 수로 바꾼다 — 그래야 GPU 에 남는 전문가가 추정 배치와 정확히 같다(균등 분포 근사는 Nemotron 에서 GPU 쪽이 최대 1GB 더 많았다).
 * 값이 없으면(전문가 전부 RAM) 전체 층 수.
 */
export function cpuMoeFlagLayers(model: Pick<ModelCore, 'arch'>, cpuMoeLayers: number | undefined): number {
  const { layers, expertLayers } = model.arch;
  if (cpuMoeLayers === undefined) return layers;
  if (!expertLayers || cpuMoeLayers <= 0) return cpuMoeLayers;
  return expertLayers[Math.min(cpuMoeLayers, expertLayers.length) - 1]! + 1;
}

/** `--n-cpu-moe N` 이 GPU 에 남기는 전문가 층의 블록 번호 — 지도(arch.expertLayers)가 없으면 모든 블록에 전문가가 있다고 본다 */
function gpuExpertBlocks(model: Pick<ModelCore, 'arch'>, nCpuMoe: number): number[] {
  const { layers, expertLayers } = model.arch;
  const blocks = expertLayers ?? Array.from({ length: layers }, (_, i) => i);
  return blocks.filter((l) => l >= nCpuMoe);
}

/**
 * `--n-cpu-moe N` 일 때 GPU 에 남는 전문가 층 수 — 판정 문장(전문가 층 수 − 엔진 cpuMoeLayers)과 같은 단위·같은 값.
 * 블록 수(layers − N)로 세면 MoE 블록이 섞인 모델(Nemotron)에서 두 문장이 다른 숫자를 말한다.
 */
export function gpuExpertLayerCount(model: Pick<ModelCore, 'arch'>, nCpuMoe: number): number {
  return gpuExpertBlocks(model, nCpuMoe).length;
}

/**
 * VRAM 이 모자랄 때 올릴 `--n-cpu-moe` 다음 값(최대 2개) — 각 값은 전문가 층을 하나씩 더 시스템 RAM 으로 보낸다.
 * 전문가 블록이 띄엄띄엄 있으면(Nemotron 은 2~3 블록 간격) N+1·N+2 가 전문가 없는 블록만 덮어 VRAM 이 줄지 않는다.
 */
export function nextCpuMoeFlags(model: Pick<ModelCore, 'arch'>, nCpuMoe: number): number[] {
  return gpuExpertBlocks(model, nCpuMoe)
    .slice(0, 2)
    .map((l) => l + 1);
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
  /**
   * `-ngl` 값. 'auto' = `-ngl`·`--n-cpu-moe` 를 빼고 llama.cpp `--fit`(b7410+ 기본)에 배치를 맡긴다 — GPU 여러 장의 cpu-moe(10-03 D67)와
   * GPU 여러 장의 반복 층 모델(full-gpu·부분 오프로드 — 10-22 D114 리뷰, 헤더 주석)
   */
  ngl: 'all' | 'auto' | number;
  /**
   * cpu-moe: 전문가를 CPU 에 둘 층 수 = 엔진 fit 이 VRAM 여유로 정한 값(추정의 근거와 같은 배치, 10-01 D56).
   * 전체 층과 같으면 전문가 전부 RAM.
   */
  nCpuMoe?: number;
  /** cpu-moe: GPU 에 남는 전문가 층 수(`gpuExpertLayerCount` — 판정 문장과 같은 값). 0 이면 전문가 전부 RAM */
  gpuExpertLayers?: number;
  /** cpu-moe: 메모리 부족 오류 때 올릴 `--n-cpu-moe` 다음 값 0~2개(`nextCpuMoeFlags`) */
  nCpuMoeNext?: number[];
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
  /** cpu-moe: Ollama 0.30+ 가 전문가 일부를 RAM 에 자동 배치 (버전 안내 필요) */
  moeAuto: boolean;
};

export type OllamaOmitted = 'no-fit' | 'sharded';

export type CommandPlan = {
  os: Os;
  mode: Mode;
  fits: boolean;
  ctx: number;
  kvQuant: KvQuant;
  layers: number;
  /** 반복 층 모델(10-22 D114 — `arch.loops`)의 반복 횟수 — `-ngl` 이 논리 층(layers × loops)을 센다는 각주용. 반복이 없으면 생략 */
  loops?: number;
  file: CommandFile;
  llamaCpp?: LlamaCppPlan;
  ollama?: OllamaPlan;
  ollamaOmitted?: OllamaOmitted;
};

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
  const loops = model.arch.loops !== undefined && model.arch.loops > 1 ? model.arch.loops : undefined;
  const base: CommandPlan = {
    os: config.hw.os,
    mode,
    fits: q.fits,
    ctx,
    kvQuant,
    layers,
    ...(loops !== undefined ? { loops } : {}),
    file,
  };
  if (!q.fits) return { ...base, ollamaOmitted: 'no-fit' };

  let ngl: LlamaCppPlan['ngl'];
  let nCpuMoe: number | undefined;
  // 반복 층 모델 × GPU 여러 장: 물리 가중치가 앞쪽 카드에 몰려 -ngl 층 분할이 엔진의 합산 판정과 맞지 않는다 — --fit 에 맡긴다(헤더 주석)
  const loopsFitAuto = loops !== undefined && gpuCountOf(config.hw) > 1;
  switch (mode) {
    case 'full-gpu':
      ngl = loopsFitAuto ? 'auto' : 'all';
      break;
    case 'cpu-moe':
      // GPU 여러 장이면 배치를 --fit 에 맡긴다 (헤더 주석 — 앞쪽 N 층 배치는 마지막 카드에 전문가가 몰린다)
      if (gpuCountOf(config.hw) > 1) {
        ngl = 'auto';
        break;
      }
      ngl = 'all';
      nCpuMoe = cpuMoeFlagLayers(model, q.result.cpuMoeLayers);
      break;
    case 'partial-offload': {
      // llama.cpp 는 출력층부터 올리고 입력층은 항상 CPU — floor 가 엔진 예산 안에 든다 (P1-2 검증)
      const onGpu = Math.floor((q.gpuFrac ?? 0) * layers);
      // 반복 층 모델(10-22 D114): -ngl 은 논리 층을 센다 — 물리 onGpu 층의 가중치를 GPU 에 두는 값(헤더 주석). 여러 장이면 --fit
      if (loopsFitAuto) {
        ngl = 'auto';
        break;
      }
      ngl = onGpu < 1 ? 0 : loops !== undefined ? layers * (loops - 1) + 1 + onGpu : onGpu;
      break;
    }
    case 'cpu-only':
      ngl = gpu.kind === 'cpu' ? 0 : 0;
      break;
  }

  const flags = [
    `-hf ${file.repo}:${file.tag}`,
    `-c ${ctx}`,
    ...(ngl !== 'auto' ? [`-ngl ${ngl}`] : []),
    ...(nCpuMoe !== undefined ? [`--n-cpu-moe ${nCpuMoe}`] : []),
    '-fa on',
    ...(kvQuant !== 'f16' ? [`--cache-type-k ${kvQuant}`, `--cache-type-v ${kvQuant}`] : []),
  ];
  const llamaCpp: LlamaCppPlan = {
    command: `llama-server ${flags.join(' ')}`,
    ngl,
    ...(nCpuMoe !== undefined
      ? {
          nCpuMoe,
          gpuExpertLayers: gpuExpertLayerCount(model, nCpuMoe),
          nCpuMoeNext: nextCpuMoeFlags(model, nCpuMoe),
        }
      : {}),
  };

  let ollamaOmitted: OllamaOmitted | undefined;
  if (shards > 1) ollamaOmitted = 'sharded';
  const ollama: OllamaPlan | undefined = ollamaOmitted
    ? undefined
    : {
        run: `ollama run hf.co/${file.repo}:${file.tag}`,
        serve: serveCommand(config.hw.os, ctx, kvQuant),
        replSet: `/set parameter num_ctx ${ctx}`,
        contextLength: ctx,
        autoOffload: mode === 'partial-offload',
        moeAuto: mode === 'cpu-moe',
      };

  return {
    ...base,
    llamaCpp,
    ...(ollama ? { ollama } : {}),
    ...(ollamaOmitted ? { ollamaOmitted } : {}),
  };
}
