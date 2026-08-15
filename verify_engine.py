"""계산 엔진 공식 검증 — 리서치로 수집한 실측값과 대조.
1) 가중치 크기: params × bpw / 8  vs 실제 GGUF 파일 크기 (HF 실측)
2) KV 캐시: 2 × layers × kv_heads × head_dim × 2B  vs 알려진 KiB/tok
3) 속도 모델: tg = eff × BW / (weights + KV_ctx)  vs llama.cpp 실측 tok/s
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows cp949 콘솔 대비
except Exception:
    pass

# ---------- 1) 가중치 크기 검증 (decimal GB) ----------
BPW = {"Q2_K": 3.1593, "IQ4_XS": 4.4597, "Q4_K_M": 4.8944, "Q5_K_M": 5.7036,
       "Q6_K": 6.5633, "Q8_0": 8.5008, "F16": 16.0005}

# (모델, params_B, quant, 실제 파일 GB)
weights_cases = [
    ("Llama-3.1-8B", 8.03, "Q4_K_M", 4.92),
    ("Llama-3.1-8B", 8.03, "Q8_0", 8.54),
    ("Llama-3.1-8B", 8.03, "Q2_K", 3.18),
    ("Llama-3.1-8B", 8.03, "IQ4_XS", 4.45),
    ("Qwen3-8B", 8.2, "Q4_K_M", 5.03),
    ("Qwen3-14B", 14.8, "Q4_K_M", 9.00),
    ("Qwen3-32B", 32.8, "Q4_K_M", 19.76),
    ("Gemma3-27B", 27.4, "Q4_K_M", 16.55),
    ("Llama-3.3-70B", 70.6, "Q4_K_M", 42.52),
    ("Mistral-Small-3.2-24B", 23.6, "Q4_K_M", 14.33),
    ("Phi-4-14.7B", 14.7, "Q4_K_M", 9.05),
]
print("=" * 78)
print("1) WEIGHTS: params_B x bpw / 8  vs actual GGUF file size")
errs = []
for name, p, q, actual in weights_cases:
    pred = p * BPW[q] / 8
    err = (pred - actual) / actual * 100
    errs.append(abs(err))
    print(f"  {name:24s} {q:7s} pred {pred:6.2f} GB | actual {actual:6.2f} GB | err {err:+5.1f}%")
print(f"  -> MAE {sum(errs)/len(errs):.1f}%  max {max(errs):.1f}%")

# ---------- 2) KV 캐시 검증 ----------
print("=" * 78)
print("2) KV CACHE: 2 x layers x kv_heads x head_dim x 2B (f16) per token")
kv_cases = [  # (모델, layers, kv_heads, head_dim, 기대 KiB/tok)
    ("Llama-3.1-8B", 32, 8, 128, 128),
    ("Qwen3-8B", 36, 8, 128, 144),
    ("Qwen3-14B", 40, 8, 128, 160),
    ("Qwen3-32B", 64, 8, 128, 256),
    ("Llama-3.3-70B", 80, 8, 128, 320),
    ("Phi-4", 40, 10, 128, 200),
    ("Qwen3-30B-A3B", 48, 4, 128, 96),
]
for name, L, kvh, hd, expect in kv_cases:
    kib = 2 * L * kvh * hd * 2 / 1024
    ok = "OK" if abs(kib - expect) < 0.5 else "MISMATCH"
    print(f"  {name:16s} -> {kib:6.0f} KiB/tok (expected {expect}) {ok}")
kv8b_16k = 2 * 32 * 8 * 128 * 2 * 16384 / 1e9
print(f"  Llama-3.1-8B @16k ctx f16 KV = {kv8b_16k:.2f} GB (q8_0 KV would be ~{kv8b_16k*0.535:.2f} GB)")

# ---------- 3) 속도 모델 검증 ----------
print("=" * 78)
print("3) SPEED: tg = eff_class x BW / (weight_GB + KV_read_GB(ctx))  vs measured")
# (라벨, BW GB/s, eff, weight GB, kv_KiB/tok, ctx, 실측 tg)
speed_cases = [
    ("4090 L2-7B Q4_0 short",      1008, 0.70, 3.83, 128, 512,   186.2),
    ("3090 L2-7B Q4_0 short",       936, 0.70, 3.83, 128, 512,   158.2),
    ("3060 L2-7B Q4_0 short",       360, 0.80, 3.83, 128, 512,    75.6),
    ("5090 Qwen3-8B Q4 @16k",      1792, 0.62, 5.03, 144, 16384, 145.3),
    ("4090 Qwen3-8B Q4 @16k",      1008, 0.70, 5.03, 144, 16384, 104.3),
    ("3090 Qwen3-8B Q4 @16k",       936, 0.70, 5.03, 144, 16384,  87.5),
    ("M4 Max 7B Q4_0 short",        546, 0.60, 3.83, 128, 512,    83.1),
    ("M4 Pro 7B Q4_0 short",        273, 0.60, 3.83, 128, 512,    50.7),
    ("CPU DDR5-5600 Mistral7B Q4",  89.6, 0.50, 4.37, 128, 512,   11.2),
    ("4090 gpt-oss-20b MoE",       1008, 0.45, 2.08,  24, 2048,  225.2),
    ("5060Ti gpt-oss-20b MoE",      448, 0.45, 2.08,  24, 2048,  111.6),
    ("StrixHalo gptoss120b MoE",    256, 0.54, 2.76,  36, 2048,   50.2),
]
errs = []
for label, bw, eff, w, kvkib, ctx, meas in speed_cases:
    kv_gb = kvkib * 1024 * ctx / 1e9
    pred = eff * bw / (w + kv_gb)
    err = (pred - meas) / meas * 100
    errs.append(abs(err))
    print(f"  {label:30s} pred {pred:6.1f} | meas {meas:6.1f} tok/s | err {err:+5.1f}%")
print(f"  -> MAE {sum(errs)/len(errs):.1f}%  max {max(errs):.1f}%")

# ---------- 4) 판정 로직 새너티 체크 ----------
print("=" * 78)
print("4) VERDICT SANITY: RTX 4060 8GB (usable ~7.3GB after OS reserve)")
usable = 8.0 - 0.7
for name, w, kvkib in [("Llama-3.1-8B Q4_K_M", 4.92, 128), ("Qwen3-14B Q4_K_M", 9.00, 160),
                       ("Qwen3-30B-A3B Q4_K_M", 18.6, 96), ("gpt-oss-20b MXFP4", 12.11, 24)]:
    kv8k = kvkib * 1024 * 8192 / 1e9
    need = w + kv8k + 0.9  # compute buffer
    fit = "FITS(full)" if need <= usable else "NO full offload -> partial/cpu-moe"
    print(f"  {name:26s} need {need:5.2f} GB vs {usable:.1f} GB -> {fit}")
print("  (실측: 4060에서 8B Q4_K_M = 38~42 tok/s 구동 확인 — LocalScore/DatabaseMart)")
