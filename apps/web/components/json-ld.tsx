import { serializeJsonLd } from '@/lib/jsonld';

/** JSON-LD 블록 — 데이터는 빌드 타임 카탈로그·messages 에서만 온다. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // serializeJsonLd 가 `<` 를 이스케이프한다 (스크립트 탈출 차단)
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
