/**
 * 손으로 쓴 MDX 의 `<Expect>` 를 빌드 없이 확인한다 (10-14 D74, 개발 도구) — 가이드(`content/{en,ko}/guides`)와
 * 허브 소개글(`content/{en,ko}/hubs/{gpu,model}`), GPU 비교 소개글(`content/{en,ko}/compare` — 10-19 D106). 빌드의 `<Expect>` 컴포넌트와 같은 대조 함수(`lib/expect-claim.ts` checkExpect)를 부르므로 여기서 통과하면
 * 빌드에서도 통과한다(전체 빌드는 몇 분 걸린다). 다른 규칙(산문 숫자·컴포넌트 prop)은 유닛 테스트 몫.
 *
 *   cd apps/web && npx tsx scripts/check-expect.ts            # 전부
 *   cd apps/web && npx tsx scripts/check-expect.ts rtx-4060   # 파일 이름이 이 글자로 시작하는 것만
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkExpect, type ExpectClaim } from '@/lib/expect-claim';

const DIRS = ['guides', 'hubs/gpu', 'hubs/model', 'compare'];
const prefix = process.argv[2] ?? '';
let checked = 0;
const failures: string[] = [];
for (const locale of ['en', 'ko']) {
  for (const sub of DIRS) {
    const dir = join('content', locale, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.mdx') && f.startsWith(prefix))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(/<Expect\b([^>]*?)\/>/g)) {
        const props = Object.fromEntries([...m[1]!.matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map((p) => [p[1]!, p[2]!]));
        checked += 1;
        try {
          checkExpect(props as ExpectClaim);
        } catch (error) {
          failures.push(`${locale}/${sub}/${file}: ${(error as Error).message}`);
        }
      }
    }
  }
}
for (const line of failures) console.log(line);
console.log(`${checked} <Expect> checked, ${failures.length} failing`);
process.exitCode = failures.length > 0 ? 1 : 0;
