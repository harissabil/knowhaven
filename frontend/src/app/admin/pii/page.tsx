"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { PII_DEFAULT, PII_ROLES, PII_TYPES } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

export default function Pii() {
  const t = useT();
  const l = useL();
  const [m, setM] = useState<Record<string, string[]>>(PII_DEFAULT);

  useEffect(() => {
    async function loadPii() {
      try {
        const res = await apiFetch<{ roles: string[] }>("/api/admin/pii");
        if (res && res.roles) {
          const next: Record<string, string[]> = {};
          for (const role of PII_ROLES) {
            next[role] = res.roles.includes(role) ? [...PII_TYPES] : [];
          }
          setM(next);
        }
      } catch {
        // fallback to default
      }
    }
    loadPii();
  }, []);

  const toggle = async (r: string, p: string) => {
    const nextRoles = { ...m };
    const current = nextRoles[r] || [];
    const updated = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    nextRoles[r] = updated;
    setM(nextRoles);

    // Collect all roles that have any PII privileges
    const activePiiRoles = Object.entries(nextRoles)
      .filter(([, types]) => types.length > 0)
      .map(([role]) => role);

    try {
      await apiFetch("/api/admin/pii", {
        method: "POST",
        body: JSON.stringify({ roles: activePiiRoles }),
      });
      toast(l("Kebijakan PII diperbarui", "PII policy updated"));
    } catch {
      // offline fallback
    }
  };

  return (
    <Shell title={t("pii")}>
      <p className="mb-3 text-sm text-muted">
        {l(
          "Peran yang dicentang boleh melihat data pribadi (PII) tanpa masking. Perubahan dicatat di audit log tamper-evident.",
          "Checked roles can see personal data (PII) unmasked. Changes are written to the tamper-evident audit log.",
        )}
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface2">
            <tr>
              <th className="p-3">{l("Peran", "Role")}</th>
              {PII_TYPES.map((p) => (
                <th key={p} className="p-3">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PII_ROLES.map((r) => (
              <tr key={r} className="border-t border-line">
                <td className="p-3 font-semibold">{r}</td>
                {PII_TYPES.map((p) => (
                  <td key={p} className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`${r} ${p}`}
                      checked={!!m[r]?.includes(p)}
                      onChange={() => toggle(r, p)}
                    />
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
