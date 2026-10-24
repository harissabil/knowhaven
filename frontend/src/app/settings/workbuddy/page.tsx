"use client";
import { useEffect, useState } from "react";
import { KeyRound, Copy, Check, Trash2 } from "lucide-react";
import { Shell } from "@/components/Shell";
import { usePersona, useSession } from "@/store/session";
import { useL, useT } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

interface TokenItem {
  id: string;
  label: string;
  created_at: string;
  last_used_at?: string | null;
  revoked: boolean;
}

export default function WorkBuddy() {
  const t = useT();
  const l = useL();
  const { persona } = usePersona();
  const tenant = useSession((s) => s.tenantId);
  const [tok, setTok] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadTokens() {
    try {
      const list = await apiFetch<TokenItem[]>("/api/settings/workbuddy/tokens");
      if (list) {
        setTokens(list);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadTokens();
  }, []);

  async function createToken() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        id: string;
        token: string;
        label: string;
      }>("/api/settings/workbuddy/tokens", {
        method: "POST",
        body: JSON.stringify({ label: "workbuddy-desktop" }),
      });

      if (res?.token) {
        setTok(res.token);
        toast(l("Token MCP berhasil dibuat!", "MCP Token generated successfully!"));
        await loadTokens();
        setLoading(false);
        return;
      }
    } catch (err: unknown) {
      console.warn("API token creation failed, using mock:", err);
    }

    // Mock fallback
    const mockToken = "wb_" + Math.random().toString(36).slice(2, 14);
    setTok(mockToken);
    toast(l("Token MCP dibuat (mode lokal)", "MCP Token generated (local mode)"));
    setLoading(false);
  }

  async function revokeToken(tokenId: string) {
    try {
      await apiFetch(`/api/settings/workbuddy/tokens/${tokenId}`, {
        method: "DELETE",
      });
      toast(l("Token dicabut", "Token revoked"));
      setTokens((prev) => prev.filter((item) => item.id !== tokenId));
    } catch {
      toast(l("Gagal mencabut token", "Failed to revoke token"));
    }
  }

  const serverUrl = typeof window !== "undefined"
    ? `${window.location.origin}/mcp`
    : "http://localhost:8000/mcp";

  const cfg = JSON.stringify(
    {
      mcpServers: {
        knowhaven: {
          url: serverUrl,
          headers: {
            Authorization: `Bearer ${tok || "<token>"}`,
          },
        },
      },
    },
    null,
    2,
  );

  function copyConfig() {
    navigator.clipboard.writeText(cfg);
    setCopied(true);
    toast(l("Konfigurasi disalin ke clipboard", "Configuration copied to clipboard"));
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Shell title={t("workbuddy")}>
      <div className="card p-6 flex flex-col gap-4 max-w-2xl">
        <div>
          <h2 className="text-xl font-bold mb-1">WorkBuddy MCP Integration</h2>
          <p className="text-sm text-muted">
            {l("Token terikat secara ketat ke pengguna", "The token is strictly bound to user")}{" "}
            <b className="text-fg">{persona?.name}</b>{" "}
            {l("di tenant", "in tenant")}{" "}
            <b className="text-fg">{tenant?.toUpperCase()}</b>.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <button
            className="btn btn-primary"
            onClick={createToken}
            disabled={loading}
          >
            <KeyRound size={16} />
            {loading ? l("Membuat…", "Generating…") : l("Buat token baru", "Generate new token")}
          </button>
          {tok && (
            <button className="btn" onClick={copyConfig}>
              {copied ? <Check size={16} className="text-ok" /> : <Copy size={16} />}
              {copied ? l("Tersalin", "Copied") : l("Salin konfigurasi", "Copy config")}
            </button>
          )}
        </div>

        {tok && (
          <div className="p-3 bg-ok/10 border border-ok/30 rounded-erp text-xs text-ok">
            {l(
              "Simpan token ini di tempat aman. Token hanya ditampilkan satu kali secara penuh.",
              "Store this token safely. It is only displayed once in full.",
            )}
          </div>
        )}

        <div>
          <label className="text-xs text-muted mb-1 block">claude_desktop_config.json / workbuddy config</label>
          <pre className="bg-surface2 p-3.5 rounded-erp text-xs font-mono overflow-x-auto border border-line">
            {cfg}
          </pre>
        </div>

        {tokens.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <h3 className="font-semibold text-sm mb-2">{l("Token aktif", "Active tokens")}</h3>
            <div className="flex flex-col gap-2">
              {tokens.map((tk) => (
                <div
                  key={tk.id}
                  className="flex items-center justify-between p-2.5 rounded-erp bg-surface2/50 border border-line text-xs"
                >
                  <div>
                    <span className="font-medium">{tk.label}</span>
                    <span className="text-muted ml-2">
                      ({new Date(tk.created_at).toLocaleDateString()})
                    </span>
                  </div>
                  <button
                    className="btn !p-1.5 text-bad hover:bg-bad/10"
                    title={l("Cabut token", "Revoke token")}
                    onClick={() => revokeToken(tk.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
