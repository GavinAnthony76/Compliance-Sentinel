import logoUrl from '@/assets/greensynk-logo.svg';
import logoWhiteUrl from '@/assets/greensynk-logo-white.svg';
import { cn } from '@/lib/utils';

export function Logo({ className, alt = 'GreenSynk', variant = 'default' }: { className?: string; alt?: string; variant?: 'default' | 'white' }) {
  return <img src={variant === 'white' ? logoWhiteUrl : logoUrl} alt={alt} className={cn('w-auto object-contain', className)} />;
}
