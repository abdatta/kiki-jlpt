import type { HTMLAttributes } from 'react';
import brandLogoSvg from '../assets/brand-mark.svg?raw';

interface BrandLogoProps extends HTMLAttributes<HTMLSpanElement> {
  title?: string;
}

export function BrandLogo({ title, ...props }: BrandLogoProps) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? 'img' : undefined}
      dangerouslySetInnerHTML={{ __html: brandLogoSvg }}
      {...props}
    />
  );
}
