# 04. SEO·콘텐츠 플랜 (en + ko 동시)

> 전제(리서치 확정): ①구글은 2026에도 "스케일드 콘텐츠"를 코어 업데이트마다 상시 단속 — **살아남는 pSEO = 실데이터 기반 도구 페이지**(PCPartPicker +10.6% MoM vs 텍스트 비교 사이트 하락). ②AI Overviews로 정보성 CTR -47~-58% — **계산기가 곧 방어**. ③번역-만-한 페이지는 스팸 정책에 명시 — ko는 로컬라이즈. ④네이버는 SSR 풀 HTML 필수.

## 1. 키워드 유니버스와 우선순위

| 티어 | 패턴 | 예 | 대응 페이지 |
|---|---|---|---|
| T1 (구매·도구, 전환↑) | best gpu for local llm 2026 / {model} hardware requirements / 로컬 llm 사양·GPU 추천 | "gpt-oss-120b requirements" | 모델 허브 + 가이드 |
| T2 (콤보 롱테일, 볼륨×수천) | can i run {model} on {gpu} / {gpu} llm / {gpu}로 {model} | "rtx 4060 llm", "4060으로 라마 돌리기" | 콤보 + GPU 허브 |
| T3 (문제 해결) | ollama out of memory / llm 느림 / cuda oom | 가이드 |
| T4 (신모델 서지) | {신모델} local / vram / 사양 — 출시 후 2주 폭발 | 신모델 플레이북 §8 |

자동완성 근거: "can i run llama 70b locally", "rtx 4060 llm performance/reddit/16gb", "best gpu for local llm 2026", ko "로컬 llm 사양/추천/순위". 콤보 빌드는 **수요 검증된 조합만**: 인기 GPU 30 × 인기 모델 20에서 시작(SEOmatic 룰: 콤보의 60%+가 수요 문서화).

## 2. URL·정보 구조 (모두 trailing slash 없음, 슬러그 언어 불변)
```
/                      홈=간이 계산기 (T1 "can my pc run ai")
/calculator            도구 (AIO 방어 핵심)
/gpu/rtx-4060          GPU 허브: 이 카드로 돌아가는 모델 전부 (T2 "{gpu} llm")
/model/qwen3-14b       모델 허브: 요구사양+돌아가는 GPU 표 (T1 requirements)
/models                모델 목록: 카탈로그 전 모델 한 표(Hugging Face 조직·파라미터·Q4_K_M·8k 필요 메모리·공개일·생각 모드·라이선스·최대 컨텍스트·30일 다운로드) — 허브 브레드크럼의 가운데 단계 (10-19 PROGRESS §4 D100·D101)
/gpus                  GPU 목록: 메모리 용량별 가장 싼 그래픽카드 + 전 GPU·칩·CPU 프로필을 종류별 표로(메모리·대역폭·가격·쾌적·원활 모델 수, CPU 전용은 돌아가는 모델 수) — 같은 날
/can-i-run/qwen3-14b/on/rtx-4060   콤보 (T2 직격)
/guides/{slug}         에디토리얼 (T1/T3)
/compare/{a}-vs-{b}    GPU 비교 (10-19 PROGRESS §4 D106 — 레지스트리 `content/compares.ts` 의 엄선 쌍만, 초안 = noindex, 게시는 사용자 승인 쌍만) · /compare = 목차
/methodology           방법론·오차 공개 (E-E-A-T + 백링크 유인)
/updates               업데이트 소식: 바뀐 기능·고친 계산(손으로 쓴 en/ko 항목) + 모델별 카탈로그 추가 날짜 (10-14 D72 — 관리되는 사이트 신호)
/ko/...                동일 트리
```
- 내부링크 규칙(스팸 방어 필수): 콤보 페이지는 항상 ①GPU 허브 ②모델 허브 ③관련 가이드 1개 ④인접 콤보 4개(같은 GPU 다른 모델 2, 같은 모델 다른 GPU 2)에서 링크 받도록 템플릿화 — 고아 페이지 0. ③의 구현(P1-4 D44): 가이드의 `<ComboGrid>`(레지스트리 그리드가 커버리지 단일 출처)가 공개 콤보로만 링크하고, 콤보는 자기를 커버하는 published 가이드로 `a[data-related-guide]` 역링크. export 테스트가 "indexable 콤보마다 published 가이드 인바운드 ≥1"을 강제(currentBatch 0 에선 공회전 단언).
- **홈·GPU 허브 추가 링크(10-16 PROGRESS §4 D95)**: 홈 "많이 찾는 조합" — 공개 콤보 8개(GPU = 홈 "자주 찾는 GPU" 순 → 나머지 공개 GPU 는 `data/publish.json` 순, 모델 = `popularity` 순 → publish 순, i 번째 GPU × (i mod 공개 모델 수) 번째 모델 — 결정론, `apps/web/lib/popular-combos.ts`), 링크 텍스트는 콤보 제목과 같은 짧은 GPU 이름("RTX 4060에서 Llama 3.1 8B"). GPU 허브 끝 "관련 가이드" 2~3편 — 하드웨어 종류별 정책(데스크톱 NVIDIA: VRAM 등급·예산별 카드·그래픽카드 2장 / AMD·Intel: ROCm·Vulkan 가이드 먼저 / 노트북: 노트북 가이드 먼저 / 맥: 맥 가이드 + 128GB 이상 구성이면 128GB 비교 / 그 밖의 통합 메모리·CPU 전용 각각 — `apps/web/lib/gpu-hub-guides.ts`, published 만 — D40).
- **목록 페이지(10-19 PROGRESS §4)**: `/models`·`/gpus`(+`/ko`)는 index, 전 페이지 헤더 내비·푸터·홈 "모두 보기"에서 링크. 서버 HTML 에 전 행(크롤 가능) — 정렬·거르기는 서버 행을 다시 놓고 숨기기만 하는 아일랜드(`components/islands/list-controls.tsx`, URL 상태 없음). 표 행은 허브로만 링크하고 콤보로는 링크하지 않는다(공개 콤보 규칙과 무관). 모델 목록 기본 순서 = 인기도 → 30일 다운로드 → 이름, GPU 목록 묶음 = 데스크톱 NVIDIA · 데스크톱 AMD · Intel · 노트북 · Apple · 그 밖의 통합 메모리 PC · CPU 전용(묶음 안 = `data/gpus.json` 순서), "쾌적·원활" 수 = GPU 허브 요약과 같은 함수·같은 구성(그래픽카드 = 허브 가정 RAM, 통합·CPU = 가장 큰 메모리 — 괄호로 표기), 쾌적과 원활을 따로 적는다(D101). 모델 목록의 필요 메모리 = 모델 허브 FAQ·메모리 행렬과 같은 식(`lib/model-need.ts`).
- 정규화: 대체 GPU 표기(4060 Ti 16GB 등) alias → canonical 슬러그 301/캐노니컬. **콤보 URL엔 alias 301을 만들지 않는다**(`_redirects` 정적 룰 2,000줄 한도 — `05` §3; 1,566쌍 × 2언어 × 별칭이 한도를 넘는다) — 콤보는 캐노니컬 태그만(P1-2, PROGRESS §4 09-29).
- **정적 페이지**(`apps/web/content/pages.ts` 레지스트리 — 소개·계산 방법·업데이트 소식·개인정보처리방침·문의)는 전부 index, 모든 페이지 푸터에서 링크(고아 0), 사이트맵 pages 에 들어간다. `/updates` 의 lastmod = max(데이터 기준일, 최신 항목 날짜 — `content/updates.ts`). 업데이트 소식은 RSS(가이드 피드)에 넣지 않는다(항목마다 캐노니컬 페이지가 없다 — PROGRESS §4 D72).
- **허브 소개글**(10-14 PROGRESS §4 D74): 인기 GPU 허브 10(배치 1 GPU)·모델 허브 10(`popularity` 5 + HF 다운로드 1위)에 손으로 쓴 소개 2~3문단(로캘별 MDX `apps/web/content/{en,ko}/hubs/**`, 레지스트리 `content/hubs.ts`) — 허브 머리말과 계산기 위젯(10-19 D107) 아래. 숫자는 데이터 컴포넌트, 판정·fit·실행 방식 주장은 조건까지 `<Expect>` 로 고정(데이터가 바뀌면 빌드 실패). 소개 안 콤보 링크는 `ComboLink`(공개 콤보만 링크 — §3 링크 규칙 그대로), 레지스트리 밖 허브는 소개 없이 그대로. 집필 규칙 `apps/web/content/AUTHORING.md` §10.
- **계산기는 index**(P1-3 D24): 캐노니컬 `/calculator`·`/ko/calculator`(쿼리 무시 — 공유 URL `?gpu=…`는 상태만 실어 나르고 캐노니컬은 청결). 인바운드 = 전 페이지 헤더 nav + 홈 GET 폼·인기 GPU 링크 + 모델 허브 GPU 표 위 `a[data-calc-model-link]`(`?mode=model&m={id}` — 계산기 모델 모드, 10-03 D65) + **상세 페이지의 미리 채운 계산기 위젯**(10-19 PROGRESS §4 D107 — 콤보·GPU 허브·모델 허브·GPU 비교 페이지마다 1개, 머리말 바로 아래·콤보는 판정 문장 아래. 그 페이지의 GPU(비교는 앞쪽 기기)를 표시명으로 채운 GET 폼 + 숨은 `m`(콤보·모델 허브), 모델 허브는 GPU 칸을 비우면 모델 모드 — 숨은 `gpu=<id>`·`mode=model` 은 하이드레이션 뒤에만 붙어 스크립트 전에 친 GPU 를 덮지 않는다(그 전엔 칸이 표시명을 보내고 계산기가 해석, D31). 딥 링크 `a[data-calc-deep-link]` = 콤보 "이 조합을 계산기에서 열기"·비교 두 기기 — 그 페이지가 가정한 구성 그대로, 계산기 URL 코덱의 정규형)(고아 0, export 테스트 강제 — 모델 허브 링크 href·위젯 숨은 값·딥 링크 쿼리도 고정). 정적 HTML = 폼 + **서버 렌더 예시·결과 읽는 법**(10-14 PROGRESS §4 D73 — 많이 쓰는 하드웨어 6종 × 크기 구간별 계산기 추천순 첫 모델의 판정·속도 밴드+라벨 + 하드웨어마다 GPU 에 전부 올라가는 가장 큰 모델·불가 구간의 RAM 힌트, 허브와 같은 함수로 빌드 때 계산, 결과 영역 아래라 CLS 무관) + 판정 기준표·FAQ. 방문자가 고른 하드웨어의 결과 문장은 클라이언트 렌더라 색인 콘텐츠가 아니다.

## 3. 인덱싱 단계 계획 (게이트 통과 전 다음 배치 금지)
| 배치 | 페이지 | 시점 | 게이트 |
|---|---|---|---|
| 0 | 에디토리얼(출시 12편 = 6쌍 en+ko, 4주 내 20편 — `docs/06` P1-4; 감수 전 초안은 noindex — P1-4 D40) + 허브 전체(현 GPU 54 + 모델 29 = 83 — P1-1 결정, PROGRESS §4 09-29) + 방법론 | 출시 주 | GSC 등록, 도메인 크롤 신뢰 웜업 |
| 1 | 콤보 상위 60 (인기 GPU 10 × 모델 6, en+ko 120p — 후보 목록은 아래) | +2주 (P1-6) | **4주 내 인덱싱 ≥80%** 아니면 중단·개선 |
| 2 | 콤보 240 | 게이트 통과 후 | 동일 |
| 3 | 콤보 나머지 전체(현 카탈로그 1,566쌍) + 확장 | 〃 | 주간 GSC 커버리지 점검 |
- **게이트 메커니즘(P1-2, PROGRESS §4 09-29 D9)**: 콤보는 **카탈로그 전 조합을 생성**하고 인덱싱만 `data/publish.json`으로 제어한다 — `{ currentBatch, batches: [{ batch, gpuIds[], modelIds[], plannedAt?, note? }] }`(스키마 `03` §1, 조회 `packages/data/src/publish.ts`). 콤보의 배치 = gpuIds·modelIds가 **둘 다** 그 쌍을 포함하는 항목들의 **최소 batch**(GPU 배치와 모델 배치의 min이 아님 — 4060이 배치 1이고 qwen3-14b가 배치 2 항목에만 있으면 그 쌍은 배치 2), 어느 항목에도 없으면 배치 없음. **indexable ⇔ batch가 있고 batch ≤ currentBatch.** 배치 확대 = `currentBatch`를 올리는 커밋(규칙 5 — 게이트 승인 필요). 출시 값: `currentBatch: 0`(콤보 전부 noindex), 배치 1 항목 등록.
- **미공개 콤보** = `<meta name="robots" content="noindex, follow">` + 허브·홈에서 링크 0 — 계산기 딥링크·미공개 콤보끼리의 인접 링크로만 도달한다. 내부 nofollow는 쓰지 않는다: 3.3K는 크롤 예산 우려 규모 미만이고, 공개 페이지에서 미공개 섬으로 가는 링크가 0이라 발견 자체가 안 된다. 실제 위험은 공개 콤보의 "발견됨-미색인"이라 허브·가이드 그리드의 판정 링크·홈 "많이 찾는 조합"·사이트맵·공개 전용 인접 링크로 대응.
- **링크 규칙**: 허브·홈·**공개 콤보는 공개 콤보로만** 링크(허브 판정 셀·가이드 `ComboGrid` 셀의 `data-combo-link` 판정 링크는 공개 콤보에만 붙는다 — 링크 텍스트는 대상 조합 이름 "RTX 4060에서 gpt-oss-20b 판정 보기" / "gpt-oss-20b verdict on the RTX 4060", 10-16 PROGRESS §4 D95. 홈 "많이 찾는 조합"도 공개 콤보만). **미공개 콤보는 전 카탈로그로** 링크할 수 있다. 공개 콤보의 인접 4개(§2)는 공개 풀 안에서 채운다 — 배치 1은 GPU당 모델 6·모델당 GPU 10이라 충족. export 테스트가 강제.
- **계산기 딥링크**(P1-3 D33): 결과 카드의 "상세" 링크는 **전 카탈로그 콤보로** 간다(사용자 세션 결과 — 클라이언트 렌더라 정적 HTML에 없다. 정적 HTML의 콤보 링크는 서버 렌더 예시의 공개 콤보뿐이고 나머지 예시는 모델 허브로 — D73, 링크 규칙은 정적 HTML만 검사). 8k·f16이 아닌 조건이면 `?ctx=&kv=`를 붙여 콤보 아일랜드가 그 셀을 프리셋한다 — 콤보의 캐노니컬·robots 메타는 쿼리와 무관.
- **sitemap-combos(P1-5)는 공개 콤보만** 수록(인터페이스 `indexableCombos`). **robots.txt는 `/can-i-run/`을 절대 Disallow하지 않는다** — 크롤이 막히면 noindex를 읽지 못해 URL만 색인될 수 있다.
- **배치 1 후보(10 GPU × 6 모델 = 60쌍, en+ko 120p — 정본은 `data/publish.json` `batches[0]`, `plannedAt` 2026-09-29)**: GPU `rtx-4060`·`rtx-3060-12gb`·`rtx-4070`·`rtx-5070`·`rtx-5060-ti-16gb`·`rtx-4090`·`rtx-3090`·`rtx-5090`·`apple-m4`·`apple-m4-pro` / 모델 `llama-3.1-8b`·`qwen3-14b`·`qwen3-30b-a3b-2507`·`gpt-oss-20b`·`gpt-oss-120b`·`gemma-3-12b`(`popular` GPU·인기 모델 중 검색 수요 상위 — 통합 메모리 2종 포함). 쌍둥이 GPU(아래)는 한쪽만.
- **P1-6 개방 절차** = `currentBatch: 1` 커밋·배포 + sitemap-combos 제출·GSC 색인 요청 → 이후 배치도 같은 방법. 주의: 오래 noindex였던 URL은 재크롤이 느리다 — **4주 게이트는 GSC에서 재크롤이 확인된 시점부터 기산**한다.
- **쌍둥이 GPU 근접 중복 완화(D22)**: VRAM·대역폭·클래스가 같은 GPU 쌍(7그룹 — RX 9070/9070 XT, RTX 4090/3090 Ti, 5070 Ti/5080 Laptop 등)은 fit·tg 수치가 동일해 콤보 페이지가 거의 같다. 페이지에 형제 문장("{twin}도 메모리 구성이 같아 생성 속도는 동일, 프롬프트 처리만 다름 {pp} vs {ppTwin}")과 FP16 TFLOPS·pp·가격·인접 GPU 차이를 싣고, **같은 인덱싱 배치에 쌍둥이를 함께 넣지 않는다**.
- 수요 없는 콤보(구형 GPU×비주류 모델)는 어느 배치에도 넣지 않는다(생성은 되지만 noindex 유지) → 인덱스 품질 보호.
- sitemap: 유형별 분할(sitemap-gpus/models/combos-en/combos-ko/guides) + lastmod = 데이터 갱신일. 엔진 수치를 그리는 계산기·허브·콤보·GPU 목록(쾌적·원활 수)은 max(데이터 갱신일, 엔진 스펙 날짜 `ENGINE_SPEC_DATE`) — 엔진 개정은 데이터 없이도 모든 수치를 바꾼다(PROGRESS §4 D93). 모델 목록(필요 메모리·30일 다운로드)은 여기에 모델 다운로드 기준일(`hfDownloadsAsOf`)의 최댓값까지 — 다운로드 수만 바뀐 주간 동기화는 데이터 갱신일을 올리지 않는다(D101). 가이드는 레지스트리 dateModified, 업데이트 소식·소개글 허브는 위 규칙대로.

## 4. 콤보 페이지 품질 요건 (스케일드 콘텐츠 판정 방어 체크리스트)
페이지당 **고유 데이터 ≥8개**: ①quant×fit 표(수치 전부 조합 고유) ②VRAM 분해 바 ③ctx별 메모리/속도 곡선 ④예상 pp/tg±밴드 ⑤실측 표(있으면) ⑥대안 3종 추천 로직 결과 ⑦실행 커맨드(플래그가 조합 의존: -ngl, --n-cpu-moe N 값) ⑧FAQ(수치 삽입형) — 선택 요소로 dGPU 콤보의 "시스템 RAM 용량별 판정"(16~128GB, 맨 위 판정이 RAM 에 따라 바뀌는 페이지만 — 10-03 D64, PROGRESS §4). 제목·description·헤더 판정·FAQ 는 RAM 32GB 가정 그대로라 RAM 목록이 이 불변식(FAQ 답 = JSON-LD, 제목 유일)을 바꾸지 않는다. "깊이 테스트": GPU명 가리고도 페이지 구분 가능해야 함 — P1-2 구현(D15): GPU명·id·별칭 마스킹 후 숫자 다중집합 지문이 로케일 내 전 콤보에서 유일 + 시드 PRNG 3페이지 기록(쌍둥이 GPU는 FP16·pp·가격·인접 GPU로 구분, §3 D22). 보일러플레이트 문장 비율 < 60% — 측정(D16): 콤보의 ≥50%에 나타나는 문장 단위(p/li/h/td/th/dt/dd/caption/code, 이름 마스킹) 글자 비율 < 0.6.
- **meta description(10-16 PROGRESS §4 D95)**: 답부터 한 문장 — 콤보는 "{GPU}에서 {모델}: {판정} — {양자화} 기준 필요 메모리 약 X GB, 속도 Y–Z tok/s ({신뢰 라벨})"(판정은 제목과 같은 `titleVerdict` 갈래, 실측이면 측정 조건이 붙는 속도 문장). 배치 문장(VRAM 여유·시스템 RAM 몫·전문가 층 수)은 헤더·FAQ 에만 두고, 그래픽카드 콤보가 시스템 RAM 을 함께 쓰면 "(일부는 시스템 RAM)"만 붙인다 — 8GB 카드에 "필요 메모리 약 12GB · 원활"이 모순처럼 읽히지 않게. GPU 허브의 "가장 큰 모델"은 FAQ Q1 과 같은 정의 하나(GPU 에 전부 올라가는 가장 큰 모델, CPU 프로필은 돌아가는 가장 큰 모델 — `faq.largestFullGpu`/`largestRunnable`)로 description 과 FAQ 가 같은 모델·양자화를 말한다(export 테스트 강제). 콤보 제목 템플릿은 바꾸지 않았다.
- **Apple 칩 허브의 맥 제품 이름(10-16 PROGRESS §4 D97)**: 맥은 칩보다 제품+메모리로 찾는다("맥미니 m4 16gb llm", "맥 스튜디오 128gb llm"). Apple 칩 허브의 `<title>`·H1 은 "Apple M4(맥 미니·맥북 에어·맥북 프로·아이맥)"(en "Apple M4 (Mac mini, MacBook Air, MacBook Pro, iMac)", 이름이 괄호로 끝나면 "Apple M4 Max (40-core GPU, 맥북 프로·맥 스튜디오)"), description 은 요약 구성(최대 메모리)으로 파는 계열만("Apple M4 Pro 칩이 들어간 통합 메모리 64GB 맥 미니에서 …"), 사양에 "이 칩이 들어간 맥" 줄(계열별 메모리). 근거는 `data/gpus.json` `products` — 애플 사양 페이지로 확인한 모델만(`03` §1). 콤보 제목·공유 카드는 그대로(export 테스트 강제).

## 5. 구조화 데이터 (JSON-LD, 템플릿 레벨)
- `/calculator` `SoftwareApplication`(무료) · 콤보/허브 `FAQPage`(3문항, 수치 포함 답) + `BreadcrumbList` · 실측 섹션 `Dataset`(P2: 공개 데이터셋 — 백링크 자석) · 가이드 `Article`+`author`(실명 E-E-A-T — P1-4 사용자 결정으로 우선 브랜드 Organization "CanRun", 레지스트리 한 줄로 실명 전환 가능, D41) + 3단 `BreadcrumbList`(홈 › 가이드 › 글).
- P1-3 구현 메모: `/calculator` = `SoftwareApplication`(`applicationCategory` UtilitiesApplication · `isAccessibleForFree` + `Offer` price 0 · `softwareVersion` = 엔진 스펙 버전) + `BreadcrumbList` 2단(홈 › 계산기) + `FAQPage` 3문항(답은 화면 FAQ 텍스트, tok/s 수치 없음 — 결과는 클라이언트 렌더). 홈 = `WebSite`(SearchAction 없음 — 사이트링크 검색창은 종료된 기능). 10-06: `alternateName` ["CanRun LLM", "canrunllm.com", "캔런"](Google 사이트 이름)과 `url` = 캐노니컬과 같은 표기(루트는 끝 슬래시 없음) — PROGRESS §4 D70. export 테스트가 두 페이지의 타입 집합을 강제.
- P1-1 구현 메모: 허브 브레드크럼은 2단(홈 › 허브) — Google은 마지막 외 항목에 URL을 요구하는데 `/gpu`·`/model` 인덱스 페이지가 없다. **10-19: 목록 페이지(`/models`·`/gpus`)가 생겨 허브는 3단(홈 › 모델 목록|GPU 목록 › 허브)** — 가운데 단계에 실제 URL 이 있고 사이트 구조(목록 → 허브)와 같다. 목록 페이지 = `BreadcrumbList` 2단 + `ItemList`(화면 기본 순서의 전 항목, url = 허브 캐노니컬 — 리치 결과는 기대하지 않는다). 콤보 브레드크럼(홈 › 모델 허브 › 콤보)은 그대로 둔다 — 검색 결과에 붙어 있는 콤보 경로를 바꿀 이유가 없고, 모델 허브가 이미 목록으로 이어진다. **콤보는 3단(홈 › 모델 허브 › 콤보=캐노니컬)** — P1-2 D10(PROGRESS §4 09-29). FAQPage 답 텍스트 = 화면 FAQ 텍스트(export 테스트가 강제). FAQ 리치 결과는 2023년부터 정부·보건 사이트 한정이라 노출은 기대하지 않고 스펙대로만 둔다.

## 6. i18n·hreflang (동시 출시 스펙)
- `/ko/` 서브디렉토리(링크 자산 통합 — 서브도메인 금지). 모든 페이지: `hreflang en / ko / x-default(en)` **자기참조 포함 완전 대칭**, 템플릿에서 생성(수기 금지).
- ko는 번역이 아니라 로컬라이즈: 템플릿 문자열 세트는 네이티브 감수 1회(유한 세트라 저비용·정책 안전), 에디토리얼은 별도 집필, ko 고유 요소(원화, 쿠팡, 한국 모델, 아카라이브 문화) 포함. **장문 기계번역 게시 금지.**
- **zh(간체) — 화면 문구만, 아직 검색 제외 (10-19 사용자 결정, PROGRESS §4 D109)**
  - 범위: `/zh/` 서브디렉토리. 홈·계산기·GPU/모델 허브·콤보·GPU 비교·목록 페이지(템플릿 페이지)만 있다. 가이드·가이드 목차·정적 페이지(소개·계산 방법·업데이트 소식·개인정보처리방침·문의)는 zh 라우트가 없고(404), 허브·비교 소개글과 모델 소개도 zh 에서는 그리지 않는다 — 장문 기계번역 게시 금지를 그대로 지킨다. zh 푸터의 정적 페이지 링크는 영어판으로 간다(`hreflang="en"`).
  - 번역: `messages/zh.json` 화면 문구(메뉴·표·판정·계산기 등 짧은 문구)를 사용자 승인 기계번역으로 만든다. 키·ICU 인자는 en 과 대칭(테스트가 강제).
  - 검색: 공개 작업(애드센스 승인 뒤 별도 작업) 전까지 zh 전 페이지 `noindex, follow` + 자기 캐노니컬만. hreflang·사이트맵·RSS·IndexNow 에 zh 를 넣지 않고, en/ko 의 hreflang 도 en/ko/x-default 그대로다. robots.txt 로 막지 않는다(막으면 noindex 를 읽지 못한다). `<html lang="zh-Hans">`, og:locale `zh_CN`, 공유 카드는 en 카드를 쓴다. 공개할 때 정할 것: hreflang 값(`zh-Hans` / `zh-CN`), 원어민 검토 1회, 바이두·ICP.
  - 용어집(간체·중국 본토 표기 — 구속력 있음, 번역·수정 모두 이대로):
    - 판정(`Verdict.*` 와 판정을 부르는 모든 문장): S = 运行流畅, A = 运行良好, B = 运行较慢, F = 无法运行. 범례 제목 = 判定说明. 다른 동의어(顺畅·流利 등)를 섞지 않는다.
    - 신뢰 라벨: measured = 实测, calibrated estimate = 校准估算, theoretical estimate = 理论估算, rough estimate(pp ±40%) = 粗略估算. "±{band}%" 같은 자리표시는 그대로 둔다.
    - 실행 방식: full GPU = 全部载入显卡, MoE experts in RAM(cpu-moe) = MoE 专家放在内存, partial offload = 部分卸载, CPU only = 纯 CPU, unified memory = 统一内存.
    - 용어: graphics card = 显卡, VRAM = 显存, system RAM = 系统内存, context = 上下文, quantization/quant = 量化, offload = 卸载, KV cache = KV 缓存, calculator = 计算器, estimate = 估算, laptop = 笔记本, desktop = 台式机, US dollar = 美元, model = 模型, thinking mode = 思考模式, benchmark = 基准测试, public benchmark result = 公开基准测试结果, guide = 指南, compare = 对比.
    - 번역하지 않는 것: CanRun, 제품·모델·런타임 이름(Ollama, LM Studio, llama.cpp, GGUF, Hugging Face, Qwen, DeepSeek, Gemma, RTX…, Apple M…, Ryzen…, DGX Spark, CUDA, Metal, ROCm, Vulkan), 양자화 이름(Q4_K_M…), 단위(GB, GB/s, TFLOPS, tok/s), %, ±.
    - 문체: 독자는 你(您 아님), 짧은 UI 말투. 중국어 문장 안에서는 전각 문장부호(，。：；（）)를 쓰되 숫자·범위("8–20 tok/s")·URL·코드 안은 ASCII 그대로. 중국어와 라틴 문자·숫자 사이에는 반각 공백("RTX 4060 显卡", "16 GB"). 간체만 — 번체·대만식 표기 금지(显卡 ○ 顯示卡 ×, 默认 ○ 預設 ×, 内存 ○ 記憶體 ×, 视频 ○ 視訊 ×).
    - 영어 원문의 뜻을 그대로 옮기고 한국어 파일은 의도를 확인하는 보조 자료로만 쓴다. 원문에 없는 주장을 더하지 않는다. 단정적인 홍보 문구(保证·一定·完美·最强) 금지.
  - 검사: `apps/web/test/messages.test.ts`(한글은 `LocaleSwitcher.ko` 만, 번체 전용 글자·대만식 용어, 복수형 `other`, 您·단정 표현·판정 동의어, 한자 뒤 반각 , ; :, 번역이 들어온 뒤엔 판정 이름 고정) · `test/export-invariants.spec.ts` "zh (D109)"(산출물 — noindex·hreflang 없음·사이트맵 밖·한글/원화 없음·내부 링크 /zh/*).

## 7. 네이버 플레이북 (ko 트래픽 2차 엔진, 점유율 62.9%지만 개발자층은 구글 우선)
1. 출시 주: 네이버 서치어드바이저 등록(소유 확인, robots에 Yeti 허용, **사이트맵+RSS 제출**) — SSG 풀 HTML이라 렌더링 리스크 없음. RSS 항목은 요약(`description`) + 본문 전체(`content:encoded`), 배포마다 IndexNow 로 바뀐 URL 을 알린다(PROGRESS §4 D93).
2. 병행 채널: **네이버 블로그 개설** — 주 1회 한국어 벤치마크/가이드 포스팅 + 도구 링크(네이버 SERP는 자사 블로그/카페 블록이 지배 — C-Rank는 주제 일관성, D.I.A+는 실사용 후기 가점 → 국민 가성비 카드인 5060 Ti 16GB 실측 후기 콘텐츠가 정확히 유리).
3. OG 태그·모바일 최적화(한국 사용자 90% 모바일).
4. (P2) 아카라이브 로컬 채널·퀘이사존에 벤치 제출 요청 포스트 — 단 광고성 금지, 기여 형태로.

## 8. 신모델 48시간 플레이북 (반복 랜드그랩 — apxml 검증 패턴)
릴리스 감지(파이프라인 알림) → ①config.json·GGUF 크기 수집(자동 PR) ②모델 허브 + 인기 GPU 15종 콤보 페이지 생성·배포 ③en/ko 요구사양 가이드 1편(30분 템플릿) ④IndexNow 전송(배포마다 자동 — 새로 생기거나 lastmod 가 바뀐 URL 을 네이버·api.indexnow.org 에, `scripts/indexnow.ts`, PROGRESS §4 D93) + GSC 색인 요청(Google 은 IndexNow 를 쓰지 않고 sitemap ping 도 2023 년에 없앴다) ⑤(선택) 자체 리그(5060 Ti 16GB)에서 돌아가는 신모델이면 실측 1점 추가 → "실측 포함" 차별화 ⑥r/LocalLLaMA·아카라이브 스레드에 계산기 링크(질문 답변 형태). 목표: 48h 내 라이브, 서지 2주 수확.

## 9. 에디토리얼 캘린더 (출시분 — AdSense 승인·웜업·T1 커버)
**P1-4 확정(PROGRESS §4 D37)** — hreflang 대칭 때문에 가이드는 **같은 슬러그의 en/ko 쌍**(같은 질문·같은 범위, 각 언어 별도 집필). 출시 6쌍(우선순위 순): `vram-requirements`(VRAM 8~32GB로 돌릴 수 있는 모델 — 배치1 dGPU 48쌍 그리드) · `ollama-context-length`(Ollama가 느리거나 앞 내용을 잊을 때) · `gguf-quantization`(Q4_K_M·IQ4_XS·Q8_0 무엇을 받을까) · `korean-open-llms`(EXAONE·Kanana·HyperCLOVA X SEED·Solar) · `mac-local-llm`(M4·M5 통합 메모리 — 배치1 Apple 12쌍 그리드) · `kv-cache-context`. 보류(해제 조건): run-120b(엔진 후속 ①④ — cpu-moe 교정·gpt-oss nonExpertGB) · 예산 GPU·중고 3090(streetKRW·중고가 데이터) · 5060 Ti 전수 실측(P0-5) · 입문(소유자 설치 스크린샷). 아래 목록은 이후 쌍을 고르는 주제 풀이다. 집필 규칙: `apps/web/content/AUTHORING.md`.
en (10): How much VRAM do LLMs need (2026) / Best GPU for local LLM 2026 by budget / Best LLMs for 8GB VRAM / …16GB / Run 120B on a 12GB card (--n-cpu-moe) / GGUF quant quality guide / KV cache & context explained / Mac vs PC for local AI / Why is Ollama slow (context defaults) / Used RTX 3090 in 2026
ko (10): 로컬 LLM 입문 2026 (Ollama/LM Studio) / VRAM별 추천 모델 (8/12/16/24GB) / 로컬 LLM GPU 추천 (신품·중고·맥) / 양자화(GGUF) 등급 정리 / 12GB로 120B MoE 돌리기 / RTX 5060 Ti 16GB 로컬 LLM 전수 실측 (자체 데이터) / 맥으로 LLM 돌리기 (M4/M5) / EXAONE·한국 오픈모델 사양 정리 / Ollama 느릴 때 (컨텍스트 기본값) / 중고 3090 아직 살 만한가
이후 주 1회 en+ko 각 1편(신모델 대응 우선). 모든 가이드에 계산기 위젯 임베드(도구 유입 전환).

## 10. 링크·확산 자산
- **방법론 공개 + 오차 수치**(MAE 6.3% 등) → HN/r/LocalLLaMA에서 인용되는 유형. Show HN은 실측 배지 어느 정도 쌓인 뒤(경쟁 CLI들이 "검증 안 된 추정" 비판으로 죽은 사례 반영).
- 공유 카드(og:image에 판정+tok/s), 임베드 배지 "Runs Qwen3-14B ✓"(P3), 공개 Dataset(P2 — CC-BY로 벤치 데이터 공개 = 백링크+포지셔닝).
- 커뮤니티 답변 활동: "can I run X?" 질문에 콤보 페이지로 답(주 2~3회, 스팸 아닌 실답변).

## 11. 금지 목록 (하지 말 것)
> GPU 비교 페이지(D106)는 이 목록의 "애드센스 승인 전 프로그래매틱 대량 노출"에 걸리지 않게 엄선 쌍(검색 근거를 쌍마다 기록)·손으로 쓴 소개글·초안 게이트로 만들었다. 상한 `COMPARE_MAX`는 14쌍이다 — D106 의 12쌍에, 사용자가 승인한 DGX Spark 계획(10-23 D119)으로 검색엔진 자동완성 근거의 초안 2쌍을 더했다(게시는 쌍마다 사용자 승인 뒤). 이 상한 밖으로 늘리는 것은 애드센스 승인 뒤 사용자 승인 + GSC 근거로만.
장문 MT 게시 / 수요 없는 콤보 인덱싱 / 게이트 무시 대량 배포 / rumor GPU(5080 Super 등) 페이지 선점용 생성 / 근거 없는 tok/s 단정(밴드·신뢰 라벨 필수) / AdSense 승인 전 프로그래매틱 대량 노출(§`07-monetization.md` 순서 준수) / 타 벤치마크 표 무단 전재(수치 인용은 출처 링크, 데이터셋 통재 금지).
