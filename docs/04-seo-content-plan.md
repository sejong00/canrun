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
/can-i-run/qwen3-14b/on/rtx-4060   콤보 (T2 직격)
/guides/{slug}         에디토리얼 (T1/T3)
/methodology           방법론·오차 공개 (E-E-A-T + 백링크 유인)
/ko/...                동일 트리
```
- 내부링크 규칙(스팸 방어 필수): 콤보 페이지는 항상 ①GPU 허브 ②모델 허브 ③관련 가이드 1개 ④인접 콤보 4개(같은 GPU 다른 모델 2, 같은 모델 다른 GPU 2)에서 링크 받도록 템플릿화 — 고아 페이지 0.
- 정규화: 대체 GPU 표기(4060 Ti 16GB 등) alias → canonical 슬러그 301/캐노니컬. **콤보 URL엔 alias 301을 만들지 않는다**(`_redirects` 정적 룰 2,000줄 한도 — `05` §3; 1,566쌍 × 2언어 × 별칭이 한도를 넘는다) — 콤보는 캐노니컬 태그만(P1-2, PROGRESS §4 09-29).

## 3. 인덱싱 단계 계획 (게이트 통과 전 다음 배치 금지)
| 배치 | 페이지 | 시점 | 게이트 |
|---|---|---|---|
| 0 | 에디토리얼 20편(en10+ko10) + 허브 전체(현 GPU 54 + 모델 29 = 83 — P1-1 결정, PROGRESS §4 09-29) + 방법론 | 출시 주 | GSC 등록, 도메인 크롤 신뢰 웜업 |
| 1 | 콤보 상위 60 (인기 GPU 10 × 모델 6, en+ko 120p — 후보 목록은 아래) | +2주 (P1-6) | **4주 내 인덱싱 ≥80%** 아니면 중단·개선 |
| 2 | 콤보 240 | 게이트 통과 후 | 동일 |
| 3 | 콤보 나머지 전체(현 카탈로그 1,566쌍) + 확장 | 〃 | 주간 GSC 커버리지 점검 |
- **게이트 메커니즘(P1-2, PROGRESS §4 09-29 D9)**: 콤보는 **카탈로그 전 조합을 생성**하고 인덱싱만 `data/publish.json`으로 제어한다 — `{ currentBatch, batches: [{ batch, gpuIds[], modelIds[], plannedAt?, note? }] }`(스키마 `03` §1, 조회 `packages/data/src/publish.ts`). 콤보의 배치 = gpuIds·modelIds가 **둘 다** 그 쌍을 포함하는 항목들의 **최소 batch**(GPU 배치와 모델 배치의 min이 아님 — 4060이 배치 1이고 qwen3-14b가 배치 2 항목에만 있으면 그 쌍은 배치 2), 어느 항목에도 없으면 배치 없음. **indexable ⇔ batch가 있고 batch ≤ currentBatch.** 배치 확대 = `currentBatch`를 올리는 커밋(규칙 5 — 게이트 승인 필요). 출시 값: `currentBatch: 0`(콤보 전부 noindex), 배치 1 항목 등록.
- **미공개 콤보** = `<meta name="robots" content="noindex, follow">` + 허브·홈에서 링크 0 — 계산기 딥링크·미공개 콤보끼리의 인접 링크로만 도달한다. 내부 nofollow는 쓰지 않는다: 3.3K는 크롤 예산 우려 규모 미만이고, 공개 페이지에서 미공개 섬으로 가는 링크가 0이라 발견 자체가 안 된다. 실제 위험은 공개 콤보의 "발견됨-미색인"이라 허브 "상세" 링크·사이트맵·공개 전용 인접 링크로 대응.
- **링크 규칙**: 허브·홈·**공개 콤보는 공개 콤보로만** 링크(허브 판정 셀의 `data-combo-link` "상세" 링크는 공개 콤보에만 붙는다). **미공개 콤보는 전 카탈로그로** 링크할 수 있다. 공개 콤보의 인접 4개(§2)는 공개 풀 안에서 채운다 — 배치 1은 GPU당 모델 6·모델당 GPU 10이라 충족. export 테스트가 강제.
- **sitemap-combos(P1-5)는 공개 콤보만** 수록(인터페이스 `indexableCombos`). **robots.txt는 `/can-i-run/`을 절대 Disallow하지 않는다** — 크롤이 막히면 noindex를 읽지 못해 URL만 색인될 수 있다.
- **배치 1 후보(10 GPU × 6 모델 = 60쌍, en+ko 120p — 정본은 `data/publish.json` `batches[0]`, `plannedAt` 2026-09-29)**: GPU `rtx-4060`·`rtx-3060-12gb`·`rtx-4070`·`rtx-5070`·`rtx-5060-ti-16gb`·`rtx-4090`·`rtx-3090`·`rtx-5090`·`apple-m4`·`apple-m4-pro` / 모델 `llama-3.1-8b`·`qwen3-14b`·`qwen3-30b-a3b-2507`·`gpt-oss-20b`·`gpt-oss-120b`·`gemma-3-12b`(`popular` GPU·인기 모델 중 검색 수요 상위 — 통합 메모리 2종 포함). 쌍둥이 GPU(아래)는 한쪽만.
- **P1-6 개방 절차** = `currentBatch: 1` 커밋·배포 + sitemap-combos 제출·GSC 색인 요청 → 이후 배치도 같은 방법. 주의: 오래 noindex였던 URL은 재크롤이 느리다 — **4주 게이트는 GSC에서 재크롤이 확인된 시점부터 기산**한다.
- **쌍둥이 GPU 근접 중복 완화(D22)**: VRAM·대역폭·클래스가 같은 GPU 쌍(7그룹 — RX 9070/9070 XT, RTX 4090/3090 Ti, 5070 Ti/5080 Laptop 등)은 fit·tg 수치가 동일해 콤보 페이지가 거의 같다. 페이지에 형제 문장("{twin}도 메모리 구성이 같아 생성 속도는 동일, 프롬프트 처리만 다름 {pp} vs {ppTwin}")과 FP16 TFLOPS·pp·가격·인접 GPU 차이를 싣고, **같은 인덱싱 배치에 쌍둥이를 함께 넣지 않는다**.
- 수요 없는 콤보(구형 GPU×비주류 모델)는 어느 배치에도 넣지 않는다(생성은 되지만 noindex 유지) → 인덱스 품질 보호.
- sitemap: 유형별 분할(sitemap-gpus/models/combos-en/combos-ko/guides) + lastmod = 데이터 갱신일.

## 4. 콤보 페이지 품질 요건 (스케일드 콘텐츠 판정 방어 체크리스트)
페이지당 **고유 데이터 ≥8개**: ①quant×fit 표(수치 전부 조합 고유) ②VRAM 분해 바 ③ctx별 메모리/속도 곡선 ④예상 pp/tg±밴드 ⑤실측 표(있으면) ⑥대안 3종 추천 로직 결과 ⑦실행 커맨드(플래그가 조합 의존: -ngl, --n-cpu-moe N 값) ⑧FAQ(수치 삽입형). "깊이 테스트": GPU명 가리고도 페이지 구분 가능해야 함 — P1-2 구현(D15): GPU명·id·별칭 마스킹 후 숫자 다중집합 지문이 로케일 내 전 콤보에서 유일 + 시드 PRNG 3페이지 기록(쌍둥이 GPU는 FP16·pp·가격·인접 GPU로 구분, §3 D22). 보일러플레이트 문장 비율 < 60% — 측정(D16): 콤보의 ≥50%에 나타나는 문장 단위(p/li/h/td/th/dt/dd/caption/code, 이름 마스킹) 글자 비율 < 0.6.

## 5. 구조화 데이터 (JSON-LD, 템플릿 레벨)
- `/calculator` `SoftwareApplication`(무료) · 콤보/허브 `FAQPage`(3문항, 수치 포함 답) + `BreadcrumbList` · 실측 섹션 `Dataset`(P2: 공개 데이터셋 — 백링크 자석) · 가이드 `Article`+`author`(실명 E-E-A-T).
- P1-1 구현 메모: 허브 브레드크럼은 2단(홈 › 허브) — Google은 마지막 외 항목에 URL을 요구하는데 `/gpu`·`/model` 인덱스 페이지가 없다. **콤보는 3단(홈 › 모델 허브 › 콤보=캐노니컬)** — P1-2 D10(PROGRESS §4 09-29). FAQPage 답 텍스트 = 화면 FAQ 텍스트(export 테스트가 강제). FAQ 리치 결과는 2023년부터 정부·보건 사이트 한정이라 노출은 기대하지 않고 스펙대로만 둔다.

## 6. i18n·hreflang (동시 출시 스펙)
- `/ko/` 서브디렉토리(링크 자산 통합 — 서브도메인 금지). 모든 페이지: `hreflang en / ko / x-default(en)` **자기참조 포함 완전 대칭**, 템플릿에서 생성(수기 금지).
- ko는 번역이 아니라 로컬라이즈: 템플릿 문자열 세트는 네이티브 감수 1회(유한 세트라 저비용·정책 안전), 에디토리얼은 별도 집필, ko 고유 요소(원화, 쿠팡, 한국 모델, 아카라이브 문화) 포함. **장문 기계번역 게시 금지.**

## 7. 네이버 플레이북 (ko 트래픽 2차 엔진, 점유율 62.9%지만 개발자층은 구글 우선)
1. 출시 주: 네이버 서치어드바이저 등록(소유 확인, robots에 Yeti 허용, **사이트맵+RSS 제출**) — SSG 풀 HTML이라 렌더링 리스크 없음.
2. 병행 채널: **네이버 블로그 개설** — 주 1회 한국어 벤치마크/가이드 포스팅 + 도구 링크(네이버 SERP는 자사 블로그/카페 블록이 지배 — C-Rank는 주제 일관성, D.I.A+는 실사용 후기 가점 → 국민 가성비 카드인 5060 Ti 16GB 실측 후기 콘텐츠가 정확히 유리).
3. OG 태그·모바일 최적화(한국 사용자 90% 모바일).
4. (P2) 아카라이브 로컬 채널·퀘이사존에 벤치 제출 요청 포스트 — 단 광고성 금지, 기여 형태로.

## 8. 신모델 48시간 플레이북 (반복 랜드그랩 — apxml 검증 패턴)
릴리스 감지(파이프라인 알림) → ①config.json·GGUF 크기 수집(자동 PR) ②모델 허브 + 인기 GPU 15종 콤보 페이지 생성·배포 ③en/ko 요구사양 가이드 1편(30분 템플릿) ④sitemap ping + GSC 색인 요청 ⑤(선택) 자체 리그(5060 Ti 16GB)에서 돌아가는 신모델이면 실측 1점 추가 → "실측 포함" 차별화 ⑥r/LocalLLaMA·아카라이브 스레드에 계산기 링크(질문 답변 형태). 목표: 48h 내 라이브, 서지 2주 수확.

## 9. 에디토리얼 캘린더 (출시분 — AdSense 승인·웜업·T1 커버)
en (10): How much VRAM do LLMs need (2026) / Best GPU for local LLM 2026 by budget / Best LLMs for 8GB VRAM / …16GB / Run 120B on a 12GB card (--n-cpu-moe) / GGUF quant quality guide / KV cache & context explained / Mac vs PC for local AI / Why is Ollama slow (context defaults) / Used RTX 3090 in 2026
ko (10): 로컬 LLM 입문 2026 (Ollama/LM Studio) / VRAM별 추천 모델 (8/12/16/24GB) / 로컬 LLM GPU 추천 (신품·중고·맥) / 양자화(GGUF) 등급 정리 / 12GB로 120B MoE 돌리기 / RTX 5060 Ti 16GB 로컬 LLM 전수 실측 (자체 데이터) / 맥으로 LLM 돌리기 (M4/M5) / EXAONE·한국 오픈모델 사양 정리 / Ollama 느릴 때 (컨텍스트 기본값) / 중고 3090 아직 살 만한가
이후 주 1회 en+ko 각 1편(신모델 대응 우선). 모든 가이드에 계산기 위젯 임베드(도구 유입 전환).

## 10. 링크·확산 자산
- **방법론 공개 + 오차 수치**(MAE 6.3% 등) → HN/r/LocalLLaMA에서 인용되는 유형. Show HN은 실측 배지 어느 정도 쌓인 뒤(경쟁 CLI들이 "검증 안 된 추정" 비판으로 죽은 사례 반영).
- 공유 카드(og:image에 판정+tok/s), 임베드 배지 "Runs Qwen3-14B ✓"(P3), 공개 Dataset(P2 — CC-BY로 벤치 데이터 공개 = 백링크+포지셔닝).
- 커뮤니티 답변 활동: "can I run X?" 질문에 콤보 페이지로 답(주 2~3회, 스팸 아닌 실답변).

## 11. 금지 목록 (하지 말 것)
장문 MT 게시 / 수요 없는 콤보 인덱싱 / 게이트 무시 대량 배포 / rumor GPU(5080 Super 등) 페이지 선점용 생성 / 근거 없는 tok/s 단정(밴드·신뢰 라벨 필수) / AdSense 승인 전 프로그래매틱 대량 노출(§`07-monetization.md` 순서 준수) / 타 벤치마크 표 무단 전재(수치 인용은 출처 링크, 데이터셋 통재 금지).
