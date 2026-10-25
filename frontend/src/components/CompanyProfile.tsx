"use client";
import { useEffect, useState } from "react";
import { Building2, Save } from "lucide-react";
import { useL } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { TenantSettingsOut } from "@/lib/contracts";
import { useSession } from "@/store/session";
import { Combobox } from "@/components/Combobox";
import { INDUSTRIES } from "@/mock/admin";
import { toast } from "@/components/ui/Toast";

function parseIndustryFromProfile(
  profile: string | null | undefined,
  wizardIndustry?: string,
  wizardOther?: string,
): { industry: string; industryOther: string } {
  const raw = (profile ?? "").trim();
  const stripped = raw.replace(/^Bidang usaha \/ Industry:\s*/i, "").trim();
  if (stripped) {
    for (const item of INDUSTRIES) {
      if (item.value === "other") continue;
      if (
        stripped.toLowerCase() === item.value.toLowerCase() ||
        stripped.toLowerCase() === item.id.toLowerCase() ||
        stripped.toLowerCase() === item.en.toLowerCase() ||
        stripped.toLowerCase() === `${item.id} / ${item.en}`.toLowerCase()
      ) {
        return { industry: item.value, industryOther: "" };
      }
    }
    return { industry: "other", industryOther: stripped };
  }
  if (wizardIndustry) {
    return { industry: wizardIndustry, industryOther: wizardOther ?? "" };
  }
  return { industry: "", industryOther: "" };
}

function formatIndustryForProfile(industry: string, industryOther: string): string | null {
  if (!industry) return null;
  if (industry === "other") {
    const custom = industryOther.trim();
    return custom ? `Bidang usaha / Industry: ${custom}` : null;
  }
  const found = INDUSTRIES.find((i) => i.value === industry);
  if (!found) return null;
  return `Bidang usaha / Industry: ${found.id} / ${found.en}`;
}

/** Admin-only: Company Name & Industry settings based on onboarding data. */
export function CompanyProfileCard() {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const tid = useSession((s) => s.tenantId) ?? "";
  const wizard = useSession((s) => (tid ? s.wizards[tid] : undefined));
  const patchWizard = useSession((s) => s.patchWizard);
  const syncMe = useSession((s) => s.syncMe);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");

  const [savedName, setSavedName] = useState("");
  const [savedIndustry, setSavedIndustry] = useState("");
  const [savedIndustryOther, setSavedIndustryOther] = useState("");

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoaded(false);
    apiFetch<TenantSettingsOut>("/api/admin/tenant")
      .then((t) => {
        const parsed = parseIndustryFromProfile(t.profile, wizard?.industry, wizard?.industryOther);
        setName(t.name);
        setSlug(t.slug);
        setIndustry(parsed.industry);
        setIndustryOther(parsed.industryOther);
        setSavedName(t.name);
        setSavedIndustry(parsed.industry);
        setSavedIndustryOther(parsed.industryOther);
        setLoaded(true);
      })
      .catch((e) => setErr(errorText(e)));
  }, [tid, wizard?.industry, wizard?.industryOther]);

  async function save() {
    if (!loaded) return;
    setBusy(true);
    setErr("");
    const cleanName = name.trim();
    const profileValue = formatIndustryForProfile(industry, industryOther);
    const body: Record<string, string | null> = {
      name: cleanName,
      profile: profileValue,
    };
    try {
      const t = await apiFetch<TenantSettingsOut>("/api/admin/tenant", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setName(t.name);
      setSlug(t.slug);
      setSavedName(t.name);
      setSavedIndustry(industry);
      setSavedIndustryOther(industryOther.trim());
      if (tid) {
        patchWizard(tid, { industry, industryOther: industryOther.trim() });
      }
      if (cleanName !== savedName) {
        await syncMe(); // tenant switcher shows the new name
      }
      toast(l("Pengaturan perusahaan disimpan", "Company settings saved"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    loaded &&
    (name.trim() !== savedName ||
      industry !== savedIndustry ||
      (industry === "other" && industryOther.trim() !== savedIndustryOther));

  const valid =
    name.trim().length >= 2 && (industry !== "other" || industryOther.trim().length > 0);

  return (
    <section className="card p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Building2 size={20} className="text-brand" />
        <h2 className="text-xl font-semibold flex-1">{l("Profil Perusahaan", "Company Profile")}</h2>
      </div>
      <p className="text-sm text-muted">
        {l(
          "Nama dan bidang usaha perusahaan yang diisi saat pendaftaran (onboarding). Informasi ini menjadi identitas perusahaan Anda di Knowhaven.",
          "Company name and industry configured during onboarding. This information defines your company identity in Knowhaven."
        )}
      </p>
      {err && <p role="alert" className="text-bad text-sm">{err}</p>}
      {loaded && (
        <>
          <label className="field">
            {l("Nama perusahaan", "Company name")}
            <input
              className="input font-normal"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={l("mis. PT Sinar Rantai Nusantara", "e.g. Acme Logistics")}
            />
            {slug && (
              <span className="text-xs text-muted font-mono font-normal">
                knowhaven.app/{slug}
              </span>
            )}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">{l("Bidang usaha", "Company industry")}</span>
            <Combobox
              label={l("Bidang usaha", "Company industry")}
              options={INDUSTRIES.map((i) => ({ value: i.value, label: i[lang] }))}
              value={industry}
              placeholder={l("Cari atau pilih bidang usaha…", "Search or choose an industry…")}
              emptyText={l("Tidak ada yang cocok. Pilih \"Lainnya\".", "No match. Choose \"Other\".")}
              onChange={(v) => setIndustry(v)}
            />
            {industry === "other" && (
              <input
                className="input mt-1 font-normal"
                aria-label={l("Sebutkan bidang usaha", "Specify your industry")}
                value={industryOther}
                onChange={(e) => setIndustryOther(e.target.value)}
                placeholder={l("Sebutkan bidang usaha Anda", "Specify your industry")}
              />
            )}
          </div>

          <div className="flex justify-end pt-4 border-t border-line">
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={!dirty || !valid || busy}
            >
              <Save size={15} /> {busy ? l("Menyimpan…", "Saving…") : l("Simpan Perubahan", "Save Changes")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
