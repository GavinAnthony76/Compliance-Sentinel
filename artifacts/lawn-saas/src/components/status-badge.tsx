import { Badge } from "./ui";

export function AppointmentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { variant: any, label: string }> = {
    pending: { variant: 'warning', label: 'Pending' },
    confirmed: { variant: 'default', label: 'Confirmed' },
    in_progress: { variant: 'secondary', label: 'In Progress' },
    completed: { variant: 'success', label: 'Completed' },
    cancelled: { variant: 'outline', label: 'Cancelled' },
    no_show: { variant: 'danger', label: 'No Show' },
  };

  const config = styles[status] || { variant: 'outline', label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { variant: any, label: string }> = {
    draft: { variant: 'outline', label: 'Draft' },
    sent: { variant: 'default', label: 'Sent' },
    paid: { variant: 'success', label: 'Paid' },
    overdue: { variant: 'danger', label: 'Overdue' },
    cancelled: { variant: 'outline', label: 'Cancelled' },
  };

  const config = styles[status] || { variant: 'outline', label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
