import { useEffect, useState } from 'react';
import { Input } from '@/components/ui';

function isoToMdy(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function formatMdy(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function mdyToIso(mdy: string): string | null {
  const m = mdy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Date input that always displays and accepts MM/DD/YYYY regardless of the
 * browser's locale (a native <input type="date"> renders dd/mm/yyyy in some
 * locales). `value`/`onChange` use ISO `YYYY-MM-DD` strings so callers keep
 * working with the same format the API expects. Empty string means "no date".
 */
export function MdyDateInput({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  id?: string;
}) {
  const [text, setText] = useState(() => isoToMdy(value));

  useEffect(() => {
    setText(isoToMdy(value));
  }, [value]);

  const handle = (raw: string) => {
    const formatted = formatMdy(raw);
    setText(formatted);
    const iso = mdyToIso(formatted);
    if (iso) onChange(iso);
    else if (formatted === '') onChange('');
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder="MM/DD/YYYY"
      maxLength={10}
      className={className}
      value={text}
      onChange={e => handle(e.target.value)}
    />
  );
}
