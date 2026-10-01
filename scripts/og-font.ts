/**
 * 공유 카드 글꼴 서브셋 받기 — 1회성 개발 도구 (10-01, PROGRESS §4 D60). 결과를 커밋한다.
 * Google Fonts CSS API 에 카드 글자(`ogCardChars`)만 넘겨 Noto Sans KR Bold 의 TTF 서브셋을 받는다(SIL OFL 1.1).
 * 실행: `pnpm exec tsx scripts/og-font.ts` — og-cards.test.ts 가 "서브셋에 없는 글자" 로 실패할 때.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OG_FONT_CHARS_PATH, OG_FONT_PATH, ogCardChars } from './og-cards';

async function main() {
  const chars = ogCardChars();
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(chars)}`)).text();
  const url = /src:\s*url\(([^)]+)\)\s*format\('truetype'\)/.exec(css)?.[1];
  if (!url) throw new Error(`no truetype url in Google Fonts response:\n${css.slice(0, 400)}`);
  const font = Buffer.from(await (await fetch(url)).arrayBuffer());
  mkdirSync(dirname(OG_FONT_PATH), { recursive: true });
  writeFileSync(OG_FONT_PATH, font);
  writeFileSync(OG_FONT_CHARS_PATH, `${chars}\n`);
  console.log(`${OG_FONT_PATH}: ${font.length} bytes, ${[...chars].length} chars`);
}

void main();
