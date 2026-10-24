"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FileText, ShieldCheck, UploadCloud } from "lucide-react";
import type { Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";

const DURATION = 3200;
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function DocRow({ name, at }: { name: string; at: number }) {
  const l = useL();
  const [now, setNow] = useState(() => Date.now());
  const p = Math.min(1, (now - at) / DURATION);
  useEffect(() => {
    if (p >= 1) return;
    const t = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(t);
  }, [p]);
  const stages = [l("Membaca", "Reading"), l("Memasking PII", "Masking PII"), l("Cek injeksi", "Checking injection"), l("Embedding", "Embedding")];
  const stage = Math.min(stages.length - 1, Math.floor(p * stages.length));
  const ext = name.split(".").pop()?.toUpperCase() ?? "FILE";
  const pii = hash(name) % 4;
  return (
    <motion.li layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card p-3 flex items-center gap-3">
      <span className="w-10 h-10 rounded-lg bg-tint text-brand grid place-items-center shrink-0"><FileText size={20} /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{name}</span>
          <span className="eyebrow border border-line2 rounded px-1">{ext}</span>
        </div>
        <div className="h-1.5 rounded-full bg-line mt-2 overflow-hidden">
          <div className="h-full bg-brand transition-[width] duration-100" style={{ width: `${p * 100}%`, background: p >= 1 ? "var(--ok)" : undefined }} />
        </div>
        <p className="text-xs text-muted mt-1">
          {p >= 1
            ? <span className="inline-flex items-center gap-1 text-ok"><ShieldCheck size={12} /> {l(`Siap · ${pii} data pribadi dimasking · tanpa injeksi`, `Ready · ${pii} personal data masked · no injection found`)}</span>
            : `${stages[stage]}…`}
        </p>
      </div>
      {p >= 1 && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-6 h-6 rounded-full bg-ok text-brandfg grid place-items-center"><Check size={14} /></motion.span>}
    </motion.li>
  );
}

export function DocDrop({ w, onAdd }: { w: Wizard; onAdd: (names: string[]) => void }) {
  const l = useL();
  const [drag, setDrag] = useState(false);
  const take = (files: FileList | null) => { if (files?.length) onAdd([...files].map((f) => f.name)); };
  return (
    <div className="flex flex-col gap-4">
      <motion.label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
        animate={{ scale: drag ? 1.015 : 1, borderColor: drag ? "var(--brand)" : "var(--border-strong)" }}
        className={`relative flex flex-col items-center gap-2 text-center rounded-2xl border-2 border-dashed px-6 py-10 cursor-pointer ${drag ? "bg-tint" : "bg-surface2"}`}>
        <motion.span animate={{ y: drag ? -6 : [0, -4, 0] }} transition={drag ? {} : { duration: 2.4, repeat: Infinity }} className="w-14 h-14 rounded-2xl bg-brand text-brandfg grid place-items-center">
          <UploadCloud size={28} />
        </motion.span>
        <b className="text-lg">{drag ? l("Lepaskan untuk mengunggah", "Drop to upload") : l("Seret dokumen ke sini", "Drag documents here")}</b>
        <span className="text-muted text-sm">{l("atau klik untuk memilih · PDF, DOCX, MD, export WhatsApp .txt", "or click to browse · PDF, DOCX, MD, WhatsApp export .txt")}</span>
        <input type="file" multiple className="sr-only" onChange={(e) => take(e.target.files)} />
      </motion.label>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">{l("Setiap file menjadi container tertutup sampai dipetakan di langkah Akses.", "Each file becomes a closed container until mapped in the Access step.")}</span>
      </div>
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {w.docs.map((d, i) => <DocRow key={d.name + i} name={d.name} at={d.at ?? 0} />)}
        </AnimatePresence>
      </ul>
    </div>
  );
}
