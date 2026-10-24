"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Shell } from "@/components/Shell";
import { usePersona, useSession } from "@/store/session";
import { useL, useT } from "@/lib/i18n";

export default function WorkBuddy() {
  const t = useT();
  const l = useL();
  const { persona } = usePersona();
  const tenant = useSession((s) => s.tenantId);
  const [tok, setTok] = useState("");
  const cfg = JSON.stringify({ mcpServers: { knowhaven: { url: "https://knowhaven.example.com/mcp", headers: { Authorization: `Bearer ${tok || "<token>"}` } } } }, null, 2);
  return (
    <Shell title={t("workbuddy")}>
      <div className="card p-4 flex flex-col gap-3 max-w-2xl">
        <p>{l("Token terikat ke", "The token is bound to")} <b>{persona?.name}</b> {l("di perusahaan", "at company")} <b>{tenant?.toUpperCase()}</b>.</p>
        <button className="btn btn-primary w-fit" onClick={() => setTok("wb_" + Math.random().toString(36).slice(2, 12))}><KeyRound size={16} /> {l("Buat token", "Create token")}</button>
        <pre className="bg-surface2 p-3 rounded-erp text-sm overflow-x-auto">{cfg}</pre>
      </div>
    </Shell>
  );
}
