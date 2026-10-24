"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, Plug, RefreshCw, Unplug } from "lucide-react";
import { newWizard, useSession, useTenants, type WContainer, type Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";
import { LOGOS } from "@/components/BrandLogos";

const Logo = ({ name }: { name: string }) => { const L = LOGOS[name]; return L ? <L /> : null; };

const SOON = ["WhatsApp", "Telegram"];
const SLACK_CH = ["#general", "#pengumuman-hr", "#ops"];
const ATL_CONT: [string, string][] = [["Space HR", "Confluence"], ["Space OPS", "Confluence"], ["Project OPS", "Jira"], ["Project ONB", "Jira"]];
const now = () => new Date().toLocaleTimeString("en-GB");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Slack + Atlassian cards (backend contract): connect/disconnect, test & save, sync now, ingestion log. */
export function IntegrationCards({ tid }: { tid: string }) {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const stored = useSession((s) => s.wizards[tid]);
  const patchWizard = useSession((s) => s.patchWizard);
  const tenantName = useTenants().find((t) => t.id === tid)?.name ?? "company";
  const w: Wizard = stored ?? newWizard();
  const cur = () => useSession.getState().wizards[tid] ?? newWizard();

  const [f, setF] = useState({ url: "", email: "", token: "" });
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const addContainers = (cs: WContainer[]) => {
    const c = cur();
    patchWizard(tid, { containers: [...c.containers, ...cs.filter((x) => !c.containers.some((y) => y.name === x.name))] });
  };
  // log messages are stored as "id||en" so they follow the language toggle
  const log = (src: string, id: string, en: string, ok = true) => {
    const c = cur();
    patchWizard(tid, { ingestLog: [{ ts: now(), src, msg: `${id}||${en}`, ok }, ...c.ingestLog].slice(0, 20) });
  };
  const show = (m: string) => { const [a, b] = m.split("||"); return b === undefined ? m : lang === "id" ? a : b; };
  const never = l("belum ada event", "no events yet");

  function connectSlack() {
    setBusy("Slack");
    setTimeout(() => {
      const c = cur();
      patchWizard(tid, { integ: { ...c.integ, Slack: true }, integMeta: { ...c.integMeta, Slack: { workspace: `${slug(tenantName)}.slack.com`, lastEvent: "" } } });
      addContainers(SLACK_CH.map((name) => ({ name, source: "Slack", tier: "hidden", roles: [] })));
      log("Slack", "Workspace terhubung, 3 channel ditemukan (belum dipetakan)", "Workspace connected, 3 channels found (not yet mapped)");
      setBusy("");
    }, 700);
  }
  function disconnect(key: string, sources: string[]) {
    const c = cur();
    const integ = { ...c.integ }; delete integ[key];
    patchWizard(tid, { integ, containers: c.containers.filter((x) => !sources.includes(x.source)) });
    log(key, "Koneksi diputus, data sumber ini dihapus dari pencarian", "Disconnected, this source's data was removed from search");
  }
  function testSave() {
    setErr("");
    if (!/^https?:\/\/[\w-]+\.atlassian\.net\/?$/i.test(f.url.trim())) return setErr(l("URL situs harus berbentuk https://nama.atlassian.net", "The site URL must look like https://name.atlassian.net"));
    if (!f.email.includes("@") || f.token.trim().length < 8) return setErr(l("Email atau API token tidak valid.", "Invalid email or API token."));
    setBusy("Atlassian");
    setTimeout(() => {
      const c = cur();
      patchWizard(tid, { integ: { ...c.integ, Atlassian: true }, integMeta: { ...c.integMeta, Atlassian: { workspace: f.url.trim().replace(/^https?:\/\//, ""), lastSync: "now" } } });
      addContainers(ATL_CONT.map(([name, source]) => ({ name, source, tier: "hidden", roles: [] })));
      log("Confluence", "4 halaman ditarik", "4 pages pulled"); log("Jira", "12 issue ditarik", "12 issues pulled");
      setF({ url: "", email: "", token: "" });
      setBusy("");
    }, 900);
  }
  function syncNow() {
    setBusy("sync");
    setTimeout(() => {
      const c = cur();
      patchWizard(tid, { integMeta: { ...c.integMeta, Atlassian: { ...c.integMeta.Atlassian, lastSync: "now" } } });
      log("Confluence", "Sinkron manual: 0 perubahan baru", "Manual sync: 0 new changes"); log("Jira", "Sinkron manual: 1 issue diperbarui", "Manual sync: 1 issue updated");
      setBusy("");
    }, 800);
  }
  // meta values from the SRN seed are Indonesian text; "now"/"" are language-neutral markers
  const when = (v?: string) => v === "now" ? l("baru saja", "just now") : v === "" ? never : v === undefined ? "-" : v === "2 detik lalu" ? l(v, "2 seconds ago") : v === "1 menit lalu" ? l(v, "1 minute ago") : v;

  const slack = w.integ.Slack, atl = w.integ.Atlassian;
  const connected = slack || atl;
  const CARDS = [
    { key: "Slack", title: "Slack", sub: l("Chat & channel", "Chats & channels"), on: !!slack },
    { key: "Atlassian", title: "Atlassian", sub: "Confluence + Jira", on: !!atl },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p role="note" className="text-sm p-3 rounded-erp border border-warn/40 bg-warn/10 text-warn">
        {l("Pratinjau: koneksi Slack/Confluence/Jira belum tersambung ke backend. Tombol di sini hanya simulasi dan tidak mengubah data.",
          "Preview: Slack/Confluence/Jira connections are not wired to the backend yet. These buttons are a simulation and change no data.")}
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label={l("Pilih integrasi", "Choose an integration")}>
        {CARDS.map((c) => (
          <button key={c.key} type="button" aria-pressed={active === c.key} onClick={() => { setActive(c.key); setErr(""); }}
            className={`card p-4 text-left flex items-center gap-3 border-2 ${active === c.key ? "!border-brand" : ""}`}>
            <span className="relative w-10 h-10 grid place-items-center">
              <Logo name={c.key} />
              {c.on && (
                <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-ok text-brandfg grid place-items-center border-2 border-surface">
                  <Check size={12} aria-label={l("terhubung", "connected")} />
                </span>
              )}
            </span>
            <span className="flex flex-col">
              <b>{c.title}</b>
              <span className="text-sm text-muted">{c.sub}</span>
              <span className={`text-xs ${c.on ? "text-ok" : "text-muted"}`}>{c.on ? l("Terhubung", "Connected") : l("Belum terhubung, klik untuk mengatur", "Not connected, click to set up")}</span>
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

      {active === "Slack" && (
        <div className="card p-4 flex flex-col gap-2">
          <h3 className="font-semibold">Slack</h3>
          {slack ? (
            <>
              <span className="text-ok">● {l("terhubung", "connected")}: {w.integMeta.Slack?.workspace}</span>
              <span className="text-sm text-muted">{l("Event terakhir masuk", "Last event received")}: {when(w.integMeta.Slack?.lastEvent)}</span>
              <button className="btn w-fit" onClick={() => disconnect("Slack", ["Slack"])}><Unplug size={16} /> {l("Putuskan", "Disconnect")}</button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">{l("Pasang bot ke workspace Slack lewat OAuth. Pesan baru masuk lewat Events API.", "Install the bot to your Slack workspace via OAuth. New messages arrive through the Events API.")}</p>
              <button className="btn btn-primary w-fit" disabled={busy === "Slack"} onClick={connectSlack}><Plug size={16} /> {busy === "Slack" ? l("Menghubungkan…", "Connecting…") : l("Hubungkan & simpan", "Connect & save")}</button>
            </>
          )}
        </div>
      )}

      {active === "Atlassian" && (
        <div className="card p-4 flex flex-col gap-2">
          <h3 className="font-semibold">Atlassian (Confluence + Jira)</h3>
          {atl ? (
            <>
              <span className="text-ok">● {l("terhubung", "connected")}: {w.integMeta.Atlassian?.workspace}</span>
              <span className="text-sm text-muted">{l("Sinkron terakhir", "Last sync")}: {when(w.integMeta.Atlassian?.lastSync)}</span>
              <div className="flex gap-2 flex-wrap">
                <button className="btn" disabled={busy === "sync"} onClick={syncNow}><RefreshCw size={16} /> {busy === "sync" ? l("Menyinkronkan…", "Syncing…") : l("Sinkronkan sekarang", "Sync now")}</button>
                <button className="btn" onClick={() => disconnect("Atlassian", ["Confluence", "Jira"])}><Unplug size={16} /> {l("Putuskan", "Disconnect")}</button>
              </div>
            </>
          ) : (
            <form className="flex flex-col gap-2 max-w-md" onSubmit={(e) => { e.preventDefault(); testSave(); }}>
              <input className="input" aria-label={l("URL situs Atlassian", "Atlassian site URL")} placeholder="https://company.atlassian.net" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
              <input className="input" aria-label="Email Atlassian" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <input className="input" aria-label="API token" type="password" placeholder="API token" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
              {err && <p role="alert" className="text-bad text-sm">{err}</p>}
              <button className="btn btn-primary w-fit" disabled={busy === "Atlassian"}>{busy === "Atlassian" ? l("Menguji koneksi…", "Testing connection…") : l("Tes & simpan", "Test & save")}</button>
              <p className="text-xs text-muted">{l("Token disimpan terenkripsi dan tidak pernah ditampilkan lagi.", "The token is stored encrypted and never shown again.")}</p>
            </form>
          )}
        </div>
      )}
      {!active && <p className="text-sm text-muted">{l("Pilih kartu di atas untuk mengatur integrasi. Anda bisa berpindah antar kartu kapan saja.", "Pick a card above to set up an integration. You can switch between cards at any time.")}</p>}

      {connected && (
        <div className="card p-3 border-warn">
          {l("Sumber tersambung. Channel, space, dan project baru ", "Source connected. New channels, spaces, and projects are ")}
          <b>{l("tidak terlihat oleh siapa pun", "invisible to everyone")}</b>
          {l(" sampai dipetakan.", " until they are mapped.")}{" "}
          <Link className="btn btn-primary ml-1" href="/admin/containers">{l("Petakan di Container & Izin", "Map in Containers & Access")}</Link>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-1">{l("Log ingestion", "Ingestion log")}</h3>
        {w.ingestLog.length === 0 ? <p className="text-sm text-muted">{l("Belum ada aktivitas.", "No activity yet.")}</p> : (
          <ul className="card divide-y divide-line text-sm font-mono">
            {w.ingestLog.map((x, i) => (
              <li key={i} className="px-3 py-1"><span className="text-muted">{x.ts}</span> [{x.src}] <span className={x.ok ? "" : "text-bad"}>{show(x.msg)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
