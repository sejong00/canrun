# 03. 데이터 명세 — 스키마·시드 데이터·파이프라인

> MVP 데이터는 저장소 `/data/*.json` (버전 관리·PR 리뷰 가능). Phase 2에서 제출 데이터만 D1(SQLite)로. **모든 레코드에 `sources: string[]` 필수.** 본 문서의 시드 표는 2026-08-09 리서치 실측·공식 스펙 기준 — 그대로 JSON화하면 시드 v1 완성.

## 1. 스키마 (zod로 구현, `packages/data/src/schema.ts`)

정본은 `packages/data/src/schema.ts` — 이 블록은 요약이며 불일치 시 코드가 우선. 초기 명세 대비 P0-3 이탈(`schema.ts` 헤더·PROGRESS §4 08-16): ① Gpu.kind에 `'cpu'` 추가(§2 CPU 프로필 3종, 엔진 `Hardware.kind`와 정합) ② unified/cpu는 `vramGB` 대신 `ramOptionsGB[]`(PRD "Mac은 칩+RAM 통합 선택") ③ BenchPoint.modelId·quant는 자유 문자열(카탈로그 외 캘리브레이션 모델·실측 quant 표기 보존 — §4).

```ts
// 공통: sources = URL[] (min 1 — Gpu·Model·ModelQuant·attnOverrides. BenchPoint는 sourceUrl 단일, QuantDef·Alias·PublishPlan은 없음)
//       날짜 = 'YYYY-MM-DD' · id = slug /^[a-z0-9][a-z0-9.-]*$/
Gpu { id, name, aliases[],  // 검색 별칭 + P1-3 계산기 콤보박스·GPU 감지 매칭 토큰(예 'radeon 8060s' — 렌더러 문자열 대응, PROGRESS §4 09-29 D30)
     vendor:'nvidia'|'amd'|'intel'|'apple'|'amd-apu'|'nvidia-dgx'|'generic',
     kind:'dgpu'|'unified'|'cpu', form:'desktop'|'laptop',
     vramGB?,            // dgpu 필수 (decimal GB)
     ramOptionsGB?: number[],   // unified/cpu 필수 — 선택 가능한 RAM 구성 GB (min 1)
     memBandwidthGBs, fp16Tflops?,   // FP16 크리플(GTX 10)이면 실효값
     memBandwidthByRam?: { ramGB, memBandwidthGBs }[],   // unified 전용 — 메모리 구성마다 대역폭이 다른 칩(Apple M6 16GB 153.6, 10-20). memBandwidthGBs 는 가장 높은 구성 값, 여기 값은 그보다 낮고 ramOptionsGB 안의 구성만 → 엔진 입력·콤보 사양 줄이 구성 값을 쓴다(hardwareConfigs)
     usableGBByRam?: { ramGB, usableGB }[],   // unified 전용 — GPU 가 쓸 수 있는 메모리에 기기 근거가 있는 기기의 구성별 값(DGX Spark 64GB 48.2·128GB 116.9, 10-23 D117). ramOptionsGB 의 구성을 빠짐없이·한 번씩, 구성 용량보다 작게(zod) → 엔진 입력 Hardware.unifiedUsableGB(hardwareConfigs — 계산기 lite 카탈로그 키). 없으면 엔진 ram × 0.70(docs/02 §2.3). 값의 유도는 레코드 note·docs/02 §2.3, 출처는 레코드 sources
     primaryRamGB?: number,   // unified 전용 — 대표 메모리 구성(10-23 D120 사용자 결정: DGX Spark 128 — NVIDIA 가 직접 파는 판). 있으면 모델 허브 행·콤보 페이지·계산기 '상세' 링크·공유 카드가 판정과 관계없이 이 구성(`pickConfigCombo`), 없으면 최고 판정의 최소 구성(D4). ramOptionsGB 안의 값만(zod), 계산기 lite 카탈로그 키·쌍둥이 판정 키. GPU 허브 요약·비교는 원래 가장 큰 구성이라 영향 없다
     cluster?: { maxNodes, directMaxNodes, linkGbps, sources[] },   // unified 전용 — 같은 기기를 제조사 공식 네트워크로 여러 대 이어 쓸 수 있는 기기(DGX Spark: 최대 4대·케이블 직결 3대·200Gb/s, NVIDIA 클러스터링 문서·제품 페이지 FAQ·케이블·스위치 플레이북, 10-23 D118 — 케이블 플레이북에는 수동 설정 전용 4대 링도 있지만(1·3번, 2·4번은 직접 이어지지 않는다) directMaxNodes 는 클러스터링 문서·FAQ 의 3대로 둔다, D118 리뷰). maxNodes 2~8 정수·directMaxNodes ≤ maxNodes·sources 는 https 이고 레코드 sources 에도 있어야 한다·다른 키 금지(zod strict) → 허브·콤보의 2대·4대 행(`clusterConfigs` — HUB_POLICY.clusterHubNodes)·계산기 대수 선택(1~maxNodes, URL `nodes=`) → 엔진 입력 Hardware.nodes(docs/02 §6.2). 계산기 lite 카탈로그에는 sources 를 빼고 maxNodes·directMaxNodes·linkGbps 만
     effClass:'nvidia'|'amd'|'intel-arc'|'apple'|'apple-ultra'|'strix'|'dgx-spark'|'cpu',
     neuralAccelerators?: true,   // GPU 코어마다 행렬곱 가속기(Apple M5 계열·M6 — 애플 뉴스룸, M6 는 10-20) → pp 계수 PP_COEF_NEURAL_ACCEL (docs/02 §3.5, 10-16 D86)
     launchYear:2015..2026, msrpUSD?, streetUSD?, streetKRW?,
     priceAsOf?,         // streetUSD/KRW 존재 시 필수 (CLAUDE.md 규칙 2)
     popular:boolean, note?,
     products?: { line:'mac-mini'|'macbook-air'|'macbook-pro'|'imac'|'mac-studio'|'mac-pro', model, memoryGB[], sources[] }[],   // Apple 칩 필수·그 밖 금지 (10-16 D97)
     sources[] }
     // products: 이 칩이 들어가는 맥 — 애플 공식 사양(Tech Specs) 페이지 하나 = 모델 하나, 페이지로 확인한 칩·메모리 짝만(추측 금지). model = 사양 페이지 제목 그대로("Mac mini (2024)").
     //   memoryGB 는 오름차순·ramOptionsGB 안의 값만, ramOptionsGB 구성마다 그 메모리로 파는 모델이 하나 이상(zod). sources = support.apple.com/<로캘>/<번호> ·
     //   apple.com/…/specs/ · 애플이 구성을 내린 뒤의 확인용 web.archive.org 사본(M3 Ultra 512GB — 10-15 D80)만, 레코드 sources 에도 있어야 한다(zod).
     //   출시 확인 전이라 ramOptionsGB 에서 뺀 구성(M5 Ultra 512GB — D85)은 여기서도 뺀다. 서버 전용(lite 카탈로그 키 아님) — GPU 허브 제목·H1
     //   "Apple M4(맥 미니·맥북 에어·맥북 프로·아이맥)", 설명(요약 구성 메모리로 파는 계열만), 사양 "이 칩이 들어간 맥" 줄(계열별 메모리). 표시 이름은 messages `MacProduct`,
     //   조립은 `apps/web/lib/search-names.ts`. 콤보 제목에는 넣지 않는다
Model { id, family, name, hfId, paramsB, activeParamsB?,   // moe ⇒ activeParamsB 필수
     arch:{layers, kvHeads, headDim, attnType:'full'|'swa'|'mla'|'hybrid'|'compressed', kvBytesPerTokenF16, experts?, topK?, expertLayers?, ple?:true, valueExperts?, valueTopK?, loops?, mhc?:true, indexerKPool?},  // 바이트/tok f16 사전계산 (SWA/MLA/하이브리드·KV 공유 층 보정 반영)
     // experts·topK (10-01 D56): MoE 전용, 둘 다 있거나 둘 다 없음, topK < experts. validateAll 이 모든 MoE 모델에 요구하고 MOE_ARCH 와 대조.
     //   출처 config.json(num_experts·num_local_experts·n_routed_experts / num_experts_per_tok·top_k_experts·experts_per_token), GGUF expert_count·expert_used_count 로 교차 확인
     // expertLayers (10-03 D63): MoE 전용·선택 — 라우팅 전문가가 있는 층 번호(0부터, 트렁크만, 오름차순, 전체 층보다 적게). 일부 층에만 전문가가 있을 때만.
     //   출처 config.json(nemotron_h layers_block_type 의 moe 블록 · bailing_hybrid first_k_dense_replace) — add-model·HF 불러오기가 classifyArch 로 기록.
     //   엔진 입력 moeLayers = 이 길이, 명령의 --n-cpu-moe 는 엔진 N 번째 전문가 층까지 덮는 블록 수(snippet.ts cpuMoeFlagLayers)
     // ple (10-21 D112): 층별 임베딩 표(PLE — config hidden_size_per_layer_input > 0, Gemma 4 E2B·E4B)가 있는 dense 모델 — classifyArch(gemma4_text) 가 기록.
     //   헤더 실측 행(offGpuGB 있음)은 모두 pleGB 를 가져야 하고, MoE 에는 둘 수 없다(validateAll). 추정 라벨은 이론 추정(assess isTheoretical — docs/02 §4 ⑦).
     //   KV 공유 층(num_kv_shared_layers)은 따로 필드를 두지 않는다 — kvBytesPerTokenF16 이 앞 `층 수 − 공유 층` 안의 전체 어텐션 층만 센 값(attnOverrides.reason·sources 에 llama.cpp 근거)
     // valueExperts·valueTopK (10-21 D113): MoE 전용·선택 — 값 전문가(MoVA, K2-Horizon) 수와 토큰당 고르는 수. 둘 다 있거나 둘 다 없음, valueTopK < valueExperts(validateAll).
     //   출처 config.json mova_num_experts·mova_num_experts_per_tok(GGUF attention.value_expert_count·value_expert_used_count) — classifyArch(k2_horizon)가 기록, 레코드 sources 에 llama.cpp 근거.
     //   MoE 층마다 V 투영을 값 전문가 중 몇 개로 만들어 그 합을 V 로 쓴다 — 토큰당 V 모양이 표준과 같아 KV 는 표준 GQA 식. 값 전문가 텐서(attn_v_exps)는
     //   llama.cpp 가 --n-cpu-moe·--fit 에서도 그래픽카드에 둬 행의 nonExpertGB 에 들어 있고, 크기는 행 valueExpertGB 에 따로 둔다(아래). 데이터 계층(toModelQuant)이
     //   valueTopK/valueExperts 를 엔진 valueExpertFrac 로 넘겨 읽기 바이트에서 고르지 않은 몫을 뺀다(엔진 0.11.0 — docs/02 §3.1). 값 전문가 라우팅 고정 시간은 세지 않고
     //   공개 실측도 없어 추정 라벨은 이론 추정(assess isTheoretical — docs/02 §4 ⑧·§9). 이 모델의 행은 모두 헤더 분할·valueExpertGB 필수(validateAll — 없으면 모델 수준
     //   유도 nonExpertGB 가 값 전문가를 FFN 전문가처럼 나눠 VRAM 을 적게 센다). 계산기 HF 불러오기는 MoVA 모델을 받지 않는다
     // loops (10-22 D114): dense 전용·선택 — 반복 층(looped transformer, Nanbeige4.2) 반복 횟수 ≥ 2(zod int ≥ 2). 출처 config.json num_loops — classifyArch(nanbeige)가 기록,
     //   레코드 sources 에 config 와 llama.cpp 근거(nanbeige.cpp·llama-kv-cache.cpp 고정 커밋). layers 는 물리 층, kvBytesPerTokenF16 은 논리 층(layers × loops) 값 —
     //   validateAll·sync-models 의 전체 어텐션 공식이 × loops 로 센다(attnOverrides 없음 — 전체 어텐션). 데이터 계층(toModelQuant)이 엔진 loops·loopGB 로 넘겨
     //   읽기 바이트에 (loops − 1) × loopGB 를 더한다(엔진 0.12.0 — docs/02 §3.1). 추정 라벨은 이론 추정(assess isTheoretical — docs/02 §4 ⑨). 헤더 실측 행은 모두 loopGB(validateAll),
     //   MoE 에는 둘 수 없다. sync-models 는 config num_loops 가 바뀌면 manual 로만 알린다. 스니펫 -ngl 은 논리 층 기준(docs/02 §3.4), GPU 여러 장이면 -ngl 을 빼고 --fit
     //   (물리 가중치가 앞쪽 카드에 몰린다 — docs/02 §9, 10-22 D114 리뷰). classifyArch 는 nanbeige config 에 layer_types·sliding_window(_pattern)·use_sliding_window 가 있으면
     //   보류한다(llama.cpp nanbeige 는 모든 논리 층이 전체 어텐션). 계산기 HF 불러오기는 반복 모델을 받지 않는다
     // attnType 'compressed' (10-22 D115): 압축 어텐션(DeepSeek V4 — 층별 compress_ratios 0·4·128). kvBytesPerTokenF16 = CSA·HCA·인덱서 압축 캐시의 토큰당 몫
     //   (docs/02 §2.2 — V4 Flash 6,880), raw SWA 창 캐시·압축기 상태는 상수라 미계상. 비-full 이라 attnOverrides 필수(validateAll — 근거는 llama-kv-cache-dsv4.cpp 고정 커밋).
     //   classifyArch(deepseek_v4 전용 분기)가 llama.cpp deepseek4 변환기·로더가 읽는 키만 켜진 config 인지 본다. 엔진 산식은 이 값을 읽지 않는다(표시용 — 엔진 0.12.1)
     // mhc (10-22 D115): 선택 — 하이퍼 커넥션(config hc_mult > 1, DeepSeek V4). 층마다 더하는 연산을 속도식이 세지 않아 추정은 이론 추정(assess isTheoretical —
     //   docs/02 §4 ⑩). deepseek_v4 밖의 hc_mult > 1 은 classifyArch 가 보류한다. 압축 어텐션·mHC 모델은 콤보 모델 대안 후보에서 뺀다(D113 임시 기본값과 같은 이유 — combo.ts)
     //   10-22 엔진 후속 ⑧-b: glm5_next_text(GLM-5.3-Flash — KDA 34층 + DSA 희소 MLA·라이트닝 인덱서 11층 + MoE + mHC)도 mhc. attnType 은 기존 'hybrid' —
     //   kvBytesPerTokenF16 = DSA 층의 MLA 잠재 K(kv_lora_rank + qk_rope_head_dim) × 2B + 인덱서 행(index_head_dim × 3 key|gate|pooled — llama.cpp 구현값) × 2B
     //   (docs/02 §2.2 — 19,712), KDA 순환 상태(≈ 153MB/시퀀스)는 미계상. arch.kvHeads·headDim 은 GGUF 표기(DSA 층 KV 헤드 1 × 잠재 512 — config 의 head_dim 0·
     //   num_key_value_heads 64 는 KDA 층 값이라 쓰지 않는다; sync-models 의 extractArch 도 같은 값을 읽는다). classifyArch(glm5_next_text 전용 분기 — 키 화이트리스트)가
     //   변환기·로더가 읽는 config 인지 본다.
     // indexerKPool (10-22 엔진 후속 ⑧-b 리뷰): 선택 정수 ≥ 2 — 라이트닝 인덱서 k-pool(config index_kpool, GGUF <arch>.attention.indexer.kpool — GLM-5.3-Flash 4).
     //   llama.cpp 가 k-pool 연산 그래프를 최악 크기(풀 수 = 셀 ÷ k-pool × n_seq_max)로 예약해 연산 버퍼가 슬롯 수에 비례한다(#29950) — 스니펫이 llama.cpp 명령에
     //   -np 1(LlamaCppPlan.singleSlot 'pool' — docs/02 §2.2)을 붙이고, 모델 허브는 어텐션을 '선형 + 희소 어텐션 층'(Attention.hybridSparse)으로 적는다.
     //   classifyArch(glm5NextArch)·add-model·계산기 HF 불러오기(buildHfModel)가 채운다. KDA 순환 상태(시퀀스마다)는 다른 상수 상태 층 하이브리드처럼 미계상이고
     //   그것만으로는 -np 1 을 붙이지 않는다(기존 하이브리드도 같다 — docs/02 §9)
     attnOverrides?:{kvBytesPerTokenF16, reason, sources[]},  // 비-full 전용, arch.kvBytesPerTokenF16과 일치(미러) — 존재 시 sync가 arch 자동 갱신 안 함 (§5.1)
     maxContext, license, moe:boolean, nonExpertGB?,   // MoE attention+shared GB (derive.ts 균등 bpw 유도) — 10-01 부터 행 실측(ModelQuant.nonExpertGB)이 우선, 이 값은 bpw 사다리 폴백
     category:('chat'|'coding'|'reasoning'|'vision')[] (min 1),
     korean?:boolean, popularity:1..5, hfDownloads30d?, hfDownloadsAsOf?, releasedAt, addedAt, note?, sources[] }
     // addedAt (10-14 D72): CanRun 카탈로그에 들어온 날(실제 있는 날짜 YYYY-MM-DD, 필수, releasedAt 이상 — zod; data/meta.json dataUpdated 이하 — 시드 테스트).
     //   add-model(신모델 자동 추가 ① 포함)이 추가한 날(UTC)로 채운다 — ① 이 연 PR 을 다음 날 이후 머지하면 ② 가 머지하는 날로 고친다(PROGRESS §3). 10-14 이전 44종은 models.json 에 그 id 가 처음 들어간 커밋 날짜로 백필.
     //   출처는 저장소 이력 자체라 sources 에 따로 적지 않는다. "업데이트 소식" 페이지(/updates)가 날짜별로 묶어 보인다. lite 카탈로그 키 아님
     // hfDownloads30d·hfDownloadsAsOf (10-06 D68): 원본 저장소(hfId)의 Hugging Face 최근 30일 다운로드 수(정수)와 그 기준일 — `https://huggingface.co/api/models/<hfId>` 의 downloads
     //   (게이트 저장소도 메타데이터는 토큰 없이 읽힌다). GGUF 저장소 다운로드는 들어 있지 않다. 둘 다 있거나 둘 다 없음, 값이 있으면 sources 에 HF 모델 URL 필수(zod refine —
     //   값마다 API URL 을 sources 에 늘리지 않는다). sync-models 가 매주 갱신(§5.1 ⑥), add-model 이 추가할 때 채운다. 계산기 "다운로드 많은 순" 정렬·카드 줄(lite 카탈로그 키)
     // popularity (1~5, 10-06 D68 리뷰에서 정의를 적음): CanRun 편집 값 — 로컬 실행에서 얼마나 널리 쓰이는지. add-model 이 원본 저장소 30일 다운로드로 처음 값을 넣고
     //   (hf.ts popularityFrom: 500만↑ 5 · 100만↑ 4 · 20만↑ 3 · 3만↑ 2 · 그 밖 1, `--popularity` 로 덮어쓰기), 사람이 조정한다 — 10-06 기준 43종 중 25종이
     //   다운로드 기준과 다르다(예: 한국어 모델 9종은 모두 높게, 한국어가 아닌 1~2B 급은 낮게, 널리 알려진 옛 모델은 높게). sync-models 는 바꾸지 않는다 — 최신 다운로드 그대로의 순서는 hfDownloads30d("다운로드 많은 순")가 따로 진다.
     //   쓰는 곳: 홈 인기 모델(4 이상), 계산기 인기순·추천순(같은 크기 구간 안에서). 화면 안내도 "다운로드 수만이 아니라 국내 사용도 함께 본 다섯 단계 점수"로 밝힌다
ModelQuant { modelId, quant:QuantId, fileGB, expertGB?, nonExpertGB?, valueExpertGB?, offGpuGB?, pleGB?, mtpGB?, loopGB?, ggufRepo, fileName?, sources[] }   // 실제 GGUF 크기 (decimal GB, 분할 합산)
     // expertGB·nonExpertGB (10-01 D56): GGUF 헤더 실측(scripts/gguf-header.ts), MoE 행 전용, 둘 다 있거나 둘 다 없음,
     //   0.75×fileGB ≤ expertGB + nonExpertGB ≤ fileGB + 0.02 (validateAll — 하한 10-03).
     //   expertGB = 트렁크 층의 `_exps`·`_chexps` 텐서 합(값 전문가 `attn_v_exps` 제외 — llama.cpp --n-cpu-moe 가 옮기는 FFN 전문가만, 10-21 D113). nonExpertGB = GPU 상주분(값 전문가 포함) — 입력층 제외(token_embd·per_layer_token_embd·position_embd·token_types,
     //   llama.cpp 는 입력층을 CPU 에 둔다, 출력층 없는 tied 모델은 token_embd 1회 포함), MTP·NextN 블록 제외(기본 로드 안 함). token_embd_norm 은 GPU.
     //   엔진 cpu-moe 배치·속도의 입력(docs/02 §3.3)이자 합이 full-gpu 의 그래픽카드 상주 가중치(docs/02 §2.4-1). sync-models 가 새 행·바뀐 파일만 다시 잰다(§5.1 ⑤)
     // valueExpertGB (10-21 D113): 값 전문가(MoVA attn_v_exps) GB — 같은 헤더 측정(classifySplit valueExpertGB)의 nonExpertGB 안 몫, 분할과 함께 · ≤ nonExpertGB(zod refine).
     //   모델 arch.valueExperts 인 모델의 행만, 그 모델 행은 모두 필수(validateAll). 배치는 비전문가 그대로, 엔진은 읽기 바이트에서만 valueExpertGB × (1 − valueTopK/valueExperts)
     //   를 뺀다(docs/02 §3.1). sync-models 는 이 모델의 새 행을 헤더 실측과 함께만 넣고(실패하면 manual 로 보류), 값 전문가 텐서가 없는 헤더는 다른 파일로 보고 보류한다.
     //   add-model 은 실측이 없는 행이 하나라도 있으면 쓰지 않는다. K2-Horizon MoVA Q4_K_M 4.25 / Q8_0 8.02
     // offGpuGB (10-03 D62): dense 행 전용 GGUF 헤더 실측 — 파일 바이트 − (전문가 + 비전문가) = 입력층·MTP 블록·헤더 메타데이터. dGPU full-gpu 필요량 = fileGB − offGpuGB.
     //   MoE 행은 fileGB − expertGB − nonExpertGB 로 같은 값을 유도하므로 두지 않는다(진실 원천 하나). 0 ≤ 값 ≤ 0.25×fileGB (validateAll, 카탈로그 최대 MiniCPM5-1B Q8_0 18%).
     //   절대값(gpuResidentGB) 대신 차분을 저장 — 파일이 다시 올라와 재측정이 실패해도 오차가 차분 크기로 묶인다. 없으면 파일 전체(보수 폴백). 임베딩 공유 모델은 ≈0.01(헤더만).
     //   층별 임베딩 표가 있는 행(10-21 D112)은 상한을 offGpuGB − pleGB 에 건다 — 표는 파일의 37~55%(Gemma 4 E 계열)
     // pleGB (10-21 D112): dense 행 전용 GGUF 헤더 실측 — 층별 임베딩 표 `per_layer_token_embd` GB(입력층이라 offGpuGB 안). offGpuGB 와 함께·≤ offGpuGB(zod),
     //   arch.ple 모델 행만(validateAll). 엔진은 토큰당 읽기 바이트·부분 오프로드 gpuFrac 분모에서 뺀다(docs/02 §3.1·§2.4-3, 토큰마다 한 줄만 읽는다),
     //   GPU 경로에 토큰당 고정 시간(PLE_TOKEN_OVERHEAD_MS, §3.1)을 더하고, dGPU full-gpu 는 이 행만 offGpuGB 가 사용 가능 시스템 RAM 에 들어가야 한다(§2.4-1). 콤보 분해 바는 이 몫을 시스템 RAM 막대로 보인다. lite 카탈로그 키.
     //   sync-models·add-model 이 offGpuGB 와 같은 측정에서 0 보다 클 때만 기록하고, 새 측정에 없으면 지운다(mtpGB 와 같은 규칙)
     // loopGB (10-22 D114): dense 반복 층 모델 행 전용 GGUF 헤더 실측 — 반복 블록 GB = 트렁크 `blk.N.*` 텐서 합(classifySplit blockGB — MTP 블록·입력층·출력층 제외).
     //   offGpuGB 와 함께 · ≤ fileGB − offGpuGB + 0.02(zod refine — 블록은 그래픽카드 상주 몫 안), arch.loops 모델 행만·그 모델의 헤더 실측 행은 모두 필수(validateAll).
     //   엔진은 토큰당 읽기 바이트·pp 실효 파라미터에 넣고(docs/02 §3.1·§3.5) 배치·VRAM 은 그대로 둔다. lite 카탈로그 키. sync-models·add-model 이 offGpuGB 와 같은 측정에서
     //   기록하고, 헤더 `<arch>.num_loops` 가 arch.loops 와 다르거나 없으면 그 측정을 보류한다(llama.cpp 가 다른 횟수로 돌리는 파일 — sync 는 manual, 새 행은 넣지 않음,
     //   add-model 은 쓰지 않음). 키는 offGpuGB(·pleGB) 바로 뒤. Nanbeige4.2 3B bartowski Q4_K_M 1.97 · IQ4_XS 1.75 · Q8_0 3.35 · Q2_K 1.26
     // mtpGB (10-03): MTP/NextN 블록 GB, 0 보다 클 때만 — 측정 행(offGpuGB 또는 분할)에만, GPU 밖 몫 + 0.02 이하(validateAll). 필요량에선 이미 빠져 있고
     //   분해 바·모델 허브 FAQ 가 "MTP 를 켜면 이만큼 + 그 KV 가 더 든다"고 안내한다(Qwen3.5/3.6·Qwen3.8·EXAONE 4.5 27행). 속도식(docs/02 §3.1)은 아직 안 씀
     // fileName (P1-2 D20, PROGRESS §4 09-29): repo 상대 실파일 경로 /^[^\s/][^\s]*\.gguf$/i — 분할이면 첫 조각 `…-00001-of-0000N.gguf`,
     //   UD 변형은 이름의 `UD-` 유지(플레인 파일이 없는 unsloth repo의 Q4_K_M 행 등). zod는 optional이지만 validateAll이 전 행 존재를
     //   강제(빌드가 호출), 값은 sync-models가 기록(§5.1 ④). 콤보 스니펫 `-hf {repo}:{tag}` 태그·다운로드 안내의 원천
     // 카탈로그 밖 모델(계산기 전용 — data/*.json 에 쓰지 않으므로 sources·zod 검증 대상 아님, 규칙 2 밖): 같은 코어 모양(ModelCore + ModelQuantCore[])을
     //   브라우저에서 조립해 고정 카드로만 쓴다. HF 불러오기 `buildHfModel`(hf.ts, D57 — 실파일 크기·fileName) · 직접 입력 `buildManualModel`
     //   (manual.ts, 10-03 D66 — fileGB = paramsB × bpw / 8 어림(Q2_K·IQ4_XS·Q4_K_M·Q8_0), ggufRepo '' · fileName 없음 → 명령 없음, nonExpertGB 는 derive.ts 유도,
     //   license 'unknown', 생각 모드 체크 시 thinking 'default-on'). 둘 다 이론 추정 고정(docs/02 §4)
PublishPlan (data/publish.json, 단일 객체 — P1-2 D9) { currentBatch:int ≥ 0,
     batches:[{ batch:int ≥ 1, gpuIds:GpuId[], modelIds:ModelId[], plannedAt?:date, note? }] }
     // 검증: 항목 안 id 중복 거부 · gpuIds/modelIds는 카탈로그 FK(validateAll) · batches가 비면 currentBatch 0만, 아니면 ≤ max(batch)
     // 콤보 배치 = 쌍을 포함하는 항목들의 최소 batch, indexable ⇔ batch ≤ currentBatch (`04` §3) — 조회 `packages/data/src/publish.ts`
QuantId = 'IQ2_M'|'Q2_K'|'IQ3_XS'|'Q3_K_M'|'IQ4_XS'|'Q4_K_M'|'Q5_K_M'|'Q6_K'|'Q8_0'|'MXFP4'|'UD-Q2_K_XL'|'UD-IQ2_M'|'F16'
QuantDef { id:QuantId, bpw, tier:'safe'|'ok'|'degraded'|'desperate', note }   // bpw = 엔진 QUANT_BPW (consistency 테스트)
BenchPoint { id, gpuId?|hardwareDesc?,   // 둘 중 하나 필수 (카탈로그 외 하드웨어는 hardwareDesc)
     modelId:string, quant:string,       // 자유 문자열 — 캘리브레이션 id(llama-2-7b)·실측 표기(Q4_0, Q4_K_XL) 허용
     backend:'llama.cpp'|'ollama'|'lm-studio'|'mlx'|'llamafile', backendVersion?,
     ctx, ppTokS?, tgTokS, flags?, sourceUrl:URL, sourceType:'official-thread'|'localscore'|'community'|'own',
     verified:boolean, measuredAt }
Alias { from, to }   // alias 경로 → canonical 301 (_redirects). 경로 /^\/[^\s?#]*$/ + 제어문자 거부 (build-redirects.ts와 동일)
Submission (P2, D1 — 미구현) { BenchPoint + submitterHash, ip rate-limit fields, status:'pending'|'approved'|'rejected'|'flagged' }
```

## 2. 시드: GPU (dgpu 32종 + 통합 10종, `data/gpus.json`)

값: VRAM GB / 대역폭 GB/s / FP16 TFLOPS / 출시가 / 실거래가(2026-08, DRAM 대란 반영). 출처: TechPowerUp DB·공식 스펙시트·MLQ/Tom's 가격 트래커 (원본 URL은 리서치 노트 `research/hardware.md` 참조, 각 레코드 sources에 복사).

| id | VRAM | BW | FP16 | MSRP | Street 26-08 | 비고 |
|---|---|---|---|---|---|---|
| rtx-pro-6000-blackwell | 96 | 1792 | 126 | — | — | 10-23 D120 — 전문가용(Workstation Edition 600W 만, NVIDIA 데이터시트 96GB GDDR7 ECC·512-bit·1792GB/s·FP32 126 TFLOPS — 제품 페이지 125). Max-Q Workstation Edition(300W, 같은 메모리·대역폭, FP32 110)은 카탈로그 밖(D120 리뷰 — 처음엔 별칭): 같은 주 빌드 공개 실측(#15396 b6199 vs b6205)에서 gpt-oss tg 0.87배·pp 0.82배라 이 레코드로 확정하지 않는다(별칭 없음 — 감지 none). dense tg 는 빌드가 다른 쌍뿐이지만 거의 같다(#15013). 별도 레코드는 사용자 결정. Server Edition(패시브 냉각·서버 전용)은 데스크톱 계산기 범위 밖. 출시가는 NVIDIA 미공개라 비움. 공개 실측 1건(#15013 Llama 2 7B b6392) — #15396 gpt-oss 2025-08 빌드 값은 지금 빌드보다 19~24% 낮아 넣지 않았다(docs/02 §9) |
| rtx-5090 | 32 | 1792 | 104.8 | $1,999 | ~$4,200 | |
| rtx-5080 | 16 | 960 | 56.3 | $999 | ~$1,256 | |
| rtx-5070-ti | 16 | 896 | 44.1 | $749 | ~$949 | |
| rtx-5070 | 12 | 672 | 30.9 | $549 | ~$629 | |
| rtx-5060-ti-16gb | 16 | 448 | 23.7 | $429 | ~$569 | 가성비 주력 |
| rtx-5060-ti-8gb | 8 | 448 | 23.7 | $379 | ~$429 | |
| rtx-5060 | 8 | 448 | 19.2 | $299 | ~$339 | |
| rtx-4090 | 24 | 1008 | 82.6 | $1,599 | ~$2,755 신품/~$2,400 중고 | |
| rtx-4080-super | 16 | 736 | 52.2 | $999 | 중고 | |
| rtx-4080 | 16 | 717 | 48.7 | $1,199 | 중고 | |
| rtx-4070-ti-super | 16 | 672 | 44.1 | $799 | 중고 | |
| rtx-4070-super | 12 | 504 | 35.5 | $599 | 중고 | |
| rtx-4070 | 12 | 504 | 29.1 | $599 | 중고 | |
| rtx-4060-ti-16gb | 16 | 288 | 22.1 | $499 | 중고 | 대역폭 협소 주의 |
| rtx-4060-ti-8gb | 8 | 288 | 22.1 | $399 | 중고 | |
| rtx-4060 | 8 | 272 | 15.1 | $299 | 중고 | 최다 검색 SKU |
| rtx-3090-ti | 24 | 1008 | 40.0 | $1,999 | 중고 | |
| rtx-3090 | 24 | 936 | 35.6 | $1,499 | ~$1,050 중고 | 중고 가성비 왕 |
| rtx-3080-12gb | 12 | 912 | 30.6 | $799 | 중고 | |
| rtx-3080-10gb | 10 | 760 | 29.8 | $699 | 중고 | |
| rtx-3070 | 8 | 448 | 20.3 | $499 | 중고 | |
| rtx-3060-12gb | 12 | 360 | 12.7 | $329 | ~$250 | 입문 기본값 |
| rtx-3050-8gb | 8 | 224 | 9.1 | $249 | 중고 | |
| rtx-2080-ti | 11 | 616 | 26.9 | $999 | 중고 | |
| gtx-1080-ti | 11 | 484 | FP16 크리플 | $699 | 중고 | cpu 폴백 판정 |
| rx-9070-xt | 16 | 645 | 97.3(peak) | $599 | ~$689 | tg 효율 우수 |
| rx-9070 | 16 | 645 | 72.3 | $549 | ~$639 | |
| rx-9060-xt-16gb | 16 | 322 | 51.3 | $349 | ~$449 | |
| rx-7900-xtx | 24 | 960 | 122.8 | $999 | 중고 | |
| rx-7900-xt | 20 | 800 | 103.0 | $899 | 중고 | |
| rx-7800-xt | 16 | 624 | 74.7 | $499 | 중고 | |
| arc-b580 | 12 | 456 | 27.3 | $249 | ~$250-330 | pp 약함 |
| **랩톱**: rtx-5090-laptop 24/896 · 5080-laptop 16/896 · 5070-ti-laptop 12/672 · 4090-laptop 16/576 · 4080-laptop 12/432 · 4070-laptop 8/256 · 4060-laptop 8/256 | | | | | | 데스크톱과 별개 SKU + 경고 배지 |

통합 메모리 (kind:'unified', usable = ram×0.7 — `usableGBByRam` 이 있는 기기는 그 값, 10-23 D117):

Apple 의 fp16Tflops: 애플이 밝히지 않아 위키백과 'Apple silicon' 표의 FP32 이론값(애플 GPU 는 FP16 이 FP32 와 같은 속도) — M4 3.76 · M4 Pro 8.08 · M4 Max 12.92/16.16 · M5 4.15 · M5 Pro 8.29 · M5 Max 13.27/16.59 · M5 Ultra 33.18 · M6 5.33 · M3 Ultra 28.26 · M2 Ultra 27.2 (10-16 D87 — 시드 값은 FP32×2).

| id | BW | RAM 구성 | 비고 |
|---|---|---|---|
| apple-m4 / m4-pro / m4-max | 120 / 273 / 410~546 | 16-32 / 24-64 / 36-128 | m4-max GPU 코어수로 BW 분기 |
| apple-m5 / m5-pro / m5-max | 153.6 / 307 / 460~614 | 12-32 / 24-64 / 36-128 | M5 Pro/Max 2026-03 출시 · `neuralAccelerators` (pp 계수 179 — 10-16 D86·D87) |
| apple-m5-ultra | 1228 | 96 / 256 | effClass 'apple-ultra' · 2026-09 출시(Mac Studio, 애플 사양 128107 — 64·80코어 GPU 모두 1.2TB/s). 512GB 는 애플이 10월 말 출시라 밝혀 출시 확인 후 추가 (10-16 D85) · `neuralAccelerators`(애플 뉴스룸 2026-08, 10-16 D86) |
| apple-m6 | 153.6 / 170.6 | 16 / 24-32 | 2026-09 출시(맥 미니만, 애플 사양 128108 — 16GB 153GB/s · 24·32GB 170GB/s → `memBandwidthByRam`). #4167 실측(32GB) tg −6.0% · `neuralAccelerators`(애플 뉴스룸 2026-08 "a Neural Accelerator in each core", #4167 pp512 실측이 계수 179 로 −3.5% — 10-20) |
| apple-m3-ultra / m2-ultra | 819 / 800 | 96-512 / 64-192 | effClass 'apple-ultra' |
| amd-strix-halo (Ryzen AI Max+ 395) | 256 | ~128 | Framework Desktop $1,999 |
| nvidia-dgx-spark | 273 | 64 / 128 | msrpUSD $3,999 = 2025-10-15 출시가(128GB). 64GB 는 OEM 전용(NVIDIA 제품 페이지·블로그 2026-10-02 — 10-23 판매 시작, 릴리스 노트 2026-10 "supports both 64 GB and 128 GB") · `usableGBByRam` 48.2 / 116.9(DGX OS 7.5.0 부팅 가용 120.55GB − 데스크톱 3.6GB, 64GB 는 같은 고정 몫 — docs/02 §2.3) · OEM 판 7종(ASUS Ascent GX10·Dell Pro Max with GB10·HP ZGX Nano G1n·Lenovo ThinkStation PGX·MSI EdgeXpert·Acer Veriton GN100·GIGABYTE AI TOP ATOM — 같은 GB10·273GB/s)은 aliases(레코드 하나 — D110 과 같은 이유) · popular. 2026-02 $4,699 인상(NVIDIA 포럼 공지)·64GB 시작가 $4,999 는 note 에만(실거래가 기준일 아님) — 10-23 D117 · `cluster` 최대 4대(케이블 직결 3대·4대는 스위치 — 케이블 플레이북의 수동 설정 전용 4대 링은 directMaxNodes 에 넣지 않았다, 2의 거듭제곱 권장)·200Gb/s ConnectX-7 — 허브·콤보 64·128GB × 2·4대 행, 계산기 1~4대(llama.cpp RPC 층 분할 — docs/02 §6.2, 10-23 D118) · `primaryRamGB` 128 — 모델 허브 행·콤보 페이지의 대표 구성(10-23 D120 사용자 결정, 64GB 판정은 '메모리 용량별 판정' 목록에) |
| cpu-ddr5-5600-2ch / ddr5-6000 / ddr4-3200 | 89.6 / 96 / 51.2 | — | CPU-only 프로필 |

주의 데이터(정기 확인): RTX 50 Super = **2027 연기(미출시)**, Intel B770 = 미출시, 가격은 `priceAsOf` 필수·주간 갱신.

## 3. 시드: 모델 카탈로그 (`data/models.json`, 1차 20종 ★ + 확장 후보)

KV = KiB/tok(f16). 파일 크기 = 실측 GGUF(decimal GB), 출처 repo 명기.

### 1차 20종 (Phase 1 콤보 생성 대상 — 2026-08 실사용 빈도 기준)
| id | params(act) | L/KV헤드/hd | KV KiB | ctx | Q4_K_M GB | 비고 |
|---|---|---|---|---|---|---|
| llama-3.1-8b ★ | 8.03 | 32/8/128 | 128 | 128k | 4.92 (bartowski) | 벤치 표준 |
| llama-3.3-70b ★ | 70.6 | 80/8/128 | 320 | 128k | 42.52 | |
| qwen3-8b ★ | 8.2 | 36/8/128 | 144 | 32k(YaRN128k) | 5.03 | |
| qwen3-14b ★ | 14.8 | 40/8/128 | 160 | 32k | 9.00 | |
| qwen3-32b ★ | 32.8 | 64/8/128 | 256 | 32k | 19.76 | |
| qwen3-30b-a3b-2507 ★ | 30.5(3.3) | 48/4/128·MoE | 96 | 256k | 18.6 | 소비자 MoE 표준 |
| qwen3.5-9b ★ | 9.65 | hybrid(8full/4/256) | 32+state | 256k | 5.87 (unsloth MTP) | 2026 신형 |
| qwen3.5-27b ★ | 27.78 | hybrid | low | 256k | 16.86 | |
| qwen3.5-35b-a3b ★ | 35.95(~3) | hybrid·MoE | 20+state | 256k | 22.63 | r/LocalLLaMA 기본픽(3.6 refresh 병기) |
| qwen3.5-122b-a10b | 125.1(10) | hybrid·MoE | low | 256k | 78.3 | 프로슈머 |
| gpt-oss-20b ★ | 20.9(3.6) | 24(12swa128)/8/64 | 24 | 128k | **MXFP4 12.11** (ggml-org) | 네이티브 quant |
| gpt-oss-120b ★ | 116.8(5.1) | 36(18swa)/8/64 | 36 | 128k | **MXFP4 63.39** | cpu-moe 대표 |
| gemma-3-12b ★ | 12.2 | 48/8/256·SWA | ~64 | 128k | 7.30 | |
| gemma-3-27b ★ | 27.4 | 62/16/128·SWA | ~80 | 128k | 16.55 | |
| gemma-4-12b ★ | 11.96 | SWA 5:1 | low | 256k | 7.12 (unsloth) | 2026 |
| gemma-4-26b-a4b | 26.54(~4) | SWA·MoE | low | 256k | 16.95(UD) | 구글 첫 오픈 MoE |
| phi-4 ★ | 14.7 | 40/10/128 | 200 | 16k | 9.05 (lmstudio) | |
| mistral-small-3.2-24b ★ | 23.6 | 40/8/128 | 160 | 128k | 14.33 | Magistral/Devstral 동형 |
| deepseek-r1-distill-32b ★ | 32.8 | 64/8/128 | 256 | 128k | 19.85 | 리즈닝 ×1.5 플래그 |
| deepseek-r1-distill-8b ★ | 8.03 | 32/8/128 | 128 | 128k | 4.92 | |

### 확장 후보(P1.5~P2에서 추가): llama-3.2-1b/3b(2.02GB), qwen3-4b-2507(2.50), qwen3.5-4b(2.83), gemma-3-4b(2.49), phi-4-mini(2.49), qwen3-coder-30b-a3b, glm-4.5-air(106B/12B, UD-Q4 67.7), llama-4-scout(109/17, 65.4), mistral-small-4-119b-a6.5b(73.8, **KV 576 KiB 주의 — MHA 32 kv헤드**), deepseek-v4-flash(284/13, UD-Q4 155, DSA), qwen3-235b-a22b(142), glm-4.6(216), minimax-m3(427/23, 264), kimi-k2.6(1T/32B, 584), kimi-k3(2.78T/104B, 1510)

### 한국 모델 (ko 차별화 — **P0-4b 완료, 시드 9종 등재**)
| 후보 | 상태 |
|---|---|
| EXAONE 4.0(32B/1.2B)·4.5-33B, Kanana 1.5(8B/15.7B-A3B), HyperCLOVA X SEED(1.5B/Think 14B), Solar Open(100B/Open 2 250B) | 시드 등재 완료(`korean: true`) — config·GGUF 실측은 research/models.md §1G. ko 페이지 우선 노출, en에도 포함(글로벌에 없는 콘텐츠 = 백링크 유인) |

### quant 목록(콤보 페이지당 표시): Q2_K(UD-XL 표기)·IQ3_XS·Q3_K_M·IQ4_XS·Q4_K_M(기본)·Q5_K_M·Q6_K·Q8_0 + 모델 네이티브(MXFP4 등). bpw 표는 `02-engine-spec.md` §2.1.

## 4. 시드: 캘리브레이션 실측 (`data/benchmarks.json`, 발췌 — 전체 ~70점은 research/hardware.md에서 이관)

| HW | 모델·quant | ctx | pp | tg | 출처 |
|---|---|---|---|---|---|
| RTX 5090 | L2-7B Q4_0 | 짧음 | 14,073 | 290.0 | llama.cpp 공식 #15013 |
| RTX 4090 | 〃 | 〃 | 11,993 | 186.2 | 〃 |
| RTX 3090 | 〃 | 〃 | 5,175 | 158.2 | 〃 |
| RTX 3060 | 〃 | 〃 | 2,138 | 75.6 | 〃 |
| RTX 5090/4090/3090 | Qwen3-8B Q4 | 16k | — | 145.3/104.3/87.5 | hardware-corner llama-bench |
| RTX 5090/4090/3090 | Qwen3-30B-A3B Q4 | 16k | — | 141.6/139.7/113.8 | 〃 |
| RTX 4090 | gpt-oss-20b MXFP4 | 2k | 8,078 | 225.2 | llama.cpp #15396 (10-15 D81 — 제출 댓글 b6210 ub 4096 줄) |
| RTX 5060 Ti 16GB | 〃 | 2k | 3,821 | 111.6 | 〃 |
| RTX 4060 | L3.1-8B Q4_K_M | 가중 | 1,528 | 38.1 | LocalScore acc/137 |
| RTX 3060 12GB | Qwen2.5-14B Q4_K_M | 가중 | 753 | 26.4 | LocalScore acc/43 |
| M4 Max 40c | L2-7B Q4_0 | 짧음 | 886 | 83.1 | llama.cpp #4167 (b1550 — 2023 기준 빌드. 10-15 D83 에 계수 근거에서 뺐다, flags 에 빌드 표기) |
| M5 Max 40c / M5 Pro / M5 | L2-7B Q4_0 | 짧음 | 3,220 / 1,340 / 723 | 119.9 / 67.6 / 31.9 | #4167 지금 빌드 b10621·b11046 (10-15 D83 — apple dense 계수 근거) |
| M2 Ultra 76c | L2-7B Q4_0 | 짧음 | 1,489 | 125.2 | #4167 본문 빌드별 표 c1d0e7a00+FA (10-15 D83 — 같은 기기 b1550 94.3) |
| M3 Ultra | gpt-oss-20b | 2k | 2,816 | 115.5 | #15396 |
| M4 Max 32c (36GB) | gpt-oss-20b | 2k | 1,277 | 92.4 | #15396 원글 b6123 (10-15 D81 — 옛 레코드는 40코어에 붙어 있었다) |
| M3 Max 128GB | L3.3-70B Q4_K_M | — | — | 9.8 | Ollama 실측 블로그 |
| Strix Halo | gpt-oss-120b MXFP4 | 짧음 | 707 | 50.2 | quozul.dev ROCm 7.0.2 (10-15 D80 — pp512/tg128) |
| DGX Spark | gpt-oss-120b | 2k | 2,444 | 58.7 | llama.cpp 개발진 결과 파일 b7941 (10-15 D79 — 옛 1,717/~35 는 출처와 맞지 않았다) |
| 2×RTX 3090 | L3-70B Q4_K_M | — | ~85 | 14~16 | compute-market |
| CPU DDR5-5600 | Mistral-7B Q4_K_M | — | — | 11.2 | llamafile #450 |
| CPU DDR5-5600 | Qwen3-30B-A3B Q4 | — | — | 18~20 | hardware-corner |
| RTX 3060 12GB+DDR5 | Qwen3.6-35B-A3B (cpu-moe) | — | — | 51~53 | openclawdc 2026-07 |

## 5. 데이터 파이프라인 (`scripts/`)

### 5.1 `sync-models.ts` (주 1회 + 신모델 수시, GitHub Actions)
1. 후보 GGUF repo(bartowski, unsloth, lmstudio-community, ggml-org) HF API `GET /api/models/{repo}/tree/main` → quant별 실제 파일 크기 갱신 (분할 파일 합산).
2. 원본 repo `config.json` fetch → layers/kv_heads/head_dim/ctx → `kvBytesPerTokenF16` 재계산. 하이브리드/SWA/MLA는 `attnOverrides` 수동 필드 우선(자동 추출 불가 케이스). 새 모델 추가(`add-model`)는 같은 config 로 `classifyArch` 가 보정값을 계산해 `attnOverrides` 를 쓴다 — 10-03 D63 부터 상수 상태 층 하이브리드(Mamba2·short-conv·KDA+MLA)도 층 지도가 있으면 계산하고, 산식 근거(llama.cpp 소스 URL)를 `attnOverrides.sources` 에 config 와 함께 남긴다(docs/02 §2.2).
3. diff 있으면 PR 자동 생성(리뷰 후 머지·배포 — 리포트 SUSPICIOUS·ERROR 0이면 Claude가 위임 처리, 그 외는 사람 승인. `docs/PROGRESS.md` §3) — 데이터 조작 방지 + 리뷰 기록.
4. **`fileName` 기록(P1-2 D20)**: quant별로 매칭된 파일의 repo 상대 경로를 `fileName`에 기록(1의 크기 갱신과 같은 매칭 결과). **드래프트 파일은 제외** — basename 접두 `mmproj-`·`mtp-`·`eagle3-`·`dflash-`(10-20)·`dspark-`(10-22 D115 — DeepSeek V4 DSpark 초안. 빼지 않으면 ggml-org V4 저장소의 MXFP4 행이 ambiguous match)는 매칭·크기 합산 모두에서 뺀다(llama.cpp `-hf` 도 같은 접두를 보조 파일로 본다)(gemma-4 MTP/EAGLE 드래프트가 fileGB에 합산되던 버그 교정 — repo 이름의 `MTP`는 무관). **파일 이름 별칭(10-22 엔진 후속 ⑧-b — `packages/data/src/quant-alias.ts`)**: 정확한 `Q4_K_M` 파일(플레인·UD)이 하나도 없을 때만 플레인 `Q4_K` 토큰(뒤 경계 `-`·`.`)의 파일을 Q4_K_M 행으로 받는다 — llama-quantize 의 `Q4_K` 는 Q4_K_M 의 별칭이라 같은 ftype 15 를 쓴다(ggml-org/GLM-5.3-Flash-GGUF 의 `GLM-5.3-Flash-Q4_K-0000N-of-00002.gguf`). 별칭으로 잡은 행은 헤더 `general.file_type` 이 15 여야 기록한다(add-model 은 중단, sync-models 재측정은 보류 — 계산기 HF 불러오기도 별칭 기준 행은 dense 여도 헤더를 읽어 대조하고, 다르면 그 파일을 빼고 기준 행을 다시 고른다. 헤더를 못 읽으면 이름대로 둔다 — `apps/web/lib/calc/hf-load.ts`, 10-22 ⑧-b 리뷰), 실행 명령의 `-hf` 태그는 파일의 실제 토큰(`:Q4_K` — llama.cpp `-hf` 는 태그 + `[.-]` 로 파일을 찾는다). 정확한 Q4_K_M 이 있으면 별칭은 쓰지 않아 기존 행은 바뀌지 않는다(10-22 sync 전체 드라이런으로 확인). 단일 파일이거나 일관된 분할 세트(`-0000N-of-0000M`, 첫 조각을 기록)가 아니면 `error`(ambiguous match)로 리포트하고 반영하지 않는다. 레코드 키 순서는 `ggufRepo` 뒤에 `fileName`(한 레코드 한 줄 직렬화 유지).
5. **행별 헤더 재측정(10-01 D56 MoE 분할 → 10-03 D62 dense 까지)**: 실측 값이 없거나 이번 동기화에서 fileGB·fileName 이 바뀐 행, 새 양자화 행의 GGUF 헤더를 Range 로 읽어(파일당 4~16MB, 분할은 조각마다) 다시 잰다. MoE 행은 리포트 field `split`(`expertGB`·`nonExpertGB`), dense 행은 field `offgpu`(`offGpuGB`), 둘 다 MTP 블록이 있으면 `mtpGB` 를 함께 기록한다(키는 fileGB 바로 뒤, 새 측정에 MTP 가 없으면 옛 `mtpGB` 삭제). 값이 없던 행의 측정 실패는 manual(다음 동기화 재시도 — 그동안 그 행은 파일 전체로 판정, 보수). **값이 있던 행의 파일이 바뀌었는데 재측정이 실패·보류되면 suspicious**(옛 값이 남으므로 위임 머지를 멈춤). 보류 조건: 측정한 파일 크기(Content-Range)가 fileGB 와 0.02 넘게 다름, MoE 분할 합 > fileGB + 0.02 또는 < 0.75×fileGB, dense offGpuGB − pleGB > 0.25×fileGB(층별 임베딩 표는 상한 밖 — 10-21 D112) — 다른 파일을 잰 것. dense 행의 층별 임베딩 표는 같은 측정의 `pleGB` 로 offGpuGB 뒤에 기록한다. 반복 층 모델(arch.loops — 10-22 D114)의 dense 행은 같은 측정의 트렁크 블록 합을 `loopGB` 로 기록하고, 헤더 `<arch>.num_loops` 가 arch.loops 와 다르거나 없으면 보류한다(새 행은 이 측정과 함께만 넣는다 — `holdUnmeasuredRows`). config 의 experts/topK·num_loops 변화는 manual. 첫 채움(10-03)은 일반 sync 와 섞지 않은 대상 한정 백필(트리·config 미조회, 같은 `planSplitChanges`·`applyChanges`)로 130행 auto·suspicious 0 — scratch 실측표와 ±0.01 일치.

6. **다운로드 수(10-06 D68)**: 원본 repo 마다 `GET /api/models/{hfId}` 의 `downloads`(최근 30일)를 다시 읽어 `hfDownloads30d`·`hfDownloadsAsOf`(실행일)를 Δ 임계 없이 쓴다(키는 `popularity` 바로 뒤). 리포트에는 모델별 행 없이 요약 한 줄("다운로드 수(원본 저장소 최근 30일) N종 갱신, 기준일 …")만 — 위임 머지 기준(SUSPICIOUS·ERROR 0)과 무관. 읽기 실패한 모델은 기존 값·기준일 유지 + 같은 줄에 실패 수(ERROR 아님). sources 에 HF 모델 URL(`https://huggingface.co/<hfId>`)이 없는 모델(손으로 쓴 레코드)은 값을 쓰지 않고 같은 줄에 "건너뜀"으로 적는다 — 그대로 쓰면 refine 이 쓰기 전 자가검증을 터뜨려 그 주 동기화 전체가 멈춘다(10-06 리뷰 반영). 다운로드 수만 바뀐 동기화는 `data/meta.json` 기준일을 올리지 않는다(페이지 내용이 그대로인데 사이트맵 lastmod·푸터 기준일이 매주 바뀌지 않게 — 다운로드 기준일은 `hfDownloadsAsOf`).

### 5.2 `new-model-alert.ts` (출시 전 주 1회 → P1-5 출시부터 일 1회): HF trending + 지정 org 신규 릴리스 감지(`text-generation`·`image-text-to-text`) → 카탈로그·기보고·리팩(추측 디코딩 드래프트 dflash·dspark, 공식 형식 변형 fp4·mxfp4·onnx 포함)·OCR 전용·타 org 파생 제외 → 새 후보가 있으면 요약 GitHub issue 1건 생성("48h 내 페이지" SLA는 출시 후 — `04-seo-content-plan.md` §8). 탐지 함수(`fetchDetectionSources`·`filterCandidates`)는 §5.3 자동 추가가 같이 쓴다.

### 5.3 `auto-add-models.ts` — 신모델 자동 추가 ① (10-06 D71, 매일 — `.github/workflows/new-model-add.yml`, New model alert 다음)
역할 분담: **①(GitHub Actions, 무료)** 이 후보를 골라 `add-model` 로 레코드를 만들고 추정값을 채워 검사를 통과하면 PR 을 연다 — 자동 머지·main 푸시는 하지 않는다. **②(Claude 클라우드 정기 작업, 매일 12:00 KST — PC 와 무관하게 돈다. 예비로 데스크톱 예약 작업 `canrun-new-model-review` 가 매일 18:00 KST 에 클라우드가 남긴 일만 마저 한다 — 10-08)** 가 PR 의 추정값을 모델 카드와 대조해 고치고 전체 검사 통과 시 머지한다(CLAUDE.md 위임, `docs/PROGRESS.md` §3). ① 의 PR 은 실제로 09:10~11:30 KST 쯤 생긴다 — 알림 cron(06:30 KST)이 GitHub 쪽에서 2.5~4.3시간 늦게 시작하고(10-01~06 실측), 그 뒤 탐지·후보별 검사·build 가 이어진다. 그래서 ② 는 12:00 에 돌고, 오늘 ① 런이 아직 돌고 있으면 끝날 때까지 기다린다.
1. **후보**: §5.2 와 같은 탐지 함수 — 조회 org 는 감시 org ∪ 아래 허용 목록 ∪ 카탈로그 제작사, org 릴리스 창 14일. 최근 14일 안에 생성됐고(trending 포함) 카탈로그·스킵 목록에 없는 것. 이슈 이력의 기보고 제외는 쓰지 않는다 — 매일 다시 평가한다(출시 직후 다운로드가 적던 모델이 며칠 뒤 기준을 넘을 수 있다).
2. **선별 기준**(정책 상수 — 코드 주석 `// source: docs/03 §5.3 (policy)`): ① 공식 제작사 허용 목록(`OFFICIAL_ORGS` — Qwen·meta-llama·google·mistralai·microsoft·openai·nvidia·deepseek-ai·ibm-granite·LGAI-EXAONE·naver-hyperclovax·kakaocorp·upstage·skt·K-intelligence·trillionlabs·Motif-Technologies·LiquidAI·inclusionAI·allenai·CohereLabs·moonshotai·zai-org·MiniMaxAI·tencent·baidu·HuggingFaceTB·tiiuae·stepfun-ai, 10-06 HF API 로 표기 확인 + 카탈로그 hfId 제작사) **또는** 최근 30일 다운로드 ≥ 20,000(`AUTO_MIN_DOWNLOADS`) ② 드래프트(태그 `draft-model`·`speculative-decoding`)·Base(이름에 Base — 단 `-Base-Instruct` 처럼 Instruct·Chat·it 이 같이 있으면 대화용, 또는 같은 org 에 `<이름>-Instruct`·`-it`·`-Chat` 짝이 있음)·용도 특화(이름에 화자 분리·guard·safety·reward·embed·rerank·ASR·TTS·시계열 등)는 넣지 않고 "확인 필요". 학습 중간 단계·교사 모델(이름에 SFT·DPO·Midtrain·Pretrain·pt·Teacher·Checkpoint·Intermediate)은 시도하지 않고 보고서에 한 줄로만. 공식 org 의 형식 변형(fp4·mxfp4·onnx)은 §5.2 리팩 패턴이 거른다(10-06 리뷰) ③ add-model 구조 분류가 보류가 아니고 Q4_K_M GGUF 가 있으며 라이선스가 배지 맵(`license.ts`)에 있을 것 ④ 한 번에 최대 3종(`AUTO_MAX_ADD`, 30일 다운로드 → likes 큰 순), 시도는 최대 8번(`AUTO_MAX_ATTEMPTS`) — 남은 후보는 다음 날.
3. **자동 추정**(add-model 옵션으로 넘기고 PR 본문에 근거와 함께 "추정"으로 표시): **생각 모드** — 채팅 템플릿(`chat_template.jinja` → `tokenizer_config.json` 의 `chat_template`, 게이트 저장소는 unsloth 미러)에서 enable_thinking 기본값(`| default(…)`·`… else True|False`, 없으면 "끄라고 할 때만 끈다" = default-on / "켜라고 할 때만 켠다" = default-off) → reasoning_effort(생각 블록을 비우는 분기가 없으면 always, 있으면 default-on) → 템플릿 변수 `thinking`(`{% if not thinking %}` — `set thinking = true|false` 가 기본값, 없으면 넘기지 않을 때 꺼짐 = default-off: DeepSeek-V3.1·V3.2, Granite 3.3). 단 `thinking` 이 없을 때 `enable_thinking` 을 따르는 꼴(`if enable_thinking is defined` → `set thinking = enable_thinking` — llama.cpp 가 GGUF 에 넣는 DeepSeek V3.1·V3.2·V4 템플릿, models/templates/deepseek-ai-*.jinja)은 enable_thinking 분기에서 default-on + 확인 필요가 나온다. llama-server 는 생각을 지원하는 템플릿에 enable_thinking 을 늘 넘기고 기본으로 켠다(`--reasoning` 기본 auto — https://github.com/ggml-org/llama.cpp/blob/0a1ef309cdbb9f2024f58a38fb4c42352c5db569/tools/server/server-context.cpp#L1686-L1687 · common/chat.cpp#L892, V3.2·V4 처리기는 생각 지원 — common/parsers/deepseek.cpp#L118). 그래서 이 꼴이고 카드가 기본 방식을 밝히지 않으면 default-on 으로 둔다(DeepSeek V4 Flash 0731 — 분할 파일이라 llama.cpp 명령만 낸다, 10-22 D115 리뷰). 카탈로그의 다른 default-off 모델이 llama-server 에서도 기본으로 꺼지는지는 확인하지 않았다 — 카드·템플릿 기본값을 그대로 둔다(판정은 생각 모드 유무만 본다) → 응답 시작에 `<think>`·`<thought>`(EXAONE Deep)·`[THINK]` 를 열어 두면 always, 표지(`/no_think` 포함)만 있으면 default-on + 확인 필요 → 표지 없음은 이름(think·reason·R1 → default-on + 확인 필요) → **모델 카드(README)**: non-thinking 전용이라고 밝히면 없음, `thinking mode`·`reasoning model`·`slow-thinking`·`hybrid reasoning`·`<think>` 같은 표현이 있으면 default-on + 확인 필요(Hunyuan·MiniMax-M1 은 템플릿에 표지가 없다), 둘 다 없으면 없음. 템플릿이나 카드를 못 받으면 확인 필요. 확실하지 않으면 **최선의 값을 넣고 "확인 필요"** 를 단다 — 판정은 생각 모드가 있는지만 본다(×1.5, D59)라 미지정이 더 위험하다(생각하는 모델을 낙관적으로 판정). 맞춰 본 결과(10-06 리뷰 반영 후): 카탈로그 43종은 확정 36종 모두 카탈로그와 같고 7종이 확인 필요(그중 MiniCPM5 2종·HCX SEED Think 는 실제로 auto), 다른 공식 모델 44종(템플릿·카드)은 확정 31종 모두 맞고 생각 모델 13종은 값이 들어간 채 확인 필요 — 생각하는 모델이 "없음(확정)"으로 나오는 경우는 0. **용도** — chat 기본 + 이름·태그 code/coder → coding, image-text-to-text·vision 태그 또는 config 비전 인코더 → vision, always → reasoning. 용도 추정은 카탈로그 관례와 약 절반(43종 중 23종)이 다르다 — 범용 대형 모델의 coding, 생각 모드가 있는 모델의 reasoning 은 ② 가 카드 기준으로 정한다(보고서는 용도를 늘 "⚠확인 필요"로 표시). **한국어** — 한국 제작사 org(`KOREAN_ORGS`) → korean. 표시 이름·인기도·최대 컨텍스트는 add-model 기본값(②가 카드와 대조).
4. **검사**: 후보를 하나씩 add-model 함수(`planAddition`·`applyAddition`)로 추가 → `pnpm validate-data` → 공유 카드 글꼴 테스트가 새 글자로 실패하면 `scripts/og-font.ts` 로 다시 받음 → `pnpm test`. 깨지면 그 후보가 쓴 파일만 되돌리고 "확인 필요(검사 실패)". 마지막에 `pnpm build`·`pnpm run test:export` 한 번 — 실패하면 PR 없이 보고서를 그날 요약 이슈에 코멘트하고 런을 실패로 남긴다.
5. **PR(②와의 계약 — 이름을 바꾸지 않는다)**: 브랜치 `data/new-models`(매 실행 main 에서 다시 만든다 — 열린 PR 은 갱신. 단 열린 PR 에 ① 이 아닌 커밋, 곧 제목이 `feat(catalog): 신모델 자동 추가` 로 시작하지 않는 커밋(② 의 수정·스킵 목록·main 병합)이 있으면 브랜치를 덮어쓰지 않고 그날 보고서를 그 PR 에 코멘트한다 — create-pull-request 는 브랜치를 리셋해 강제 푸시하므로 ② 의 수정이 지워지기 때문, 10-06 리뷰. ② 는 그 PR 을 머지하거나 닫아서 끝낸다), 라벨 `new-model-add`, 제목 `feat(catalog): 신모델 자동 추가 (YYYY-MM-DD)`, 본문 = 보고서(추가한 모델 표: hfId·구조·기준 GGUF·파라미터·추정값과 근거·add-model 경고 → "② 가 확인할 것" → "확인 필요" 표 → 마커 `<!-- new-model-add: <hfId,…> -->`). 커밋 경로 `data/*.json`·`packages/data/src/index.ts`(MoE `MOE_ARCH`)·`apps/web/content/model-makers.ts`(처음 보는 개발 조직 이름 — add-model 이 Hugging Face 조직 정보의 fullname 으로 한 줄 넣는다, 10-19 D101)·`apps/web/assets/og/*`. 추가가 0 이면 PR 없이 요약 이슈에 코멘트. GITHUB_TOKEN 이 만든 PR 이라 CI job 이 돌지 않는다(§5.1 data-sync 와 같음) — ② 가 close→reopen 으로 CI 를 본 뒤 머지. **data-sync PR 과의 충돌**: 두 PR 은 `data/models.json`(레코드당 1줄이라 끝에 레코드를 더하면 기존 마지막 줄에 쉼표가 붙고, data-sync 는 매주 거의 모든 줄의 다운로드 수를 다시 쓴다)·`data/meta.json` 에서 반드시 충돌한다. 한쪽을 머지하면 다른 쪽은 그 워크플로를 다시 돌려 main 기준으로 다시 만든다 — 신모델 PR 을 먼저 머지했으면 `gh workflow run data-sync.yml`, data-sync PR 을 먼저 머지했으면 신모델 PR 은 다음 날 ① 이 새로 만든다(② 가 그날 처리하려면 ② 의 커밋이 없는 PR 일 때 `gh workflow run new-model-add.yml`, 있으면 PR 을 닫고 다시 돌린 뒤 고친 값을 다시 넣는다).
6. **스킵 목록** `scripts/new-model-skips.json` — `[{ "hfId", "decision": "skip" | "wait", "reason", "decidedAt" }]`(zod `NewModelSkipSchema`, 테스트가 검증). ① 은 여기 있는 hfId 를 후보에서 빼고(형식 변형 접미 `-BF16`·`-FP8`·`-fp4`·`-onnx` 등을 뗀 이름으로 맞춘다 — `GLM-5.3-Flash` 한 줄이 `GLM-5.3-Flash-BF16` 도 막는다), ② 가 "넣지 않음·대기" 판단을 여기에 적는다. **"확인 필요" 표에서 계속 안 될 후보(보류 구조·GGUF 없음·처음 보는 라이선스 등)도 ② 가 wait·skip 으로 적는다** — 실패한 시도도 하루 시도 상한(8번)을 쓰고 출시 14일 동안 매일 다시 시도하므로, 적지 않으면 그 뒤의 새 모델이 밀린다. 적는 곳은 그날 열린 신모델 PR 이 있으면 그 브랜치, 없으면 main(전체 게이트 통과 후 커밋 — CLAUDE.md 위임 "게이트 통과한 태스크 커밋"). 사이트에 나가는 데이터가 아니라 운영 메모라 `data/` 밖에 둔다(sources[] 규칙 대상 아님). 첫 내용 = `docs/PROGRESS.md` §2 「카탈로그 확장」의 엔진 후속 대기 4·llama.cpp 본선 대기 4·제외 3.
7. **모델 소개(10-19 D102)**: 모델 허브 맨 위 "어떤 모델인가요" 한 문단(`apps/web/content/{en,ko}/model-about/<id>.mdx`, 규칙 `apps/web/content/AUTHORING.md` §11)은 ① 이 만들지 않는다 — **② 가 머지하는 모델마다 쓴다**. ① 의 추정값을 대조하며 읽은 모델 카드(와 출시 글)로 en·ko 를 따로 쓰고, 레지스트리 `apps/web/content/model-about.ts` 에 `'<id>': '<머지하는 날 UTC>'` 한 줄, 로더 맵 `apps/web/lib/model-about.ts` 에 en·ko import 두 줄을 넣어 같은 브랜치에 커밋한다(커밋 제목은 위 5 처럼 `feat(catalog): 신모델 자동 추가` 로 시작하지 않게 — 예: `docs(model-about): <모델> 소개`). 전체 검사(`pnpm test` 의 `model-about.test.ts` — 대칭·분량·합니다체·첫 출처 = 그 모델의 HF 카드)를 통과해야 머지한다. 모델 카드를 읽지 못한 날은 소개 없이 머지해도 된다 — 소개가 없는 모델은 같은 테스트가 실패 없이 목록으로 알리고(출력 `[model-about] N catalog model(s) without an about text`), 다음 ② 실행(예비 18:00 실행 포함)이 main 에 따로 커밋으로 쓴다(전체 게이트 통과 후 — CLAUDE.md 위임 "게이트 통과한 태스크 커밋"). 카탈로그 전 모델을 요구하는 검사는 두지 않는다 — ① 의 후보별 `pnpm test` 가 새 모델마다 실패하게 되기 때문이다.

### 5.4 가격 (`prices.json`): 주간 수동/반자동(정찰 소스: 아마존 표시가, 다나와 최저가). `priceAsOf` 없는 가격 표시 금지. TechPowerUp 등 DB **통째 스크래핑 금지**(개별 사실 확인·출처 기재만) — 법적 리스크 정책.

## 6. 자체 실측 프로토콜 (리그: RTX 5060 Ti 16GB + RAM 16GB, "own" sourceType)

> 전략: 하이엔드(5090/4090) 캘리브레이션은 공개 실측이 풍부해 §4 시드에 이미 포함 — 자체 리그는 **구매 수요가 가장 큰 16GB 미드레인지 세그먼트 + 신모델 48h 실측**을 커버한다(P1·P3 타깃 페르소나와 정확히 일치). 하이엔드 스팟 검증이 필요하면 클라우드 렌트(RunPod 등 5090 ~$1/h × 1~2h)로 충분하며, 렌트 경험 자체가 "못 돌리면 빌리기" CTA의 1차 콘텐츠가 된다. (선택) RAM 64GB 증설 시 gpt-oss-120b·GLM-4.5-Air cpu-moe 측정이 열리지만 2026 DRAM 대란 가격을 감안해 필수 아님.
표준 커맨드(제출 가이드 페이지에도 동일 게재):
```
llama-bench -m {model.gguf} -p 512,2048 -n 128 -ngl 99 -fa 1        # 기본
llama-bench -m {model.gguf} -p 2048 -n 128 -d 8192,16384             # 컨텍스트 감쇠 측정
# MoE cpu-moe: llama-bench -m {model} -ngl 99 --n-cpu-moe {N} …
기록: GPU/드라이버, llama.cpp 빌드 해시, ctx, 플래그, 전력 제한 여부
```
1차 측정 매트릭스 (VRAM 16GB·RAM 16GB 기준, 목표 ≥30행 — A그룹만으로 충족 가능):
- **A. 풀 오프로드 dense**: llama-3.1-8b·qwen3-8b·qwen3.5-9b(MTP)·r1-distill-8b {Q4_K_M, Q8_0} / qwen3-14b·phi-4·gemma-3-12b·gemma-4-12b {Q4_K_M, Q6_K} / mistral-small-3.2 {IQ4_XS 기본; Q4_K_M(14.33GB)은 KV q8_0·4k 조건부} / gemma-3-27b {IQ3_XS·Q3_K_M} / qwen3-32b {Q2_K} — 각 ctx {2k, 16k}
- **B. MoE (16GB 카드의 킬러 콘텐츠)**: gpt-oss-20b MXFP4(풀 GPU, 공개 실측 111.6 tok/s 재현 대조) / qwen3-30b-a3b-2507 Q4_K_M(`--n-cpu-moe` 최소 스필 ~4GB) / qwen3.5-35b-a3b Q4_K_M(스필 ~9GB — RAM 16GB에선 저ctx 조건부, **실패해도 그 기록이 데이터**)
- **C. 교육용 절벽 데모**: qwen3-32b Q4_K_M `-ngl` 스윕(부분 오프로드 감속 곡선) + KV f16 vs q8_0 비교 1종
- **D. 불가 판정 실증**: llama-3.3-70b Q4_K_M — "안 됨"을 실측으로 못박는 콤보 페이지용
- **E. 한국 모델 5종 (ko 차별화 — 글로벌에 공개 실측 전무 = 백링크 유인, P0-4b 시드)**: kanana-1.5-8b {Q4_K_M, Q8_0} / hyperclovax-seed-think-14b Q4_K_M(단일 배포, 리즈닝 — 감쇠 측정 포함) / kanana-1.5-15.7b-a3b Q4_K_M(10.44GB — 16GB 풀 GPU MoE) / hyperclovax-seed-1.5b Q8_0(온디바이스급 대조) / exaone-4.5-33b IQ4_XS(18.03GB — `-ngl` 부분 오프로드, C그룹 절벽 곡선과 교차 검증) — 각 ctx {2k, 16k}
→ 출시 시 16GB 세그먼트에 "실측 배지" 달린 페이지 확보.

## 7. 갱신 케이던스 요약
| 데이터 | 주기 | 방법 |
|---|---|---|
| 모델 파일 크기·신모델 | 주 1회 + 알림 시 즉시 | 파이프라인 PR |
| 신모델 레코드 | 매일 | 자동 추가 PR(①) → Claude 정기 작업(②) 검토·머지 (§5.3, D71) |
| 모델 HF 다운로드 수(최근 30일) | 주 1회 | 파이프라인 PR (자동 반영, 리포트 요약 한 줄 — D68) |
| GPU 신제품 | 발표 시 | 수동 (Super/B770 등 미출시 rumor는 절대 미등록) |
| 가격 | 주 1회 | 반자동 + priceAsOf |
| 효율 계수 | P2부터 주 1회 배치 | 제출 실측 n≥3 조합만 override |
| 환율(ko 표기) | 주 1회 | 공개 API |
