"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import { PII_TYPES, type PiiMatrix, type RoleOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

const LABEL: Record<string, string> = { nik: "NIK", phone: "Phone", email: "Email", npwp: "NPWP", bank_account: "Bank" };

export default function Pii() {
  const t = useT();
  const l = useL();
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [m, setM] = useState<PiiMatrix>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([apiFetch<RoleOut[]>("/api/admin/roles"), apiFetch<PiiMatrix>("/api/admin/pii")])
      .then(([rs, pii]) => { setRoles(rs.filter((r) => !r.is_system)); setM(pii); })
      .catch((e) => setErr(errorText(e)));
  }, []);

  const toggle = async (roleId: string, p: string) => {
    const current = m[roleId] ?? [];
    const updated = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    const prev = m;
    setM({ ...m, [roleId]: updated });
    try {
      await apiFetch(`/api/admin/pii/${roleId}`, { method: "PUT", body: JSON.stringify({ pii_types: updated }) });
      toast(l("Kebijakan PII diperbarui", "PII policy updated"));
    } catch (e) {
      setM(prev);
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  };

  return (
    <Shell title={t("pii")}>
      <p className="mb-3 text-sm text-muted">
        {l(
          "Peran yang dicentang boleh melihat jenis data pribadi (PII) itu tanpa masking, hanya di sumber yang memang boleh dibacanya. Perubahan dicatat di audit log tamper-evident.",
          "Checked roles see that kind of personal data (PII) unmasked, only in sources they can already read. Changes are written to the tamper-evident audit log.",
        )}
      </p>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface2">
            <tr>
              <th className="px-4 py-3">{l("Peran", "Role")}</th>
              {PII_TYPES.map((p) => <th key={p} className="px-4 py-3">{LABEL[p]}</th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-3.5"><span className="inline-flex items-center gap-2.5"><span className="font-semibold">{r.name}</span><span className="text-xs text-muted font-mono px-1.5 py-0.5 rounded bg-surface2 border border-line">{r.key}</span></span></td>
                {PII_TYPES.map((p) => (
                  <td key={p} className="px-4 py-3.5">
                    <input type="checkbox" aria-label={`${r.name} ${LABEL[p]}`} checked={!!m[r.id]?.includes(p)} onChange={() => toggle(r.id, p)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
