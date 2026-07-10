import type { HTMLAttributes } from 'react';

const brandLogoUrl = new URL('../assets/brand-mark.svg', import.meta.url).href;

interface BrandLogoProps extends HTMLAttributes<HTMLSpanElement> {
  title?: string;
}

export function BrandLogo({ title, ...props }: BrandLogoProps) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? 'img' : undefined}
      {...props}
    >
      <img alt="" src={brandLogoUrl} />
    </span>
  );
}
