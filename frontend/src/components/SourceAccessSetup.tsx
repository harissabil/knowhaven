"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { useL } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { ContainerOut, RoleOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

const SOURCES: Record<string, [string, string]> = {
  slack_channel: ["Channel Slack", "Slack channels"],
  confluence_space: ["Space Confluence", "Confluence spaces"],
  jira_project: ["Project Jira", "Jira projects"],
};
type Tier = "open" | "gated" | "hidden";
interface Plan { roleIds: string[]; tier: Tier; why: [string, string] | null }

/** A starting point from the name only; the admin always confirms. Anything unrecognised stays
 * hidden: default-deny is the rule, these presets just save clicks. */
function suggest(name: string, roles: RoleOut[]): Plan {
  const n = name.toLowerCase();
  const pick = (...keys: string[]) => roles.filter((r) => keys.includes(r.key)).map((r) => r.id);
  const all = roles.map((r) => r.id);
  if (/example|sample|template|software development|sandbox|test/.test(n)) return { roleIds: [], tier: "hidden", why: null };
  if (/rahasia|secret|confidential|strategis|kenari|direksi|board|restruktur/.test(n))
    return { roleIds: pick("project_mgr", "direksi", "director"), tier: "hidden", why: ["nama menunjukkan rahasia", "name looks confidential"] };
  if (/(hr|sdm|personalia).*(internal|private)|(internal|private).*(hr|sdm)/.test(n))
    return { roleIds: pick("hr"), tier: "hidden", why: ["internal HR", "HR internal"] };
  if (/fin|keuangan|finance|gaji|payroll|salary/.test(n))
    return { roleIds: pick("hr", "finance", "direksi", "director"), tier: "gated", why: ["data keuangan", "finance data"] };
  if (/general|umum|all-|pengumuman|announce|random|social|onboarding|town ?hall|human resources|\bhr\b/.test(n))
    return { roleIds: all, tier: "open", why: ["untuk semua karyawan", "for every employee"] };
  if (/ops|operasional|gudang|logistik|warehouse|distribusi/.test(n))
    return { roleIds: pick("ops", "ops_makassar", "project_mgr"), tier: "open", why: ["tim operasional", "operations team"] };
  return { roleIds: [], tier: "hidden", why: null };
}

/** Right after connecting Slack / Atlassian: everything new is hidden (default-deny, T25); this
 * panel lets an admin open each source to the right roles in one place. */
export function SourceAccessSetup({ refreshKey = 0 }: { refreshKey?: number }) {
  const l = useL();
  const [containers, setContainers] = useState<ContainerOut[] | null>(null);
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [cs, rs] = await Promise.all([apiFetch<ContainerOut[]>("/api/admin/containers"), apiFetch<RoleOut[]>("/api/admin/roles")]);
      const business = rs.filter((r) => !r.is_system);
      const mine = cs.filter((c) => c.source in SOURCES);
      setRoles(business);
      setContainers(mine);
      setPlans(Object.fromEntries(mine.filter((c) => !c.mapped).map((c) => [c.id, suggest(c.name, business)])));
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const pending = useMemo(() => (containers ?? []).filter((c) => !c.mapped), [containers]);
  const done = useMemo(() => (containers ?? []).filter((c) => c.mapped), [containers]);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "?";

  async function apply(ids: string[]) {
    setBusy(ids.length > 1 ? "all" : ids[0]);
    setErr("");
    let n = 0;
    try {
      for (const id of ids) {
        const p = plans[id];
        if (!p || p.roleIds.length === 0) continue; // nothing chosen: stays hidden
        await apiFetch(`/api/admin/containers/${id}`, { method: "PATCH", body: JSON.stringify({ mapped: true, tier: p.tier, role_ids: p.roleIds }) });
        n++;
      }
      toast(n ? l(`${n} sumber dibuka sesuai pilihan; sisanya tetap tersembunyi`, `${n} source(s) opened as chosen; the rest stay hidden`)
        : l("Belum ada peran yang dipilih", "No roles chosen yet"));
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy("");
    }
  }

  if (!containers) return err ? <p className="text-sm text-bad">{err}</p> : null;
  if (containers.length === 0) return null;
  const withPlan = pending.filter((c) => (plans[c.id]?.roleIds.length ?? 0) > 0).map((c) => c.id);

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={18} className="text-brand" />
        <h3 className="font-semibold flex-1">{l("Atur siapa yang bisa membaca sumber baru", "Choose who can read the new sources")}</h3>
        {withPlan.length > 0 && (
          <button className="btn btn-primary" disabled={!!busy} onClick={() => apply(withPlan)}>
            <Sparkles size={15} /> {busy === "all" ? l("Menerapkan…", "Applying…") : l(`Terapkan semua (${withPlan.length})`, `Apply all (${withPlan.length})`)}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        {l("Semua yang baru masuk tersembunyi dulu, supaya channel atau space rahasia tidak pernah terbuka tanpa sengaja. Pilihan di bawah sudah diisi saran dari namanya; periksa lalu terapkan. Yang tanpa peran tetap tersembunyi.",
          "Everything new starts hidden, so a confidential channel or space is never opened by accident. The choices below are pre-filled from each name; review and apply. Anything without roles stays hidden.")}
      </p>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}

      {pending.length === 0 ? (
        <p className="text-sm text-ok flex items-center gap-1.5"><Check size={15} /> {l("Semua sumber sudah diatur.", "Every source has access set.")}</p>
      ) : (
        Object.keys(SOURCES).map((src) => {
          const rows = pending.filter((c) => c.source === src);
          if (!rows.length) return null;
          return (
            <div key={src} className="flex flex-col gap-2">
              <p className="eyebrow">{l(...SOURCES[src])}</p>
              {rows.map((c) => {
                const p = plans[c.id] ?? { roleIds: [], tier: "hidden" as Tier, why: null };
                const set = (patch: Partial<Plan>) => setPlans((prev) => ({ ...prev, [c.id]: { ...p, ...patch, why: null } }));
                return (
                  <div key={c.id} className="rounded-erp border border-line p-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{c.name}</b>
                      <span className="text-xs text-muted">{c.item_count} item</span>
                      {p.why && <span className="text-xs px-1.5 py-0.5 rounded bg-tint text-brand">{l("saran", "suggested")}: {l(...p.why)}</span>}
                      <span className="flex-1" />
                      <select className="input !w-auto !py-1 text-sm" value={p.tier} onChange={(e) => set({ tier: e.target.value as Tier })} aria-label="tier">
                        <option value="open">{l("Terbuka untuk peran terpilih", "Open to chosen roles")}</option>
                        <option value="gated">{l("Terbatas, orang lain bisa minta akses", "Restricted, others can request access")}</option>
                        <option value="hidden">{l("Rahasia, tidak ditawarkan ke orang lain", "Confidential, never offered to others")}</option>
                      </select>
                      <button className="btn !py-1" disabled={!!busy || p.roleIds.length === 0} onClick={() => apply([c.id])}>
                        {busy === c.id ? "…" : l("Terapkan", "Apply")}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                      <button type="button" className="text-xs underline text-muted" onClick={() => set({ roleIds: roles.map((r) => r.id) })}>{l("semua anggota", "all members")}</button>
                      <button type="button" className="text-xs underline text-muted" onClick={() => set({ roleIds: [] })}>{l("kosongkan", "clear")}</button>
                      {roles.map((r) => (
                        <label key={r.id} className="text-xs flex items-center gap-1">
                          <input type="checkbox" checked={p.roleIds.includes(r.id)}
                            onChange={(e) => set({ roleIds: e.target.checked ? [...p.roleIds, r.id] : p.roleIds.filter((x) => x !== r.id) })} />
                          {r.name}
                        </label>
                      ))}
                      {p.roleIds.length === 0 && <span className="text-xs text-muted inline-flex items-center gap-1"><EyeOff size={12} /> {l("tetap tersembunyi", "stays hidden")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{l(`${done.length} sumber sudah diatur`, `${done.length} source(s) already set`)}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {done.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-2"><b>{c.name}</b><span className="text-muted">{c.tier} · {c.role_ids.map(roleName).join(", ") || "—"}</span></li>
            ))}
          </ul>
          <Link className="text-xs underline" href="/admin/containers">{l("Ubah di halaman Container", "Change on the Containers page")}</Link>
        </details>
      )}
    </section>
  );
}
