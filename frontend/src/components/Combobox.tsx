"use client";
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface Option { value: string; label: string }

/** Searchable single-select dropdown (ARIA combobox). */
export function Combobox({ options, value, onChange, placeholder, label, emptyText }: {
  options: Option[]; value: string; onChange: (v: string) => void;
  placeholder?: string; label: string; emptyText: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const list = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())),
    [options, q],
  );
  const pick = (o: Option) => { onChange(o.value); setOpen(false); setQ(""); };

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setQ(""); } }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        ref={ref} id={id} className="input pr-8" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        value={open ? q : selected?.label ?? ""} placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
      />
      <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="card absolute z-20 mt-1 w-full max-h-60 overflow-auto">
          {list.length === 0 && <li className="px-3 py-2 text-muted">{emptyText}</li>}
          {list.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} tabIndex={-1}
              className={`px-3 py-2 cursor-pointer ${i === hi ? "bg-surface2" : ""} ${o.value === value ? "font-bold" : ""}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
