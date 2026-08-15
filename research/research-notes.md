# 리서치 노트 (2026-08-09) — 출처 아카이브

> 4개 병렬 리서치(경쟁·모델·하드웨어·SEO/수익화)의 요약 인덱스. **레코드 단위 원자료는 `hardware.md`(GPU 스펙·실측 70점·효율계수·출처)와 `models.md`(모델 카탈로그·quant bpw·런타임·출처) 참조** — `data/*.json`의 `sources[]`는 그 두 파일에서 채운다. 저장소 `research/`에 그대로 커밋 권장.

## A. 경쟁 서비스 (전수 30여 곳 중 유의미 목록)

| 사이트 | 요약 | 핵심 URL |
|---|---|---|
| canirunthisllm.com | 캘리브레이션 공개(R² 98% Apple/90% dGPU 주장), Build Advisor, 제출 3건뿐, URL 11개 | canirunthisllm.com/methodology, /build-advisor, /benchmarks |
| canirunthisllm.net | Django 취미 프로젝트 (GitHub Jordi577, 31★) | github.com/Jordi577/CanIRunThisLLM |
| willitrunai.com | 콤보 pSEO 선점, 394모델×196GPU, 7언어(ko 포함), WebGPU 감지, 추정 과장 | willitrunai.com/can-run/llama-3.1-70b-on-rtx-4090-24gb |
| apxml.com | 계산기 1위 브랜드, TTFT·동시사용자·렌트비용까지, AdSense+강의 | apxml.com/tools/vram-calculator, /posts/qwen-3-5-system-requirement-vram-guide |
| localscore.ai | Mozilla Builders, 실측 ~4,000건(2026-08 활성), 고정 3모델 | localscore.ai/latest, github.com/cjpais/localscore |
| hardware-corner.net | 실측 21GPU×20모델, GPU별/모델별 페이지, Amazon | hardware-corner.net/gpu-llm-benchmarks/, /llm-database/ |
| vramcalculator.com | 클라이언트에서 GGUF 헤더 실파싱 (참고할 기법) | vramcalculator.com |
| gpuforllm.com | GQA 인지 공식, RunPod+Amazon 제휴 선례 | gpuforllm.com |
| localvram.com | 자체 1시간 지속 벤치, 12언어(ko 기계번역) | localvram.com/en |
| llm.extractum.io | 모델 페이지 37,106개 프로그래매틱 인덱싱 선례 | llm.extractum.io |
| systemrequirementslab | 게임판 원조: 감지 앱+타이틀별 페이지+Amazon | systemrequirementslab.com/cyri |
| CLI 실패 사례 | whichllm(Show HN 3pt 혹평: 미검증 점수·낡은 카탈로그), llmfit(GeekNews 28pt) | github.com/Andyyyy64/whichllm, news.hada.io/topic?id=27143 |
| 한국 커뮤니티 | 아카라이브 로컬 채널(~7,000명, 일 10~15포스트), dcinside 로컬LLM갤, 퀘이사존, PyTorchKR | arca.live/b/alpaca, discuss.pytorch.kr/t/local-llm-llm-gpu/11274 |
| 한국 콘텐츠 | promptquorum /ko(고품질 로컬라이즈 글, 계산기 없음), wikidocs 로컬LLM 전자책, 유튜브 "그래픽카드 16종 로컬 AI 전수조사" | promptquorum.com/ko/local-llms |

## B. 모델·양자화 핵심 출처

- llama.cpp 공식 quant bpw 실측표: github.com/ggml-org/llama.cpp → tools/quantize/README.md (엔진 상수의 원출처)
- KV·아키텍처: 각 모델 HF config.json (Qwen/Qwen3.5-9B, deepseek-ai/DeepSeek-V4-Flash, zai-org/GLM-5 등 raw/main/config.json)
- 실제 GGUF 크기: HF tree API — bartowski/*, unsloth/*, lmstudio-community/*, ggml-org/* (예: huggingface.co/api/models/unsloth/Qwen3-14B-GGUF/tree/main)
- 런타임: FA 기본화 PR #15434 · KV quant server README · --n-cpu-moe PR #15077 · MTP PR #22673 · Ollama 컨텍스트 기본값 docs.ollama.com/context-length · LM Studio 0.4.16(기본 8k, MLX 병행)
- 2026 신모델 계보: Qwen3.5(하이브리드 리니어, MTP)·Qwen3.6 refresh, Gemma 4(12B/26B-A4B/31B), DeepSeek-V4-Flash(284B/13B, DSA, MIT), GLM-5/5.2, Kimi K2.5~K3(2.78T, MXFP4 QAT), MiniMax M3, Mistral Small 4(119B-A6.5B — KV 무거움 주의: MHA 32 kv헤드). Meta는 2025-04 이후 신규 없음(허브 확인).

## C. 하드웨어·실측 핵심 출처

- 스펙: TechPowerUp GPU DB(개별 확인만, DB 통재 금지 정책), Apple 공식 스펙(M5 Pro/Max 2026-03 출시, support.apple.com/en-us/126319)
- 실측 스레드(캘리브레이션 원천): llama.cpp discussions **#15013**(CUDA 표준표), **#15396**(gpt-oss), **#4167**(Apple), **#10879**(Vulkan), **#16578**(DGX Spark) + localscore.ai/accelerator/{43,77,137,155} + hardware-corner.net/gpu-ranking-local-llm/ + quozul.dev(Strix Halo 120b) + llamafile #450(CPU)
- 가격(2026 DRAM 대란): mlq.ai GPU price tracker(5090 $4,200+), Tom's Hardware 2026 가격 기사, bestvaluegpu.com(3090 중고 ~$1,050)
- 미출시 확인: RTX 50 Super 무기연기(techpowerup.com/346010, tweaktown 109694), Arc B770 미출시(tweaktown 109721)
- 효율계수 도출표(클래스별 tg 효율 0.28~0.82)와 12점 검증은 `verify_engine.py` + `docs/02` §3.2·§7

## D. SEO·수익화 핵심 출처

- 정책: developers.google.com/search/docs/essentials/spam-policies (2026-05-15 갱신 — scaled content에 '번역' 명시) · 2026-03 코어 타격 리포트 digitalapplied.com(단일 소스 주의) · pSEO 룰셋 seomatic.ai/blog/programmatic-seo-best-practices
- 생존 사례 Similarweb(2026-06): pcpartpicker +10.6% MoM · apxml 348K · gpu-monkey +24.5% vs versus/technical.city 하락
- AIO: Pew(CTR 8% vs 15%), Ahrefs pos1 -58%, 도구 페이지 방어 논리 ahrefs.com/blog/the-free-tools-seo-strategy/
- 광고: Journey 1,000세션(jupiter.co 가이드) · Mediavine $5K/yr 기준(2026-01~) · Raptive 25K PV+Tier1 50% · Ezoic 250K MAU(2026-02) · RPM: techconda 벤치마크, 한국 RPM ~$1 사례 msg.soledot.com/blog/fo/25950
- 어필리에이트: Amazon PC부품 2.5%(affiliate-program.amazon.com 공식표) · Newegg ~0.5%(Rakuten) · B&H 2~8%/60일(Impact) · 쿠팡 가전~1%·15만원 승인·M+2 정산(startbucks.co.kr, cando50.com) · RunPod referral 3/5% → affiliate 10%(runpod.io/referral-and-affiliate-program) · Vast 3% 평생(docs.vast.ai) · Lambda/TensorDock/Colab 없음
- 수요: Ollama 890만·$65M(techcrunch 2026-07-09) · r/LocalLLaMA 795K(+54.8%, gummysearch) · 구글 자동완성(suggestqueries) en/ko 채집 결과는 docs/04 §1
- 네이버: 점유율 62.86%(koreatimes 2026-01-04) · Search Advisor 절차(indexly.ai, interad.com) · SSR 필요성(dweb.co.kr) · C-Rank/D.I.A+(theegg.com 가이드)
