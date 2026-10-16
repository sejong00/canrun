/**
 * 콤보 페이지 문장 조립 — 헤더·FAQ 가 **같은 판정 문장**을 쓰고, 제목·description 은 같은 판정(`titleVerdict`)과
 * 같은 수치를 짧게 쓴다 (결정 D14, description 은 10-16 D95).
 * 모든 속도 문장은 밴드 + 신뢰 라벨을 동반한다 (CLAUDE.md 규칙 3) — speedPhrase, description 은 `metaSpeed`.
 */
import { maxCtxAtVerdict, titleVerdict, type QuantAssessment, type RamStep } from '@canrun/data';
import type { Locale } from '@/i18n/routing';
import type { ComboPage } from './combos';
import { formatCtx, formatGB, formatInt, formatSpeed, formatUSD } from './format';
import type { QA } from './jsonld';
import { confidenceText, gpuName, quantText, shortGpuName, speedPhrase, type Translate } from './phrases';

type Tr = Translate & { has?: (key: string) => boolean };

export type ComboTranslators = {
  combo: Tr;
  faq: Tr;
  common: Tr;
  confidence: Tr;
  verdict: Tr;
  names: Tr;
  hint: Tr;
  gpuHub: Tr;
};

/** 이 페이지 구성의 메모리 표기 ("8 GB" / "32 GB of unified memory" / "32 GB of RAM") */
export function comboMemoryLabel(t: ComboTranslators, page: ComboPage, locale: Locale): string {
  if (page.gpu.kind === 'dgpu') {
    return t.gpuHub('memoryVram', { vram: formatInt(locale, page.gpu.vramGB ?? 0) });
  }
  const max = formatInt(locale, page.config.ramGB);
  return page.gpu.kind === 'cpu'
    ? t.gpuHub('memoryRamOne', { max })
    : t.gpuHub('memoryUnifiedOne', { max });
}

/** 이 구성에서 "사용 가능한 메모리" — GPU 풀, CPU 프로필은 RAM */
export function usableGBFor(page: ComboPage, q: QuantAssessment): number {
  return page.gpu.kind === 'cpu' ? q.memory.ramUsableGB : q.memory.gpuUsableGB;
}

/** 제목에 붙는 판정 (D14) */
export function titleVerdictText(t: ComboTranslators, page: ComboPage, locale: Locale): string {
  const tv = titleVerdict(page.combo);
  switch (tv.kind) {
    case 'baseline':
      return t.verdict(tv.verdict);
    case 'quant':
      return t.combo('titleVerdictQuant', { verdict: t.verdict(tv.verdict), quant: tv.quant });
    case 'ram':
      return t.combo('titleVerdictRam', {
        verdict: t.verdict(tv.verdict),
        ram: formatInt(locale, tv.ramGB),
      });
    case 'none':
      return t.verdict('F');
  }
}

/** description 의 속도 — 밴드 + 신뢰 라벨만. 실측은 측정 조건(컨텍스트·건수)과 8k 추정이 붙는 speedPhrase 그대로 */
function descriptionSpeed(t: ComboTranslators, locale: Locale, q: QuantAssessment): string {
  if (q.result.confidence === 'measured') return speedPhrase(t.common, t.confidence, locale, q);
  const s = formatSpeed(locale, q.result);
  return t.combo('metaSpeed', { low: s.low, high: s.high, label: confidenceText(t.confidence, q.result) });
}

/**
 * meta description (10-16 D95) — 답부터 한 문장: 제목과 같은 판정 + 필요 메모리 + 속도 밴드·신뢰 라벨.
 * 배치 문장(VRAM 여유·시스템 RAM 몫·전문가 층 수 같은 판정 문장)은 헤더·FAQ 몫이라 넣지 않는다 — 그래픽카드 콤보가
 * 시스템 RAM 을 함께 쓰는지만 짧게 밝힌다.
 * 수치는 제목 판정이 가리키는 양자화 — 기준, 추천(기준이 불가), RAM 힌트 구성(`titleVerdict` 와 같은 갈래)
 */
export function comboDescription(t: ComboTranslators, page: ComboPage, locale: Locale): string {
  const { combo } = page;
  const tv = titleVerdict(combo);
  // GPU 는 제목과 같은 짧은 이름(D14 — "GeForce"·"Apple" 접두를 뗀다): 검색어 그대로이고 한국어 description 이 100자 안팎에 든다
  const names = { model: page.model.name, gpu: shortGpuName(gpuName(t.names, page.gpu)) };
  const gb = (v: number) => formatGB(locale, v);
  if (tv.kind === 'none') {
    // 기준 그대로(추천·RAM 힌트 없음) — 들어가지만 너무 느림 / 안 들어감
    const q = combo.display;
    const args = { ...names, verdict: t.verdict('F'), quant: quantText(t.hint, q), need: gb(q.memory.needGB) };
    return q.fReason === 'too-slow'
      ? t.combo('metaDescriptionTooSlow', { ...args, speed: descriptionSpeed(t, locale, q) })
      : t.combo('metaDescriptionNoFit', args);
  }
  const q = tv.kind === 'ram' ? combo.ramHint!.q : combo.display;
  // 그래픽카드보다 큰 필요량에 "원활"이 붙으면 모순처럼 읽힌다 — 시스템 RAM 을 함께 쓴다는 것만 밝힌다(몫·층 수는 본문)
  const split = page.gpu.kind === 'dgpu' && (q.result.mode === 'partial-offload' || q.result.mode === 'cpu-moe');
  return t.combo('metaDescription', {
    ...names,
    // RAM 힌트는 "RAM 64GB면 원활" 까지가 판정이다. 추천 양자화는 뒤의 "{quant} 기준" 이 밝힌다
    verdict: tv.kind === 'ram' ? titleVerdictText(t, page, locale) : t.verdict(tv.verdict),
    quant: quantText(t.hint, q),
    need: gb(q.memory.needGB),
    split: split ? t.combo('metaSplitRam') : '',
    speed: descriptionSpeed(t, locale, q),
  });
}

/** 판정 문장 — 헤더·description·FAQ Q1 의 단일 출처 */
export function verdictSentence(t: ComboTranslators, page: ComboPage, locale: Locale): string {
  const { combo, gpu } = page;
  const base = combo.baseline;
  const display = combo.display;
  const speed = (q: QuantAssessment) => speedPhrase(t.common, t.confidence, locale, q);
  const gb = (v: number) => formatGB(locale, v);
  let sentence: string;

  if (display.fReason === 'no-fit') {
    // 표시 quant 조차 미탑재 = 추천 없음
    const usable = usableGBFor(page, base);
    const short = Math.max(0, base.memory.needGB - usable);
    if (combo.ramHint) {
      sentence = t.combo('verdictNoFitRam', {
        quant: base.quant,
        need: gb(base.memory.needGB),
        short: gb(short),
        usable: gb(usable),
        ram: formatInt(locale, combo.ramHint.ramGB),
        altVerdict: t.verdict(combo.ramHint.verdict),
        altSpeed: speed(combo.ramHint.q),
      });
    } else {
      sentence = t.combo('verdictNoFit', {
        quant: base.quant,
        need: gb(base.memory.needGB),
        short: gb(short),
        usable: gb(usable),
        ram: formatInt(locale, page.config.ramGB),
      });
    }
    return sentence;
  }

  const verdict = t.verdict(display.result.verdict);
  const m = display.memory;
  if (display.fReason === 'too-slow') {
    sentence = t.combo('verdictTooSlow', {
      quant: display.quant,
      need: gb(m.needGB),
      speed: speed(display),
    });
  } else if (base.fReason === 'no-fit' && display.quant !== base.quant) {
    // 기준은 미탑재, 추천 quant 로는 가능 — "Q4_K_M 은 1.7GB 부족 → IQ3_XS 가능" 형식 (docs/01 F3)
    const usable = usableGBFor(page, base);
    sentence = t.combo('verdictNoFitAlt', {
      quant: base.quant,
      need: gb(base.memory.needGB),
      short: gb(Math.max(0, base.memory.needGB - usable)),
      usable: gb(usable),
      altQuant: quantText(t.hint, display),
      altVerdict: verdict,
      altSpeed: speed(display),
    });
  } else {
    switch (display.result.mode) {
      case 'full-gpu':
        sentence =
          gpu.kind === 'unified'
            ? t.combo('verdictUnified', {
                quant: display.quant,
                used: gb(m.needGB),
                usable: gb(m.gpuUsableGB),
                verdict,
                speed: speed(display),
              })
            : t.combo('verdictFullGpu', {
                quant: display.quant,
                headroom: gb(Math.max(0, m.gpuUsableGB - m.needGB)),
                verdict,
                speed: speed(display),
              });
        break;
      case 'partial-offload':
        // RAM 에 두는 가중치(파일 기준 — 입력 임베딩 포함, 엔진 RAM 검사와 같은 값) 하나만 GB 로 (10-03 D62).
        // 모자란 양은 그래픽카드 몫 기준이라 함께 쓰면 두 숫자가 GPU 밖 몫만큼 어긋난다
        sentence = t.combo('verdictPartial', {
          quant: display.quant,
          ram: gb(m.ramGB),
          verdict,
          speed: speed(display),
        });
        break;
      case 'cpu-moe': {
        // 전문가 층 일부를 GPU 에 둔 배치(10-01 D56)면 그 층 수까지, 전부 RAM 이면 기존 문장.
        // 세는 단위는 전문가가 있는 층(엔진 단위) — 전문가가 일부 층에만 있는 모델은 arch.expertLayers 길이(10-03 D63)
        const moeLayers = page.model.arch.expertLayers?.length ?? page.model.arch.layers;
        const gpuLayers = moeLayers - (display.result.cpuMoeLayers ?? moeLayers);
        sentence =
          gpuLayers > 0
            ? t.combo('verdictCpuMoePartial', {
                quant: display.quant,
                gpuLayers,
                gpuGB: gb(m.gpuGB),
                ramGB: gb(m.ramGB),
                verdict,
                speed: speed(display),
              })
            : t.combo('verdictCpuMoe', {
                quant: display.quant,
                gpuGB: gb(m.gpuGB),
                ramGB: gb(m.ramGB),
                verdict,
                speed: speed(display),
              });
        break;
      }
      case 'cpu-only':
        sentence = t.combo('verdictCpuOnly', {
          quant: display.quant,
          ramGB: gb(m.ramGB),
          verdict,
          speed: speed(display),
        });
        break;
    }
    if (base.fReason === 'too-slow' && display.quant !== base.quant) {
      sentence =
        t.combo('verdictTooSlow', { quant: base.quant, need: gb(base.memory.needGB), speed: speed(base) }) +
        t.combo('altSuffix', { altQuant: quantText(t.hint, display), altVerdict: verdict, altSpeed: speed(display) });
    }
  }

  if (combo.lastResort && display.tier !== 'desperate') {
    sentence += t.combo('lastResortSuffix', {
      quant: combo.lastResort.quant,
      verdict: t.verdict(combo.lastResort.result.verdict),
      speed: speed(combo.lastResort),
    });
  }
  return sentence;
}

/**
 * 시스템 RAM 토글의 단계 문장 (10-03 D64 리뷰 반영) — "시스템 RAM 16GB 기준: " + 헤더와 같은 판정 문장 규칙.
 * 단, 그 RAM 에서 기준 양자화가 안 들어가면 VRAM 몫만 말하는 `verdictNoFit*`(모자란 양이 RAM 단계마다 같다) 대신
 * 시스템 RAM 몫으로 말한다: dGPU 에서 들어가는 양자화의 RAM 몫은 RAM 용량과 무관하므로(combo.test) 그 양자화가
 * 들어가는 더 큰 단계에서 읽고, 계단 끝(128GB)에서도 안 들어가면 그 사실만 말한다. RAM 힌트 꼬리("RAM 96GB 구성의
 * 판정")는 붙이지 않는다 — 목록과 라디오가 이미 그 RAM 을 보여 준다.
 */
export function ramStepSentence(t: ComboTranslators, page: ComboPage, step: RamStep, locale: Locale): string {
  const prefix = t.combo('hintPrefix', { ram: formatInt(locale, step.ramGB) });
  const { baseline: base, display } = step.combo;
  if (base.fReason !== 'no-fit') {
    return prefix + verdictSentence(t, { ...page, combo: step.combo, config: step.config }, locale);
  }
  const gb = (v: number) => formatGB(locale, v);
  const usable = base.memory.ramUsableGB;
  const fitting = page.ramSteps
    .map((s) => s.combo.perQuant.find((x) => x.quant === base.quant))
    .find((x) => x?.fits);
  let sentence: string;
  if (!fitting) {
    sentence = t.combo('ramStepNoFitAny', {
      quant: base.quant,
      max: formatInt(locale, page.ramSteps.at(-1)?.ramGB ?? step.ramGB),
    });
  } else if (gb(fitting.memory.ramGB) === gb(usable)) {
    // 반올림하면 같은 수(gpt-oss-120b 64GB: 60.004 vs 60) — "60.0GB 가 필요한데 60.0GB" 로 읽히지 않게
    sentence = t.combo('ramStepNoFitTight', { quant: base.quant, usable: gb(usable) });
  } else {
    sentence = t.combo('ramStepNoFit', { quant: base.quant, need: gb(fitting.memory.ramGB), usable: gb(usable) });
  }
  // 기준이 안 들어가면 표시 양자화는 추천(F 아님)이거나 기준 그대로(미탑재) — 표시가 F 면 쓸 만한 파일이 없다
  if (display.result.verdict === 'F') {
    sentence += t.combo('ramStepNone');
  } else {
    sentence += t.combo('altSuffix', {
      altQuant: quantText(t.hint, display),
      altVerdict: t.verdict(display.result.verdict),
      altSpeed: speedPhrase(t.common, t.confidence, locale, display),
    });
  }
  const { lastResort } = step.combo;
  if (lastResort && display.tier !== 'desperate') {
    sentence += t.combo('lastResortSuffix', {
      quant: lastResort.quant,
      verdict: t.verdict(lastResort.result.verdict),
      speed: speedPhrase(t.common, t.confidence, locale, lastResort),
    });
  }
  return prefix + sentence;
}

/** FAQ 3문항 (docs/04 §4 ⑧) — 표와 같은 계산 결과에서 수치를 뽑는다 */
export function comboFaq(t: ComboTranslators, page: ComboPage, locale: Locale, sentence: string): QA[] {
  const { combo, model, gpu, matrix } = page;
  const name = gpuName(t.names, gpu);
  const display = combo.display;
  const gb = (v: number) => formatGB(locale, v);
  const speed = (q: QuantAssessment) => speedPhrase(t.common, t.confidence, locale, q);
  const items: QA[] = [];

  // Q1 — 판정 + 필요/가용 (CPU·통합은 풀이 하나라 "GPU 가용 + 여유 RAM" 병기가 오도)
  const runArgs = {
    sentence,
    quant: display.quant,
    need: gb(display.memory.needGB),
    usable: gb(usableGBFor(page, display)),
    ram: gb(display.memory.ramUsableGB),
  };
  items.push({
    question: t.faq('comboRunQ', { model: model.name, gpu: name }),
    answer: t.faq(gpu.kind === 'cpu' ? 'comboRunACpu' : gpu.kind === 'unified' ? 'comboRunAUnified' : 'comboRunA', runArgs),
  });

  // Q2 — 컨텍스트 (표시 quant 의 판정을 유지하는 최대 ctx, f16 / q8_0)
  const q = page.q;
  const verdict = q.result.verdict;
  // fits 면 판정을 유지하는 최대 ctx. too-slow(F 지만 fits)는 바닥이 없으니 "들어가는" 최대 ctx 가 된다
  const ctxF16 = q.fits ? maxCtxAtVerdict(matrix, 'f16', verdict) : undefined;
  const ctxQ8 = q.fits ? maxCtxAtVerdict(matrix, 'q8_0', verdict) : undefined;
  const cellAt = (ctx: number, kv: 'f16' | 'q8_0') =>
    matrix.rows[matrix.ctxs.indexOf(ctx)]![matrix.kvQuants.indexOf(kv)]!;
  const first = matrix.rows[0]![0]!;
  // F 페이지의 표·속도는 RAM 힌트 구성 기준 — 답변 앞에 그 구성을 밝힌다 (페이지 본문과 동일)
  const hintPrefix = page.usesRamHint ? t.combo('hintPrefix', { ram: formatInt(locale, page.qConfig.ramGB) }) : '';
  items.push({
    question: t.faq('comboCtxQ', { model: model.name, gpu: name }),
    answer:
      hintPrefix +
      (ctxF16 !== undefined
        ? t.faq(verdict === 'F' ? 'comboCtxTooSlowA' : 'comboCtxA', {
            quant: q.quant,
            verdict: t.verdict(verdict),
            speed: speed(q),
            ctxF16: formatCtx(ctxF16),
            kvF16: gb(cellAt(ctxF16, 'f16').kvGB),
            ctxQ8: formatCtx(ctxQ8 ?? ctxF16),
            kvQ8: gb(cellAt(ctxQ8 ?? ctxF16, 'q8_0').kvGB),
            maxModel: formatCtx(model.maxContext),
          })
        : t.faq('comboCtxNoneA', {
            quant: q.quant,
            need: gb(first.needGB),
            usable: gb(usableGBFor(page, q)),
          })),
  });

  // Q3 — quant 선택
  let answer: string;
  const size = (x: QuantAssessment) => formatGB(locale, x.fileGB, 2);
  const fitting = combo.perQuant.filter((x) => x.fits);
  if (display.result.verdict === 'F') {
    // 추천 없음 — RAM 힌트 > 들어가지만 전부 너무 느림 > 아무것도 안 들어감 (메모리 문제) 순으로 원인을 말한다
    if (combo.ramHint) {
      answer = t.faq('comboQuantNoneRamA', {
        ram: formatInt(locale, page.config.ramGB),
        hintRam: formatInt(locale, combo.ramHint.ramGB),
        quant: quantText(t.hint, combo.ramHint.q),
        verdict: t.verdict(combo.ramHint.verdict),
        speed: speed(combo.ramHint.q),
      });
    } else if (fitting.length > 0) {
      const fastest = [...fitting].sort((a, b) => b.result.tgTokS.est - a.result.tgTokS.est)[0]!;
      answer = t.faq('comboQuantTooSlowA', { quant: quantText(t.hint, fastest), size: size(fastest), speed: speed(fastest) });
    } else {
      const smallest = [...combo.perQuant].sort((a, b) => a.fileGB - b.fileGB)[0]!;
      answer = t.faq(
        gpu.kind === 'cpu' ? 'comboQuantNoneACpu' : gpu.kind === 'unified' ? 'comboQuantNoneAUnified' : 'comboQuantNoneA',
        {
          minQuant: quantText(t.hint, smallest),
          minSize: size(smallest),
          minNeed: gb(smallest.memory.needGB),
          usable: gb(usableGBFor(page, smallest)),
          ram: gb(smallest.memory.ramUsableGB),
        },
      );
    }
  } else if (combo.perQuant.length === 1) {
    answer = t.faq('comboQuantOnlyA', {
      quant: quantText(t.hint, display),
      size: size(display),
      verdict: t.verdict(display.result.verdict),
      speed: speed(display),
    });
  } else {
    const largestSame = combo.perQuant
      .filter((x) => x.result.verdict === display.result.verdict && x.tier !== 'desperate')
      .sort((a, b) => b.fileGB - a.fileGB)[0];
    const base = {
      quant: quantText(t.hint, display),
      size: size(display),
      verdict: t.verdict(display.result.verdict),
      speed: speed(display),
    };
    answer =
      largestSame && largestSame.quant !== display.quant
        ? t.faq('comboQuantA', {
            ...base,
            altVerdict: t.verdict(largestSame.result.verdict),
            altQuant: largestSame.quant,
            altSize: size(largestSame),
            altSpeed: speed(largestSame),
          })
        : t.faq('comboQuantSameA', base);
  }
  items.push({ question: t.faq('comboQuantQ'), answer });
  return items;
}

/** 대안 카드의 GPU 가격 문구 — 실거래가 + 기준일 (규칙 2) */
export function pricedGpuText(t: ComboTranslators, locale: Locale, gpu: string, priceUSD: number, priceAsOf: string, speed: string): string {
  return t.combo('gpuBody', { gpu, price: formatUSD(locale, priceUSD), date: priceAsOf, speed });
}
