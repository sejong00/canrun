import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

// shadcn/ui 패턴(new-york). 레지스트리에서 추가되는 컴포넌트는 모두 이 형태를 따른다.
// 변형 정의는 `button-variants.ts` (클라이언트 아일랜드 공유, cn 없음).
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
