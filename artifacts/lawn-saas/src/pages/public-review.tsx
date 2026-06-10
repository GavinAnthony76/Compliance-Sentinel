import { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import { Star, CheckCircle2 } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { usePageMeta } from '@/hooks/use-page-meta';

interface PublicReview {
  reviewerName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface CompanyReviews {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reviews: PublicReview[];
}

function StarRating({ value, onChange, size = 'lg' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'lg' }) {
  const [hover, setHover] = useState(0);
  const dim = size === 'lg' ? 'w-9 h-9' : 'w-4 h-4';
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const active = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={!onChange}
            onClick={() => onChange?.(n)}
            onMouseEnter={() => onChange && setHover(n)}
            onMouseLeave={() => onChange && setHover(0)}
            className={onChange ? 'transition-transform hover:scale-110' : 'cursor-default'}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            <Star className={`${dim} ${active ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
          </button>
        );
      })}
    </div>
  );
}

export function PublicReviewPage() {
  const [, params] = useRoute('/review/:slug');
  const slug = params?.slug ?? '';

  const [data, setData] = useState<CompanyReviews | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [reviewerName, setReviewerName] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  usePageMeta({
    title: data?.companyName ? `Leave a Review for ${data.companyName}` : 'Leave a Review',
    description: 'Share your experience and help others find great local service.',
    noIndex: true,
  });

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/public/reviews/${slug}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then(d => { if (d) setData(d); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!reviewerName.trim()) { setError('Please enter your name.'); return; }
    if (rating < 1) { setError('Please select a star rating.'); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/reviews/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerName: reviewerName.trim(), rating, comment: comment.trim() || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.message || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Company not found</h1>
          <p className="text-muted-foreground">This review link is invalid or no longer active.</p>
        </div>
      </div>
    );
  }

  const avg = data.reviews.length > 0
    ? (data.reviews.reduce((s, r) => s + r.rating, 0) / data.reviews.length)
    : 0;

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          {data.logoUrl ? (
            <img src={data.logoUrl} alt={data.companyName} className="h-14 mx-auto mb-4 object-contain" />
          ) : null}
          <h1 className="text-2xl md:text-3xl font-bold">{data.companyName}</h1>
          {data.reviews.length > 0 && (
            <div className="flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
              <StarRating value={Math.round(avg)} size="sm" />
              <span>{avg.toFixed(1)} · {data.reviews.length} review{data.reviews.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6 md:p-8">
          {submitted ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-1">Thank you!</h2>
              <p className="text-muted-foreground">Your review has been submitted and will appear once approved.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <h2 className="text-lg font-bold">Leave a review</h2>
              <div>
                <label className="text-sm font-medium block mb-2">Your rating *</label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Your name *</label>
                <Input value={reviewerName} onChange={e => setReviewerName(e.target.value)} placeholder="Jane Doe" maxLength={120} required />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Comments</label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Tell us about your experience..."
                  maxLength={2000}
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit review'}
              </Button>
            </form>
          )}
        </div>

        {data.reviews.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground px-1">Recent reviews</h3>
            {data.reviews.map((r, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-semibold text-sm">{r.reviewerName}</span>
                  <StarRating value={r.rating} size="sm" />
                </div>
                {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground pt-2">
          Powered by <span className="font-semibold">GreenSynk</span>
        </p>
      </div>
    </div>
  );
}
