import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Mail, MessageSquare, Phone, StickyNote, Cog, Plus, X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Card, Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';

type Channel = 'email' | 'sms' | 'phone' | 'note' | 'system';
type Direction = 'outbound' | 'inbound';

interface CommunicationEvent {
  id: number;
  channel: Channel;
  direction: Direction | null;
  subject: string | null;
  bodyPreview: string | null;
  status: string | null;
  customerId: number | null;
  leadId: number | null;
  createdAt: string;
}

const CHANNEL_META: Record<Channel, { icon: typeof Mail; label: string; color: string }> = {
  email: { icon: Mail, label: 'Email', color: 'bg-blue-100 text-blue-600' },
  sms: { icon: MessageSquare, label: 'SMS', color: 'bg-green-100 text-green-600' },
  phone: { icon: Phone, label: 'Phone', color: 'bg-violet-100 text-violet-600' },
  note: { icon: StickyNote, label: 'Note', color: 'bg-amber-100 text-amber-600' },
  system: { icon: Cog, label: 'System', color: 'bg-gray-100 text-gray-500' },
};

const LOGGABLE_CHANNELS: Channel[] = ['phone', 'note', 'email', 'sms'];

interface Props {
  customerId?: number;
  leadId?: number;
}

export function CommunicationTimeline({ customerId, leadId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showLog, setShowLog] = useState(false);
  const [form, setForm] = useState<{ channel: Channel; subject: string; bodyPreview: string; direction: Direction }>({
    channel: 'phone',
    subject: '',
    bodyPreview: '',
    direction: 'outbound',
  });

  const queryParam = customerId ? `customerId=${customerId}` : leadId ? `leadId=${leadId}` : '';
  const queryKey = ['/api/communications', { customerId, leadId }];

  const { data, isLoading, error } = useQuery({
    queryKey,
    enabled: !!queryParam,
    queryFn: async () => {
      const res = await fetch(`/api/communications?${queryParam}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
      });
      if (!res.ok) throw new Error('Failed to load timeline');
      return res.json() as Promise<{ events: CommunicationEvent[] }>;
    },
  });

  const logMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
        body: JSON.stringify({
          customerId: customerId ?? null,
          leadId: leadId ?? null,
          channel: form.channel,
          direction: form.direction,
          subject: form.subject.trim() || null,
          bodyPreview: form.bodyPreview.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || 'Failed to log');
      return d;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setShowLog(false);
      setForm({ channel: 'phone', subject: '', bodyPreview: '', direction: 'outbound' });
      toast({ title: 'Communication logged' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const handleLog = () => {
    if (!form.bodyPreview.trim() && !form.subject.trim()) {
      toast({ title: 'Add a subject or note', variant: 'destructive' });
      return;
    }
    logMut.mutate();
  };

  const events = data?.events ?? [];

  return (
    <Card className="border-border/50 overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">
          {events.length} communication{events.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={() => setShowLog(s => !s)}>
          {showLog ? <><X className="w-4 h-4 mr-1.5" />Cancel</> : <><Plus className="w-4 h-4 mr-1.5" />Log Communication</>}
        </Button>
      </div>

      {showLog && (
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Channel</label>
              <select
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                value={form.channel}
                onChange={e => setForm(f => ({ ...f, channel: e.target.value as Channel }))}
              >
                {LOGGABLE_CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_META[c].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Direction</label>
              <select
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"
                value={form.direction}
                onChange={e => setForm(f => ({ ...f, direction: e.target.value as Direction }))}
              >
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
            </div>
          </div>
          <Input
            placeholder="Subject (optional)"
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
          />
          <textarea
            className="w-full min-h-[72px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="What was discussed?"
            value={form.bodyPreview}
            onChange={e => setForm(f => ({ ...f, bodyPreview: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleLog} isLoading={logMut.isPending}>Save</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 flex justify-center">
          <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-12 text-center text-destructive text-sm">Failed to load communication history.</div>
      ) : events.length === 0 ? (
        <div className="p-12 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No communications yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {events.map(ev => {
            const meta = CHANNEL_META[ev.channel] ?? CHANNEL_META.system;
            const Icon = meta.icon;
            return (
              <div key={ev.id} className="p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{meta.label}</span>
                    {ev.direction && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        {ev.direction === 'inbound'
                          ? <><ArrowDownLeft className="w-3 h-3" />In</>
                          : <><ArrowUpRight className="w-3 h-3" />Out</>}
                      </span>
                    )}
                    {ev.status && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{ev.status}</span>}
                  </div>
                  {ev.subject && <p className="text-sm font-medium mt-0.5">{ev.subject}</p>}
                  {ev.bodyPreview && <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{ev.bodyPreview}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{format(new Date(ev.createdAt), 'MMM d, yyyy · h:mm a')}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
