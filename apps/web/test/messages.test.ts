/**
 * messages/{en,ko,zh}.json 대칭 — CLAUDE.md 규칙 4 (사용자 노출 문자열은 전부 messages, 로캘 동시).
 * 키 집합·ICU 인자명이 en 과 같고 빈 문자열이 없어야 한다. 한쪽에만 키가 있으면 다른 로케일 페이지가
 * 런타임에 키 이름을 그대로 노출한다.
 *
 * zh(10-19 D109) — 화면 문구만 사용자 승인 기계번역(간체·중국 본토 표기, 용어집 docs/04 §6). 여기서 지키는 규칙:
 * 한글 없음(언어 선택의 `LocaleSwitcher.ko` 만), 번체 전용 글자·대만식 용어 없음, ICU 복수형 `other` 분기, 你(您 아님),
 * 단정 표현·판정 동의어 없음, 한자 바로 뒤 반각 쉼표·쌍점·쌍반점 없음. 판정 이름(용어집)은 번역이 들어온 뒤 고정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../messages/', import.meta.url));
const load = (locale: string) =>
  JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8')) as Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value as Record<string, unknown>, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

/** ICU 최상위 인자명 ({name}, {count, plural, …}) — 중첩 분기 안의 # 는 제외 */
function icuArgs(message: string): string[] {
  const args = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?:,|\})/g)) {
    args.add(match[1]!);
  }
  return [...args].sort();
}

const en = flatten(load('en'));
const ko = flatten(load('ko'));
const zh = flatten(load('zh'));
const OTHERS = { ko, zh } as const;

describe('messages en/ko/zh parity (CLAUDE.md rule 4)', () => {
  for (const [locale, other] of Object.entries(OTHERS)) {
    it(`${locale} has the same key set as en`, () => {
      expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
    });

    it(`${locale} uses the same ICU arguments per key`, () => {
      for (const [key, enMessage] of en) {
        const message = other.get(key);
        if (message === undefined) continue;
        expect(icuArgs(message), `${locale} ${key}`).toEqual(icuArgs(enMessage));
      }
    });
  }

  it('have no empty strings', () => {
    for (const [locale, map] of Object.entries({ en, ko, zh })) {
      for (const [key, value] of map) expect(value.trim(), `${locale} ${key}`).not.toBe('');
    }
  });

  it('name every routed locale by its endonym in the language switcher, the same in every file (10-19 D109)', () => {
    for (const map of [en, ko, zh]) {
      expect(['en', 'ko', 'zh'].map((l) => map.get(`LocaleSwitcher.${l}`))).toEqual(['English', '한국어', '中文']);
    }
  });
});

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
/** 한자(CJK 통합·확장 A·호환) */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 번체 전용 글자 — 간체에서는 다른 글자를 쓴다(괄호 안이 간체). 간체와 같은 글자(境·景·卡·硬 …)는 넣지 않는다.
 * 顯(显) 記(记) 憶(忆) 體(体) 預(预) 設(设) 視(视) 訊(讯) 為(为) 這(这) 個(个) 們(们) 與(与) 說(说) 時(时) 間(间) 對(对) 頁(页) 載(载) 開(开) 關(关) …
 */
const TRADITIONAL_ONLY = new Set(
  [
    '顯記憶體預設視訊為這個們與說時間對頁載開關選擇資檔網機處運轉號碼價備電腦實測較無環筆臺輸結線擴優參數圖標準試據類達過還會從後裡長見給讓認識報單層級專業屬應該寬頻內儲讀寫執鍵盤點擊確請問題錯誤舊啟動',
    '歡幫隱條聯繫導覽尋篩費貨幣圓韓國語簡華東亞歐傳統雲響隨際戶帳錄證書樣範註釋匯場稱適項籤欄狀態總劃礎濟慮滿夠雙階壓縮調節樂觀盡約經驗麼嗎於係製週畫灣鐘產區極質縣銷購買發佈軟',
    '億萬氣學習譯變張將並隻復雜計閱務簽驅歷寶難雖斷續舉戰現圍爾邊頂額輕鬆頭馬黃齊龍門陽陰陳隊離靈順須領顏風飛餘館驟髮鬥麵黨齒裏綫佔與',
  ]
    .join('')
    .split(''),
);
/** 대만·홍콩식 용어 중 간체와 같은 글자로 쓰는 것 — 본토 표기(괄호): 程式(程序) 影片(视频) 介面(界面) 支援(支持) 效能(性能) 解析度(分辨率) 登入(登录) 滑鼠(鼠标) 硬碟(硬盘) 晶片(芯片) 伺服器(服务器) */
const TAIWAN_TERMS = ['程式', '影片', '介面', '支援', '效能', '解析度', '登入', '滑鼠', '硬碟', '晶片', '伺服器'];
/** 단정 표현(CLAUDE.md 규칙 3 — 추정치는 밴드·라벨, 단정 금지)·판정 동의어(용어집: 运行流畅/运行良好/运行较慢/无法运行 만) */
const ZH_BANS: ReadonlyArray<[RegExp, string]> = [
  [/您/, 'address the reader with 你, not 您'],
  [/保证|一定|完美|最强/, 'assertive wording'],
  [/顺畅|流利/, 'verdict synonym — the glossary uses 运行流畅'],
  [/[\u4e00-\u9fff][,;:]/, 'half-width , ; : right after a Chinese character — use ，；：'],
];

/** 아직 번역 전(en 사본)인지 — 병렬 번역이 합쳐지기 전 브랜치 상태. 용어집 값 고정 검사만 이때 건너뛴다 */
const ZH_IS_EN_COPY = [...zh].every(([key, value]) => key === 'LocaleSwitcher.label' || value === en.get(key));

describe('zh messages (10-19 D109 — Simplified Chinese, mainland conventions, docs/04 §6)', () => {
  it('carry no Hangul except the Korean endonym in the language switcher', () => {
    const bad = [...zh].filter(([key, value]) => key !== 'LocaleSwitcher.ko' && HANGUL.test(value)).map(([key, value]) => `${key}: ${value}`);
    expect(bad).toEqual([]);
  });

  it('use Simplified characters only — no Traditional-only characters, no Taiwan/HK terms', () => {
    const bad: string[] = [];
    for (const [key, value] of zh) {
      const trad = [...value].filter((ch) => TRADITIONAL_ONLY.has(ch));
      if (trad.length > 0) bad.push(`${key}: Traditional ${[...new Set(trad)].join('')} — ${value}`);
      for (const term of TAIWAN_TERMS) if (value.includes(term)) bad.push(`${key}: Taiwan/HK term ${term} — ${value}`);
    }
    expect(bad).toEqual([]);
  });

  it('keep an `other` branch in every plural (Chinese has only the `other` category)', () => {
    for (const [key, value] of zh) {
      if (/,\s*plural\s*,/.test(value)) expect(value, key).toMatch(/\bother\s*\{/);
    }
  });

  it('follow the style rules: 你 not 您, no assertive wording or verdict synonyms, full-width punctuation after Chinese', () => {
    const bad: string[] = [];
    for (const [key, value] of zh) for (const [re, why] of ZH_BANS) if (re.test(value)) bad.push(`${key}: ${why} — ${value}`);
    expect(bad).toEqual([]);
  });

  it.skipIf(ZH_IS_EN_COPY)('are translated, with the binding glossary verdict names (skipped while zh.json is still the English copy)', () => {
    expect(['S', 'A', 'B', 'F'].map((v) => zh.get(`Verdict.${v}`))).toEqual(['运行流畅', '运行良好', '运行较慢', '无法运行']);
    expect(zh.get('Verdict.legendTitle')).toBe('判定说明');
    // 번역이 들어왔다 = 영어 문장이 있는 메시지 대부분이 한자를 담는다 (제품 이름·ICU 인자만 있는 메시지는 그대로일 수 있다)
    const prose = [...en].filter(([, value]) => /[a-z]{3,}\s+[a-z]{2,}/.test(value.replace(/\{[^{}]*\}/g, '')));
    const translated = prose.filter(([key]) => HAN.test(zh.get(key) ?? ''));
    expect(translated.length / prose.length).toBeGreaterThan(0.9);
  });
});
