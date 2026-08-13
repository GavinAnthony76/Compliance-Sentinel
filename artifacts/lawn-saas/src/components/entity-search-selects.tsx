import { useEffect, useState } from 'react';
import { useListCustomers, useListAppointments } from '@workspace/api-client-react';
import { SearchableSelect, type SearchableOption } from '@/components/searchable-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const PAGE_SIZE = 50;

/**
 * Customer picker backed by server-side search + paging, so every customer is
 * reachable no matter how long the list is (no hardcoded cap).
 */
export function CustomerSearchSelect({
  value,
  onChange,
  selectedLabel,
  placeholder = 'Select customer...',
  emptyOptionLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string, label?: string) => void;
  /** Label to show for the current value even if it's not in the loaded page. */
  selectedLabel?: string;
  placeholder?: string;
  emptyOptionLabel?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState<SearchableOption[]>([]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isFetching } = useListCustomers({
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  } as Parameters<typeof useListCustomers>[0]);

  useEffect(() => {
    if (!data) return;
    const pageOpts = data.customers.map(c => ({
      value: String(c.id),
      label: `${c.firstName || ''} ${c.lastName || ''}`.trim() || (c as { phone?: string }).phone || 'Customer',
    }));
    setOptions(prev => {
      const base = data.page === 1 ? [] : prev;
      const seen = new Set(base.map(o => o.value));
      return [...base, ...pageOpts.filter(o => !seen.has(o.value))];
    });
  }, [data]);

  return (
    <SearchableSelect
      value={value}
      selectedLabel={selectedLabel}
      options={options}
      onChange={v => onChange(v, options.find(o => o.value === v)?.label)}
      onSearchChange={setSearch}
      placeholder={placeholder}
      emptyOptionLabel={emptyOptionLabel}
      disabled={disabled}
      loading={isFetching}
      total={data?.total}
      onLoadMore={() => setPage(p => p + 1)}
    />
  );
}

/**
 * Appointment picker backed by server-side search (by customer name) + paging.
 * Optional `status` narrows the server query; `excludeIds` hides records
 * already used elsewhere (e.g. existing route stops).
 */
export function AppointmentSearchSelect({
  value,
  onChange,
  selectedLabel,
  placeholder = 'Select appointment...',
  emptyOptionLabel,
  disabled,
  status,
  excludeIds,
}: {
  value: string;
  onChange: (value: string, label?: string) => void;
  selectedLabel?: string;
  placeholder?: string;
  emptyOptionLabel?: string;
  disabled?: boolean;
  status?: string;
  excludeIds?: Set<number>;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState<SearchableOption[]>([]);
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isFetching } = useListAppointments({
    page,
    limit: PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  } as Parameters<typeof useListAppointments>[0]);

  useEffect(() => {
    const d = data as { appointments?: Array<{ id: number; scheduledStart: string; customerName?: string; customerId: number; serviceName?: string }>; page?: number } | undefined;
    if (!d?.appointments) return;
    const pageOpts = d.appointments.map(a => {
      const dateStr = new Date(a.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const custName = a.customerName || `Customer #${a.customerId}`;
      const svcName = a.serviceName ? ` — ${a.serviceName}` : '';
      return { value: String(a.id), label: `${dateStr} · ${custName}${svcName}` };
    });
    setOptions(prev => {
      const base = (d.page ?? 1) === 1 ? [] : prev;
      const seen = new Set(base.map(o => o.value));
      return [...base, ...pageOpts.filter(o => !seen.has(o.value))];
    });
  }, [data]);

  const visibleOptions = excludeIds
    ? options.filter(o => !excludeIds.has(Number(o.value)))
    : options;

  return (
    <SearchableSelect
      value={value}
      selectedLabel={selectedLabel}
      options={visibleOptions}
      onChange={v => onChange(v, visibleOptions.find(o => o.value === v)?.label)}
      onSearchChange={setSearch}
      placeholder={placeholder}
      emptyOptionLabel={emptyOptionLabel}
      disabled={disabled}
      loading={isFetching}
      total={(data as { total?: number })?.total}
      onLoadMore={() => setPage(p => p + 1)}
    />
  );
}
