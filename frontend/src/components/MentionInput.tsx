"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileIcon } from "@/components/documents";
import { useL } from "@/lib/i18n";
import type { DocumentOut } from "@/lib/contracts";
import { present, type Mention } from "@/lib/mentions";

const MAX_HEIGHT = 160;
// Both layers must lay text out identically: same padding, font, line height and wrapping.
const LAYER = "px-4 py-3 text-base leading-6 whitespace-pre-wrap break-words";

/** A message box where "@" picks a readable document and the tag stays inline in the text,
 * highlighted like a mention. A mirror layer behind a transparent textarea draws the highlight, so
 * typing, selection, IME and paste behave like a normal textarea. */
export function MentionInput({ value, onChange, mentions, onMentionsChange, docs, onSubmit, disabled, placeholder, pickerRequest = 0, focusRequest = 0 }: {
  value: string;
  onChange: (v: string) => void;
  mentions: Mention[];
  onMentionsChange: (m: Mention[]) => void;
  docs: DocumentOut[];
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Increment to open the document picker (the "@" button next to the box). */
  pickerRequest?: number;
  /** Increment to focus the box with the caret at the end (e.g. after prefilling it). */
  focusRequest?: number;
}) {
  const l = useL();
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [match, setMatch] = useState<{ start: number; end: number; query: string } | null>(null);
  const [idx, setIdx] = useState(0);

  // Grow with the text up to MAX_HEIGHT, then scroll (the mirror follows).
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    if (mirror.current) mirror.current.scrollTop = el.scrollTop;
  }, [value]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = ta.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [focusRequest]);

  const options = useMemo(() => {
    if (!match) return [];
    const needle = match.query.toLowerCase();
    const taken = new Set(mentions.map((m) => m.id));
    return docs.filter((d) => !taken.has(d.id) && (!needle || `${d.title ?? ""} ${d.filename} ${d.folder_name} ${d.id}`.toLowerCase().includes(needle))).slice(0, 8);
  }, [match, docs, mentions]);

  function detect(text: string, caret: number) {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    if (!m) return setMatch(null);
    setMatch({ start: caret - m[1].length - 1, end: caret, query: m[1] });
    setIdx(0);
  }

  useEffect(() => {
    if (!pickerRequest) return;
    const next = insertAt(value);
    onChange(next);
    detect(next, next.length);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(next.length, next.length); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerRequest]);

  function update(text: string, caret: number) {
    onChange(text);
    onMentionsChange(present(text, mentions)); // a deleted token drops its tag
    detect(text, caret);
  }

  function pick(d: DocumentOut) {
    if (!match) return;
    const title = (d.title || d.filename).replace(/[[\]\n]/g, " ").trim();
    const token = `@${title} `;
    const next = value.slice(0, match.start) + token + value.slice(match.end);
    const caret = match.start + token.length;
    onChange(next);
    onMentionsChange([...present(next, mentions), { id: d.id, title }]);
    setMatch(null);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(caret, caret); });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (match && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[idx]);
        return;
      }
    }
    if (e.key === "Escape" && match) {
      e.preventDefault();
      setMatch(null);
      return;
    }
    const el = e.currentTarget;
    // Backspace right after a tag removes the whole tag, like a chip.
    if (e.key === "Backspace" && el.selectionStart === el.selectionEnd) {
      const before = value.slice(0, el.selectionStart);
      const hit = mentions.find((m) => before.endsWith(`@${m.title}`) || before.endsWith(`@${m.title} `));
      if (hit) {
        e.preventDefault();
        const cut = before.endsWith(" ") ? `@${hit.title} ` : `@${hit.title}`;
        const start = before.length - cut.length;
        update(value.slice(0, start) + value.slice(el.selectionStart), start);
        requestAnimationFrame(() => el.setSelectionRange(start, start));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  // Mirror content: plain text with the tag tokens highlighted.
  const highlighted = useMemo(() => {
    const titles = [...mentions].map((m) => m.title).sort((a, b) => b.length - a.length);
    if (!titles.length) return [value];
    const re = new RegExp(`(${titles.map((t) => `@${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).join("|")})`, "g");
    return value.split(re).map((part, i) =>
      i % 2 === 1 ? <mark key={i} className="bg-tint text-brand rounded-sm">{part}</mark> : <span key={i}>{part}</span>);
  }, [value, mentions]);

  return (
    <div className="relative flex-1">
      <AnimatePresence>
        {match && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full left-0 right-0 mb-2 card p-2 shadow-xl max-h-64 overflow-y-auto z-30" role="listbox">
            <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted flex justify-between gap-2">
              <span>{l("Tandai dokumen (@)", "Tag a document (@)")}</span>
              <span className="font-normal normal-case">{l("↑↓ pilih · Enter tandai · Esc tutup", "↑↓ navigate · Enter select · Esc close")}</span>
            </div>
            {options.length === 0 ? (
              <p className="text-xs text-muted px-2.5 py-3">{l("Tidak ada dokumen yang cocok.", "No readable documents match.")}</p>
            ) : options.map((d, i) => (
              <button key={d.id} type="button" role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(d)}
                className={`w-full text-left px-2.5 py-2 rounded-erp flex items-center gap-2.5 text-sm ${i === idx ? "bg-tint text-brand font-medium" : "hover:bg-surface2"}`}>
                <FileIcon filename={d.filename} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">{d.title || d.filename}</span>
                  <span className="block text-xs text-muted truncate">{d.folder_name} · <span className="font-mono">{d.filename}</span></span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="input !p-0 rounded-3xl relative overflow-hidden focus-within:border-brand">
        <div ref={mirror} aria-hidden className={`${LAYER} absolute inset-0 overflow-hidden pointer-events-none text-fg`}>
          {highlighted}{"​"}
        </div>
        <textarea
          ref={ta}
          rows={1}
          value={value}
          maxLength={1800}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={l("Pesan untuk Havi", "Message to Havi")}
          className={`${LAYER} relative block w-full resize-none bg-transparent outline-none text-transparent caret-[var(--fg)] placeholder:text-muted selection:bg-brand/25`}
          style={{ maxHeight: MAX_HEIGHT }}
          onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
          onBlur={() => setTimeout(() => setMatch(null), 120)}
        />
      </div>
    </div>
  );
}

/** Opens the picker from a button: inserts "@" at the caret. */
export function insertAt(value: string): string {
  return value.endsWith(" ") || !value ? `${value}@` : `${value} @`;
}
