"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Plug, RefreshCw, Unplug, UserRound } from "lucide-react";
import { useSession } from "@/store/session";
import { useL } from "@/lib/i18n";
import { LOGOS } from "@/components/BrandLogos";
import { StatusChip } from "@/components/Chip";
import { relTime } from "@/components/documents";
import { apiFetch, errorText } from "@/lib/api";
import type { IntegrationOut, IntegrationsOut, MemberOut, SlackUserOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

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

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<IntegrationsOut>("/api/admin/integrations");
      setData(d);
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
                {l("Havi hanya menerima pesan dari channel tempat ia diundang (", "Havi only receives messages from channels it was invited to (")}<code>/invite @havi</code>).
              </p>
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

      {(slack || atl) && (
        <div className="card p-3 border-warn text-sm">
          {l("Channel, space, dan project baru ", "New channels, spaces, and projects are ")}
          <b>{l("tidak terlihat oleh siapa pun", "invisible to everyone")}</b>
          {l(" sampai dipetakan ke peran.", " until they are mapped to roles.")}{" "}
          <Link className="btn btn-primary ml-1" href="/admin/containers">{l("Petakan di Container & Izin", "Map in Containers & Access")}</Link>
        </div>
      )}
    </div>
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
