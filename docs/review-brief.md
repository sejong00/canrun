# 외부 코드 리뷰 브리프 — canrun 저장소

> 리뷰어 모델(Codex 등)에게 이 문서를 그대로 전달한다. 절차는 `docs/PROGRESS.md` §6.

## 0. 검토 대상과 안전 수칙

- 검토 대상은 **커밋된 HEAD**. 사용자가 만든 **격리 클론 폴더**에서 검토하고, 라이브 작업 폴더는 건드리지 않는다.
- **read-only**: 소스·문서·데이터를 수정·생성하지 않는다(의존성·빌드 산출물은 격리 클론 안에서만 허용). 산출물은 보고서 텍스트뿐.
- 실행 가능: `git log/diff/show`, Node 24(`.nvmrc`)·`corepack enable` 후 `pnpm install --frozen-lockfile` → `.github/workflows/ci.yml`과 같은 순서로 `pnpm run typecheck` · `lint` · `test:coverage` · `validate-data` · `build` · `test:export` 등 검증성 명령. Windows PowerShell 실행 정책이 `pnpm`을 막으면 `pnpm.cmd` 또는 cmd에서 실행. 코드를 외부로 보내는 도구 사용 금지.
- **검토 범위**: `docs/PROGRESS.md` §6의 **리뷰 기준 커밋**..HEAD. 범위 밖 코드는 변경분이 기대는 부분만 본다.

## 1. 프로젝트 컨텍스트

LLM 하드웨어 계산기("Can You Run It"의 AI판). GPU/RAM 선택 → 구동 가능 모델·quant·예상 tok/s. en 루트 + `/ko/` 이중언어 **정적 사이트**(Next.js 16 static export → Cloudflare Pages), 계산은 방문자 브라우저에서 실행.
현재 마일스톤(P1-2)은 **콤보 페이지 템플릿** `/can-i-run/{model}/on/{gpu}`(+`/ko/`): 카탈로그 전 조합(1,566 × 2언어 = 3,132p)을 생성하고 인덱싱은 `data/publish.json`(`currentBatch: 0` — 출시 시점 콤보 전부 noindex)으로 게이트한다(`docs/04` §3). **`docs/00~07` + `CLAUDE.md`가 스펙**이고 코드는 이를 따라야 한다. 문서↔코드 불일치를 찾으면 어느 쪽을 고쳐야 하는지까지 판정하라 — 단, `docs/PROGRESS.md` §4에 "코드가 정본"으로 기록된 스펙 이탈은 문서 쪽 미갱신으로 본다. 현재 상태와 결정 기록은 `docs/PROGRESS.md`.

## 2. 검증 항목 (변경분에 해당하는 것 우선)

1. **정확성**: 판정·수치가 엔진(`packages/engine`)과 `docs/02`를 따르는가 — 페이지가 엔진을 우회해 자체 계산하는 곳, 단위(decimal GB)·반올림(tok/s 소수 1자리) 위반, 신뢰 라벨·밴드 누락. **거짓 양성(못 돌리는 조합을 돌린다고 표시)은 최우선.**
2. **SEO·i18n 불변식** (`docs/04` §3·§4·§6, CLAUDE.md 규칙 4·5): 캐노니컬 자기참조, hreflang en/ko/x-default 대칭, **`data/publish.json` noindex 게이트**(메커니즘 `docs/04` §3 — 콤보 배치 = 쌍을 포함하는 항목들의 최소 batch, indexable ⇔ batch ≤ currentBatch, en/ko 짝의 noindex 일치)와 **링크 규칙**(허브·홈·공개 콤보 → 공개 콤보만, 미공개 콤보 → 전 카탈로그 허용, 허브 `data-combo-link`는 공개 콤보에만), 콤보 페이지 고유 데이터 8요소, **깊이 테스트 AC**(`docs/06` P1-2: GPU명·id·별칭을 마스킹해도 숫자 지문이 로케일 내 전 콤보에서 유일 — 특히 쌍둥이 GPU 7그룹 `docs/04` §3 D22) + 보일러플레이트 비율 < 0.6(`docs/04` §4 D16)이 테스트로 실제 강제되는지, 하드코딩 문자열, `test/export-invariants.spec.ts`가 새 페이지 유형(콤보 3,132p)까지 실제로 검사하는지.
3. **데이터 거버넌스**: `sources[]`·`priceAsOf` 규칙, 엔진 상수 `// source:` 규칙, 배지(라이선스·GGUF 출처) 판별 로직의 정확성.
4. **보안**: 히스토리 포함 시크릿 0 (gitleaks 등 방법 자유), `.gitleaks.toml` allowlist 과대 여부, 워크플로 시크릿 최소 전달·로그 노출, 클라이언트 번들로 비공개 값 유입.
5. **CI 게이트 실효성**: 위반 시 실제로 실패하는가 — 거짓 초록불 가능성.
6. **성능·접근성**: 페이지 JS 예산(`docs/01` §7 — 계산기 외 <150KB, 콤보는 클라이언트 JS 0 — `docs/05` §3), LHCI `assertMatrix`(콤보 LCP 랩 게이트 2.5s·noindex 페이지 개별 SEO 감사 — `docs/05` §6), 광고 슬롯 CLS 예약, verdict 색+아이콘+텍스트 3중 표기. **빌드 산출물**: postbuild RSC 프루닝(`docs/05` §3 D18)이 클라이언트 요청을 깨뜨리지 않는지(`<a>`만 사용, 뒤로가기 포함), 파일 수 < 16,000.

## 3. 출력 형식

- Findings를 **P1(치명) / P2(중요) / P3(사소)** 순으로. 각 항목: 한 줄 요약 + `파일:라인` 근거 + 실패 시나리오 + 수정 제안.
- 근거 없는 지적 금지. 실행한 명령과 확인 방법을 명시하고, 실행하지 못한 게이트는 그 사실을 적는다.
- 마지막에: 종합 판정 한 문단 + "다음 태스크 전에 잠가야 할 톱3".
