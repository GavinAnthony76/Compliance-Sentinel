import { useState } from 'react';
import { useListTeam, useInviteTeamMember, useRemoveTeamMember, getListTeamQueryKey } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Users2, Mail, Phone, Shield, Lock, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthState } from '@/hooks/use-auth-state';
import { format } from 'date-fns';
import { Link } from 'wouter';

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600',
};

function InviteModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'staff', phone: '' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const inviteMut = useInviteTeamMember();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inviteMut.mutateAsync({ data: form as any });
      toast({ title: 'Team member added' });
      qc.invalidateQueries({ queryKey: getListTeamQueryKey() });
      onClose();
    } catch (err: any) {
      toast({ title: 'Error adding team member', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-6">Add Team Member</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label className="text-sm font-medium">Email *</label>
            <Input type="email" className="mt-1" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="john@company.com" required icon={<Mail className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-medium">Password *</label>
            <Input type="password" className="mt-1" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" required minLength={8} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Role</label>
              <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input className="mt-1" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" icon={<Phone className="w-4 h-4" />} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={inviteMut.isPending}>Add Member</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TeamPage() {
  const { data, isLoading } = useListTeam();
  const [showInvite, setShowInvite] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const removeMut = useRemoveTeamMember();
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan ?? 'starter';
  const canAddTeam = plan === 'growth' || plan === 'pro';

  return (
    <AppLayout>
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Team</h1>
          <p className="text-muted-foreground mt-1">Manage your staff and permissions</p>
        </div>
        {canAddTeam && (
          <Button onClick={() => setShowInvite(true)}><Plus className="w-4 h-4 mr-2" />Add Member</Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.members.map(member => (
              <Card key={member.id} className="border-border/50 hover:shadow-md transition-all">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                        {member.firstName[0]}{member.lastName[0]}
                      </div>
                      <div>
                        <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize inline-flex items-center gap-1 ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-600'}`}>
                          <Shield className="w-2.5 h-2.5" />{member.role}
                        </span>
                      </div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${member.isActive ? 'bg-green-500' : 'bg-gray-300'}`} title={member.isActive ? 'Active' : 'Inactive'} />
                  </div>
                  <div className="space-y-1.5 mb-4">
                    <p className="text-sm text-muted-foreground flex items-center gap-2"><Mail className="w-3.5 h-3.5" />{member.email}</p>
                    {member.phone && <p className="text-sm text-muted-foreground flex items-center gap-2"><Phone className="w-3.5 h-3.5" />{member.phone}</p>}
                    {member.lastLoginAt && <p className="text-xs text-muted-foreground">Last login: {format(new Date(member.lastLoginAt), 'MMM d, yyyy')}</p>}
                  </div>
                  {member.role !== 'owner' && canAddTeam && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 w-full" onClick={async () => {
                      if (!confirm('Remove team member?')) return;
                      await removeMut.mutateAsync({ id: member.id });
                      qc.invalidateQueries({ queryKey: getListTeamQueryKey() });
                      toast({ title: 'Team member removed' });
                    }}>Remove</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* Upgrade CTA for Starter */}
          {!canAddTeam && (
            <Card className="mt-6 border-dashed border-2 border-emerald-200 bg-emerald-50/50">
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-7 h-7 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Add team members on Growth</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
                  Upgrade to Growth to invite crew members, assign them to jobs, and manage roles and permissions across your team.
                </p>
                <Link href="/billing">
                  <Button className="bg-emerald-600 hover:bg-emerald-700">
                    Upgrade to Growth <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {canAddTeam && data?.members.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4"><Users2 className="w-8 h-8 text-muted-foreground" /></div>
              <h3 className="text-xl font-semibold mb-2">No team members yet</h3>
              <Button onClick={() => setShowInvite(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Add First Member</Button>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
