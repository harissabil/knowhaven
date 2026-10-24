"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Link2 } from "lucide-react";
import { ProductDemo } from "@/components/ProductDemo";
import { Mascot } from "@/components/mascot/Mascot";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function MiniApprovals({ lang }: { lang: "id" | "en" }) {
  const [done, setDone] = useState(false);
  const [press, setPress] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      while (!dead) {
        setDone(false); setPress(false); await sleep(1600);
        setPress(true); await sleep(250); setPress(false); setDone(true); await sleep(3800);
      }
    })();
    return () => { dead = true; };
  }, []);
  const l = (a: string, b: string) => (lang === "id" ? a : b);
  return (
    <div className="p-5 flex flex-col gap-4 min-h-[300px]">
      <p className="eyebrow">{l("Permintaan akses · menunggu approver", "Access request · awaiting approver")}</p>
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <p className="font-medium">Rina Wulandari</p>
          <p className="text-muted text-sm">{l("Meminta: Grade gaji per level", "Requests: Salary grades per level")}</p>
          <p className="text-muted text-sm">{l("Alasan: evaluasi staf baru Makassar", "Reason: evaluating new Makassar staff")}</p>
        </div>
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="ok" className="flex items-center gap-2 text-ok font-medium" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <span className="w-7 h-7 rounded-full bg-ok text-brandfg grid place-items-center"><Check size={16} /></span>
              {l("Disetujui 7 hari", "Approved for 7 days")}
            </motion.div>
          ) : (
            <motion.div key="btn" exit={{ opacity: 0 }} className="flex gap-2">
              <span className={`btn btn-primary ${press ? "!scale-95" : ""}`}>{l("Setujui 7 hari", "Approve 7 days")}</span>
              <span className="btn">{l("Tolak", "Reject")}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="card p-4 font-mono text-sm">
        <p className="eyebrow mb-2">{l("Draf aksi · SOP Reimbursement", "Action draft · Reimbursement SOP")}</p>
        <p className="text-bad">- {l("Uang bensin: Rp500.000", "Fuel allowance: Rp500,000")}</p>
        <p className="text-ok">+ {l("Uang bensin: Rp750.000", "Fuel allowance: Rp750,000")}</p>
      </div>
    </div>
  );
}

function MiniAudit({ lang }: { lang: "id" | "en" }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      while (!dead) {
        setN(0); await sleep(900);
        for (let i = 1; i <= 5 && !dead; i++) { setN(i); await sleep(600); }
        await sleep(3000);
      }
    })();
    return () => { dead = true; };
  }, []);
  const hashes = ["a3f9…c01", "7be2…9d4", "c4d0…12a", "19ab…f7e", "e5c8…304"];
  const l = (a: string, b: string) => (lang === "id" ? a : b);
  return (
    <div className="p-5 flex flex-col gap-5 min-h-[300px]">
      <p className="eyebrow">{l("Audit log · verifikasi hash chain", "Audit log · hash chain verification")}</p>
      <div className="flex items-center overflow-x-auto pb-2">
        {hashes.map((h, i) => (
          <div key={h} className="flex items-center">
            <motion.div className="card px-3 py-2 min-w-[110px] font-mono text-xs"
              animate={{ borderColor: n > i ? "var(--ok)" : "var(--border)" }}>
              <p className="text-muted">#{i + 1}</p><p>{h}</p>
              <p className={n > i ? "text-ok" : "text-muted"}>{n > i ? "✓ ok" : "…"}</p>
            </motion.div>
            {i < hashes.length - 1 && <motion.span className="mx-1" animate={{ color: n > i + 1 ? "var(--ok)" : "var(--border-strong)" }}><Link2 size={18} /></motion.span>}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted">{n === 5 ? l("Rantai utuh: tidak ada entri yang diubah.", "Chain intact: no entry was altered.") : l("Memeriksa tiap entri terhadap hash sebelumnya…", "Checking each entry against the previous hash…")}</p>
    </div>
  );
}

export function ProductTabs({ lang, question, answer, traceLabel, frame }: {
  lang: "id" | "en"; question: string; answer: string; traceLabel: string; frame: string;
}) {
  const [tab, setTab] = useState(0);
  const tabs = [lang === "id" ? "Chat" : "Chat", lang === "id" ? "Persetujuan" : "Approvals", "Audit"];
  return (
    <div>
      <div className="flex gap-2 mb-4 justify-center" role="tablist">
        {tabs.map((t, i) => (
          <button key={t} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            className={`btn ${tab === i ? "btn-primary" : ""}`}>{t}</button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="eyebrow border-b border-line px-4 py-2.5 flex items-center gap-2"><Mascot size={22} /> {tab === 0 ? frame : tabs[tab]}</div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {tab === 0 && <ProductDemo lang={lang} question={question} answer={answer} traceLabel={traceLabel} frame="" bare />}
            {tab === 1 && <MiniApprovals lang={lang} />}
            {tab === 2 && <MiniAudit lang={lang} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
