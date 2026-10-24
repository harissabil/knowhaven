"use client";
import { copyText } from "@/lib/clipboard";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, Check, Trash2 } from "lucide-react";
import { Shell } from "@/components/Shell";
import { usePersona, useSession } from "@/store/session";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { TokenCreated, TokenOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

export default function WorkBuddy() {
  const t = useT();
  const l = useL();
  const { persona } = usePersona();
  const tenantName = useSession((s) => s.currentUser?.active_tenant?.tenant_name);
  const [created, setCreated] = useState<TokenCreated | null>(null);
  const [copied, setCopied] = useState<"" | "cfg" | "ins">("");
  const [tokens, setTokens] = useState<TokenOut[]>([]);
  const [info, setInfo] = useState<{ instructions: string; server_url: string } | null>(null);
  const [label, setLabel] = useState("WorkBuddy");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const loadTokens = useCallback(async () => {
    try {
      setTokens(await apiFetch<TokenOut[]>("/api/settings/workbuddy/tokens"));
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);

  useEffect(() => {
    loadTokens();
    apiFetch<{ instructions: string; server_url: string }>("/api/settings/workbuddy/instructions").then(setInfo).catch(() => {});
  }, [loadTokens]);

  async function createToken() {
    setLoading(true);
    setErr("");
    try {
      const res = await apiFetch<TokenCreated>("/api/settings/workbuddy/tokens", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() || "WorkBuddy" }),
      });
      setCreated(res);
      toast(l("Token MCP dibuat", "MCP token created"));
      await loadTokens();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function revokeToken(tokenId: string) {
    try {
      await apiFetch(`/api/settings/workbuddy/tokens/${tokenId}`, { method: "DELETE" });
      toast(l("Token dicabut", "Token revoked"));
      setTokens((prev) => prev.map((x) => (x.id === tokenId ? { ...x, revoked: true } : x)));
    } catch (e) {
      toast(l(`Gagal mencabut token: ${errorText(e)}`, `Failed to revoke token: ${errorText(e)}`));
    }
  }

  // Before a token exists, show the shape with a placeholder; the real file comes from the backend.
  const cfg = created?.mcp_json ?? JSON.stringify(
    { mcpServers: { "workplace-brain": { type: "streamableHttp", url: info?.server_url ?? "…/mcp", headers: { Authorization: "Bearer <token>" } } } },
    null,
    2,
  );

  async function copy(text: string, which: "cfg" | "ins") {
    if (await copyText(text)) {
      setCopied(which);
      toast(l("Disalin ke clipboard", "Copied to clipboard"));
      setTimeout(() => setCopied(""), 2000);} else { toast(l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually.")); }
  }

  return (
    <Shell title={t("workbuddy")}>
      <div className="card p-6 flex flex-col gap-4 max-w-2xl">
        <div>
          <h2 className="text-xl font-bold mb-1">WorkBuddy MCP</h2>
          <p className="text-sm text-muted">
            {l("Token terikat ke", "The token is bound to")} <b className="text-fg">{persona?.name}</b>{" "}
            {l("di", "in")} <b className="text-fg">{tenantName}</b>.{" "}
            {l("WorkBuddy hanya melihat apa yang boleh Anda lihat; perubahan peran berlaku seketika.", "WorkBuddy sees only what you may see; role changes apply immediately.")}
          </p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <input className="input !w-48" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={l("Label token", "Token label")} />
          <button className="btn btn-primary" onClick={createToken} disabled={loading}>
            <KeyRound size={16} />
            {loading ? l("Membuat…", "Generating…") : l("Buat token baru", "Generate new token")}
          </button>
          {created && (
            <button className="btn" onClick={() => copy(cfg, "cfg")}>
              {copied === "cfg" ? <Check size={16} className="text-ok" /> : <Copy size={16} />}
              {copied === "cfg" ? l("Tersalin", "Copied") : l("Salin mcp.json", "Copy mcp.json")}
            </button>
          )}
        </div>
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}

        {created && (
          <div className="p-3 bg-ok/10 border border-ok/30 rounded-erp text-xs text-ok">
            {l("Simpan konfigurasi ini sekarang. Token hanya ditampilkan satu kali.", "Save this config now. The token is shown only once.")}
          </div>
        )}

        <div>
          <label className="text-xs text-muted mb-1 block">mcp.json</label>
          <pre className="bg-surface2 p-3.5 rounded-erp text-xs font-mono overflow-x-auto border border-line">{cfg}</pre>
        </div>

        {info && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted">{l("Instruksi expert WorkBuddy", "WorkBuddy expert instructions")}</label>
              <button className="btn !py-0.5 !px-2 text-xs" onClick={() => copy(info.instructions, "ins")}>
                {copied === "ins" ? <Check size={12} /> : <Copy size={12} />} {l("Salin", "Copy")}
              </button>
            </div>
            <pre className="bg-surface2 p-3.5 rounded-erp text-xs whitespace-pre-wrap border border-line max-h-56 overflow-y-auto">{info.instructions}</pre>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <h3 className="font-semibold text-sm mb-2">{l("Token Anda", "Your tokens")}</h3>
            <div className="flex flex-col gap-2">
              {tokens.map((tk) => (
                <div key={tk.id} className={`flex items-center justify-between p-2.5 rounded-erp bg-surface2/50 border border-line text-xs ${tk.revoked ? "opacity-50" : ""}`}>
                  <div>
                    <span className="font-medium">{tk.label}</span>
                    <span className="text-muted ml-2">
                      {l("dibuat", "created")} {new Date(tk.created_at).toLocaleDateString()} ·{" "}
                      {tk.last_used_at ? `${l("terakhir dipakai", "last used")} ${new Date(tk.last_used_at).toLocaleString()}` : l("belum dipakai", "never used")}
                      {tk.revoked ? ` · ${l("dicabut", "revoked")}` : ""}
                    </span>
                  </div>
                  {!tk.revoked && (
                    <button className="btn !p-1.5 text-bad hover:bg-bad/10" title={l("Cabut token", "Revoke token")} onClick={() => revokeToken(tk.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
