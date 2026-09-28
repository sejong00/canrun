import { useTranslations } from 'next-intl';
import { JsonLd } from '@/components/json-ld';
import { faqJsonLd, type QA } from '@/lib/jsonld';

/**
 * FAQ — 화면의 문답과 FAQPage JSON-LD 가 같은 문자열 (docs/04 §5, 결정 D8).
 * 답은 페이지 고유 수치를 담은 messages 템플릿에서 만든다 (docs/01 F3 "수치 기반").
 */
export function Faq({ items }: { items: readonly QA[] }) {
  const t = useTranslations('Faq');
  return (
    <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
      <h2 id="faq-heading" className="text-xl font-semibold tracking-tight">
        {t('title')}
      </h2>
      <div className="flex flex-col gap-4" data-faq>
        {items.map((qa) => (
          <div key={qa.question}>
            <h3 className="font-medium" data-faq-question>
              {qa.question}
            </h3>
            <p className="mt-1 text-muted-foreground" data-faq-answer>
              {qa.answer}
            </p>
          </div>
        ))}
      </div>
      <JsonLd data={faqJsonLd(items)} />
    </section>
  );
}
