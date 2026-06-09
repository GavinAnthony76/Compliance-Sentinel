import { Input } from '@/components/ui';
import { Trash2 } from 'lucide-react';

export type LineItem = { description: string; quantity: number; unitPrice: number; lineTotal: number };

export function LineItemsEditor({ items, onChange }: { items: LineItem[]; onChange: (items: LineItem[]) => void }) {
  const addRow = () => onChange([...items, { description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const removeRow = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof LineItem, val: string) => {
    const updated = items.map((li, idx) => {
      if (idx !== i) return li;
      const next = { ...li, [field]: field === 'description' ? val : Number(val) };
      next.lineTotal = Number((next.quantity * next.unitPrice).toFixed(2));
      return next;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-xs font-semibold text-muted-foreground px-1">
        <span className="flex-1 min-w-0">Description</span>
        <span className="w-14 text-center shrink-0">Qty</span>
        <span className="w-24 text-right shrink-0">Unit Price</span>
        <span className="w-20 text-right shrink-0">Total</span>
        <span className="w-6 shrink-0" />
      </div>
      {items.map((li, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input className="flex-1 min-w-0 h-9 text-sm" value={li.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Service description" required />
          <Input className="w-14 shrink-0 h-9 text-sm text-center px-1" type="number" min="0.01" step="0.01" value={li.quantity} onChange={e => update(i, 'quantity', e.target.value)} />
          <Input className="w-24 shrink-0 h-9 text-sm text-right px-1" type="number" min="0" step="0.01" value={li.unitPrice} onChange={e => update(i, 'unitPrice', e.target.value)} />
          <div className="w-20 shrink-0 text-right text-sm font-medium">${li.lineTotal.toFixed(2)}</div>
          <button type="button" onClick={() => removeRow(i)} className="w-6 shrink-0 flex justify-center text-muted-foreground hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs text-primary underline underline-offset-2 hover:opacity-80 mt-1">+ Add Line Item</button>
    </div>
  );
}
