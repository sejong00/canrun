# 외부 코드 리뷰 브리프 — canrun 저장소

> 리뷰어 모델(Codex 등)에게 이 문서를 그대로 전달한다. 절차는 `docs/PROGRESS.md` §6.

## 0. 검토 대상과 안전 수칙

- 검토 대상은 **커밋된 HEAD**. 사용자가 만든 **격리 클론 폴더**에서 검토하고, 라이브 작업 폴더는 건드리지 않는다.
- **read-only**: 소스·문서·데이터를 수정·생성하지 않는다(의존성·빌드 산출물은 격리 클론 안에서만 허용). 산출물은 보고서 텍스트뿐.
- 실행 가능: `git log/diff/show`, Node 24(`.nvmrc`)·`corepack enable` 후 `pnpm install --frozen-lockfile` → `.github/workflows/ci.yml`과 같은 순서로 `pnpm run typecheck` · `lint` · `test:coverage` · `validate-data` · `build` · `test:export` 등 검증성 명령. Windows PowerShell 실행 정책이 `pnpm`을 막으면 `pnpm.cmd` 또는 cmd에서 실행. 코드를 외부로 보내는 도구 사용 금지.
- **검토 범위**: `docs/PROGRESS.md` §6의 **리뷰 기준 커밋**..HEAD. 범위 밖 코드는 변경분이 기대는 부분만 본다.

## 1. 프로젝트 컨텍스트

LLM 하드웨어 계산기("Can You Run It"의 AI판). GPU/RAM 선택 → 구동 가능 모델·quant·예상 tok/s. en 루트 + `/ko/` 이중언어 **정적 사이트**(Next.js 16 static export → Cloudflare Pages), 계산은 방문자 브라우저에서 실행.
직전 마일스톤(P1-2)은 **콤보 페이지 템플릿** `/can-i-run/{model}/on/{gpu}`(+`/ko/`): 카탈로그 전 조합(1,566 × 2언어 = 3,132p)을 생성하고 인덱싱은 `data/publish.json`(`currentBatch: 0` — 출시 시점 콤보 전부 noindex)으로 게이트한다(`docs/04` §3). 현재 마일스톤(P1-3)은 **계산기·홈** — `/calculator`(+`/ko/`, index): 첫 클라이언트 컴포넌트("아일랜드", `apps/web/components/islands/`)로 카탈로그 GPU·커스텀 하드웨어 × 모델 29종 판정을 브라우저에서 계산(`@canrun/data/client` — zod 없는 엔트리, `docs/05` §5), 상태는 URL 쿼리(`docs/01` F4 D31), GPU 감지(WebGL/WebGPU, 실패 시 무소음 폴백 — `docs/05` §5 D30), 홈은 no-JS GET 폼, 콤보 페이지 ctx/KV 아일랜드(엔진 미탑재 — 서버 셀 뷰 props, D28), 모델 허브 가격 정렬. 결정 D24~D36은 `docs/PROGRESS.md` §4. **`docs/00~07` + `CLAUDE.md`가 스펙**이고 코드는 이를 따라야 한다. 문서↔코드 불일치를 찾으면 어느 쪽을 고쳐야 하는지까지 판정하라 — 단, `docs/PROGRESS.md` §4에 "코드가 정본"으로 기록된 스펙 이탈은 문서 쪽 미갱신으로 본다. 현재 상태와 결정 기록은 `docs/PROGRESS.md`.

## 2. 검증 항목 (변경분에 해당하는 것 우선)

1. **정확성**: 판정·수치가 엔진(`packages/engine`)과 `docs/02`를 따르는가 — 페이지가 엔진을 우회해 자체 계산하는 곳, 단위(decimal GB)·반올림(tok/s 소수 1자리) 위반, 신뢰 라벨·밴드 누락. **거짓 양성(못 돌리는 조합을 돌린다고 표시)은 최우선.**
2. **SEO·i18n 불변식** (`docs/04` §3·§4·§6, CLAUDE.md 규칙 4·5): 캐노니컬 자기참조, hreflang en/ko/x-default 대칭, **`data/publish.json` noindex 게이트**(메커니즘 `docs/04` §3 — 콤보 배치 = 쌍을 포함하는 항목들의 최소 batch, indexable ⇔ batch ≤ currentBatch, en/ko 짝의 noindex 일치)와 **링크 규칙**(허브·홈·공개 콤보 → 공개 콤보만, 미공개 콤보 → 전 카탈로그 허용, 허브 `data-combo-link`는 공개 콤보에만), 콤보 페이지 고유 데이터 8요소, **깊이 테스트 AC**(`docs/06` P1-2: GPU명·id·별칭을 마스킹해도 숫자 지문이 로케일 내 전 콤보에서 유일 — 특히 쌍둥이 GPU 7그룹 `docs/04` §3 D22) + 보일러플레이트 비율 < 0.6(`docs/04` §4 D16)이 테스트로 실제 강제되는지, 하드코딩 문자열, `test/export-invariants.spec.ts`가 새 페이지 유형(콤보 3,132p)까지 실제로 검사하는지.
3. **데이터 거버넌스**: `sources[]`·`priceAsOf` 규칙, 엔진 상수 `// source:` 규칙, 배지(라이선스·GGUF 출처) 판별 로직의 정확성.
4. **보안**: 히스토리 포함 시크릿 0 (gitleaks 등 방법 자유), `.gitleaks.toml` allowlist 과대 여부, 워크플로 시크릿 최소 전달·로그 노출, 클라이언트 번들로 비공개 값 유입.
5. **CI 게이트 실효성**: 위반 시 실제로 실패하는가 — 거짓 초록불 가능성.
6. **성능·접근성**: 페이지 JS 예산(`docs/01` §7 — 계산기 외 ≤150KB, 계산기 ≤180,224B, 콤보·허브 아일랜드 +≤3KB — `docs/05` §6의 export 바이트 게이트가 실제로 3,304페이지를 검사하는지), LHCI `assertMatrix`(콤보 LCP 랩 게이트 2.5s·noindex 페이지 개별 SEO 감사·계산기 별도 캡 — `docs/05` §6), 광고 슬롯 CLS 예약, verdict 색+아이콘+텍스트 3중 표기. **빌드 산출물**: postbuild RSC 프루닝(`docs/05` §3 D18)이 클라이언트 요청을 깨뜨리지 않는지(`<a>`만 사용, 뒤로가기 포함 — 아일랜드의 `history.replaceState`가 Next `__NA` 상태를 보존하는지), 파일 수 < 16,000.
7. **계산기·아일랜드(P1-3)**: ① 브라우저 계산이 서버 조립(`assessCombo`)과 동일한가 — 기본 인자(8k·f16·허브 가정 RAM)에서 허브·콤보와 판정·quant·밴드가 바이트 동일해야 한다(`apps/web/test/calc-run.test.ts`), 실측 조인은 8k·f16에서만(D33), 커스텀 하드웨어는 전부 theoretical(D32); ② 하이드레이션: SSR = 첫 클라이언트 렌더(콤보박스 승격·감지 버튼·결과는 플래그 이후), 콘솔 에러 0; ③ URL 상태(D31): 기본값 생략·미지 키 삭제·`popstate` 복원·스위처 href 쿼리 유지·캐노니컬은 쿼리 없이; ④ GPU 감지(D30): 소프트웨어 렌더러·vendor 불일치·타임아웃·예외에서 **시각 변화 0**, 메모리 변형(4060 Ti 8/16GB)은 추측하지 않고 후보 제시; ⑤ 클라이언트 그래프: zod·next-intl·tailwind-merge·`node:*`·`@canrun/data` 배럴 도달 0(`client-graph.test.ts`), i18n-lite가 next-intl과 동치(`i18n-lite.test.ts`), 하드코딩 문자열 0; ⑥ 콤보 아일랜드가 엔진 없이 서버 셀 뷰만 쓰는지(추가 청크 0), 선택 ctx가 llama.cpp `-c`·Ollama `OLLAMA_CONTEXT_LENGTH`에 반영되는지; ⑦ 홈 GET 폼이 JS 없이 `/calculator?gpu=`로 가고 계산기가 자유 텍스트를 캐노니컬 id로 해석하는지.

## 3. 출력 형식

- Findings를 **P1(치명) / P2(중요) / P3(사소)** 순으로. 각 항목: 한 줄 요약 + `파일:라인` 근거 + 실패 시나리오 + 수정 제안.
- 근거 없는 지적 금지. 실행한 명령과 확인 방법을 명시하고, 실행하지 못한 게이트는 그 사실을 적는다.
- 마지막에: 종합 판정 한 문단 + "다음 태스크 전에 잠가야 할 톱3".
