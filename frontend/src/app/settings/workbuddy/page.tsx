"use client";
import { copyText } from "@/lib/clipboard";
import { Fragment, useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, Check, Trash2, ChevronRight, Info } from "lucide-react";
import { Shell } from "@/components/Shell";
import { WorkBuddyLogo } from "@/components/BrandLogos";
import { usePersona, useSession } from "@/store/session";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { TokenCreated, TokenOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

/** "Connectors › Custom connectors › + Add MCP" as menu chips. */
function MenuPath({ items }: { items: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {items.map((it, i) => (
        <Fragment key={it}>
          {i > 0 && <ChevronRight size={13} className="text-muted" aria-hidden />}
          <kbd className="px-1.5 py-0.5 rounded-md border border-line bg-surface2 text-xs font-medium font-sans text-fg">{it}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className={`shrink-0 w-8 h-8 rounded-full grid place-items-center text-sm font-semibold ${done ? "bg-ok/15 text-ok" : "bg-tint text-brand"}`}>
        {done ? <Check size={16} /> : n}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-3 pb-2">
        <h3 className="font-semibold leading-8">{title}</h3>
        {children}
      </div>
    </li>
  );
}

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

  // Before a token exists, show the shape with a placeholder; the real config comes from the backend.
  const cfg = created?.mcp_json ?? JSON.stringify(
    { mcpServers: { "workplace-brain": { type: "streamableHttp", url: info?.server_url ?? "…/mcp", headers: { Authorization: "Bearer <token>" } } } },
    null,
    2,
  );

  async function copy(text: string, which: "cfg" | "ins") {
    if (await copyText(text)) {
      setCopied(which);
      toast(l("Disalin ke clipboard", "Copied to clipboard"));
      setTimeout(() => setCopied(""), 2000);
    } else {
      toast(l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually."));
    }
  }

  const copyBtn = (text: string, which: "cfg" | "ins", label: string, primary = false) => (
    <button className={`btn ${primary ? "btn-primary" : ""}`} onClick={() => copy(text, which)}>
      {copied === which ? <Check size={16} /> : <Copy size={16} />}
      {copied === which ? l("Tersalin", "Copied") : label}
    </button>
  );

  return (
    <Shell title={t("workbuddy")}>
      <div className="card p-6 flex flex-col gap-6 max-w-3xl">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5"><WorkBuddyLogo size={28} /><h2 className="text-xl font-bold">{l("Hubungkan Knowhaven ke WorkBuddy", "Connect Knowhaven to WorkBuddy")}</h2></div>
          <p className="text-sm text-muted">
            {l("Tanya Knowhaven langsung dari WorkBuddy. Token terikat ke", "Ask Knowhaven right from WorkBuddy. The token is bound to")}{" "}
            <b className="text-fg">{persona?.name}</b> {l("di", "in")} <b className="text-fg">{tenantName}</b>.{" "}
            {l("WorkBuddy hanya melihat apa yang boleh Anda lihat; perubahan peran berlaku seketika.", "WorkBuddy sees only what you may see; role changes apply immediately.")}
          </p>
        </div>

        <ol className="flex flex-col gap-5">
          <Step n={1} title={l("Buat token MCP", "Generate an MCP token")} done={!!created}>
            <div className="flex gap-2 items-center flex-wrap">
              <input className="input !w-48" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={l("Label token", "Token label")} />
              <button className={`btn ${created ? "" : "btn-primary"}`} onClick={createToken} disabled={loading}>
                <KeyRound size={16} />
                {loading ? l("Membuat…", "Generating…") : created ? l("Buat token lain", "Generate another") : l("Buat token", "Generate token")}
              </button>
            </div>
            {err && <p role="alert" className="text-bad text-sm">{err}</p>}
            {created && (
              <div className="p-3 bg-ok/10 border border-ok/30 rounded-erp text-xs text-ok">
                {l("Token hanya ditampilkan satu kali. Salin konfigurasinya sekarang (langkah 2).", "The token is shown only once. Copy the config now (step 2).")}
              </div>
            )}
          </Step>

          <Step n={2} title={l("Salin konfigurasi MCP", "Copy the MCP config")}>
            <pre className={`bg-surface2 p-3.5 rounded-erp text-xs font-mono overflow-x-auto border border-line ${created ? "" : "opacity-60"}`}>{cfg}</pre>
            <div>
              {created
                ? copyBtn(cfg, "cfg", l("Salin konfigurasi", "Copy config"), true)
                : <p className="text-xs text-muted">{l("Buat token dulu di langkah 1; konfigurasi berisi token Anda.", "Generate a token in step 1 first; the config contains your token.")}</p>}
            </div>
          </Step>

          <Step n={3} title={l("Tambahkan konektor di WorkBuddy", "Add the connector in WorkBuddy")}>
            <ol className="list-decimal pl-5 flex flex-col gap-2 text-sm">
              <li>{l("Buka WorkBuddy, lalu ke", "Open WorkBuddy and go to")} <MenuPath items={["Connectors", "Custom connectors", "+ Add MCP"]} /></li>
              <li>{l("Tempel konfigurasi dari langkah 2.", "Paste the config from step 2.")}</li>
              <li>{l("Klik", "Click")} <MenuPath items={["Save"]} />. {l("Konektor", "The connector")} <code className="text-xs">workplace-brain</code> {l("akan muncul di daftar.", "appears in the list.")}</li>
            </ol>
          </Step>

          <Step n={4} title={l("Buat expert Knowhaven", "Create the Knowhaven expert")}>
            <ol className="list-decimal pl-5 flex flex-col gap-2 text-sm">
              <li>{l("Salin instruksi expert di bawah.", "Copy the expert instructions below.")}</li>
              <li>{l("Di WorkBuddy, buka", "In WorkBuddy, open")} <MenuPath items={["Experts", "My Experts", "+ Create Expert"]} /></li>
              <li>
                {l("Di kotak chat, hapus teks contoh (placeholder), tapi", "In the chat box, delete the placeholder text, but")}{" "}
                <b>{l("jangan hapus perintah", "keep the")} <code className="text-xs">expert-manager</code></b>{l(" di awal.", " command at the start.")}
              </li>
              <li>{l("Tempel instruksi setelah perintah itu, lalu kirim.", "Paste the instructions after that command, then send.")}</li>
            </ol>
            {info && (
              <>
                <pre className="bg-surface2 p-3.5 rounded-erp text-xs whitespace-pre-wrap border border-line max-h-64 overflow-y-auto">{info.instructions}</pre>
                <div>{copyBtn(info.instructions, "ins", l("Salin instruksi expert", "Copy expert instructions"), !!created)}</div>
              </>
            )}
          </Step>

          <Step n={5} title={l("Coba tanya", "Try it")}>
            <p className="text-sm text-muted flex gap-2">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>
                {l("Pilih expert Knowhaven, lalu tanya misalnya", "Pick the Knowhaven expert and ask, for example,")}{" "}
                <i>&ldquo;{l("Berapa uang bensin per bulan?", "What is the monthly fuel allowance?")}&rdquo;</i>.{" "}
                {l("Jawaban datang dengan sitasi yang sama seperti di Knowhaven.", "Answers come with the same citations as in Knowhaven.")}
              </span>
            </p>
          </Step>
        </ol>

        {tokens.length > 0 && (
          <div className="pt-4 border-t border-line">
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
