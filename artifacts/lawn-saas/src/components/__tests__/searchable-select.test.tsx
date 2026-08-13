import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchableSelect } from '../searchable-select';

const options = Array.from({ length: 50 }, (_, i) => ({ value: String(i + 1), label: `Option ${i + 1}` }));

describe('SearchableSelect', () => {
  it('offers Load more when the server has more records than are loaded', () => {
    const onLoadMore = vi.fn();
    render(
      <SearchableSelect
        value=""
        options={options}
        onChange={() => {}}
        onSearchChange={() => {}}
        placeholder="Select..."
        total={120}
        onLoadMore={onLoadMore}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    const loadMore = screen.getByRole('button', { name: /load more/i });
    expect(loadMore.textContent).toContain('50 of 120');
    fireEvent.click(loadMore);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hides Load more when every record is loaded', () => {
    render(
      <SearchableSelect
        value=""
        options={options}
        onChange={() => {}}
        onSearchChange={() => {}}
        placeholder="Select..."
        total={50}
        onLoadMore={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('forwards typed search text so the parent can query the server', () => {
    const onSearchChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        options={options}
        onChange={() => {}}
        onSearchChange={onSearchChange}
        placeholder="Select..."
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    fireEvent.change(screen.getByPlaceholderText(/type to search/i), { target: { value: 'quix' } });
    expect(onSearchChange).toHaveBeenCalledWith('quix');
  });

  it('shows the selected label even when the option is not in the current page', () => {
    render(
      <SearchableSelect
        value="999"
        selectedLabel="Zelda Quixote"
        options={options}
        onChange={() => {}}
        onSearchChange={() => {}}
        placeholder="Select..."
      />
    );
    expect(screen.getByText('Zelda Quixote')).toBeTruthy();
  });
});
