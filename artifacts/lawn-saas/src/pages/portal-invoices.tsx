import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { ArrowLeft, CreditCard, CheckCircle, Leaf, ChevronRight, Download } from 'lucide-react';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft:      { label: 'Draft',                 className: 'bg-gray-100 text-gray-700' },
    sent:       { label: 'Sent',                  className: 'bg-blue-100 text-blue-800' },
    paid:       { label: 'Paid',                  className: 'bg-green-100 text-green-800' },
    overdue:    { label: 'Overdue',               className: 'bg-red-100 text-red-800' },
    processing: { label: 'Payment in progress…',  className: 'bg-amber-100 text-amber-800' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${s.className}`}>
      {status === 'processing' && (
        <span className="w-2.5 h-2.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
      )}
      {s.label}
    </span>
  );
}

function PaymentMethodBadge({ method }: { method: string }) {
  const labels: Record<string, string> = {
    cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App',
    bank_transfer: 'Bank Transfer', card: 'Card', other: 'Other',
  };
  return <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">{labels[method] ?? method}</span>;
}

function InvoiceDetailPanel({ invoice, slug, onBack, portalFetch }: { invoice: any; slug: string; onBack: () => void; portalFetch: any }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    portalFetch(`/api/portal/invoices/${invoice.id}`)
      .then((r: any) => r.json())
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [invoice.id]);

  const handlePay = async () => {
    setPaying(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/pay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 || data.error === 'ChargeInProgress') {
          setDetail((d: any) => (d ? { ...d, status: 'processing' } : d));
          toast({ title: 'Payment in progress', description: 'This invoice is already being processed. Please wait a moment before trying again.' });
          return;
        }
        throw new Error(data.message || 'Payment error');
      }
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      toast({ title: 'Payment failed', description: err.message, variant: 'destructive' });
    } finally {
      setPaying(false);
    }
  };

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/pdf`);
      if (!res.ok) throw new Error('Could not generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err.message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadReceipt = async () => {
    setDownloadingReceipt(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/receipt-pdf`);
      if (!res.ok) throw new Error('Could not generate receipt');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err.message, variant: 'destructive' });
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const pc = detail?.paymentConfig;
  const methods: string[] = pc?.acceptedPaymentMethods ?? [];
  // Prefer the freshly-fetched detail status over the (possibly stale) list
  // item prop so the processing/paid state reflects the latest server value.
  const effectiveStatus = detail?.status ?? invoice.status;
  const isPaid = effectiveStatus === 'paid';
  const isProcessing = effectiveStatus === 'processing';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-5 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" />Back to Invoices
      </button>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-5">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl">{invoice.invoiceNumber}</CardTitle>
                  {detail?.companyName && <p className="text-sm text-muted-foreground mt-0.5">From {detail.companyName}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={effectiveStatus} />
                  <Button variant="outline" size="sm" onClick={handleDownloadPdf} isLoading={downloading}>
                    <Download className="w-4 h-4 mr-1.5" />PDF
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {detail?.lineItems?.length > 0 && (
                <div className="mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs">
                        <th className="text-left py-2">Description</th>
                        <th className="text-center py-2">Qty</th>
                        <th className="text-right py-2">Unit Price</th>
                        <th className="text-right py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {detail.lineItems.map((li: any) => (
                        <tr key={li.id}>
                          <td className="py-2">{li.description}</td>
                          <td className="py-2 text-center">{li.quantity}</td>
                          <td className="py-2 text-right">${Number(li.unitPrice).toFixed(2)}</td>
                          <td className="py-2 text-right font-medium">${Number(li.lineTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="border-t border-border pt-3 space-y-1 text-sm">
                {Number(detail?.tax) > 0 && (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span><span>${Number(detail?.subtotal).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax</span><span>${Number(detail?.tax).toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-lg pt-1">
                  <span>Total</span><span>${Number(invoice.total).toFixed(2)}</span>
                </div>
              </div>

              {invoice.dueDate && (
                <p className="text-xs text-muted-foreground mt-3">
                  Due {new Date(invoice.dueDate.split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              )}
              {invoice.notes && <p className="text-sm text-muted-foreground mt-2 italic">{invoice.notes}</p>}
            </CardContent>
          </Card>

          {!isPaid && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">How to Pay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {pc?.paymentInstructions && (
                  <p className="text-sm text-muted-foreground">{pc.paymentInstructions}</p>
                )}

                {methods.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {methods.map((m: string) => <PaymentMethodBadge key={m} method={m} />)}
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  {pc?.zelleInfo && methods.includes('zelle') && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-accent">
                      <span className="font-medium">Zelle</span>
                      <span className="text-muted-foreground">{pc.zelleInfo}</span>
                    </div>
                  )}
                  {pc?.venmoHandle && methods.includes('venmo') && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-accent">
                      <span className="font-medium">Venmo</span>
                      <span className="text-muted-foreground">{pc.venmoHandle}</span>
                    </div>
                  )}
                  {pc?.cashAppTag && methods.includes('cashapp') && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-accent">
                      <span className="font-medium">Cash App</span>
                      <span className="text-muted-foreground">{pc.cashAppTag}</span>
                    </div>
                  )}
                  {pc?.checkPayableTo && methods.includes('check') && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-accent">
                      <span className="font-medium">Check payable to</span>
                      <span className="text-muted-foreground">{pc.checkPayableTo}</span>
                    </div>
                  )}
                </div>

                {isProcessing ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <span className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-800">Payment in progress…</p>
                      <p className="text-sm text-amber-700">We're processing a payment for this invoice. This page will update once it's complete.</p>
                    </div>
                  </div>
                ) : (methods.includes('card') && detail?.companyPlan !== 'starter') ? (
                  <Button className="w-full" onClick={handlePay} isLoading={paying}>
                    <CreditCard className="w-4 h-4 mr-2" />Pay Online Now
                  </Button>
                ) : (
                  !pc?.paymentInstructions && !methods.includes('card') && (
                    <p className="text-sm text-muted-foreground">
                      Please contact your service provider to arrange payment.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          )}

          {isPaid && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
              <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-green-800">Payment Received</p>
                <p className="text-sm text-green-700">This invoice has been paid. Thank you!</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 bg-white" onClick={handleDownloadReceipt} isLoading={downloadingReceipt}>
                <Download className="w-4 h-4 mr-1.5" />Download Receipt
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PortalInvoicesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { isLoading, isAuthenticated, session, portalFetch } = usePortalAuth();
  const [, setLocation] = useLocation();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation(`/portal/${slug}/login`);
  }, [isLoading, isAuthenticated, slug, setLocation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    portalFetch('/api/portal/invoices').then((r: any) => r.json()).then((data: any) => {
      setInvoices(Array.isArray(data) ? data : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          {selectedInvoice ? (
            <button onClick={() => setSelectedInvoice(null)}>
              <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
            </button>
          ) : (
            <Link href={`/portal/${slug}`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
            </Link>
          )}
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Leaf className="w-6 h-6 fill-primary" />
            {session?.company.name}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {selectedInvoice ? (
          <InvoiceDetailPanel
            invoice={selectedInvoice}
            slug={slug}
            onBack={() => setSelectedInvoice(null)}
            portalFetch={portalFetch}
          />
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-6">Invoices</h1>

            {dataLoading ? (
              <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : invoices.length === 0 ? (
              <Card className="border-border/50">
                <CardContent className="py-12 text-center text-muted-foreground">No invoices found.</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {invoices.map(inv => (
                  <button
                    key={inv.id}
                    className="w-full text-left"
                    onClick={() => setSelectedInvoice(inv)}
                  >
                    <Card className="border-border/50 hover:border-primary/40 hover:shadow-sm transition-all">
                      <CardContent className="py-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {inv.status === 'paid'
                            ? <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                            : <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
                          }
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{inv.invoiceNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              {inv.dueDate ? `Due ${new Date(inv.dueDate).toLocaleDateString()}` : `Issued ${new Date(inv.createdAt).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="font-bold text-lg">${Number(inv.total).toFixed(2)}</p>
                            <StatusBadge status={inv.status} />
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
