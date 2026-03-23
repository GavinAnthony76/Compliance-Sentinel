import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { Button, Card, CardContent } from '@/components/ui';
import { ArrowLeft, FileText, PenLine, CheckCircle, Leaf } from 'lucide-react';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft:    { label: 'Draft',    className: 'bg-gray-100 text-gray-700' },
    sent:     { label: 'Sent',     className: 'bg-blue-100 text-blue-800' },
    accepted: { label: 'Accepted', className: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${s.className}`}>{s.label}</span>;
}

export function PortalEstimatesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { isLoading, isAuthenticated, session, portalFetch } = usePortalAuth();
  const [, setLocation] = useLocation();
  const [estimates, setEstimates] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation(`/portal/${slug}/login`);
  }, [isLoading, isAuthenticated, slug, setLocation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    portalFetch('/api/portal/estimates').then(r => r.json()).then(data => {
      setEstimates(Array.isArray(data) ? data : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href={`/portal/${slug}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Leaf className="w-6 h-6 fill-primary" />
            {session?.company.name}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Estimates</h1>

        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : estimates.length === 0 ? (
          <Card className="border-border/50"><CardContent className="py-12 text-center text-muted-foreground">No estimates found.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {estimates.map(est => (
              <Card key={est.id} className="border-border/50">
                <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    {est.signedAt
                      ? <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                      : <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                    }
                    <div>
                      <p className="font-semibold">{est.estimateNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(est.createdAt).toLocaleDateString()}
                        {est.signedAt && ` · Signed ${new Date(est.signedAt).toLocaleDateString()}`}
                      </p>
                      {est.notes && <p className="text-xs text-muted-foreground mt-0.5">{est.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-auto">
                    <div className="text-right">
                      <p className="font-bold text-lg">${Number(est.total).toFixed(2)}</p>
                      <StatusBadge status={est.status} />
                    </div>
                    {est.publicToken && !est.signedAt && est.status !== 'rejected' && (
                      <Link href={`/estimates/${est.publicToken}/sign`}>
                        <Button size="sm" variant="outline">
                          <PenLine className="w-4 h-4 mr-1" /> Sign
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
