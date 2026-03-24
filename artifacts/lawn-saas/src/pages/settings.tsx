import { useState, useEffect, useRef } from 'react';
import { useGetSettings, useUpdateSettings } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Settings, Globe, Palette } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSettingsQueryKey } from '@workspace/api-client-react';

export function SettingsPage() {
  const { data: company, isLoading } = useGetSettings();
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateSettings();
  const [tab, setTab] = useState<'business' | 'branding'>('business');

  const [businessForm, setBusinessForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    timezone: '',
  });
  const [brandingForm, setBrandingForm] = useState({
    primaryColor: '',
    reviewUrl: '',
    logoUrl: '',
  });

  const initialized = useRef(false);
  useEffect(() => {
    if (company && !initialized.current) {
      initialized.current = true;
      setBusinessForm({
        name: company.name ?? '',
        phone: company.phone ?? '',
        email: company.email ?? '',
        address: company.address ?? '',
        city: company.city ?? '',
        state: company.state ?? '',
        zip: company.zip ?? '',
        website: company.website ?? '',
        timezone: company.timezone ?? 'America/New_York',
      });
      setBrandingForm({
        primaryColor: company.primaryColor ?? '#22c55e',
        reviewUrl: company.reviewUrl ?? '',
        logoUrl: company.logoUrl ?? '',
      });
    }
  }, [company]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ data: businessForm });
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: 'Settings saved' });
    } catch {
      toast({ title: 'Error saving settings', variant: 'destructive' });
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ data: brandingForm });
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: 'Branding saved' });
    } catch {
      toast({ title: 'Error saving branding', variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your business profile and preferences</p>
      </div>

      <div className="flex gap-2 mb-6">
        {([['business', 'Business Info', Settings], ['branding', 'Branding', Palette]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === id ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card border border-border hover:border-primary/50 text-muted-foreground'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : tab === 'business' ? (
        <Card className="border-border/50">
          <CardContent className="p-6">
            <form onSubmit={handleSaveBusiness} className="space-y-5 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input value={businessForm.name} onChange={e => setBusinessForm(f => ({ ...f, name: e.target.value }))} placeholder="Your Company" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Phone</label>
                  <Input value={businessForm.phone} onChange={e => setBusinessForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Business Email</label>
                  <Input type="email" value={businessForm.email} onChange={e => setBusinessForm(f => ({ ...f, email: e.target.value }))} placeholder="info@yourcompany.com" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Website</label>
                  <Input value={businessForm.website} onChange={e => setBusinessForm(f => ({ ...f, website: e.target.value }))} placeholder="https://yoursite.com" icon={<Globe className="w-4 h-4" />} />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-sm font-medium">Street Address</label>
                  <Input value={businessForm.address} onChange={e => setBusinessForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">City</label>
                  <Input value={businessForm.city} onChange={e => setBusinessForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">State</label>
                    <Input value={businessForm.state} onChange={e => setBusinessForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">ZIP</label>
                    <Input value={businessForm.zip} onChange={e => setBusinessForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Timezone</label>
                  <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={businessForm.timezone} onChange={e => setBusinessForm(f => ({ ...f, timezone: e.target.value }))}>
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                    <option value="America/Phoenix">Arizona Time</option>
                    <option value="Pacific/Honolulu">Hawaii Time</option>
                  </select>
                </div>
              </div>
              <Button type="submit" isLoading={updateMut.isPending}>Save Changes</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-6">
            <form onSubmit={handleSaveBranding} className="space-y-5 max-w-2xl">
              <div className="space-y-1">
                <label className="text-sm font-medium">Logo URL</label>
                <Input value={brandingForm.logoUrl} onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://yoursite.com/logo.png" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Primary Brand Color</label>
                <div className="flex items-center gap-3">
                  <Input type="color" value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} className="w-16 h-11 px-1 py-1 cursor-pointer" />
                  <Input value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} placeholder="#22c55e" className="flex-1" />
                </div>
                <p className="text-xs text-muted-foreground">Used on your public booking page</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Review Page URL</label>
                <Input value={brandingForm.reviewUrl} onChange={e => setBrandingForm(f => ({ ...f, reviewUrl: e.target.value }))} placeholder="https://g.page/review/your-business" />
                <p className="text-xs text-muted-foreground">Where customers are directed for reviews (Google, Yelp, etc.)</p>
              </div>
              <Button type="submit" isLoading={updateMut.isPending}>Save Branding</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
}
