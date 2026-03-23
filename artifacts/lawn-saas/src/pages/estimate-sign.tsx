import { useEffect, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui';
import { PenLine, CheckCircle, Leaf, X } from 'lucide-react';

export function EstimateSignPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [estimate, setEstimate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [signerName, setSignerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/public/estimates/${token}`)
      .then(r => r.json())
      .then(data => {
        setEstimate(data);
        if (data.signedAt) setSigned(true);
        if (data.customer) setSignerName(`${data.customer.firstName} ${data.customer.lastName}`);
      })
      .catch(() => setEstimate(null))
      .finally(() => setLoading(false));
  }, [token]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !lastPos.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasSignature(true);
  }

  function stopDraw() {
    setIsDrawing(false);
    lastPos.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSignature) {
      toast({ title: 'Please sign in the box above', variant: 'destructive' });
      return;
    }
    if (!signerName.trim()) {
      toast({ title: 'Please enter your name', variant: 'destructive' });
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureData = canvas.toDataURL('image/png');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/estimates/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: signerName.trim(), signatureData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to sign');
      setSigned(true);
      toast({ title: 'Estimate signed!', description: data.message });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!estimate || estimate.error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">This estimate link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2 text-primary font-bold text-xl">
          <Leaf className="w-6 h-6 fill-primary" />
          {estimate.company?.name || 'Service Estimate'}
        </div>

        {/* Estimate details */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-xl">Estimate {estimate.estimateNumber}</CardTitle>
                {estimate.customer && (
                  <p className="text-muted-foreground text-sm mt-1">
                    Prepared for {estimate.customer.firstName} {estimate.customer.lastName}
                  </p>
                )}
              </div>
              <span className="text-2xl font-bold text-primary">${Number(estimate.total).toFixed(2)}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {estimate.notes && (
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm font-medium mb-1">Details</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{estimate.notes}</p>
              </div>
            )}
            {estimate.company && (
              <div className="text-xs text-muted-foreground">
                {estimate.company.phone && <span>{estimate.company.phone}</span>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Signed state */}
        {signed ? (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="py-8 text-center space-y-3">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto" />
              <h2 className="text-xl font-bold text-green-800">Estimate Accepted</h2>
              <p className="text-green-700">
                {estimate.signerName
                  ? `Signed by ${estimate.signerName}`
                  : 'This estimate has been signed and accepted.'}
              </p>
              {estimate.signedAt && (
                <p className="text-sm text-green-600">{new Date(estimate.signedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
              )}
            </CardContent>
          </Card>
        ) : (
          /* Signature form */
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PenLine className="w-5 h-5" /> Sign to Accept Estimate
              </CardTitle>
              <p className="text-sm text-muted-foreground">By signing below you agree to the estimate total of ${Number(estimate.total).toFixed(2)}</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Your Full Name</label>
                  <Input
                    placeholder="Full name as it appears on the estimate"
                    value={signerName}
                    onChange={e => setSignerName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Signature</label>
                    {hasSignature && (
                      <button type="button" onClick={clearCanvas} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                        <X className="w-3 h-3" /> Clear
                      </button>
                    )}
                  </div>
                  <div className="border-2 border-dashed border-border rounded-xl overflow-hidden bg-white relative">
                    <canvas
                      ref={canvasRef}
                      width={600}
                      height={180}
                      className="w-full touch-none cursor-crosshair"
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={stopDraw}
                      onMouseLeave={stopDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={stopDraw}
                    />
                    {!hasSignature && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-muted-foreground text-sm">Draw your signature here</p>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Sign using your mouse or finger</p>
                </div>

                <Button type="submit" className="w-full h-12" isLoading={submitting}>
                  <CheckCircle className="w-4 h-4 mr-2" /> Accept & Sign Estimate
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
