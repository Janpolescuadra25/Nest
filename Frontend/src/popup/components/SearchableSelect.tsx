import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  subtitle?: string;
  group?: string;
}

interface Props {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState({ top: 0, left: 0, width: 0, maxHeight: 256 });

  const selected = options.find((o) => o.value === value);

  const filtered =
    query.length > 0
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(query.toLowerCase()) ||
            (o.subtitle?.toLowerCase().includes(query.toLowerCase()) ?? false),
        )
      : options;

  // Build grouped list
  const grouped: { group: string; items: SelectOption[] }[] = [];
  filtered.forEach((opt) => {
    const g = opt.group ?? '';
    const existing = grouped.find((x) => x.group === g);
    if (existing) existing.items.push(opt);
    else grouped.push({ group: g, items: [opt] });
  });

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        (!dropdownRef.current || !dropdownRef.current.contains(e.target as Node))
      ) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleScroll = (e: Event) => {
      // Don't close if the user is scrolling inside the dropdown itself
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setQuery('');
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [open]);

  const computePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const DROPDOWN_MAX = 256;
    const PADDING = 4;

    const spaceBelow = window.innerHeight - rect.bottom - PADDING;
    const spaceAbove = rect.top - PADDING;

    let top: number;
    let maxHeight: number;

    if (spaceBelow >= DROPDOWN_MAX) {
      top = rect.bottom + PADDING;
      maxHeight = DROPDOWN_MAX;
    } else if (spaceAbove >= DROPDOWN_MAX) {
      top = rect.top - DROPDOWN_MAX - PADDING;
      maxHeight = DROPDOWN_MAX;
    } else if (spaceBelow >= spaceAbove) {
      top = rect.bottom + PADDING;
      maxHeight = Math.max(spaceBelow, 80);
    } else {
      top = Math.max(PADDING, rect.top - spaceAbove - PADDING);
      maxHeight = Math.max(spaceAbove, 80);
    }

    setDropdownStyle({ top, left: rect.left, width: rect.width, maxHeight });
  };

  const openDropdown = () => {
    if (!disabled) {
      computePosition();
      setOpen(true);
      setHighlighted(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) { onChange(opt.value); setOpen(false); setQuery(''); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {label && <div className="text-xs text-gray-500 mb-0.5">{label}</div>}
      <div
        ref={triggerRef}
        className={`flex items-center gap-1 bg-gray-900 border rounded px-2 py-1.5 text-xs cursor-pointer transition-colors ${
          open ? 'border-cyan-500' : 'border-gray-600'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-gray-400'}`}
        onClick={openDropdown}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
      >
        {open ? (
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-white outline-none text-xs min-w-0"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`flex-1 truncate ${selected ? 'text-white' : 'text-gray-500'}`}>
            {selected?.label ?? placeholder}
          </span>
        )}
        {value && !disabled && (
          <button
            type="button"
            className="text-gray-500 hover:text-red-400 shrink-0 leading-none"
            onClick={(e) => { e.stopPropagation(); onChange(''); setQuery(''); }}
            aria-label="Clear"
          >
            ✕
          </button>
        )}
        <span className="text-gray-600 shrink-0 text-xs">{open ? '▲' : '▼'}</span>
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: dropdownStyle.top, left: dropdownStyle.left, width: dropdownStyle.width, zIndex: 9999, maxHeight: dropdownStyle.maxHeight }}
          className="bg-gray-800 border border-gray-600 rounded shadow-2xl overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 italic">No results</div>
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group}>
                {group && (
                  <div className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-700/60 sticky top-0">
                    {group}
                  </div>
                )}
                {items.map((opt) => {
                  const flatIdx = filtered.indexOf(opt);
                  return (
                    <div
                      key={opt.value}
                      className={`px-3 py-1.5 cursor-pointer text-xs transition-colors ${
                        flatIdx === highlighted
                          ? 'bg-cyan-800 text-white'
                          : 'text-gray-300 hover:bg-gray-700'
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onChange(opt.value);
                        setOpen(false);
                        setQuery('');
                      }}
                      onMouseEnter={() => setHighlighted(flatIdx)}
                    >
                      <div className="truncate">{opt.label}</div>
                      {opt.subtitle && (
                        <div className="text-gray-500 text-xs truncate">{opt.subtitle}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
