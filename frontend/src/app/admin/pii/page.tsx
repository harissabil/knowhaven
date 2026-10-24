"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { PII_DEFAULT, PII_ROLES, PII_TYPES } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";

export default function Pii() {
  const t = useT();
  const l = useL();
  const [m, setM] = useState(PII_DEFAULT);
  const toggle = (r: string, p: string) =>
    setM((o) => ({ ...o, [r]: o[r]?.includes(p) ? o[r].filter((x) => x !== p) : [...(o[r] ?? []), p] }));
  return (
    <Shell title={t("pii")}>
      <p className="mb-2 text-sm text-muted">{l("Peran yang dicentang boleh melihat data pribadi tanpa masking. Perubahan dicatat di audit log.", "Checked roles can see personal data unmasked. Changes are written to the audit log.")}</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-surface2"><tr><th className="p-2">{l("Peran", "Role")}</th>{PII_TYPES.map((p) => <th key={p} className="p-2">{p}</th>)}</tr></thead>
          <tbody>
            {PII_ROLES.map((r) => (
              <tr key={r} className="border-t border-line">
                <td className="p-2 font-semibold">{r}</td>
                {PII_TYPES.map((p) => (
                  <td key={p} className="p-2"><input type="checkbox" aria-label={`${r} ${p}`} checked={!!m[r]?.includes(p)} onChange={() => toggle(r, p)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
