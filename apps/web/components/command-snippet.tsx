import type { CommandPlan } from '@canrun/data';
import { useLocale, useTranslations } from 'next-intl';
import { formatGB, formatInt } from '@/lib/format';

/**
 * 실행 커맨드 (docs/04 §4 ⑦, docs/01 §9) — llama.cpp / Ollama 블록. 명령 문자열은 데이터 레이어(snippet.ts)
 * 가 만들고 여기서는 설명(각주)만 번역한다. <pre> 는 가로 스크롤 영역이라 region + tabindex (a11y).
 */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-md border border-border bg-muted p-3 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <pre className="text-xs leading-5 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CommandSnippet({
  plan,
  kvGB,
  hintRamGB,
}: {
  plan: CommandPlan;
  /** 8k 기준 q8_0 KV 캐시 크기 (각주용) */
  kvGB: number;
  /** F 페이지: RAM 힌트 구성으로 만든 명령임을 밝힌다 */
  hintRamGB?: number;
}) {
  const locale = useLocale();
  const t = useTranslations('Snippet');
  const gb = (v: number) => formatGB(locale, v, 2);

  if (!plan.llamaCpp) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        {t('noFit', { usable: '—', ram: '—' })}
      </p>
    );
  }

  const llama = plan.llamaCpp;
  const notes: string[] = [];
  if (llama.ngl === 'all') notes.push(t('nglAll'));
  else if (llama.ngl === 0) notes.push(t('nglZero'));
  else notes.push(t('nglN', { n: llama.ngl, layers: plan.layers }));
  if (llama.nCpuMoe !== undefined) {
    notes.push(t('cpuMoe', { n: llama.nCpuMoe }));
    if (llama.nCpuMoeMin !== undefined && llama.nCpuMoeMin < llama.nCpuMoe) {
      notes.push(t('cpuMoeMin', { min: llama.nCpuMoeMin }));
    }
  }
  notes.push(t('fa'));
  notes.push(t('kv', { kv: gb(kvGB) }));

  const fileText =
    plan.file.shards > 1
      ? t('fileSharded', {
          file: plan.file.name ?? plan.file.tag,
          rest: plan.file.shards - 1,
          size: gb(plan.file.fileGB),
          repo: plan.file.repo,
        })
      : t('file', { file: plan.file.name ?? plan.file.tag, size: gb(plan.file.fileGB), repo: plan.file.repo });

  const ollamaNotes: string[] = [t('ctx')];
  if (plan.ollama?.autoOffload) ollamaNotes.push(t('ollamaAutoOffload'));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('intro', { quant: plan.file.tag })}</p>
      {hintRamGB !== undefined && (
        <p className="text-sm text-muted-foreground">{t('hintConfig', { ram: formatInt(locale, hintRamGB) })}</p>
      )}
      <p className="text-sm break-all">{fileText}</p>

      <figure data-snippet="llama.cpp" className="flex flex-col gap-2">
        <figcaption className="font-medium">{t('llamaCpp')}</figcaption>
        <CodeBlock code={llama.command} label={t('llamaCpp')} />
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </figure>

      <figure {...(plan.ollama ? { 'data-snippet': 'ollama' } : { 'data-snippet-omitted': 'ollama' })} className="flex flex-col gap-2">
        <figcaption className="font-medium">{t('ollama')}</figcaption>
        {plan.ollama ? (
          <>
            <p className="text-xs text-muted-foreground">
              {plan.os === 'windows' ? t('serveWindows') : t('serveUnix')}
            </p>
            <CodeBlock code={`${plan.ollama.serve}\n${plan.ollama.run}`} label={t('ollama')} />
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {ollamaNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              <li>
                <code>{plan.ollama.replSet}</code>
              </li>
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {plan.ollamaOmitted === 'sharded' ? t('ollamaSharded') : t('ollamaNoMoe')}
          </p>
        )}
      </figure>
    </div>
  );
}
