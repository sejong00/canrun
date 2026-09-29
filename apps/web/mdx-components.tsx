import type { ComponentPropsWithoutRef } from 'react';

/**
 * MDX 요소 매핑 (D38) — `@next/mdx` 가 App Router 에서 요구하는 파일. 가이드 본문(apps/web/content/{en,ko}/guides/*.mdx)의
 * 마크다운 요소를 기존 유틸 클래스로 스타일한다(typography 플러그인 없음). 서버 전용 — `'use client'`·`@mdx-js/react` 금지(D6·D34).
 *
 * - `#`(h1) 금지: h1 은 레지스트리 제목을 페이지 템플릿이 그린다 → 쓰면 빌드 실패
 * - `a` 는 외부 링크·같은 페이지 앵커만: 내부 링크는 로캘·게이트를 아는 `HubLink`/`GuideLink`/`ComboLink` 컴포넌트로 (D40·D44)
 * - 데이터 컴포넌트는 여기 넣지 않는다 — 가이드 페이지가 `components={guideComponents({ locale, slug })}` 로 주입
 */
function Anchor({ href = '', children, ...rest }: ComponentPropsWithoutRef<'a'>) {
  if (!/^https:\/\//.test(href) && !href.startsWith('#')) {
    throw new Error(`guide MDX: internal or non-https link "${href}" — use HubLink/GuideLink/ComboLink`);
  }
  return (
    <a href={href} className="underline underline-offset-4" {...rest}>
      {children}
    </a>
  );
}

const components = {
  h1: () => {
    throw new Error('guide MDX: "#" heading is not allowed — the page template renders the h1 from the registry');
  },
  h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 className="mt-10 text-xl font-semibold tracking-tight" {...props} />,
  h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 className="mt-6 text-lg font-semibold" {...props} />,
  p: (props: ComponentPropsWithoutRef<'p'>) => <p className="leading-7" {...props} />,
  ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul className="flex list-disc flex-col gap-1 pl-6 leading-7" {...props} />,
  ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol className="flex list-decimal flex-col gap-1 pl-6 leading-7" {...props} />,
  li: (props: ComponentPropsWithoutRef<'li'>) => <li {...props} />,
  a: Anchor,
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-2 border-border pl-4 text-muted-foreground" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<'code'>) => <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]" {...props} />,
  pre: (props: ComponentPropsWithoutRef<'pre'>) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-5" {...props} />
  ),
  strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong className="font-semibold" {...props} />,
  em: (props: ComponentPropsWithoutRef<'em'>) => <em {...props} />,
  hr: () => <hr className="my-8 border-border" />,
};

export function useMDXComponents(): typeof components {
  return components;
}
