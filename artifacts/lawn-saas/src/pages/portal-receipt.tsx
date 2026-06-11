import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Button, Card, CardContent } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Leaf, Printer, ArrowLeft, FileText, Download } from 'lucide-react';

export function PortalReceiptView({
  invoiceId,
  slug,
  companyName,
  customerName,
  portalFetch,
  onDone,
}: {
  invoiceId: string | null;
  slug: string;
  companyName?: string;
  customerName?: string;
  portalFetch: any;
  onDone: () => void;
}) {
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!invoiceId) {
      setError(true);
      setLoading(false);
      return;
    }
    let active = true;
    portalFetch(`/api/portal/invoices/${invoiceId}`)
      .then((r: any) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((data: any) => {
        if (active) setInvoice(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invoiceId, portalFetch]);

  const paidDate = invoice?.paidAt ? new Date(invoice.paidAt) : new Date();
  const company = invoice?.companyName || companyName || 'Your provider';
  const isPaid = invoice?.status === 'paid';

  const handleDownloadReceipt = async () => {
    if (!invoiceId) return;
    setDownloading(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoiceId}/receipt-pdf`);
      if (!res.ok) throw new Error('Could not generate receipt');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${invoice?.invoiceNumber ?? invoiceId}.pdf`;
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

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`@media print {
        body { background: #fff !important; }
        .receipt-no-print { display: none !important; }
        .receipt-print-area { box-shadow: none !important; border: none !important; }
      }`}</style>

      <header className="bg-white border-b border-border sticky top-0 z-10 receipt-no-print">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Leaf className="w-6 h-6 fill-primary" />
            <span>{company}</span>
          </div>
          <button onClick={onDone} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <CheckCircle className="w-9 h-9 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">Payment successful</h1>
              <p className="text-muted-foreground mt-1">
                {error
                  ? 'Thank you! Your payment has been received.'
                  : `Thank you${customerName ? `, ${customerName}` : ''}! Your payment has been received.`}
              </p>
            </div>

            <Card className="border-border/50 receipt-print-area">
              <CardContent className="py-6">
                <div className="flex items-center gap-2 text-primary font-bold text-lg mb-1">
                  <Leaf className="w-5 h-5 fill-primary" />
                  <span>{company}</span>
                </div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-5">Payment Receipt</p>

                <dl className="space-y-3 text-sm">
                  {!error && invoice?.invoiceNumber && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Invoice</dt>
                      <dd className="font-medium">{invoice.invoiceNumber}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Date paid</dt>
                    <dd className="font-medium">
                      {paidDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Payment method</dt>
                    <dd className="font-medium">Card (online)</dd>
                  </div>
                  {!error && invoice && (
                    <div className="flex justify-between border-t border-border pt-3 mt-1 text-lg font-bold">
                      <dt>Amount paid</dt>
                      <dd>${Number(invoice.total).toFixed(2)}</dd>
                    </div>
                  )}
                </dl>

                {!error && invoice?.lineItems?.length > 0 && (
                  <div className="mt-6 border-t border-border pt-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Items</p>
                    <ul className="space-y-1.5 text-sm">
                      {invoice.lineItems.map((li: any) => (
                        <li key={li.id} className="flex justify-between">
                          <span className="text-muted-foreground">
                            {li.description}
                            {Number(li.quantity) > 1 ? ` × ${Number(li.quantity)}` : ''}
                          </span>
                          <span>${Number(li.lineTotal).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-muted-foreground mt-6 text-center">
                  A confirmation has been recorded for your account. Keep this receipt for your records.
                </p>
              </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row gap-3 mt-6 receipt-no-print">
              {isPaid && (
                <Button variant="outline" className="flex-1" onClick={handleDownloadReceipt} isLoading={downloading}>
                  <Download className="w-4 h-4 mr-2" /> Download Receipt
                </Button>
              )}
              <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-2" /> Print receipt
              </Button>
              <Link href={`/portal/${slug}/invoices`} className="flex-1">
                <Button variant="outline" className="w-full">
                  <FileText className="w-4 h-4 mr-2" /> View all invoices
                </Button>
              </Link>
              <Button className="flex-1" onClick={onDone}>
                Back to dashboard
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
