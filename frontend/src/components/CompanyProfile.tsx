"use client";
import { useEffect, useState } from "react";
import { Building2, Save } from "lucide-react";
import { useL } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { TenantSettingsOut } from "@/lib/contracts";
import { useSession } from "@/store/session";
import { toast } from "@/components/ui/Toast";

/** Admin-only: company facts every member's answers may use (cited as COMPANY-profile). */
export function CompanyProfileCard() {
  const l = useL();
  const syncMe = useSession((s) => s.syncMe);
  const [form, setForm] = useState<TenantSettingsOut | null>(null);
  const [saved, setSaved] = useState<TenantSettingsOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch<TenantSettingsOut>("/api/admin/tenant").then((t) => { setForm(t); setSaved(t); }).catch((e) => setErr(errorText(e)));
  }, []);

  async function save() {
    if (!form || !saved) return;
    setBusy(true);
    setErr("");
    const body: Record<string, string | null> = {};
    if (form.name.trim() !== saved.name) body.name = form.name.trim();
    if ((form.default_contact ?? "") !== (saved.default_contact ?? "")) body.default_contact = form.default_contact?.trim() || null;
    if ((form.profile ?? "") !== (saved.profile ?? "")) body.profile = form.profile?.trim() || null;
    try {
      const t = await apiFetch<TenantSettingsOut>("/api/admin/tenant", { method: "PATCH", body: JSON.stringify(body) });
      setForm(t);
      setSaved(t);
      if (body.name) await syncMe(); // tenant switcher shows the new name
      toast(l("Profil perusahaan disimpan", "Company profile saved"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty = !!form && !!saved && (form.name !== saved.name || (form.default_contact ?? "") !== (saved.default_contact ?? "") || (form.profile ?? "") !== (saved.profile ?? ""));

  return (
    <section className="card p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Building2 size={20} className="text-brand" />
        <h2 className="text-xl font-semibold flex-1">{l("Profil perusahaan", "Company profile")}</h2>
      </div>
      <p className="text-sm text-muted">
        {l("Fakta umum yang boleh diketahui semua anggota, misalnya tahun berdiri, alamat, atau bidang usaha. Havi memakai ini untuk menjawab pertanyaan tentang perusahaan. Jangan masukkan data rahasia di sini.",
          "General facts every member may know, such as the founding year, address, or line of business. Havi uses this to answer questions about the company. Don't put confidential data here.")}
      </p>
      {err && <p role="alert" className="text-bad text-sm">{err}</p>}
      {form && (
        <>
          <label className="field">{l("Nama perusahaan", "Company name")}
            <input className="input" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">{l("Kontak umum (dipakai saat Havi tidak tahu)", "General contact (used when Havi doesn't know)")}
            <input className="input" value={form.default_contact ?? ""} maxLength={200} placeholder="HR (hr@company.id)" onChange={(e) => setForm({ ...form, default_contact: e.target.value })} />
          </label>
          <label className="field">{l("Tentang perusahaan", "About the company")}
            <textarea className="input min-h-32" value={form.profile ?? ""} maxLength={4000}
              placeholder={l("mis. Berdiri sejak 2020 di Jakarta. Bergerak di bidang distribusi.", "e.g. Founded in 2020 in Jakarta. We distribute consumer goods.")}
              onChange={(e) => setForm({ ...form, profile: e.target.value })} />
            <span className="text-xs text-muted text-right">{(form.profile ?? "").length}/4000</span>
          </label>
          <div className="flex justify-end pt-4 border-t border-line">
            <button className="btn btn-primary" onClick={save} disabled={!dirty || busy || form.name.trim().length < 2}>
              <Save size={15} /> {busy ? l("Menyimpan…", "Saving…") : l("Simpan", "Save")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
