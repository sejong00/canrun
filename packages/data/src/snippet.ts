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
 *  - 압축 어텐션 모델(attnType `compressed` — DeepSeek V4, 10-22 D115 리뷰)은 `-np 1` 을 붙인다. llama-server 는 `-np` 를 주지 않으면 슬롯 4개에
 *    통합 KV(kv_unified)로 뜨고(https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/tools/server/server.cpp#L169-L173 —
 *    통합이면 슬롯마다 n_ctx_seq = n_ctx, src/llama-context.cpp#L379-L380), 다른 모델은 슬롯들이 n_ctx 셀 하나를 나눠 써서 엔진 KV(ctx 한 벌)와 같다.
 *    DSV4 캐시는 통합 모드여도 raw SWA·CSA·HCA·인덱서·압축기 상태를 시퀀스마다 따로 잡아(src/llama-kv-cache-dsv4.cpp#L1247-L1248 · #L1291-L1333,
 *    텐서 = kv_size × n_stream — src/llama-kv-cache.cpp#L84 · #L233) 기본 4슬롯이면 KV 가 엔진 값의 4배다. `-np 1` 이면 n_seq_max 1 — #27680 로그의
 *    `1/1 seqs`·`streams = 1` 과 같은 조건이라 엔진 KV(요청 하나)와 맞는다
 *  - 라이트닝 인덱서 k-pool 모델(`arch.indexerKPool` — GLM-5.3-Flash, 10-22 엔진 후속 ⑧-b 리뷰)도 `-np 1` 을 붙인다. 이 모델의 어텐션·인덱서 캐시는 표준
 *    llama_kv_cache 라 통합 KV 면 슬롯들이 n_ctx 셀을 나눠 쓴다(KV 는 엔진 값 그대로 — https://github.com/ggml-org/llama.cpp/blob/a37cc46104eb50900d5ab4a9ba02a0abdac039db/src/llama-memory-hybrid-idx.cpp#L52-L74).
 *    다른 점은 인덱서 k-pool 의 연산 그래프 예약이다: 풀 수를 최악 크기 n_pool_max = 셀 / k-pool × n_seq_max 로 잡아(같은 파일 #L483-L494) 연산 버퍼가
 *    슬롯 수 × 컨텍스트에 비례해 커진다(https://github.com/ggml-org/llama.cpp/issues/29950 — 307k·-ub 8192 에서 22.3 GiB 를 더 잡아 OOM, 열림).
 *    엔진의 연산 버퍼 근사는 이 몫을 모른다. ggml-org 가 이 모델을 띄운 명령도 `-np 1` 이다(https://github.com/ggml-org/llama.cpp/pull/30499#issuecomment-6234771665).
 *    KDA 순환 상태(층마다 128² × 64헤드 f32 + conv — 34층 ≈ 153MB)도 시퀀스마다 한 벌(recurrent_rs_size = n_seq_max — 같은 커밋 src/llama-model.cpp#L2883-L2926)이라
 *    `-np 1` 이면 한 벌로 줄지만, 이것은 이 모델만의 이유가 아니다 — Qwen3.5 27B·122B-A10B·Solar Open2 250B 같은 기존 상수 상태 층 하이브리드도 슬롯마다
 *    ≈ 0.16GB(기본 4슬롯 ≈ 0.63~0.65GB)를 미계상으로 두고 명령에 `-np` 를 붙이지 않는다(D63 — 배포된 명령 그대로, docs/02 §9)
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
import { quantFileAlias } from './quant-alias';

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
 * 별칭으로 잡힌 행(파일 이름에 `Q4_K_M` 이 없고 `Q4_K` 만 — quant-alias.ts, 10-22 엔진 후속 ⑧-b)은 파일의 실제 토큰(`Q4_K`) — llama.cpp `-hf` 는 태그 + `[.-]` 를
 * 파일 이름에서 찾는다(`Q4_K_M` 이면 이 파일을 못 고른다).
 * 파일명이 없거나 토큰을 못 찾으면 quant id 그대로 (llama.cpp·Ollama 모두 대소문자 무시).
 */
export function ggufTag(fileName: string | undefined, quant: string): string {
  if (!fileName) return quant;
  const base = fileName.split('/').at(-1) ?? fileName;
  const token = quantFileAlias(quant, base)?.token ?? quant;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
   * `-np 1`(요청 슬롯 하나)을 붙였나 — true: 압축 어텐션 모델(헤더 주석: 압축 캐시가 슬롯마다 따로 잡힌다, 10-22 D115 리뷰) ·
   * 'pool': 라이트닝 인덱서 k-pool 모델(GLM-5.3-Flash — KV 는 슬롯들이 나눠 쓰고, k-pool 연산 예약이 슬롯 수에 비례해 커지며 KDA 순환 상태도 슬롯마다, 10-22 ⑧-b 리뷰)
   */
  singleSlot?: true | 'pool';
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

  // 압축 어텐션(10-22 D115 리뷰): llama-server 기본 4슬롯이면 압축 KV·raw SWA·상태가 슬롯마다 붙는다 — 요청 하나로 띄워 엔진 KV 와 맞춘다(헤더 주석).
  // 라이트닝 인덱서 k-pool(GLM-5.3-Flash — 10-22 ⑧-b 리뷰): KV 는 슬롯들이 나눠 쓰지만 k-pool 연산 예약(#29950)·KDA 순환 상태가 슬롯 수만큼 — 'pool'
  const singleSlot: LlamaCppPlan['singleSlot'] =
    model.arch.attnType === 'compressed' ? true : model.arch.indexerKPool !== undefined ? 'pool' : undefined;
  const flags = [
    `-hf ${file.repo}:${file.tag}`,
    `-c ${ctx}`,
    ...(singleSlot ? ['-np 1'] : []),
    ...(ngl !== 'auto' ? [`-ngl ${ngl}`] : []),
    ...(nCpuMoe !== undefined ? [`--n-cpu-moe ${nCpuMoe}`] : []),
    '-fa on',
    ...(kvQuant !== 'f16' ? [`--cache-type-k ${kvQuant}`, `--cache-type-v ${kvQuant}`] : []),
  ];
  const llamaCpp: LlamaCppPlan = {
    command: `llama-server ${flags.join(' ')}`,
    ngl,
    ...(singleSlot !== undefined ? { singleSlot } : {}),
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
