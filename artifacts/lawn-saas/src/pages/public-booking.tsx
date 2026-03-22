import { useState } from 'react';
import { useGetBookingPage, useSubmitBookingRequest } from '@workspace/api-client-react';
import { useParams } from 'wouter';
import { Button, Input, Card, CardContent } from '@/components/ui';
import { Leaf, Check, MapPin, Phone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function PublicBookingPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { data, isLoading, error } = useGetBookingPage(slug);
  const submitMut = useSubmitBookingRequest();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', addressLine1: '',
    city: '', state: '', zip: '', notes: '', gateNotes: '', yardSize: '', preferredDate: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) { toast({ title: 'Please select a service', variant: 'destructive' }); return; }
    try {
      await submitMut.mutateAsync({
        slug,
        data: {
          ...form,
          serviceId: selectedService,
          preferredDate: form.preferredDate ? new Date(form.preferredDate).toISOString() : undefined,
        } as any,
      });
      setSubmitted(true);
    } catch {
      toast({ title: 'Error submitting request', variant: 'destructive' });
    }
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Company Not Found</h1>
        <p className="text-muted-foreground">This booking page does not exist.</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: data.primaryColor ? `${data.primaryColor}08` : undefined }}>
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h1 className="text-3xl font-bold mb-3">Booking Submitted!</h1>
        <p className="text-muted-foreground text-lg mb-2">Thank you for choosing {data.companyName}.</p>
        <p className="text-muted-foreground">We'll contact you shortly to confirm your appointment.</p>
      </div>
    </div>
  );

  const primaryColor = data.primaryColor || '#22c55e';

  return (
    <div className="min-h-screen bg-background" style={{ '--primary': primaryColor } as any}>
      {/* Header */}
      <div className="py-8 px-4 text-center border-b border-border" style={{ background: `${primaryColor}10` }}>
        {data.logoUrl ? (
          <img src={data.logoUrl} alt={data.companyName} className="h-14 mx-auto mb-4 object-contain" />
        ) : (
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}20` }}>
              <Leaf className="w-8 h-8" style={{ color: primaryColor }} />
            </div>
          </div>
        )}
        <h1 className="text-3xl font-display font-bold">{data.companyName}</h1>
        <p className="text-muted-foreground mt-2">Book a Service</p>
        {data.phone && (
          <a href={`tel:${data.phone}`} className="inline-flex items-center gap-2 text-sm mt-3 hover:underline" style={{ color: primaryColor }}>
            <Phone className="w-4 h-4" />{data.phone}
          </a>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Service Selection */}
          <div>
            <h2 className="text-xl font-bold mb-4">Select a Service *</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {data.services?.map((service: any) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setSelectedService(service.id)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${selectedService === service.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                  style={selectedService === service.id ? { borderColor: primaryColor, backgroundColor: `${primaryColor}08` } : {}}
                >
                  <div className="font-semibold">{service.name}</div>
                  {service.basePrice && <div className="text-sm mt-1" style={{ color: primaryColor }}>${Number(service.basePrice).toFixed(2)}</div>}
                  {service.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{service.description}</p>}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h2 className="text-xl font-bold mb-4">Your Information</h2>
            <Card className="border-border/50">
              <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">First Name *</label>
                    <Input className="mt-1" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="John" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Last Name *</label>
                    <Input className="mt-1" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" required />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Phone *</label>
                  <Input type="tel" className="mt-1" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" required />
                </div>
                <div>
                  <label className="text-sm font-medium">Email</label>
                  <Input type="email" className="mt-1" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="john@email.com" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Property */}
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><MapPin className="w-5 h-5" />Property Address *</h2>
            <Card className="border-border/50">
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium">Street Address *</label>
                  <Input className="mt-1" value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Main St" required />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="text-sm font-medium">City</label>
                    <Input className="mt-1" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">State</label>
                    <Input className="mt-1" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">ZIP Code</label>
                    <Input className="mt-1" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Yard Size</label>
                    <Input className="mt-1" value={form.yardSize} onChange={e => setForm(f => ({ ...f, yardSize: e.target.value }))} placeholder="e.g. 1/4 acre" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Gate Code / Access Notes</label>
                  <Input className="mt-1" value={form.gateNotes} onChange={e => setForm(f => ({ ...f, gateNotes: e.target.value }))} placeholder="Gate code #1234, dog in backyard, etc." />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Scheduling */}
          <div>
            <h2 className="text-xl font-bold mb-4">Preferred Date (Optional)</h2>
            <Input type="datetime-local" value={form.preferredDate} onChange={e => setForm(f => ({ ...f, preferredDate: e.target.value }))} />
          </div>

          <div>
            <label className="text-sm font-medium">Additional Notes</label>
            <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything else we should know?" />
          </div>

          <Button type="submit" className="w-full h-14 text-lg" isLoading={submitMut.isPending} style={{ backgroundColor: primaryColor }}>
            Submit Booking Request
          </Button>
          <p className="text-center text-sm text-muted-foreground">We'll contact you to confirm the appointment.</p>
        </form>
      </div>
    </div>
  );
}
