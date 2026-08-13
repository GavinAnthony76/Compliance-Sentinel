import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export type SearchableOption = { value: string; label: string };

/**
 * A searchable dropdown backed by server-side search. The parent owns the
 * option list and re-fetches it as `onSearchChange` fires, so every record is
 * reachable even when the full list is too long to load at once.
 */
export function SearchableSelect({
  value,
  selectedLabel,
  options,
  onChange,
  onSearchChange,
  placeholder,
  emptyOptionLabel,
  disabled,
  loading,
  total,
  onLoadMore,
}: {
  value: string;
  /** Label to show for the current value even if it's not in `options`. */
  selectedLabel?: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  onSearchChange: (search: string) => void;
  placeholder: string;
  /** When set, an explicit "none" choice is shown that selects ''. */
  emptyOptionLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Total matching records on the server (to hint that typing narrows further). */
  total?: number;
  /** Fetch the next page of results and append them to `options`. */
  onLoadMore?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const currentLabel = value
    ? (options.find(o => o.value === value)?.label ?? selectedLabel ?? `#${value}`)
    : '';

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch('');
    onSearchChange('');
  };

  const showMoreHint = typeof total === 'number' && total > options.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm flex items-center justify-between gap-2 disabled:opacity-50"
      >
        <span className={currentLabel ? '' : 'text-muted-foreground'}>
          {currentLabel || placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value && !disabled && (
            <X
              className="w-4 h-4 text-muted-foreground hover:text-foreground"
              onClick={e => { e.stopPropagation(); select(''); }}
            />
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); onSearchChange(e.target.value); }}
              placeholder="Type to search..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
            {emptyOptionLabel !== undefined && (
              <li>
                <button type="button" onClick={() => select('')} className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
                  {emptyOptionLabel}
                </button>
              </li>
            )}
            {options.map(o => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => select(o.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${o.value === value ? 'bg-accent/60 font-medium' : ''}`}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {loading && <li className="px-3 py-2 text-sm text-muted-foreground">Searching...</li>}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matches found</li>
            )}
            {showMoreHint && onLoadMore && (
              <li className="border-t border-border">
                <button
                  type="button"
                  disabled={loading}
                  onClick={onLoadMore}
                  className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent disabled:opacity-50"
                >
                  {loading ? 'Loading…' : `Load more (showing ${options.length} of ${total})`}
                </button>
              </li>
            )}
            {!loading && showMoreHint && !onLoadMore && (
              <li className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                Showing {options.length} of {total} — type to narrow the search
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
