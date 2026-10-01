/**
 * 원화 환산 환율 갱신 — 주간 data-sync 가 sync-models 다음에 돌린다 (10-01, PROGRESS §4 D61).
 * ECB 기준환율 XML(EUR 기준)에서 USD·KRW 를 읽어 1달러 = KRW/USD 원으로 `data/fx.json` 에 쓴다. 변화가 없으면 쓰지 않는다.
 * 실행: pnpm exec tsx scripts/sync-fx.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFx, type FxRate } from '../packages/data/src/index';

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** ECB 일일 XML → { usdKrw, asOf } (소수 2자리). 형식이 다르면 throw */
export function parseEcbDaily(xml: string): { usdKrw: number; asOf: string } {
  const asOf = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rate = (cur: string): number | undefined => {
    const m = new RegExp(`currency=['"]${cur}['"]\\s+rate=['"]([0-9.]+)['"]`).exec(xml);
    return m ? Number(m[1]) : undefined;
  };
  const usd = rate('USD');
  const krw = rate('KRW');
  if (!asOf || !usd || !krw || !Number.isFinite(usd) || !Number.isFinite(krw)) throw new Error('ECB daily XML: USD/KRW/time missing');
  return { usdKrw: Math.round((krw / usd) * 100) / 100, asOf };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fxPath = join(repoRoot, 'data/fx.json');

async function main() {
  const dry = process.argv.includes('--dry');
  const res = await fetch(ECB_DAILY_URL);
  if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
  const next = parseEcbDaily(await res.text());
  const current = parseFx(JSON.parse(readFileSync(fxPath, 'utf8')));
  if (current.usdKrw === next.usdKrw && current.asOf === next.asOf) {
    console.log(`fx unchanged: ${current.usdKrw} (${current.asOf})`);
    return;
  }
  const record: FxRate = { usdKrw: next.usdKrw, asOf: next.asOf, sources: [ECB_DAILY_URL] };
  console.log(`fx ${current.usdKrw} (${current.asOf}) → ${record.usdKrw} (${record.asOf})${dry ? ' [dry]' : ''}`);
  if (!dry) writeFileSync(fxPath, `${JSON.stringify(parseFx(record), null, 2)}\n`);
}

// 테스트에서 import 할 때는 실행하지 않는다
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
