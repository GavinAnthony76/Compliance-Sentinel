import { useState } from 'react';
import { useListReviewRequests, useSendReviewRequest, useListCustomers } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button } from '@/components/ui';
import { Star, Plus, Mail, MessageSquare, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListReviewRequestsQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

export function ReviewsPage() {
  const { data, isLoading } = useListReviewRequests({ page: 1, limit: 50 } as any);
  const [showSend, setShowSend] = useState(false);
  const [form, setForm] = useState({ customerId: '', channel: 'email' as 'email' | 'sms' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const sendMut = useSendReviewRequest();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendMut.mutateAsync({ data: { customerId: Number(form.customerId), channel: form.channel } });
      toast({ title: 'Review request sent!' });
      qc.invalidateQueries({ queryKey: getListReviewRequestsQueryKey() });
      setShowSend(false);
    } catch {
      toast({ title: 'Error sending review request', variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <PlanGate feature="review_requests">
      {showSend && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-6">Send Review Request</h2>
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Customer *</label>
                <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
                  <option value="">Select customer...</option>
                  {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Channel</label>
                <div className="flex gap-3 mt-2">
                  {(['email', 'sms'] as const).map(ch => (
                    <button key={ch} type="button" onClick={() => setForm(f => ({ ...f, channel: ch }))}
                      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium flex items-center justify-center gap-2 transition-all ${form.channel === ch ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                      {ch === 'email' ? <><Mail className="w-4 h-4" />Email</> : <><MessageSquare className="w-4 h-4" />SMS</>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowSend(false)} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" isLoading={sendMut.isPending}>Send Request</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Reviews</h1>
          <p className="text-muted-foreground mt-1">Request and track customer reviews</p>
        </div>
        <Button onClick={() => setShowSend(true)}><Plus className="w-4 h-4 mr-2" />Send Request</Button>
      </div>

      {(data?.reviewRequests?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <Card className="p-4 border-border/50">
            <p className="text-sm text-muted-foreground">Total Sent</p>
            <p className="text-2xl font-bold">{data?.total ?? 0}</p>
          </Card>
          <Card className="p-4 border-border/50">
            <p className="text-sm text-muted-foreground">This Page</p>
            <p className="text-2xl font-bold">{data?.reviewRequests.length ?? 0}</p>
          </Card>
          <Card className="p-4 border-border/50 hidden sm:block">
            <p className="text-sm text-muted-foreground">Channels</p>
            <p className="text-2xl font-bold">
              {[...new Set(data?.reviewRequests.map(r => r.channel))].join(' / ') || '—'}
            </p>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : data?.reviewRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4"><Star className="w-8 h-8 text-amber-500" /></div>
          <h3 className="text-xl font-semibold mb-2">No review requests yet</h3>
          <p className="text-muted-foreground mb-6">Send review requests to happy customers after completing jobs</p>
          <Button onClick={() => setShowSend(true)}><Plus className="w-4 h-4 mr-2" />Send First Request</Button>
        </div>
      ) : (
        <Card className="border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-accent/30">
                  <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                  <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Channel</th>
                  <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Status</th>
                  <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Sent</th>
                  <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Review Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.reviewRequests.map(r => (
                  <tr key={r.id} className="hover:bg-accent/30">
                    <td className="p-4 font-medium text-sm">{r.customerName || '—'}</td>
                    <td className="p-4">
                      <span className="flex items-center gap-1.5 text-sm">
                        {r.channel === 'email' ? <><Mail className="w-3.5 h-3.5" />Email</> : <><MessageSquare className="w-3.5 h-3.5" />SMS</>}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${r.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{r.sentAt ? format(new Date(r.sentAt), 'MMM d, yyyy h:mm a') : '—'}</td>
                    <td className="p-4">
                      {r.reviewUrl ? (
                        <a href={r.reviewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                          Leave Review <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      </PlanGate>
    </AppLayout>
  );
}
