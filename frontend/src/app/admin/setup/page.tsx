"use client";
import { copyText } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Building2, Check, Copy, FileText, FlaskConical, Lock, Plug, Send, Sparkles, UserCog, Users, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Combobox } from "@/components/Combobox";
import { IntegrationCards } from "@/components/IntegrationCards";
import { AccessMatrix } from "@/components/wizard/AccessMatrix";
import { DocDrop } from "@/components/wizard/DocDrop";
import { DoneStep } from "@/components/wizard/DoneStep";
import { InviteStep } from "@/components/wizard/InviteStep";
import { RoleTest } from "@/components/wizard/RoleTest";
import { toast } from "@/components/ui/Toast";
import { newWizard, useSession, useTenants, type WContainer, type Wizard } from "@/store/session";
import { INDUSTRIES } from "@/mock/admin";
import { apiFetch } from "@/lib/api";
import { useL } from "@/lib/i18n";

const STEPS: { id: string; en: string; icon: React.ReactNode }[] = [
  { id: "Perusahaan", en: "Company", icon: <Building2 size={20} /> },
  { id: "Peran", en: "Roles", icon: <Users size={20} /> },
  { id: "Dokumen", en: "Documents", icon: <FileText size={20} /> },
  { id: "Integrasi", en: "Integrations", icon: <Plug size={20} /> },
  { id: "Akses", en: "Access", icon: <Lock size={20} /> },
  { id: "Pemilik & PII", en: "Owners & PII", icon: <UserCog size={20} /> },
  { id: "Uji coba", en: "Test", icon: <FlaskConical size={20} /> },
  { id: "Undang tim", en: "Invite team", icon: <Send size={20} /> },
  { id: "Selesai", en: "Done", icon: <Sparkles size={20} /> },
];
const REQUIRED: number[] = []; // every step is skippable; the admin can adjust later
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const hueOf = (s: string) => [14, 28, 160, 200, 262, 330][hash(s) % 6];
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function Setup() {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const tid = useSession((s) => s.tenantId) ?? "";
  const stored = useSession((s) => s.wizards[tid]);
  const patchWizard = useSession((s) => s.patchWizard);
  const tenant = useTenants().find((t) => t.id === tid);
  const [code, setCode] = useState("…");
  useEffect(() => {
    apiFetch<{ join_code: string }>("/api/admin/join-code").then((r) => setCode(r.join_code)).catch(() => setCode("—"));
  }, [tid]);
  const w: Wizard = stored ?? newWizard();
  const patch = (p: Partial<Wizard>) => patchWizard(tid, p);
  const [err, setErr] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const stepName = (i: number) => (lang === "id" ? STEPS[i].id : STEPS[i].en);

  const unmapped = w.containers.filter((c) => c.tier === "hidden" && c.roles.length === 0);
  const go = (n: number) => { setErr(""); patch({ step: Math.max(0, Math.min(STEPS.length - 1, n)) }); };
  const finish = (n: number, skip = false) => {
    patch({ done: skip ? w.done : [...new Set([...w.done, n])], skipped: skip ? [...new Set([...w.skipped, n])] : w.skipped.filter((x) => x !== n) });
    go(n + 1);
  };
  const addContainers = (cs: WContainer[]) => {
    const c = useSession.getState().wizards[tid] ?? newWizard();
    patchWizard(tid, { containers: [...c.containers, ...cs.filter((x) => !c.containers.some((y) => y.name === x.name))] });
  };
  function addNames(names: string[]) {
    const c = useSession.getState().wizards[tid] ?? newWizard();
    const at = Date.now();
    patchWizard(tid, { docs: [...c.docs, ...names.map((name, i) => ({ name, status: "ingesting" as const, at: at + i * 250 }))] });
    addContainers(names.map((n) => ({ name: `Upload: ${n}`, source: "Upload", tier: "hidden", roles: [] })));
    toast(l(`${names.length} dokumen ditambahkan`, `${names.length} document(s) added`));
  }

  const company = tenant?.name ?? tid;
  const hue = hueOf(company || "x");

  const isStepFilled = () => {
    switch (w.step) {
      case 0:
        return Boolean(w.industry && (w.industry !== "other" || w.industryOther?.trim()));
      case 1:
        return w.roles.length > 0;
      case 2:
        return w.docs.length > 0;
      case 3:
        return Object.values(w.integ ?? {}).some(Boolean);
      case 4:
        return w.containers.length > 0 && w.containers.some((c) => c.tier !== "hidden" || c.roles.length > 0);
      case 5:
        return Boolean(w.approver?.trim() || w.topicOwner?.trim() || w.fallback?.trim() || (w.pii && w.pii.length > 0));
      case 6:
        return Boolean(w.tested);
      case 7:
        return (w.invitees && w.invitees.length > 0) || (w.invites && w.invites.length > 0);
      default:
        return true;
    }
  };

  const next = () => finish(w.step);

  return (
    <Shell title={l("Wizard setup perusahaan", "Company setup wizard")}>
      <p role="note" className="text-sm p-3 mb-4 rounded-erp border border-warn/40 bg-warn/10 text-warn">
        {l("Wizard ini panduan langkah demi langkah dan menyimpan draf di browser. Pengaturan yang berlaku diatur di halaman Admin (Container, Undangan, Topik, PII, Unggah).",
          "This wizard is a guided walkthrough that keeps a draft in your browser. The settings that take effect live on the Admin pages (Containers, Invites, Topics, PII, Upload).")}
      </p>
      {/* stepper */}
      <div className="card p-4 mb-6 overflow-x-auto">
        <ol className="flex items-start min-w-max mx-auto w-fit" aria-label={l("Langkah setup", "Setup steps")}>
          {STEPS.map((s, i) => {
            const done = w.done.includes(i), skipped = w.skipped.includes(i), cur = w.step === i;
            return (
              <li key={i} className="flex items-start">
                <button onClick={() => go(i)} aria-current={cur ? "step" : undefined} className="flex flex-col items-center gap-1.5 w-[92px] text-center group">
                  <span className="relative">
                    {cur && <motion.span layoutId="ring" className="absolute -inset-1.5 rounded-full border-2 border-brand" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                    <motion.span animate={{ scale: cur ? 1.08 : 1 }}
                      className={`relative w-11 h-11 rounded-full grid place-items-center border-2 transition-colors ${cur ? "bg-brand border-brand text-brandfg" : done ? "bg-ok border-ok text-brandfg" : skipped ? "border-line2 text-muted" : "border-line2 text-muted group-hover:border-brand"}`}>
                      {done ? <Check size={20} /> : s.icon}
                    </motion.span>
                  </span>
                  <span className={`text-xs ${cur ? "font-semibold" : "text-muted"}`}>{stepName(i)}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <span className="relative h-0.5 w-5 mt-[22px] bg-line2 overflow-hidden" aria-hidden>
                    <motion.span className="absolute inset-0 bg-ok origin-left" initial={false} animate={{ scaleX: done ? 1 : 0 }} transition={{ duration: 0.5 }} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <AnimatePresence mode="wait">
          <motion.div key={w.step} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="card p-6 md:p-8 flex flex-col gap-6 min-h-[460px]">
            <div>
              <p className="eyebrow">{l("Langkah", "Step")} {w.step + 1} / {STEPS.length}</p>
              <h2 className="text-3xl md:text-4xl mt-1">{stepName(w.step)}</h2>
            </div>
            {err && <p role="alert" className="text-bad">{err}</p>}

            {w.step === 0 && (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium">{l("Bidang usaha", "Industry")}</span>
                    <Combobox label={l("Bidang usaha", "Industry")} options={INDUSTRIES.map((i) => ({ value: i.value, label: i[lang] }))} value={w.industry}
                      placeholder={l("Cari atau pilih bidang usaha…", "Search or choose an industry…")}
                      emptyText={l("Tidak ada yang cocok. Pilih \"Lainnya\".", "No match. Choose \"Other\".")} onChange={(v) => patch({ industry: v })} />
                    <AnimatePresence>
                      {w.industry === "other" && (
                        <motion.input initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="input mt-1"
                          aria-label={l("Sebutkan bidang usaha", "Specify your industry")} value={w.industryOther} onChange={(e) => patch({ industryOther: e.target.value })}
                          placeholder={l("Sebutkan bidang usaha Anda", "Specify your industry")} />
                      )}
                    </AnimatePresence>
                  </div>
                  <div>
                    <span className="font-medium">{l("Kode perusahaan", "Company code")}</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="input !w-auto text-lg tracking-widest">{code}</code>
                      <button className="btn" onClick={async () => { toast((await copyText(code)) ? l("Kode disalin", "Code copied") : l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually.")); }}><Copy size={14} /> {l("Salin", "Copy")}</button>
                    </div>
                    <p className="text-sm text-muted mt-1.5">{l("Anggota yang memakai kode ini berstatus Pending sampai Anda menyetujui.", "Members who use this code stay Pending until you approve them.")}</p>
                  </div>
                </div>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card p-5 flex flex-col items-center text-center gap-3 self-start bg-surface2">
                  <span className="w-20 h-20 rounded-3xl grid place-items-center text-3xl font-semibold text-white" style={{ background: `hsl(${hue} 70% 45%)` }}>
                    {(company.match(/\b\w/g)?.join("").slice(0, 2) || "?").toUpperCase()}
                  </span>
                  <div><p className="text-xl font-semibold">{company}</p><p className="eyebrow">knowhaven.app/{slugOf(company)}</p></div>
                  <p className="text-sm text-muted">{w.industry ? INDUSTRIES.find((i) => i.value === w.industry)?.[lang] : l("Pilih bidang usaha", "Pick an industry")}</p>
                </motion.div>
              </div>
            )}

            {w.step === 1 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">{l("Peran sistem (Owner, Admin, Auditor) tetap. Peran bisnis menentukan data yang boleh dilihat.", "Business roles decide what data can be seen.")}</p>
                <LayoutGroup>
                  <motion.div layout className="flex flex-wrap gap-2 min-h-[44px]">
                    <AnimatePresence>
                      {w.roles.map((r) => (
                        <motion.span key={r} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
                          className="inline-flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5 border font-medium"
                          style={{ borderColor: `hsl(${hueOf(r)} 60% 55% / .5)`, background: `hsl(${hueOf(r)} 80% 50% / .1)` }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: `hsl(${hueOf(r)} 70% 50%)` }} />{r}
                          <button aria-label={l(`Hapus ${r}`, `Remove ${r}`)} onClick={() => patch({ roles: w.roles.filter((x) => x !== r) })} className="w-5 h-5 rounded-full grid place-items-center hover:bg-line"><X size={12} /></button>
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </motion.div>
                </LayoutGroup>
                {!w.roles.length && <p className="text-muted">{l("Belum ada peran. Tambahkan peran pertama Anda, mis. staf, hr, keuangan.", "No roles yet. Add your first role, e.g. staff, hr, finance.")}</p>}
                <form className="flex gap-2 max-w-sm" onSubmit={(e) => { e.preventDefault(); const v = roleDraft.trim().toLowerCase().replace(/\s+/g, "_"); if (v && !w.roles.includes(v)) patch({ roles: [...w.roles, v] }); setRoleDraft(""); }}>
                  <input className="input" aria-label={l("Tambah peran", "Add role")} value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} placeholder={l("Tambah peran, mis. gudang", "Add a role, e.g. warehouse")} />
                  <button className="btn btn-primary">{l("Tambah", "Add")}</button>
                </form>
              </div>
            )}

            {w.step === 2 && <DocDrop w={w} onAdd={addNames} />}
            {w.step === 3 && <IntegrationCards tid={tid} />}
            {w.step === 4 && <AccessMatrix w={w} patch={patch} />}

            {w.step === 5 && (
              <div className="grid md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5 font-medium">{l("Approver (menyetujui akses dan draf aksi)", "Approver (approves access and action drafts)")}
                    <input className="input font-normal" value={w.approver} onChange={(e) => patch({ approver: e.target.value })} placeholder={l("Nama atau email", "Name or email")} /></label>
                  <label className="flex flex-col gap-1.5 font-medium">{l("Pemilik topik (rujukan saat Havi tidak tahu)", "Topic owner (who Havi points to when it doesn't know)")}
                    <input className="input font-normal" value={w.topicOwner} onChange={(e) => patch({ topicOwner: e.target.value })} placeholder={l("mis. HR", "e.g. HR")} /></label>
                  <label className="flex flex-col gap-1.5 font-medium">{l("Kontak cadangan umum", "General fallback contact")}
                    <input className="input font-normal" value={w.fallback} onChange={(e) => patch({ fallback: e.target.value })} placeholder="helpdesk@company.com" /></label>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="font-medium mb-2">{l("Boleh melihat data pribadi tanpa masking", "May see personal data unmasked")}</p>
                    <ul className="flex flex-col gap-1.5">
                      {w.roles.map((r) => {
                        const on = w.pii.includes(r);
                        return (
                          <li key={r} className="flex items-center justify-between gap-3">
                            <span>{r}</span>
                            <button role="switch" aria-checked={on} aria-label={`PII ${r}`} onClick={() => patch({ pii: on ? w.pii.filter((x) => x !== r) : [...w.pii, r] })}
                              className={`w-11 h-6 rounded-full p-0.5 transition-colors flex ${on ? "bg-brand justify-end" : "bg-line2 justify-start"}`}>
                              <motion.span layout className="block w-5 h-5 rounded-full bg-white" transition={{ type: "spring", stiffness: 500, damping: 30 }} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {w.step === 6 && <RoleTest w={w} onTested={() => !w.tested && patch({ tested: true })} />}
            {w.step === 7 && (
              <>
                {unmapped.length > 0 && <p className="text-warn">{l("Akses belum dipetakan. Mengundang sekarang berarti anggota baru belum melihat data itu.", "Access isn't mapped yet. Inviting now means new members won't see that data.")}</p>}
                <InviteStep w={w} patch={patch} />
              </>
            )}
            {w.step === 8 && <DoneStep w={w} names={STEPS.map((_, i) => stepName(i))} goto={go} />}

            <div className="flex gap-3 flex-wrap border-t border-line pt-5 mt-auto">
              <button className="btn" disabled={w.step === 0} onClick={() => go(w.step - 1)}>{l("Kembali", "Back")}</button>
              {w.step < 8 && (
                <>
                  <button className="btn btn-primary btn-lg" disabled={!isStepFilled()} onClick={next}>{l("Simpan dan lanjut", "Save and continue")}</button>
                  {!REQUIRED.includes(w.step) && <button className="btn" onClick={() => finish(w.step, true)}>{l("Lewati", "Skip")}</button>}
                </>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

      </div>
    </Shell>
  );
}
