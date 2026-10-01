/**
 * 콤보 페이지 문장 조립 — 제목·description·헤더·FAQ 가 **같은 판정 문장**을 쓴다 (결정 D14).
 * 모든 속도 문장은 speedPhrase(밴드 + 신뢰 라벨)를 거친다 (CLAUDE.md 규칙 3).
 */
import { maxCtxAtVerdict, titleVerdict, type QuantAssessment } from '@canrun/data';
import type { Locale } from '@/i18n/routing';
import type { ComboPage } from './combos';
import { formatCtx, formatGB, formatInt, formatUSD } from './format';
import type { QA } from './jsonld';
import { gpuName, quantText, speedPhrase, type Translate } from './phrases';

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

/** 페이지 가정을 짧게 (description 용) */
export function assumeShort(t: ComboTranslators, page: ComboPage, locale: Locale): string {
  const ram = formatInt(locale, page.config.ramGB);
  if (page.gpu.kind === 'dgpu') return t.combo('assumeShortDgpu', { ram });
  if (page.gpu.kind === 'unified') return t.combo('assumeShortUnified');
  return t.combo('assumeShortCpu');
}

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
        sentence = t.combo('verdictPartial', {
          quant: display.quant,
          short: gb(Math.max(0, m.needGB - m.gpuUsableGB)),
          cpuPct: Math.round((1 - (display.gpuFrac ?? 0)) * 100),
          verdict,
          speed: speed(display),
        });
        break;
      case 'cpu-moe': {
        // 전문가 층 일부를 GPU 에 둔 배치(10-01 D56)면 그 층 수까지, 전부 RAM 이면 기존 문장
        const gpuLayers = page.model.arch.layers - (display.result.cpuMoeLayers ?? page.model.arch.layers);
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
