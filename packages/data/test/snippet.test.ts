/**
 * 실행 커맨드 스니펫 (packages/data/src/snippet.ts) — 기대값은 P1-2 계획 검토의 탐침값.
 * llama.cpp/Ollama 플래그 의미는 snippet.ts 헤더의 검증 사실 참조.
 */
import { computeBufferGB, kvGB, usableGB } from '@canrun/engine';
import { describe, expect, it } from 'vitest';
import {
  assessCombo,
  commandPlan,
  cpuMoeFlagLayers,
  dgpuHardware,
  ggufTag,
  gpuExpertLayerCount,
  hardwareConfigs,
  isUdFile,
  assessQuant,
  nextCpuMoeFlags,
  shardCount,
  type HwConfig,
} from '../src/index';
import { loadSeed } from './seed';

const seed = loadSeed();
const gpu = (id: string) => seed.gpus.find((g) => g.id === id)!;
const model = (id: string) => seed.models.find((m) => m.id === id)!;
const row = (modelId: string, quant: string) =>
  seed.modelQuants.find((r) => r.modelId === modelId && r.quant === quant)!;

/** display quant(F 면 RAM 힌트 구성)로 계획 생성 — 페이지와 같은 선택 */
function planFor(gpuId: string, modelId: string, opts: { configIndex?: number; ctx?: number; kvQuant?: 'f16' | 'q8_0' | 'q4_0' } = {}) {
  const g = gpu(gpuId);
  const config = hardwareConfigs(g, seed.gpus)[opts.configIndex ?? 0]!;
  const combo = assessCombo(seed, g, config, model(modelId));
  const useHint = !combo.display.fits && combo.ramHint;
  const q = useHint ? combo.ramHint!.q : combo.display;
  const cfg = useHint ? combo.ramHint!.config : config;
  return commandPlan(g, cfg, model(modelId), row(modelId, q.quant), q, {
    ctx: opts.ctx,
    kvQuant: opts.kvQuant,
  });
}

describe('file name helpers', () => {
  it('ggufTag keeps the token as written in the file name (UD-, native, dotted names)', () => {
    expect(ggufTag('Qwen3.5-35B-A3B-UD-Q4_K_M.gguf', 'Q4_K_M')).toBe('UD-Q4_K_M');
    expect(ggufTag('gpt-oss-20b-MXFP4.gguf', 'MXFP4')).toBe('MXFP4');
    expect(ggufTag('kanana-1.5-8b-instruct-2505.Q4_K_M.gguf', 'Q4_K_M')).toBe('Q4_K_M');
    expect(ggufTag('UD-Q4_K_M/Qwen3.5-122B-A10B-UD-Q4_K_M-00001-of-00003.gguf', 'Q4_K_M')).toBe('UD-Q4_K_M');
    expect(ggufTag('Qwen3.5-27B-UD-Q2_K_XL.gguf', 'UD-Q2_K_XL')).toBe('UD-Q2_K_XL');
    expect(ggufTag(undefined, 'Q8_0')).toBe('Q8_0');
  });

  it('isUdFile / shardCount', () => {
    expect(isUdFile('Qwen3.5-35B-A3B-UD-Q4_K_M.gguf')).toBe(true);
    expect(isUdFile('Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf')).toBe(false);
    expect(shardCount('UD-Q4_K_M/Qwen3.5-122B-A10B-UD-Q4_K_M-00001-of-00003.gguf')).toBe(3);
    expect(shardCount('gpt-oss-20b-MXFP4.gguf')).toBe(1);
    expect(shardCount(undefined)).toBe(1);
  });

  it('every seed row resolves a tag that the file name actually contains', () => {
    for (const r of seed.modelQuants) {
      const tag = ggufTag(r.fileName, r.quant);
      expect(r.fileName!.toLowerCase(), `${r.modelId}/${r.quant}`).toContain(tag.toLowerCase());
    }
  });
});

describe('commandPlan — llama.cpp', () => {
  it('full GPU: -ngl all (rtx-4060 × llama-3.1-8b)', () => {
    const p = planFor('rtx-4060', 'llama-3.1-8b');
    expect(p.llamaCpp?.command).toBe(
      'llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M -c 8192 -ngl all -fa on',
    );
    expect(p.os).toBe('windows');
    expect(p.ollama?.run).toBe('ollama run hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M');
    expect(p.ollama?.serve).toBe('$env:OLLAMA_CONTEXT_LENGTH="8192"; ollama serve');
    expect(p.ollama?.replSet).toBe('/set parameter num_ctx 8192');
  });

  it('KV quant: the Ollama server env sets flash attention + OLLAMA_KV_CACHE_TYPE (f16 unchanged) — re-verification fix', () => {
    const win = planFor('rtx-4060', 'llama-3.1-8b', { ctx: 16384, kvQuant: 'q8_0' });
    expect(win.ollama?.serve).toBe(
      '$env:OLLAMA_CONTEXT_LENGTH="16384"; $env:OLLAMA_FLASH_ATTENTION="1"; $env:OLLAMA_KV_CACHE_TYPE="q8_0"; ollama serve',
    );
    const unix = planFor('cpu-ddr5-5600-2ch', 'qwen3-8b', { configIndex: 1, kvQuant: 'q4_0' });
    expect(unix.ollama?.serve).toBe('OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q4_0 ollama serve');
    expect(planFor('rtx-4060', 'llama-3.1-8b', { kvQuant: 'f16' }).ollama?.serve).toBe('$env:OLLAMA_CONTEXT_LENGTH="8192"; ollama serve');
  });

  it('KV q8_0 at 16k adds cache-type flags', () => {
    expect(planFor('rtx-4060', 'llama-3.1-8b', { ctx: 16384, kvQuant: 'q8_0' }).llamaCpp?.command).toBe(
      'llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M -c 16384 -ngl all -fa on --cache-type-k q8_0 --cache-type-v q8_0',
    );
  });

  it('partial offload: -ngl floor(gpuFrac × layers) (rtx-4060 × qwen3-14b, 0.609 × 40 = 24)', () => {
    const p = planFor('rtx-4060', 'qwen3-14b');
    expect(p.llamaCpp?.ngl).toBe(24);
    expect(p.llamaCpp?.command).toBe('llama-server -hf unsloth/Qwen3-14B-GGUF:Q4_K_M -c 8192 -ngl 24 -fa on');
    expect(p.ollama?.autoOffload).toBe(true);
  });

  it('cpu-moe: -ngl all --n-cpu-moe N = the engine placement (rtx-3060-12gb × qwen3.5-35b-a3b, UD file)', () => {
    const p = planFor('rtx-3060-12gb', 'qwen3.5-35b-a3b');
    // 10-01 D56: 추정과 같은 배치 — 앞쪽 24/40층 전문가만 CPU (GGUF 실측 분할 + 여유 1층)
    expect(p.llamaCpp?.command).toBe(
      'llama-server -hf unsloth/Qwen3.5-35B-A3B-MTP-GGUF:UD-Q4_K_M -c 8192 -ngl all --n-cpu-moe 24 -fa on',
    );
    expect(p.llamaCpp?.nCpuMoe).toBe(24);
    expect(p.file).toMatchObject({ tag: 'UD-Q4_K_M', ud: true, shards: 1 });
    // Ollama 0.30+ 는 llama.cpp 자동 배치로 같은 방식을 쓴다 — 명령 + 버전 각주
    expect(p.ollamaOmitted).toBeUndefined();
    expect(p.ollama?.moeAuto).toBe(true);
    expect(p.ollama?.autoOffload).toBe(false);
  });

  it('F page uses the RAM-hint configuration (rtx-5060-ti-16gb × gpt-oss-120b @64GB)', () => {
    const p = planFor('rtx-5060-ti-16gb', 'gpt-oss-120b');
    expect(p.llamaCpp?.command).toBe(
      'llama-server -hf ggml-org/gpt-oss-120b-GGUF:MXFP4 -c 8192 -ngl all --n-cpu-moe 30 -fa on',
    );
    // 이전(D23) N_min 은 4070 5 · 4060 13 — 비전문가 실측(gpt-oss 1.30/1.69GB)과 일반 여유 1층으로 대체
    expect(planFor('rtx-4070', 'gpt-oss-20b').llamaCpp?.nCpuMoe).toBe(4);
    expect(planFor('rtx-4060', 'gpt-oss-20b').llamaCpp?.nCpuMoe).toBe(13);
  });

  it('no-fit without a RAM hint: no commands (rtx-4060 × llama-3.3-70b)', () => {
    const p = planFor('rtx-4060', 'llama-3.3-70b');
    expect(p.fits).toBe(false);
    expect(p.llamaCpp).toBeUndefined();
    expect(p.ollamaOmitted).toBe('no-fit');
  });

  it('CPU profile: -ngl 0 on linux; Apple unified: -ngl all on macos', () => {
    const cpu = planFor('cpu-ddr5-5600-2ch', 'qwen3-8b', { configIndex: 1 });
    expect(cpu.llamaCpp?.ngl).toBe(0);
    expect(cpu.os).toBe('linux');
    expect(cpu.ollama?.serve).toBe('OLLAMA_CONTEXT_LENGTH=8192 ollama serve');
    const mac = planFor('apple-m4-pro', 'qwen3-14b');
    expect(mac.llamaCpp?.ngl).toBe('all');
    expect(mac.os).toBe('macos');
  });

  it('sharded files: llama.cpp ok, Ollama omitted (rtx-5090 × qwen3.5-122b-a10b uses the UD-Q2_K_XL single file)', () => {
    const p = planFor('rtx-5090', 'qwen3.5-122b-a10b');
    expect(p.file.tag).toBe('UD-Q2_K_XL');
    expect(p.ollama).toBeDefined();
    const g = gpu('rtx-5090');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const q = assessCombo(seed, g, config, model('qwen3.5-122b-a10b')).perQuant.find((x) => x.quant === 'Q4_K_M')!;
    // 78GB 파일은 32GB 가정에선 미탑재 — 분할 처리만 보려고 fit 상태를 가정한다
    const sharded = commandPlan(g, config, model('qwen3.5-122b-a10b'), row('qwen3.5-122b-a10b', 'Q4_K_M'), {
      fits: true,
      result: { ...q.result, mode: 'partial-offload' },
      gpuFrac: 0.3,
    });
    expect(sharded.file.shards).toBe(3);
    expect(sharded.ollamaOmitted).toBe('sharded');
  });
});

describe('looped layers (Nanbeige4.2, 10-22 D114): -ngl counts logical layers', () => {
  it('partial offload puts the weights of floor(gpuFrac × layers) physical layers on the GPU: -ngl = layers × (loops − 1) + 1 + that', () => {
    const m = model('nanbeige4.2-3b');
    // 8GB 카드 32k(KV 5.9GB) · 12GB 카드 48k(KV 8.9GB) — 둘 다 KV 때문에 가중치 일부만 GPU 에
    for (const [gpuId, ctx] of [['rtx-4060', 32768], ['rtx-3060-12gb', 49152]] as const) {
      const g = gpu(gpuId);
      const config = hardwareConfigs(g, seed.gpus)[0]!;
      const q = assessCombo(seed, g, config, m, { ctx }).perQuant.find((x) => x.quant === 'Q4_K_M')!;
      expect(q.result.mode, gpuId).toBe('partial-offload');
      const plan = commandPlan(g, config, m, row(m.id, 'Q4_K_M'), q, { ctx });
      const k = Math.floor(q.gpuFrac! * 22);
      expect(k, gpuId).toBeGreaterThan(0);
      expect(plan.llamaCpp!.ngl, gpuId).toBe(23 + k);
      expect(plan.llamaCpp!.command).toContain(`-ngl ${String(plan.llamaCpp!.ngl)} `);
    }
  });

  it('the same gpuFrac without loops keeps the old count; full-gpu and cpu-only are unchanged (all · 0)', () => {
    const g = gpu('rtx-4060');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const m = model('nanbeige4.2-3b');
    const plain = { ...m, arch: { ...m.arch, loops: undefined } };
    const q = assessCombo(seed, g, config, m, { ctx: 32768 }).perQuant.find((x) => x.quant === 'Q4_K_M')!;
    expect(commandPlan(g, config, plain, row(m.id, 'Q4_K_M'), q, { ctx: 32768 }).llamaCpp!.ngl).toBe(Math.floor(q.gpuFrac! * 22));
    expect(commandPlan(g, config, plain, row(m.id, 'Q4_K_M'), q, { ctx: 32768 })).not.toHaveProperty('loops');
    expect(planFor('rtx-4060', 'nanbeige4.2-3b').llamaCpp!.ngl).toBe('all');
    expect(planFor('cpu-ddr5-5600-2ch', 'nanbeige4.2-3b').llamaCpp!.ngl).toBe(0);
  });
});

describe('compressed attention (DeepSeek V4, 10-22 D115 review): -np 1, because llama.cpp keeps the compressed caches per slot', () => {
  const v4 = 'deepseek-v4-flash-0731';
  const ramConfig = (gpuId: string, ramGB: number, extra: Parameters<typeof hardwareConfigs>[2] = {}) =>
    hardwareConfigs(gpu(gpuId), seed.gpus, { ramGB, ...extra })[0]!;
  const planAt = (gpuId: string, config: HwConfig, quant: string, ctx = 8192) => {
    const q = assessCombo(seed, gpu(gpuId), config, model(v4), { ctx }).perQuant.find((x) => x.quant === quant)!;
    return commandPlan(gpu(gpuId), config, model(v4), row(v4, quant), q, { ctx });
  };

  it('full GPU on an M3 Ultra 256GB: -np 1 right after -c (one request, the slot count the KV estimate and the #27680 log assume)', () => {
    const p = planAt('apple-m3-ultra', ramConfig('apple-m3-ultra', 256), 'MXFP4');
    expect(p.llamaCpp?.command).toBe('llama-server -hf ggml-org/DeepSeek-V4-Flash-0731-GGUF:MXFP4 -c 8192 -np 1 -ngl all -fa on');
    expect(p.llamaCpp?.singleSlot).toBe(true);
  });

  it('every mode keeps -np 1: experts in RAM (--n-cpu-moe), CPU only, several cards (--fit), a q8_0 cache', () => {
    const moe = planAt('rtx-5090', ramConfig('rtx-5090', 192), 'MXFP4');
    expect(moe.mode).toBe('cpu-moe');
    expect(moe.llamaCpp?.command).toMatch(/^llama-server -hf \S+ -c 8192 -np 1 -ngl all --n-cpu-moe \d+ -fa on$/);
    const cpu = planAt('nvidia-dgx-spark', hardwareConfigs(gpu('nvidia-dgx-spark'), seed.gpus)[0]!, 'Q2_K');
    expect(cpu.mode).toBe('cpu-only');
    expect(cpu.llamaCpp?.command).toContain(' -c 8192 -np 1 -ngl 0 ');
    const multi = planAt('rtx-5090', ramConfig('rtx-5090', 64, { gpuCount: 4 }), 'MXFP4');
    expect(multi.llamaCpp?.ngl).toBe('auto');
    expect(multi.llamaCpp?.command).toBe('llama-server -hf ggml-org/DeepSeek-V4-Flash-0731-GGUF:MXFP4 -c 8192 -np 1 -fa on');
    const q8 = (() => {
      const config = ramConfig('apple-m3-ultra', 256);
      const q = assessCombo(seed, gpu('apple-m3-ultra'), config, model(v4), { ctx: 32768, kvQuant: 'q8_0' }).perQuant.find((x) => x.quant === 'MXFP4')!;
      return commandPlan(gpu('apple-m3-ultra'), config, model(v4), row(v4, 'MXFP4'), q, { ctx: 32768, kvQuant: 'q8_0' });
    })();
    expect(q8.llamaCpp?.command).toContain(' -c 32768 -np 1 -ngl all -fa on --cache-type-k q8_0 --cache-type-v q8_0');
  });

  it('no other catalog model gets -np (their slots share one n_ctx pool, which is what the engine counts)', () => {
    const g = gpu('rtx-4090');
    const config = hardwareConfigs(g, seed.gpus, { ramGB: 256 })[0]!;
    for (const m of seed.models) {
      const combo = assessCombo(seed, g, config, m);
      if (!combo.display.fits) continue;
      const plan = commandPlan(g, config, m, row(m.id, combo.display.quant), combo.display);
      if (m.arch.attnType === 'compressed') {
        expect(plan.llamaCpp?.command, m.id).toContain(' -np 1 ');
      } else {
        expect(plan.llamaCpp?.command, m.id).not.toMatch(/ -np /);
        expect(plan.llamaCpp, m.id).not.toHaveProperty('singleSlot');
      }
    }
  });
});

describe('looped layers × several GPUs (10-22 D114 review): -ngl is left to --fit', () => {
  it('full-gpu and partial offload drop -ngl on 2 cards (the weights would pile onto the first card); one card keeps -ngl', () => {
    const m = model('nanbeige4.2-3b');
    const g = gpu('rtx-4060');
    for (const [ctx, mode] of [[8192, 'full-gpu'], [65536, 'partial-offload']] as const) {
      const pairCfg = hardwareConfigs(g, seed.gpus, { gpuCount: 2 })[0]!;
      const q = assessCombo(seed, g, pairCfg, m, { ctx }).perQuant.find((x) => x.quant === 'Q4_K_M')!;
      expect(q.result.mode, String(ctx)).toBe(mode);
      const plan = commandPlan(g, pairCfg, m, row(m.id, 'Q4_K_M'), q, { ctx });
      expect(plan.llamaCpp!.ngl, String(ctx)).toBe('auto');
      expect(plan.llamaCpp!.command).not.toMatch(/-ngl/);
      expect(plan.loops).toBe(2);
      // 반복이 없으면 같은 2장 구성도 -ngl 을 그대로 쓴다
      const plain = { ...m, arch: { ...m.arch, loops: undefined } };
      expect(commandPlan(g, pairCfg, plain, row(m.id, 'Q4_K_M'), q, { ctx }).llamaCpp!.ngl, String(ctx)).not.toBe('auto');
    }
    expect(planFor('rtx-4060', 'nanbeige4.2-3b').llamaCpp!.ngl).toBe('all');
  });
});

describe('--n-cpu-moe counts blocks, the engine counts expert layers (10-03 D63)', () => {
  const arch = (layers: number, expertLayers?: number[]) => ({ arch: { layers, kvHeads: 2, headDim: 128, attnType: 'hybrid' as const, kvBytesPerTokenF16: 1, ...(expertLayers ? { expertLayers } : {}) } });

  it('passes the engine value through when every layer has experts; no value = every layer', () => {
    expect(cpuMoeFlagLayers(arch(48), 30)).toBe(30);
    expect(cpuMoeFlagLayers(arch(48), undefined)).toBe(48);
  });

  it('with an expert-layer map: the block count that covers the first N expert layers', () => {
    const m = arch(8, [1, 3, 6]);
    expect([0, 1, 2, 3, 5].map((n) => cpuMoeFlagLayers(m, n))).toEqual([0, 2, 4, 7, 7]);
    expect(cpuMoeFlagLayers(m, undefined)).toBe(8);
  });

  it('Nemotron 3.5 Lightning on a 16GB card: the command keeps exactly the engine’s expert blocks on the GPU', () => {
    const m = model('nemotron-3.5-lightning-30b-a3b');
    const g = gpu('rtx-5060-ti-16gb');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const combo = assessCombo(seed, g, config, m);
    expect(combo.display.result.mode).toBe('cpu-moe');
    expect(combo.display.result.confidence).toBe('theoretical');
    const onCpu = combo.display.result.cpuMoeLayers!;
    const n = commandPlan(g, config, m, row(m.id, combo.display.quant), combo.display).llamaCpp!.nCpuMoe!;
    const experts = m.arch.expertLayers!;
    expect(experts.filter((l) => l < n)).toHaveLength(onCpu);
    expect(experts).toContain(n - 1);
    expect(n).toBeGreaterThan(onCpu); // 블록 번호는 MoE 블록 수보다 크다 — 엔진 값을 그대로 쓰면 GPU 에 전문가가 더 남는다
  });

  it('GPU-side count and OOM next values are in expert layers, not blocks', () => {
    const m = arch(8, [1, 3, 6]);
    // N=2: 블록 0·1 → 전문가 층 1 만 CPU, GPU 에는 3·6 두 개 (블록으로 세면 6)
    expect(gpuExpertLayerCount(m, 2)).toBe(2);
    expect(nextCpuMoeFlags(m, 2)).toEqual([4, 7]);
    expect(gpuExpertLayerCount(m, 4)).toBe(1);
    expect(nextCpuMoeFlags(m, 4)).toEqual([7]);
    expect(gpuExpertLayerCount(m, 8)).toBe(0);
    expect(nextCpuMoeFlags(m, 8)).toEqual([]);
    // 모든 층에 전문가가 있으면 블록 수와 같다 — N+1·N+2
    expect(gpuExpertLayerCount(arch(48), 30)).toBe(18);
    expect(nextCpuMoeFlags(arch(48), 30)).toEqual([31, 32]);
    expect(nextCpuMoeFlags(arch(48), 47)).toEqual([48]);
  });

  it('every partial cpu-moe command matches the verdict sentence and each OOM step frees one expert layer', () => {
    let checked = 0;
    let mapped = 0;
    for (const g of seed.gpus.filter((x) => x.kind === 'dgpu')) {
      for (const m of seed.models.filter((x) => x.moe)) {
        for (const config of hardwareConfigs(g, seed.gpus)) {
          const combo = assessCombo(seed, g, config, m);
          const d = combo.display;
          if (!d.fits || d.result.mode !== 'cpu-moe') continue;
          const llama = commandPlan(g, config, m, row(m.id, d.quant), d).llamaCpp!;
          // 판정 문장(apps/web/lib/combo-phrases.ts verdictSentence)이 세는 값과 같아야 한다
          const moeLayers = m.arch.expertLayers?.length ?? m.arch.layers;
          const sentence = moeLayers - (d.result.cpuMoeLayers ?? moeLayers);
          expect(llama.gpuExpertLayers, `${g.id} ${m.id}`).toBe(Math.max(0, sentence));
          if (sentence <= 0) continue;
          checked += 1;
          if (m.arch.expertLayers) mapped += 1;
          // 올리라고 안내하는 값마다 GPU 에 남는 전문가 층이 정확히 하나씩 줄어든다
          const next = llama.nCpuMoeNext!;
          expect(next.length).toBe(Math.min(2, sentence));
          next.forEach((v, i) =>
            expect(gpuExpertLayerCount(m, v), `${g.id} ${m.id} → ${v}`).toBe(sentence - i - 1),
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(mapped).toBeGreaterThan(10);
  });

  it('Nemotron on a 16GB card: footnote count = verdict count, OOM steps skip expert-free blocks', () => {
    const m = model('nemotron-3.5-lightning-30b-a3b');
    const g = gpu('rtx-5060-ti-16gb');
    const config = hardwareConfigs(g, seed.gpus)[0]!;
    const d = assessCombo(seed, g, config, m).display;
    const llama = commandPlan(g, config, m, row(m.id, d.quant), d).llamaCpp!;
    expect(llama.nCpuMoe).toBe(25);
    expect(llama.gpuExpertLayers).toBe(12); // 블록 수로 세면 27
    expect(llama.nCpuMoeNext).toEqual([28, 30]); // 26·27 은 전문가 없는 블록 25·26 만 덮는다
  });
});

describe('--n-cpu-moe N keeps the GPU side within usable VRAM for every cpu-moe combo (10-01 D56)', () => {
  it('holds over dGPU × MoE × rows × RAM options, measured from each row’s GGUF split', () => {
    let checked = 0;
    let partial = 0;
    for (const g of seed.gpus.filter((x) => x.kind === 'dgpu')) {
      for (const m of seed.models.filter((x) => x.moe)) {
        for (const r of seed.modelQuants.filter((x) => x.modelId === m.id)) {
          // 모든 MoE 행은 GGUF 헤더 실측 분할을 갖는다 (validateAll)
          expect(r.expertGB, `${m.id} ${r.quant}`).toBeDefined();
          for (const ramGB of [32, 64, 96, 128]) {
            const config: HwConfig = {
              gpuId: g.id,
              ramGB,
              assumedRam: false,
              hw: dgpuHardware(g, ramGB, 89.6),
            };
            const q = assessQuant({ gpu: g, config, model: m, row: r, tier: 'ok', benchmarks: [] });
            if (!q.fits || q.result.mode !== 'cpu-moe') continue;
            const p = commandPlan(g, config, m, r, q);
            const n = p.llamaCpp!.nCpuMoe!;
            checked += 1;
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(m.arch.layers);
            if (n < m.arch.layers) partial += 1;
            // llama.cpp 의 실제 배치로 잰다: `--n-cpu-moe N` = 앞 N 블록의 전문가를 CPU 에. 전문가가 일부 블록에만 있는 모델
            // (arch.expertLayers — Mamba 사이에 섞인 MoE 블록·앞쪽 dense 층, 10-03 D63)은 N 이상 번호의 전문가 층만 GPU 에 남는다
            // (전엔 균등 분포 근사로 재서 Nemotron 의 실제 GPU 쪽 초과 최대 1GB 를 못 잡았다 — 근사가 엔진과 같았기 때문)
            const expertLayers = m.arch.expertLayers ?? Array.from({ length: m.arch.layers }, (_, i) => i);
            const perLayer = r.expertGB! / expertLayers.length;
            const gpuSide =
              r.nonExpertGB! +
              perLayer * expertLayers.filter((l) => l >= n).length +
              kvGB(m.arch.kvBytesPerTokenF16, 8192) +
              computeBufferGB(8192);
            expect(gpuSide, `${g.id} ${m.id} ${r.quant} @${ramGB}`).toBeLessThanOrEqual(usableGB(config.hw) + 1e-9);
            // 여유 1층을 빼면 GPU 에 한 층 더 들어갈 수도 있었다 — 배치가 VRAM 을 놀리지 않는다
            if (n > 1 && n < m.arch.layers) {
              expect(gpuSide + perLayer * 2, `${g.id} ${m.id} ${r.quant} @${ramGB} slack`).toBeGreaterThan(
                usableGB(config.hw),
              );
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1500);
    expect(partial).toBeGreaterThan(500);
  });
});

describe('several GPUs (D58 같은 카드 · 10-03 D67 서로 다른 카드)', () => {
  const planOn = (gpuId: string, modelId: string, opts: { gpuCount?: number; extra?: string[] }) => {
    const g = gpu(gpuId);
    const config = hardwareConfigs(g, seed.gpus, {
      ramGB: 64,
      ...(opts.gpuCount ? { gpuCount: opts.gpuCount } : {}),
      ...(opts.extra ? { extraGpus: opts.extra.map(gpu) } : {}),
    })[0]!;
    const c = assessCombo(seed, g, config, model(modelId), { theoretical: true });
    return { combo: c, plan: commandPlan(g, config, model(modelId), row(modelId, c.display.quant), c.display) };
  };

  it('cpu-moe: -ngl and --n-cpu-moe are left out so llama.cpp --fit places the experts per card (front-layer N piles experts on the last card)', () => {
    for (const opts of [{ gpuCount: 2 }, { extra: ['rtx-3060-12gb'] }]) {
      const { combo, plan } = planOn('rtx-4060', 'gpt-oss-120b', opts);
      expect(combo.display.result.mode).toBe('cpu-moe');
      expect(plan.llamaCpp?.ngl).toBe('auto');
      expect(plan.llamaCpp?.nCpuMoe).toBeUndefined();
      expect(plan.llamaCpp?.command).toBe('llama-server -hf ggml-org/gpt-oss-120b-GGUF:MXFP4 -c 8192 -fa on');
    }
    // 1장이면 그대로 엔진 배치를 명시
    expect(planOn('rtx-5060-ti-16gb', 'gpt-oss-120b', {}).plan.llamaCpp?.nCpuMoe).toBe(30);
  });

  it('full GPU on mixed cards: plain -ngl all (the default split is the modelled split); partial keeps -ngl K', () => {
    const full = planOn('rtx-3090', 'llama-3.1-8b', { extra: ['rtx-3060-12gb'] }).plan;
    expect(full.llamaCpp?.command).toMatch(/ -ngl all -fa on$/);
    const { combo, plan } = planOn('rtx-3090', 'llama-3.3-70b', { extra: ['rtx-3060-12gb'] });
    expect(combo.display.result.mode).toBe('partial-offload');
    expect(plan.llamaCpp?.ngl).toBe(Math.floor((combo.display.gpuFrac ?? 0) * model('llama-3.3-70b').arch.layers));
  });
});
