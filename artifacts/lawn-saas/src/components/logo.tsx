import logoUrl from '@/assets/goshen-logo.png';
import logoWhiteUrl from '@/assets/goshen-logo-white.png';
import { cn } from '@/lib/utils';

export function Logo({ className, alt = 'Goshen Lawn Care Management', variant = 'default' }: { className?: string; alt?: string; variant?: 'default' | 'white' }) {
  return <img src={variant === 'white' ? logoWhiteUrl : logoUrl} alt={alt} className={cn('w-auto object-contain', className)} />;
}
