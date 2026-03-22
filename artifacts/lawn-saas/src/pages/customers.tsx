import { useState } from 'react';
import { useListCustomers } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input, Badge } from '@/components/ui';
import { Search, Plus, MapPin, Phone, Mail, Download } from 'lucide-react';
import { Link } from 'wouter';
import { formatDate } from '@/lib/utils';
import { useAuthState } from '@/hooks/use-auth-state';

function usePlan() {
  const { user } = useAuthState();
  return user?.company?.subscriptionPlan ?? 'starter';
}

function downloadExport(path: string, filename: string) {
  fetch(path, { headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } })
    .then(r => {
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => console.error('Export error:', err));
}

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useListCustomers({ search, limit: 50 });
  const plan = usePlan();

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage your client base and their properties.</p>
        </div>
        <div className="flex gap-2">
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => downloadExport('/api/export/customers', 'customers.csv')}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          )}
          <Button><Plus className="w-4 h-4 mr-2"/> Add Customer</Button>
        </div>
      </div>

      <Card className="overflow-hidden border-border/50">
        <div className="p-4 border-b border-border bg-card/50 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search customers by name, email, or address..."
              className="w-full h-10 pl-9 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-accent/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Location</th>
                <th className="px-6 py-4">Added</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              ) : data?.customers.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No customers found.</td></tr>
              ) : (
                data?.customers.map(customer => (
                  <tr key={customer.id} className="bg-card hover:bg-accent/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-foreground">{customer.firstName} {customer.lastName}</div>
                      <div className="flex gap-1 mt-1">
                        {customer.tags?.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground space-y-1">
                      {customer.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3" /> {customer.phone}</div>}
                      {customer.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3" /> {customer.email}</div>}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {customer.addressLine1 ? (
                        <div className="flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span className="truncate max-w-[200px]">{customer.addressLine1}, {customer.city}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatDate(customer.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/customers/${customer.id}`}>
                        <Button variant="outline" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">View Details</Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination placeholder */}
        <div className="p-4 border-t border-border bg-card/50 flex items-center justify-between text-sm text-muted-foreground">
          <div>Showing {data?.customers.length || 0} of {data?.total || 0} customers</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>Previous</Button>
            <Button variant="outline" size="sm" disabled>Next</Button>
          </div>
        </div>
      </Card>
    </AppLayout>
  );
}
