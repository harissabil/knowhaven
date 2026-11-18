"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Download, ExternalLink, Plug, RefreshCw, Unplug, UserRound, Zap } from "lucide-react";
import { useSession } from "@/store/session";
import { useL } from "@/lib/i18n";
import { LOGOS } from "@/components/BrandLogos";
import { StatusChip } from "@/components/Chip";
import { relTime } from "@/components/documents";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import type { IntegrationOut, IntegrationsOut, MemberOut, SlackUserOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";
import { SourceAccessSetup } from "@/components/SourceAccessSetup";

const Logo = ({ name }: { name: string }) => { const L = LOGOS[name]; return L ? <L size={28} /> : null; };
const SOON = ["WhatsApp", "Telegram"];

const SLACK_ERRORS: Record<string, [string, string]> = {
  access_denied: ["Pemasangan dibatalkan di Slack.", "Installation was cancelled in Slack."],
  workspace_connected_to_another_company: ["Workspace Slack ini sudah terhubung ke perusahaan lain.", "This Slack workspace is already connected to another company."],
  state_expired: ["Sesi pemasangan kedaluwarsa, coba lagi.", "The install session expired, try again."],
  not_admin: ["Hanya admin yang bisa menghubungkan Slack.", "Only admins can connect Slack."],
};

/** Slack ("Add to Slack" OAuth + Events API) and Atlassian (site + email + API token) for the
 * active company. Credentials never come back from the API; only status and metadata do. */
export function IntegrationCards({ tid }: { tid: string }) {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const patchWizard = useSession((s) => s.patchWizard);
  const [data, setData] = useState<IntegrationsOut | null>(null);
  const [active, setActive] = useState<"Slack" | "Atlassian" | null>(null);
  const [f, setF] = useState({ url: "", email: "", token: "" });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loads, setLoads] = useState(0); // new containers may appear after connect/sync/refresh

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<IntegrationsOut>("/api/admin/integrations");
      setData(d);
      setLoads((n) => n + 1);
      const on = (t: string) => d.integrations.some((i) => i.type === t && i.status !== "disconnected");
      if (tid) patchWizard(tid, { integ: { Slack: on("slack"), Atlassian: on("confluence") || on("jira") } }); // wizard step done
    } catch (e) {
      setErr(errorText(e));
    }
  }, [tid, patchWizard]);
  useEffect(() => { load(); }, [load]);

  // Back from Slack's OAuth screen: /admin/integrations?slack=connected | ?slack_error=reason
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const okSlack = q.get("slack"), bad = q.get("slack_error");
    if (okSlack || bad) {
      setActive("Slack");
      setNotice(okSlack ? l("Slack terhubung. Undang @havi ke channel yang ingin dibaca.", "Slack connected. Invite @havi to the channels it should read.")
        : l(...(SLACK_ERRORS[bad!] ?? [`Gagal menghubungkan Slack: ${bad}`, `Could not connect Slack: ${bad}`])));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [l]);

  const find = (t: string) => data?.integrations.find((i) => i.type === t && i.status !== "disconnected");
  const slack = find("slack"), conf = find("confluence"), jira = find("jira");
  const atl = conf ?? jira;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr("");
    try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  }

  const connectAtlassian = () => run("Atlassian", async () => {
    const r = await apiFetch<{ site: string; spaces: string[]; projects: string[] }>("/api/admin/integrations/atlassian", {
      method: "POST", body: JSON.stringify({ site_url: f.url, email: f.email, api_token: f.token }),
    });
    setF({ url: "", email: "", token: "" });
    toast(l(`Terhubung ke ${r.site}: ${r.spaces.length} space, ${r.projects.length} project. Sinkron pertama berjalan.`,
      `Connected to ${r.site}: ${r.spaces.length} spaces, ${r.projects.length} projects. First sync is running.`));
    await load();
  });
  const syncNow = () => run("sync", async () => {
    await apiFetch("/api/admin/integrations/atlassian/sync", { method: "POST" });
    toast(l("Sinkron selesai", "Sync finished"));
    await load();
  });
  const refreshSlack = () => run("refresh", async () => {
    await apiFetch("/api/admin/integrations/slack/refresh", { method: "POST" });
    toast(l("Channel dan anggota Slack diperbarui", "Slack channels and members refreshed"));
    await load();
  });
  const disconnect = (kind: "slack" | "atlassian") => run(`off-${kind}`, async () => {
    await apiFetch(`/api/admin/integrations/${kind}`, { method: "DELETE" });
    toast(l("Koneksi diputus. Konten yang sudah masuk tetap ada sampai dipetakan ulang atau dihapus.", "Disconnected. Content already imported stays until you unmap or remove it."));
    await load();
  });

  const CARDS = [
    { key: "Slack" as const, title: "Slack", sub: l("Chat & channel", "Chats & channels"), on: !!slack, bad: slack?.status === "error" },
    { key: "Atlassian" as const, title: "Atlassian", sub: "Confluence + Jira", on: !!atl, bad: conf?.status === "error" || jira?.status === "error" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label={l("Pilih integrasi", "Choose an integration")}>
        {CARDS.map((c) => (
          <button key={c.key} type="button" aria-pressed={active === c.key} onClick={() => { setActive(c.key); setErr(""); }}
            className={`card p-4 text-left flex items-center gap-3 border-2 ${active === c.key ? "!border-brand" : ""}`}>
            <span className="relative w-10 h-10 grid place-items-center">
              <Logo name={c.key} />
              {c.on && (
                <span className={`absolute -right-1 -bottom-1 w-5 h-5 rounded-full ${c.bad ? "bg-bad" : "bg-ok"} text-brandfg grid place-items-center border-2 border-surface`}>
                  {c.bad ? <AlertTriangle size={11} aria-label={l("error", "error")} /> : <Check size={12} aria-label={l("terhubung", "connected")} />}
                </span>
              )}
            </span>
            <span className="flex flex-col">
              <b>{c.title}</b>
              <span className="text-sm text-muted">{c.sub}</span>
              <span className={`text-xs ${c.bad ? "text-bad" : c.on ? "text-ok" : "text-muted"}`}>
                {c.bad ? l("Ada masalah, klik untuk detail", "Needs attention, click for details") : c.on ? l("Terhubung", "Connected") : l("Belum terhubung, klik untuk mengatur", "Not connected, click to set up")}
              </span>
            </span>
          </button>
        ))}
        {SOON.map((c) => (
          <div key={c} aria-disabled="true" className="card p-4 flex items-center gap-3 opacity-50 grayscale cursor-not-allowed select-none">
            <span className="w-10 h-10 grid place-items-center"><Logo name={c} /></span>
            <span className="flex flex-col">
              <b>{c}</b>
              <span className="text-xs font-semibold uppercase tracking-wide">{l("Segera hadir", "Coming Soon")}</span>
            </span>
          </div>
        ))}
      </div>

      {notice && <p role="status" className="text-sm p-3 rounded-erp border border-line bg-surface2/60">{notice}</p>}
      {err && <p role="alert" className="text-bad text-sm">{err}</p>}

      {active === "Slack" && data && (
        <div className="card p-4 flex flex-col gap-3">
          <h3 className="font-semibold">Slack</h3>
          {slack ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusChip tone={slack.status === "error" ? "bad" : "ok"}>{slack.status}</StatusChip>
                <b>{slack.workspace}</b>
                <Meta i={slack} k="channels" label={l("channel", "channels")} />
                <Meta i={slack} k="bot_in_channels" label={l("berisi @havi", "with @havi")} />
                <Meta i={slack} k="members_mapped" label={l("anggota terpetakan", "members mapped")} />
              </div>
              <p className="text-sm text-muted">
                {l("Pesan masuk real-time. Event terakhir", "Messages arrive in real time. Last event")}: {slack.meta.last_event_at ? relTime(String(slack.meta.last_event_at), lang) : l("belum ada", "none yet")}.{" "}
                {l("Havi otomatis bergabung ke channel publik. Untuk channel private, ketik ", "Havi joins public channels by itself. For private channels, type ")}<code>/invite @havi</code>{l(" di channel itu.", " in that channel.")}
              </p>
              {slack.meta.join_error === "missing_scope" && (
                <p className="text-sm text-warn">{l("Izin bergabung ke channel belum diberikan. Klik \"Hubungkan Slack\" sekali lagi untuk memperbarui izin.", "Permission to join channels is missing. Click \"Add to Slack\" once more to update the permissions.")}
                  {" "}<a className="underline" href="/api/integrations/slack/install">{l("Perbarui izin", "Update permissions")}</a></p>
              )}
              {slack.last_error && <p className="text-sm text-bad">{slack.last_error}</p>}
              <div className="flex gap-2 flex-wrap">
                <button className="btn" disabled={busy === "refresh"} onClick={refreshSlack}><RefreshCw size={16} className={busy === "refresh" ? "animate-spin" : ""} /> {l("Segarkan channel & anggota", "Refresh channels & members")}</button>
                <button className="btn" disabled={busy === "off-slack"} onClick={() => disconnect("slack")}><Unplug size={16} /> {l("Putuskan", "Disconnect")}</button>
              </div>
              <SlackPeople />
            </>
          ) : data.slack_available ? (
            <>
              <p className="text-sm text-muted">{l("Pasang Havi ke workspace Slack perusahaan Anda. Channel baru masuk dalam keadaan tersembunyi sampai Anda memetakannya.", "Install Havi into your company's Slack workspace. New channels arrive hidden until you map them.")}</p>
              {/* A plain link: the API answers with a redirect to Slack's consent screen. */}
              <a className="btn btn-primary w-fit" href="/api/integrations/slack/install"><Plug size={16} /> {l("Hubungkan Slack", "Add to Slack")}</a>
            </>
          ) : (
            <p className="text-sm text-warn">
              {l("Slack app belum dikonfigurasi di server (Client ID, Client Secret, Signing Secret). Hubungi pengelola platform.", "The Slack app isn't configured on the server yet (Client ID, Client Secret, Signing Secret). Contact the platform operator.")}
            </p>
          )}
        </div>
      )}

      {active === "Atlassian" && data && (
        <div className="card p-4 flex flex-col gap-3">
          <h3 className="font-semibold">Atlassian (Confluence + Jira)</h3>
          {atl ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusChip tone={atl.status === "error" ? "bad" : "ok"}>{atl.status}</StatusChip>
                <a className="font-semibold underline inline-flex items-center gap-1" href={`https://${atl.workspace}`} target="_blank" rel="noreferrer">{atl.workspace} <ExternalLink size={12} /></a>
                <span className="text-muted">{String(atl.meta.email ?? "")} · token {String(atl.meta.token_hint ?? "")}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                {[conf, jira].filter(Boolean).map((i) => (
                  <div key={i!.type} className="rounded-erp border border-line p-3">
                    <b className="capitalize">{i!.type}</b>
                    <p className="text-muted">
                      {i!.type === "confluence" ? `${i!.meta.spaces ?? 0} space · ${i!.meta.pages ?? "–"} ${l("halaman", "pages")}` : `${i!.meta.projects ?? 0} project · ${i!.meta.issues ?? "–"} issue`}
                    </p>
                    <p className="text-xs text-muted">{l("Sinkron terakhir", "Last sync")}: {i!.last_sync_at ? relTime(i!.last_sync_at, lang) : l("menunggu", "pending")}
                      {i!.meta.last_created != null && ` · +${i!.meta.last_created} / ~${i!.meta.last_updated} / −${i!.meta.last_deleted}`}</p>
                    {i!.last_error && <p className="text-xs text-bad mt-1">{i!.last_error}</p>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">{l("Perubahan ditarik otomatis setiap ±2 menit. Update SOP yang disetujui di Approvals ditulis langsung ke halaman Confluence.", "Changes are pulled automatically about every 2 minutes. SOP updates approved in Approvals are written straight to the Confluence page.")}</p>
              <div className="flex gap-2 flex-wrap">
                <button className="btn" disabled={busy === "sync"} onClick={syncNow}><RefreshCw size={16} className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? l("Menyinkronkan…", "Syncing…") : l("Sinkronkan sekarang", "Sync now")}</button>
                <button className="btn" disabled={busy === "off-atlassian"} onClick={() => disconnect("atlassian")}><Unplug size={16} /> {l("Putuskan", "Disconnect")}</button>
              </div>
              <AtlassianWebhooks />
            </>
          ) : (
            <form className="flex flex-col gap-2 max-w-md" onSubmit={(e) => { e.preventDefault(); connectAtlassian(); }}>
              <input className="input" aria-label={l("URL situs Atlassian", "Atlassian site URL")} placeholder="https://company.atlassian.net" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required />
              <input className="input" aria-label="Email Atlassian" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
              <input className="input" aria-label="API token" type="password" autoComplete="off" placeholder="API token" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} required />
              <button className="btn btn-primary w-fit" disabled={busy === "Atlassian"}>{busy === "Atlassian" ? l("Menguji koneksi…", "Testing connection…") : l("Tes & simpan", "Test & save")}</button>
              <p className="text-xs text-muted">{l("Buat token di id.atlassian.com → Security → API tokens. Token disimpan terenkripsi dan tidak pernah ditampilkan lagi.", "Create a token at id.atlassian.com → Security → API tokens. It is stored encrypted and never shown again.")}</p>
            </form>
          )}
        </div>
      )}
      {!active && <p className="text-sm text-muted">{l("Pilih kartu di atas untuk mengatur integrasi.", "Pick a card above to set up an integration.")}</p>}

      {(slack || atl) && <SourceAccessSetup refreshKey={loads} />}
    </div>
  );
}

type Hooks = { jira: { url: string; secret_hint: string | null }; confluence: { url: string; token: string } };
type FlowState = "ENABLED" | "DISABLED" | "missing";
type Flows = { flows: { published: FlowState; updated: FlowState } | null; reason: string | null; installed_at: string | null };

function CopyField({ label, value, hide }: { label: string; value: string; hide?: boolean }) {
  const l = useL();
  const copy = () => navigator.clipboard.writeText(value).then(() => toast(l("Disalin", "Copied")));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex gap-2">
        <input className="input font-mono !text-xs" readOnly value={hide ? "•".repeat(24) : value} aria-label={label} />
        <button type="button" className="btn !px-2" onClick={copy} aria-label={l(`Salin ${label}`, `Copy ${label}`)}><Copy size={15} /></button>
      </div>
    </div>
  );
}

/** Optional push: a Jira admin webhook and two Confluence Automation flows. Without them the
 * 2-minute poll still picks every change up; with them a change shows up within seconds. */
function AtlassianWebhooks() {
  const l = useL();
  const [h, setH] = useState<Hooks | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const [flows, setFlows] = useState<Flows | null>(null);

  useEffect(() => {
    apiFetch<Hooks>("/api/admin/integrations/atlassian/webhooks").then(setH).catch((e) => setErr(errorText(e)));
    apiFetch<Flows>("/api/admin/integrations/confluence/automation").then(setFlows).catch(() => setFlows(null));
  }, []);

  // Atlassian's answer, in words an admin can act on.
  const why = (reason: string | null | undefined) => reason === "no_permission"
    ? l("Akun Atlassian yang terhubung bukan admin Confluence. Hubungkan akun admin, atau pakai template di bawah.",
        "The connected Atlassian account is not a Confluence admin. Connect an admin account, or use the template below.")
    : reason === "bad_credentials"
      ? l("API token ditolak Atlassian. Hubungkan ulang dengan token yang masih berlaku.", "Atlassian rejected the API token. Reconnect with a valid token.")
      : l(`Atlassian menolak permintaan (${reason ?? "error"}). Coba lagi, atau pakai template di bawah.`,
          `Atlassian refused the request (${reason ?? "error"}). Try again, or use the template below.`);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr("");
    try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  }
  const saveSecret = (value: string) => run("secret", async () => {
    const r = await apiFetch<{ secret_hint: string | null }>("/api/admin/integrations/jira/webhook-secret", { method: "PUT", body: JSON.stringify({ secret: value }) });
    setSecret("");
    setH((x) => x && { ...x, jira: { ...x.jira, secret_hint: r.secret_hint } });
    toast(value ? l("Secret Jira disimpan", "Jira secret saved") : l("Secret Jira dihapus", "Jira secret removed"));
  });
  const install = () => run("install", async () => {
    try {
      await apiFetch("/api/admin/integrations/confluence/automation", { method: "POST" });
    } catch (e) {
      const reason = e instanceof ApiError ? (e.payload?.detail as { reason?: string } | undefined)?.reason : undefined;
      throw new Error(why(reason));
    }
    setFlows(await apiFetch<Flows>("/api/admin/integrations/confluence/automation"));
    toast(l("Kedua flow Automation terpasang dan aktif", "Both Automation flows are installed and on"));
  });
  const rotate = () => run("rotate", async () => {
    const r = await apiFetch<{ token: string; flows_updated: boolean }>("/api/admin/integrations/confluence/webhook-token", { method: "POST" });
    setH((x) => x && { ...x, confluence: { ...x.confluence, token: r.token } });
    toast(r.flows_updated
      ? l("Token baru dibuat dan sudah dipasang di kedua flow.", "New token created and pushed to both flows.")
      : l("Token baru dibuat. Perbarui header di flow Automation Anda.", "New token created. Update the header in your Automation flows."));
  });
  const download = () => run("template", async () => {
    const data = await apiFetch<unknown>("/api/admin/integrations/confluence/automation-template");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "knowhaven-confluence-automation.json" });
    a.click();
    URL.revokeObjectURL(url);
  });

  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer font-medium text-sm"><Zap size={15} className="inline mr-1.5 -mt-0.5" />{l("Opsional: update instan lewat webhook", "Optional: instant updates via webhooks")}</summary>
      <p className="text-xs text-muted mt-2">{l("Tanpa ini pun semua perubahan tetap masuk lewat sinkron otomatis tiap ±2 menit. Webhook hanya memberi tahu halaman/issue mana yang berubah; Knowhaven selalu membaca isinya langsung dari Atlassian.",
        "Without this, every change still arrives through the automatic sync about every 2 minutes. A webhook only says which page/issue changed; Knowhaven always reads the content from Atlassian itself.")}</p>
      {err && <p role="alert" className="text-bad text-sm mt-2">{err}</p>}
      {!h ? (!err && <p className="text-sm text-muted animate-pulse mt-2">{l("Memuat…", "Loading…")}</p>) : (
        <div className="grid md:grid-cols-2 gap-4 mt-3">
          <div className="flex flex-col gap-2">
            <h5 className="font-medium text-sm">Jira</h5>
            <ol className="text-xs text-muted list-decimal pl-4 space-y-0.5">
              <li>{l("Jira → ⚙ System → WebHooks → Create a WebHook.", "Jira → ⚙ System → WebHooks → Create a WebHook.")}</li>
              <li>{l("Tempel URL di bawah, klik Generate secret, centang Issue: created, updated, deleted.", "Paste the URL below, click Generate secret, tick Issue: created, updated, deleted.")}</li>
              <li>{l("Tempel secret yang sama di sini, lalu simpan.", "Paste the same secret here and save.")}</li>
            </ol>
            <CopyField label="URL" value={h.jira.url} />
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveSecret(secret); }}>
              <input className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)}
                placeholder={h.jira.secret_hint ? l(`Tersimpan (${h.jira.secret_hint})`, `Saved (${h.jira.secret_hint})`) : l("Secret dari Jira", "Secret from Jira")}
                aria-label={l("Secret webhook Jira", "Jira webhook secret")} />
              <button className="btn" disabled={!secret || busy === "secret"}>{l("Simpan", "Save")}</button>
              {h.jira.secret_hint && <button type="button" className="btn" disabled={busy === "secret"} onClick={() => saveSecret("")}>{l("Hapus", "Remove")}</button>}
            </form>
          </div>
          <div className="flex flex-col gap-2">
            <h5 className="font-medium text-sm">Confluence Automation</h5>
            <p className="text-xs text-muted">{l("Knowhaven memasang dua flow (halaman dipublikasikan / diubah) di Confluence Anda, berjalan atas nama akun Atlassian yang terhubung. Akun itu harus admin Confluence.",
              "Knowhaven installs two flows (page published / updated) in your Confluence, running as the connected Atlassian account. That account must be a Confluence admin.")}</p>
            <FlowStatus flows={flows} why={why} />
            <button type="button" className="btn btn-primary w-fit" disabled={busy === "install"} onClick={install}>
              <Zap size={16} /> {busy === "install" ? l("Memasang…", "Installing…")
                : flows?.flows && Object.values(flows.flows).every((x) => x === "ENABLED") ? l("Pasang ulang", "Reinstall") : l("Pasang otomatis", "Install automatically")}
            </button>
            <button type="button" className="btn w-fit !text-xs" disabled={busy === "rotate"} onClick={rotate}><RefreshCw size={14} /> {l("Buat token baru", "New token")}</button>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">{l("Pasang manual (kalau akun terhubung bukan admin)", "Manual setup (if the connected account isn't an admin)")}</summary>
              <ol className="text-muted list-decimal pl-4 space-y-0.5 mt-2">
                <li>{l("Unduh template, lalu di Confluence → ⚙ Settings → Automation → ⋯ → Import.", "Download the template, then in Confluence → ⚙ Settings → Automation → ⋯ → Import.")}</li>
                <li>{l("Confluence selalu mengganti Actor dengan bot Automation, yang tidak bisa di-enable. Di tiap flow buka Settings, ganti Actor ke akun admin, simpan, lalu Enable.",
                  "Confluence always sets the Actor to its Automation bot, which won't enable. In each flow open Settings, set Actor to an admin account, save, then Enable.")}</li>
                <li>{l("Setelah token baru dibuat, perbarui header X-Knowhaven-Token di kedua flow.", "After a new token, update the X-Knowhaven-Token header in both flows.")}</li>
              </ol>
              <div className="flex flex-col gap-2 mt-2">
                <button type="button" className="btn w-fit !text-xs" disabled={busy === "template"} onClick={download}><Download size={14} /> {l("Unduh template Automation", "Download Automation template")}</button>
                <CopyField label="URL" value={h.confluence.url} />
                <CopyField label="X-Knowhaven-Token" value={h.confluence.token} hide />
              </div>
            </details>
            <p className="text-xs text-muted">{l("Confluence Free memberi 200 step Automation per bulan. Kalau habis, sinkron 2 menit tetap berjalan.", "Confluence Free includes 200 Automation steps a month. If they run out, the 2-minute sync keeps working.")}</p>
          </div>
        </div>
      )}
    </details>
  );
}

function FlowStatus({ flows, why }: { flows: Flows | null; why: (r: string | null) => string }) {
  const l = useL();
  if (!flows) return null;
  if (!flows.flows) return <p className="text-xs text-warn flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{why(flows.reason)}</p>;
  const label = (k: "published" | "updated") => k === "published" ? l("Halaman dipublikasikan", "Page published") : l("Halaman diubah", "Page updated");
  const state = (x: FlowState) => x === "ENABLED" ? l("aktif", "on") : x === "DISABLED" ? l("nonaktif", "off") : l("belum ada", "not installed");
  return (
    <ul className="text-xs space-y-0.5">
      {(["published", "updated"] as const).map((k) => (
        <li key={k} className={flows.flows![k] === "ENABLED" ? "text-good" : "text-muted"}>
          {flows.flows![k] === "ENABLED" ? <Check size={13} className="inline mr-1 -mt-0.5" /> : "• "}{label(k)}: {state(flows.flows![k])}
        </li>
      ))}
    </ul>
  );
}

function Meta({ i, k, label }: { i: IntegrationOut; k: string; label: string }) {
  if (i.meta[k] == null) return null;
  return <span className="text-muted">· {String(i.meta[k])} {label}</span>;
}

/** Which member each Slack account speaks for: decides the authority of their messages (an HR
 * account posting in #pengumuman-hr counts as an official announcement). */
function SlackPeople() {
  const l = useL();
  const [people, setPeople] = useState<SlackUserOut[] | null>(null);
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([apiFetch<SlackUserOut[]>("/api/admin/integrations/slack/users"), apiFetch<MemberOut[]>("/api/admin/members")])
      .then(([p, m]) => { setPeople(p); setMembers(m.filter((x) => x.status === "active")); })
      .catch((e) => setErr(errorText(e)));
  }, []);

  async function map(slackId: string, userId: string) {
    try {
      await apiFetch(`/api/admin/integrations/slack/users/${encodeURIComponent(slackId)}`, { method: "PUT", body: JSON.stringify({ member_user_id: userId || null }) });
      setPeople((prev) => prev?.map((p) => (p.slack_user_id === slackId ? { ...p, member_user_id: userId || null }
        : p.member_user_id === userId && userId ? { ...p, member_user_id: null } : p)) ?? null);
      toast(l("Pemetaan disimpan; berlaku untuk pesan berikutnya", "Mapping saved; applies to the next messages"));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!people) return <p className="text-sm text-muted animate-pulse">{l("Memuat anggota Slack…", "Loading Slack members…")}</p>;
  return (
    <div className="border-t border-line pt-3">
      <h4 className="font-medium text-sm mb-1 flex items-center gap-1.5"><UserRound size={15} /> {l("Akun Slack → anggota", "Slack accounts → members")}</h4>
      <p className="text-xs text-muted mb-2">{l("Dicocokkan otomatis lewat email. Akun yang belum dipetakan dianggap pesan pribadi (otoritas terendah).", "Matched automatically by email. Unmapped accounts count as personal messages (lowest authority).")}</p>
      <div className="flex flex-col gap-1.5">
        {people.map((p) => (
          <div key={p.slack_user_id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-48"><b>{p.name}</b> <span className="text-muted text-xs">{p.email ?? p.slack_user_id}</span></span>
            <select className="input !w-auto !py-1" value={p.member_user_id ?? ""} onChange={(e) => map(p.slack_user_id, e.target.value)}>
              <option value="">{l("— belum dipetakan —", "— not mapped —")}</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name} ({m.roles.join(", ") || "—"})</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
