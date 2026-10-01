/** 원화 환산 환율 (scripts/sync-fx.ts, D61) — ECB 일일 XML 해석 */
import { describe, expect, it } from 'vitest';
import { parseEcbDaily } from './sync-fx';

const XML = `<gesmes:Envelope><Cube><Cube time='2026-10-01'>
<Cube currency='USD' rate='1.1298'/><Cube currency='JPY' rate='170.1'/><Cube currency='KRW' rate='1537.96'/>
</Cube></Cube></gesmes:Envelope>`;

describe('parseEcbDaily', () => {
  it('cross rate KRW per USD = EUR→KRW ÷ EUR→USD, 2 decimals, with the ECB date', () => {
    expect(parseEcbDaily(XML)).toEqual({ usdKrw: 1361.27, asOf: '2026-10-01' });
  });
  it('throws when a currency is missing', () => {
    expect(() => parseEcbDaily(XML.replace("<Cube currency='KRW' rate='1537.96'/>", ''))).toThrow(/missing/);
  });
});
