import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';
import {
  MapPin, Clock, CheckCircle2, Play, LogIn, RefreshCw, LogOut,
  Loader2, Navigation, User as UserIcon, Camera, ImageIcon, Trash2,
} from 'lucide-react';

const TOKEN = () => localStorage.getItem('greensync_token');

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN()}`,
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.message || body?.error || 'Request failed');
  return body;
}

interface Appt {
  id: number;
  customerId: number;
  customerName?: string | null;
  serviceName?: string | null;
  status: string;
  scheduledStart: string;
  notes?: string | null;
  actualStartedAt?: string | null;
  actualCompletedAt?: string | null;
  checkedInByUserId?: number | null;
}

interface Photo {
  id: number;
  fileUrl: string;
  type: string;
  caption?: string | null;
  originalFileName?: string | null;
}

async function uploadPhoto(appointmentId: number, file: File, type: string): Promise<void> {
  const reqRes = await fetch('/api/storage/uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }),
  });
  if (!reqRes.ok) throw new Error('Could not start upload');
  const { uploadURL, objectPath } = await reqRes.json();

  const putRes = await fetch(uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error('Upload failed');

  await api('/appointment-photos', {
    method: 'POST',
    body: JSON.stringify({
      appointmentId,
      objectPath,
      type,
      originalFileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
    }),
  });
}

function getPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function AuthedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { headers: { Authorization: `Bearer ${TOKEN()}` } });
        if (!res.ok) throw new Error('Failed to load image');
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setObjectUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [src]);

  if (failed) {
    return <div className={`flex items-center justify-center text-gray-300 ${className ?? ''}`}><ImageIcon className="w-5 h-5" /></div>;
  }
  if (!objectUrl) {
    return <div className={`flex items-center justify-center ${className ?? ''}`}><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>;
  }
  return <img src={objectUrl} alt={alt} className={className} loading="lazy" />;
}

function PhotoSection({ appointmentId }: { appointmentId: number }) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const beforeRef = useRef<HTMLInputElement>(null);
  const afterRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/appointment-photos?appointmentId=${appointmentId}`);
      setPhotos(data.photos ?? []);
    } catch {
      // non-fatal; leave empty
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const handleFile = async (file: File | undefined, type: string) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadPhoto(appointmentId, file, type);
      toast({ title: 'Photo uploaded' });
      await loadPhotos();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this photo?')) return;
    try {
      await api(`/appointment-photos/${id}`, { method: 'DELETE' });
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" /> Job Photos {photos.length > 0 && `(${photos.length})`}
        </p>
        <div className="flex gap-2">
          <input ref={beforeRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { handleFile(e.target.files?.[0], 'before'); e.target.value = ''; }} />
          <input ref={afterRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { handleFile(e.target.files?.[0], 'after'); e.target.value = ''; }} />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => beforeRef.current?.click()} className="gap-1 h-8 text-xs">
            <Camera className="w-3.5 h-3.5" /> Before
          </Button>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => afterRef.current?.click()} className="gap-1 h-8 text-xs">
            <Camera className="w-3.5 h-3.5" /> After
          </Button>
        </div>
      </div>

      {uploading && <p className="text-xs text-gray-500 flex items-center gap-1 mb-2"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</p>}

      {loading ? (
        <p className="text-xs text-gray-400">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="text-xs text-gray-400">No photos yet. Capture before/after shots.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative group rounded-lg overflow-hidden border border-gray-200 aspect-square bg-gray-100">
              <AuthedImage src={p.fileUrl} alt={p.caption || p.type} className="w-full h-full object-cover" />
              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium capitalize">{p.type}</span>
              <button
                onClick={() => handleDelete(p.id)}
                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete photo"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ appt, onAction, busy }: { appt: Appt; onAction: (a: Appt, action: 'check-in' | 'start' | 'complete') => void; busy: boolean }) {
  const done = appt.status === 'completed';
  const started = !!appt.actualStartedAt;
  const checkedIn = !!appt.checkedInByUserId;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${done ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 flex items-center gap-1.5">
            <UserIcon className="w-4 h-4 text-gray-400 shrink-0" />
            {appt.customerName || `Customer #${appt.customerId}`}
          </p>
          {appt.serviceName && <p className="text-sm text-gray-500 mt-0.5">{appt.serviceName}</p>}
        </div>
        <div className="flex items-center gap-1 text-sm font-medium text-gray-600 shrink-0">
          <Clock className="w-4 h-4" /> {timeStr(appt.scheduledStart)}
        </div>
      </div>

      {appt.notes && <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg p-2">{appt.notes}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
        {checkedIn && <span className="px-2 py-1 rounded-full bg-sky-100 text-sky-700 font-medium flex items-center gap-1"><MapPin className="w-3 h-3" />Checked in</span>}
        {started && !done && <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1"><Play className="w-3 h-3" />In progress</span>}
        {done && <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Completed</span>}
      </div>

      {!done && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Button variant="outline" size="sm" disabled={busy || checkedIn} onClick={() => onAction(appt, 'check-in')} className="gap-1.5">
            <LogIn className="w-4 h-4" /> Check In
          </Button>
          <Button variant="outline" size="sm" disabled={busy || started} onClick={() => onAction(appt, 'start')} className="gap-1.5">
            <Play className="w-4 h-4" /> Start
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAction(appt, 'complete')} className="gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Done
          </Button>
        </div>
      )}
      {done && appt.actualStartedAt && appt.actualCompletedAt && (
        <p className="text-xs text-emerald-700 mt-3 flex items-center gap-1">
          <Navigation className="w-3 h-3" />
          {Math.max(1, Math.round((new Date(appt.actualCompletedAt).getTime() - new Date(appt.actualStartedAt).getTime()) / 60000))} min on site
        </p>
      )}

      {(checkedIn || started || done) && <PhotoSection appointmentId={appt.id} />}
    </div>
  );
}

export function TechPage() {
  const { user, logout } = useAuthState();
  const { toast } = useToast();
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const params = new URLSearchParams({
        assignedUserId: String(user.id),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: '100',
      });
      const data = await api(`/appointments?${params.toString()}`);
      const list: Appt[] = (data.appointments ?? []).slice().sort(
        (a: Appt, b: Appt) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
      );
      setAppts(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const action = async (appt: Appt, kind: 'check-in' | 'start' | 'complete') => {
    setBusyId(appt.id);
    try {
      const pos = await getPosition();
      let body: any = pos ?? {};
      if (kind === 'complete') {
        const note = window.prompt('Completion notes (optional):') ?? '';
        body = { ...body, completionNotes: note || null };
      }
      await api(`/appointments/${appt.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      toast({
        title: kind === 'check-in' ? 'Checked in' : kind === 'start' ? 'Job started' : 'Job completed',
        description: pos ? 'Location captured' : 'Saved without location',
      });
      await load();
    } catch (err: any) {
      toast({ title: 'Action failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const remaining = appts.filter((a) => a.status !== 'completed').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <Logo className="h-7" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh">
            <RefreshCw className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out">
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 py-5">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900">Today's Jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {remaining} remaining
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <Button variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : appts.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 mb-3" />
            <h3 className="font-semibold text-gray-900">No jobs scheduled today</h3>
            <p className="text-sm text-gray-500 mt-1">Enjoy your day off, or check back later.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {appts.map((appt) => (
              <JobCard key={appt.id} appt={appt} onAction={action} busy={busyId === appt.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
