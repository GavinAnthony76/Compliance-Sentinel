import { cn } from '@/lib/utils';

/**
 * Renders a mailto link for a platform contact address loaded from the API.
 * While the address is still loading (undefined), shows a muted placeholder so
 * no email is ever hardcoded in the calling page.
 */
export function ContactEmailLink({ email, className }: { email?: string; className?: string }) {
  if (!email) {
    return <span className={cn('text-muted-foreground', className)}>…</span>;
  }
  return (
    <a href={`mailto:${email}`} className={cn('text-primary hover:underline', className)}>
      {email}
    </a>
  );
}
