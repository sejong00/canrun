/**
 * 기본 공유 카드(og:image) 생성 — 1회성 개발 도구 (P1-5). 결과 PNG 를 커밋한다: `apps/web/public/og/default-{en,ko}.png`.
 * 새 의존성 없이 설치된 Playwright 로 HTML 을 1200×630 스크린샷한다. 문구는 messages(Site.name·Site.tagline·Home.intro).
 * 실행: `pnpm exec tsx scripts/make-og.ts` (Chrome 이 없는 PC 는 `OG_CHANNEL=msedge`).
 * GPU·모델 허브(D60)·공개 콤보·게시 가이드(D96) 카드는 빌드마다 scripts/og-cards.ts 가 그린다 — 미공개 콤보·초안·계산기·정적 페이지는 이 기본 카드.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'apps/web/public/og');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(process.env.OG_CHANNEL ? { channel: process.env.OG_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const locale of ['en', 'ko'] as const) {
    const m = JSON.parse(readFileSync(join(repoRoot, 'apps/web/messages', `${locale}.json`), 'utf8')) as {
      Site: { name: string; tagline: string };
      Home: { intro: string };
    };
    const font = locale === 'ko' ? "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" : "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    await page.setContent(`<!doctype html><html lang="${locale}"><body style="margin:0">
<div style="box-sizing:border-box;width:1200px;height:630px;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between;background:#0f172a;color:#f8fafc;font-family:${font}">
  <div style="font-size:40px;font-weight:700;letter-spacing:-0.5px">${esc(m.Site.name)}</div>
  <div>
    <div style="font-size:76px;font-weight:800;line-height:1.1;letter-spacing:-1.5px">${esc(m.Site.tagline)}</div>
    <div style="margin-top:28px;font-size:30px;line-height:1.45;color:#cbd5e1;max-width:1000px">${esc(m.Home.intro)}</div>
  </div>
  <div style="display:flex;gap:14px;font-size:26px;font-weight:600">
    <span style="padding:8px 18px;border-radius:999px;background:#14532d;color:#bbf7d0">${locale === 'ko' ? '쾌적' : 'Runs great'}</span>
    <span style="padding:8px 18px;border-radius:999px;background:#1e3a8a;color:#bfdbfe">${locale === 'ko' ? '원활' : 'Runs well'}</span>
    <span style="padding:8px 18px;border-radius:999px;background:#713f12;color:#fde68a">${locale === 'ko' ? '겨우 가능' : 'Runs slowly'}</span>
    <span style="padding:8px 18px;border-radius:999px;background:#7f1d1d;color:#fecaca">${locale === 'ko' ? '불가' : "Won't run"}</span>
  </div>
</div></body></html>`);
    await page.screenshot({ path: join(outDir, `default-${locale}.png`), type: 'png' });
    console.log(`og/default-${locale}.png`);
  }
  await browser.close();
}

void main();
