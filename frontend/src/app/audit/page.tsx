"use client";
import { copyText } from "@/lib/clipboard";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Filter,
  Globe,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { NeutralChip, RoleChip, StatusChip, type Tone } from "@/components/Chip";
import { WorkBuddyLogo } from "@/components/BrandLogos";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
import type { AuditRowOut, QueryDetailOut, SummaryOut, TraceStepOut, VerifyOut } from "@/lib/contracts";
import { relTime } from "@/components/documents";
import { toast } from "@/components/ui/Toast";

const PAGE = 50;
const PATH_STYLE: Record<string, string> = {
  answer: "bg-ok",
  conflict: "bg-warn",
  idk: "bg-muted",
  policy_refusal: "bg-brand",
  error: "bg-bad",
};
const PATH_TONE: Record<string, Tone> = {
  answer: "ok",
  conflict: "warn",
  idk: "muted",
  policy_refusal: "warn",
  error: "bad",
};
const PATH_LABEL: Record<string, [string, string]> = {
  answer: ["Dijawab", "Answered"],
  conflict: ["Konflik diselesaikan", "Conflict resolved"],
  idk: ["Tidak tahu", "Don't know"],
  policy_refusal: ["Ditolak kebijakan", "Policy refusal"],
  error: ["Error", "Error"],
};
const STEP_NAME: Record<string, [string, string]> = {
  identify: ["Identitas & izin", "Identity & permissions"],
  understand: ["Pahami pertanyaan", "Understand question"],
  policy_gate: ["Gerbang kebijakan", "Policy gate"],
  retrieve: ["Retrieval", "Retrieval"],
  evidence: ["Bukti & konflik", "Evidence & conflicts"],
  compose: ["Susun jawaban", "Compose answer"],
  validate: ["Validasi", "Validation"],
  record: ["Catat audit", "Record audit"],
};

type Tab = "trace" | "io" | "meta";

function ChannelBadge({ channel }: { channel: string | null | undefined }) {
  if (channel === "mcp") {
    return (
      <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-medium leading-none whitespace-nowrap bg-tint text-brand ring-1 ring-inset ring-brand/20">
        <WorkBuddyLogo size={13} />
        WorkBuddy
      </span>
    );
  }
  if (channel === "web") {
    return (
      <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-medium leading-none whitespace-nowrap bg-surface2 text-muted ring-1 ring-inset ring-line">
        <Globe size={12} />
        Web
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-medium leading-none whitespace-nowrap bg-surface2 text-muted ring-1 ring-inset ring-line">
      <Terminal size={12} />
      {channel || "system"}
    </span>
  );
}

export default function Audit() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [view, setView] = useState<"runs" | "events">("runs");
  const [rows, setRows] = useState<AuditRowOut[]>([]);
  const [summary, setSummary] = useState<SummaryOut | null>(null);
  const [path, setPath] = useState("");
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [verify, setVerify] = useState<VerifyOut | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [selected, setSelected] = useState<AuditRowOut | null>(null);

  const load = useCallback(async (beforeSeq?: number) => {
    setLoading(true);
    setErr("");
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (view === "runs") p.set("event_type", "query");
    else p.set("exclude_queries", "true");
    if (path && view === "runs") p.set("decision_path", path);
    if (channel) p.set("channel", channel);
    if (q.trim()) p.set("q", q.trim());
    if (beforeSeq) p.set("before_seq", String(beforeSeq));
    try {
      const [data, sum] = await Promise.all([
        apiFetch<AuditRowOut[]>(`/api/audit/log?${p}`),
        beforeSeq ? Promise.resolve(null) : apiFetch<SummaryOut>("/api/audit/summary?days=7"),
      ]);
      const list = data;
      setRows((prev) => (beforeSeq ? [...prev, ...list] : list));
      if (sum) setSummary(sum);
      setMore(data.length === PAGE);
      if (!beforeSeq && view === "runs" && list.length && !selected) setSelected(list[0]);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, path, channel, q]);
  useEffect(() => { load(); }, [load]);

  async function runVerify() {
    setVerifying(true);
    try {
      setVerify(await apiFetch<VerifyOut>("/api/audit/verify", { method: "POST" }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Shell title={t("audit")}>
      {/* Summary cards */}
      {summary && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
          {/* Card 1: Runs & Channels */}
          <div className="card p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{l("Pertanyaan (7 hari)", "Questions (7 days)")}</span>
              <span className="text-2xl font-bold tracking-tight">{summary.queries}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line/70 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Globe size={12} /> Web: <b className="text-fg">{summary.by_channel.web ?? 0}</b>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5 text-brand">
                <WorkBuddyLogo size={13} /> WorkBuddy: <b className="text-fg">{summary.by_channel.mcp ?? 0}</b>
              </span>
            </div>
          </div>

          {/* Card 2: Outcomes breakdown */}
          <div className="card p-4 flex flex-col justify-between gap-2.5">
            <span className="text-xs font-medium text-muted">{l("Hasil keputusan", "Decision outcomes")}</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(summary.by_decision).length > 0 ? (
                Object.entries(summary.by_decision).map(([k, v]) => (
                  <StatusChip key={k} tone={PATH_TONE[k] ?? "muted"}>
                    {l(...(PATH_LABEL[k] ?? [k, k]))}: <b>{v}</b>
                  </StatusChip>
                ))
              ) : (
                <span className="text-xs text-muted">{l("Belum ada data", "No data yet")}</span>
              )}
            </div>
          </div>

          {/* Card 3: Access filtering & Latency */}
          <div className="card p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted" title={l("Sumber yang cocok dengan pencarian tapi otomatis diblokir karena peran penanya tidak punya akses", "Sources matching a search that were automatically blocked because the user's role lacked access")}>
                {l("Sumber rahasia diblokir", "Restricted sources blocked")}
              </span>
              <span className="text-2xl font-bold tracking-tight">{summary.total_filtered}</span>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-line/70 text-xs text-muted">
              <span title="Median (p50)">
                {l("Waktu jawab umum", "Typical")}: <b className="font-mono text-fg">{summary.p50_latency_ms != null ? `${(summary.p50_latency_ms / 1000).toFixed(1)}s` : "–"}</b>
              </span>
              <span>·</span>
              <span title="95th percentile (p95)">
                {l("Lambat (p95)", "Slow (p95)")}: <b className="font-mono text-fg">{summary.p95_latency_ms != null ? `${(summary.p95_latency_ms / 1000).toFixed(1)}s` : "–"}</b>
              </span>
            </div>
          </div>

          {/* Card 4: Hash-chain verification */}
          <div className="card p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">{l("Integritas log (SHA-256)", "Log integrity (SHA-256)")}</span>
              {verify && (
                verify.ok ? (
                  <StatusChip tone="ok">{l(`Utuh (${verify.rows})`, `Intact (${verify.rows})`)}</StatusChip>
                ) : (
                  <StatusChip tone="bad">{l(`Rusak #${verify.first_bad_seq}`, `Broken #${verify.first_bad_seq}`)}</StatusChip>
                )
              )}
            </div>
            <button className="btn w-full justify-center text-sm" onClick={runVerify} disabled={verifying}>
              <ShieldCheck size={15} />
              {verifying ? l("Memeriksa rantai…", "Verifying chain…") : l("Verifikasi rantai hash", "Verify hash chain")}
            </button>
          </div>
        </div>
      )}

      {/* Filter & search toolbar */}
      <div className="card p-3 mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-line p-1 bg-surface2/60">
          {(["runs", "events"] as const).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setSelected(null); setRows([]); }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${view === v ? "bg-brand text-brandfg shadow-xs" : "text-muted hover:text-fg"}`}
            >
              {v === "runs" ? l("Run pertanyaan", "Question runs") : l("Event sistem & MCP", "System & MCP events")}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            className="input !pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={l("Cari pertanyaan…", "Search questions…")}
          />
        </form>

        <div className="flex items-center gap-2.5 flex-wrap ml-auto">
          {view === "runs" && (
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <Filter size={14} className="shrink-0" />
              <select className="input !w-auto" value={path} onChange={(e) => setPath(e.target.value)}>
                <option value="">{l("Semua hasil", "All outcomes")}</option>
                {Object.keys(PATH_LABEL).map((k) => (
                  <option key={k} value={k}>{l(...PATH_LABEL[k])}</option>
                ))}
              </select>
            </label>
          )}

          <select
            className="input !w-auto"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-label={l("Kanal", "Channel")}
          >
            <option value="">{l("Semua kanal", "All channels")}</option>
            <option value="web">Web</option>
            <option value="mcp">WorkBuddy (MCP)</option>
          </select>

          <button
            className="btn text-sm"
            onClick={() => load()}
            disabled={loading}
            aria-label={l("Segarkan", "Refresh")}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{l("Segarkan", "Refresh")}</span>
          </button>
        </div>
      </div>

      {err && <p role="alert" className="text-bad mb-4 text-sm">{err}</p>}

      {view === "runs" ? (
        <div className="grid lg:grid-cols-[minmax(340px,420px)_1fr] gap-5 items-start">
          {/* Runs list */}
          <div className="card overflow-hidden lg:max-h-[calc(100vh-250px)] lg:overflow-y-auto divide-y divide-line">
            {rows.map((r) => {
              const active = selected?.seq === r.seq;
              const outcomeLabel = PATH_LABEL[r.decision_path ?? ""]
                ? l(...PATH_LABEL[r.decision_path ?? ""])
                : (r.decision_path ?? "—");
              return (
                <button
                  key={r.seq}
                  onClick={() => setSelected(r)}
                  className={`w-full text-left px-4 py-3.5 flex flex-col gap-2 transition-colors ${active ? "bg-tint/70" : "hover:bg-surface2/60"}`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="text-sm font-medium leading-snug line-clamp-2 text-fg">
                      {r.query_text || l("(Tanpa teks pertanyaan)", "(No question text)")}
                    </span>
                    <span className="text-xs text-muted whitespace-nowrap shrink-0 mt-0.5" title={new Date(r.ts).toLocaleString()}>
                      {relTime(r.ts, lang)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusChip tone={PATH_TONE[r.decision_path ?? ""] ?? "muted"}>
                      {outcomeLabel}
                    </StatusChip>
                    <ChannelBadge channel={r.channel} />
                    <span className="text-xs text-muted truncate">{r.actor_name ?? "—"}</span>
                    {!!r.filtered_count && (
                      <span className="text-xs font-medium text-warn ml-auto">
                        {r.filtered_count} {l("terfilter", "filtered")}
                      </span>
                    )}
                    {r.latency_ms != null && (
                      <span className={`text-xs font-mono text-muted ${r.filtered_count ? "" : "ml-auto"}`}>
                        {(r.latency_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {!loading && rows.length === 0 && (
              <p className="p-8 text-sm text-muted text-center">
                {channel === "mcp"
                  ? l("Belum ada run pertanyaan dari WorkBuddy MCP. Pastikan WorkBuddy memanggil tool ask_workplace_brain.", "No question runs from WorkBuddy MCP yet. Make sure WorkBuddy calls ask_workplace_brain.")
                  : l("Belum ada run yang cocok.", "No matching runs yet.")}
              </p>
            )}
            {more && (
              <button
                className="w-full py-3 text-sm font-medium text-brand hover:bg-surface2"
                disabled={loading}
                onClick={() => load(rows[rows.length - 1]?.seq)}
              >
                {l("Muat lebih banyak", "Load more")}
              </button>
            )}
          </div>

          {/* Run detail */}
          {selected ? (
            <RunDetail key={selected.seq} row={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="card p-12 text-center text-muted text-sm hidden lg:block">
              {l("Pilih salah satu run di sebelah kiri untuk melihat trace 8 langkah dan rincian audit.", "Select a run on the left to inspect its 8-step trace and audit details.")}
            </div>
          )}
        </div>
      ) : (
        <EventsList rows={rows} loading={loading} more={more} onMore={() => load(rows[rows.length - 1]?.seq)} />
      )}

      <p className="text-xs text-muted mt-5">
        {l(
          "Pertanyaan dan jawaban disimpan dalam bentuk tersamarkan (PII masked). Setiap baris menyimpan hash SHA-256 dari baris sebelumnya sehingga perubahan apa pun akan memutus rantai.",
          "Questions and answers are stored masked. Each row stores a SHA-256 hash over the previous row, so any edit breaks the chain.",
        )}
      </p>
    </Shell>
  );
}

function RunDetail({ row, onClose }: { row: AuditRowOut; onClose: () => void }) {
  const l = useL();
  const [detail, setDetail] = useState<QueryDetailOut | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("trace");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!row.query_id) return;
    apiFetch<QueryDetailOut>(`/api/audit/queries/${row.query_id}`)
      .then((d) => {
        setDetail(d);
        const first = d.trace.find((s) => s.name === "retrieve") ?? d.trace[0];
        setOpen(first?.step ?? null);
      })
      .catch((e) => setErr(errorText(e)));
  }, [row.query_id]);

  const timeline = useMemo(() => {
    const steps = detail?.trace ?? [];
    const starts = steps.map((s) => (s.started_at ? new Date(s.started_at).getTime() : null));
    const t0 = Math.min(...starts.filter((x): x is number => x != null));
    const end = Math.max(...steps.map((s, i) => (starts[i] ?? t0) + (s.ms ?? 0)), t0 + 1);
    return { t0, total: end - t0, starts };
  }, [detail]);

  const a = detail?.audit ?? row;
  const copy = async (text: string) => {
    toast(
      (await copyText(text))
        ? l("Disalin", "Copied")
        : l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually."),
    );
  };

  const outcomeLabel = PATH_LABEL[a.decision_path ?? ""]
    ? l(...PATH_LABEL[a.decision_path ?? ""])
    : (a.decision_path ?? "—");

  return (
    <section className="card overflow-hidden flex flex-col lg:max-h-[calc(100vh-250px)]">
      {/* Header */}
      <div className="p-5 border-b border-line flex gap-3 items-start bg-surface">
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip tone={PATH_TONE[a.decision_path ?? ""] ?? "muted"}>
              {outcomeLabel}
            </StatusChip>
            <ChannelBadge channel={a.channel} />
            {a.latency_ms != null && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface2 text-muted">
                {(a.latency_ms / 1000).toFixed(2)} s
              </span>
            )}
            <span className="text-xs text-muted ml-auto">
              #{a.seq} · {new Date(a.ts).toLocaleString()}
            </span>
          </div>

          <h2 className="font-semibold text-lg leading-snug break-words">{a.query_text}</h2>

          <div className="flex items-center gap-2 flex-wrap text-xs text-muted pt-0.5">
            <span className="font-medium text-fg">{a.actor_name ?? "—"}</span>
            {a.roles_snapshot.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {a.roles_snapshot.map((role) => (
                  <RoleChip key={role} role={role} system={["owner", "admin", "auditor"].includes(role)} />
                ))}
              </div>
            )}
            <span>· {l("izin", "perm")} v{a.permission_version ?? "–"}</span>
            {a.intent && (
              <>
                <span>·</span>
                <span className="font-mono text-fg/80">{a.intent}</span>
              </>
            )}
          </div>
        </div>
        <button className="btn !p-1.5 lg:hidden" onClick={onClose} aria-label="close">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-5 pt-2.5 border-b border-line bg-surface2/30">
        {(
          [
            ["trace", l("Trace 8 langkah", "8-step trace")],
            ["io", l("Input & Output", "Input & Output")],
            ["meta", l("Metadata & Hash", "Metadata & Hash")],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              tab === k ? "border-brand text-fg font-semibold" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}
        {!detail && !err && (
          <p className="text-muted text-sm animate-pulse">{l("Memuat trace…", "Loading trace…")}</p>
        )}

        {detail && tab === "trace" && (
          <div className="flex flex-col gap-2">
            {detail.trace.map((s, i) => {
              const start =
                timeline.starts[i] != null
                  ? (timeline.starts[i]! - timeline.t0) / timeline.total
                  : 0;
              const width = Math.max(0.015, (s.ms ?? 0) / timeline.total);
              const skipped = !!s.detail?.skipped;
              const isOpen = open === s.step;
              return (
                <div
                  key={s.step}
                  className={`rounded-erp border transition-colors ${
                    isOpen ? "border-line2 bg-surface" : "border-line bg-surface/60 hover:bg-surface2/40"
                  }`}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : s.step)}
                    className={`w-full px-3.5 py-3 text-left flex flex-col gap-2 ${skipped ? "opacity-55" : ""}`}
                  >
                    <div className="flex items-center gap-2.5 w-full">
                      {isOpen ? (
                        <ChevronDown size={15} className="text-muted shrink-0" />
                      ) : (
                        <ChevronRight size={15} className="text-muted shrink-0" />
                      )}
                      <span className="text-xs font-mono text-muted w-4">{s.step}.</span>
                      <span
                        className={`text-[0.68rem] font-semibold px-2 py-0.5 rounded font-mono shrink-0 ${
                          s.label.includes("LLM")
                            ? "bg-tint text-brand"
                            : "bg-surface2 text-muted"
                        }`}
                      >
                        {s.label}
                      </span>
                      <span className="text-sm font-medium text-fg">
                        {l(...(STEP_NAME[s.name] ?? [s.name, s.name]))}
                      </span>
                      {s.summary && !isOpen && (
                        <span className="text-xs text-muted truncate hidden sm:inline">
                          — {s.summary}
                        </span>
                      )}
                      <span className="text-xs font-mono text-muted ml-auto shrink-0">
                        {skipped ? l("dilewati", "skipped") : `${s.ms ?? 0} ms`}
                      </span>
                    </div>

                    {/* Timeline bar */}
                    <div className="pl-6 pr-1">
                      <div className="relative h-2 rounded-full bg-surface2 overflow-hidden">
                        <span
                          className={`absolute top-0 h-full rounded-full ${
                            s.label.includes("LLM") ? "bg-brand" : "bg-muted/60"
                          }`}
                          style={{ left: `${start * 100}%`, width: `${width * 100}%` }}
                        />
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-2 border-t border-line/70 flex flex-col gap-3 bg-surface2/20">
                      {s.summary && <p className="text-sm font-medium text-fg">{s.summary}</p>}
                      <StepDetail step={s} audit={detail.audit} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {detail && tab === "io" && (
          <div className="flex flex-col gap-5">
            <Block title={l("Pertanyaan pengguna (tersamarkan)", "User question (masked)")}>
              <div className="p-3.5 rounded-erp bg-surface2/60 border border-line">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.audit.query_text}</p>
              </div>
            </Block>

            <Block title={l("Jawaban sistem (tersamarkan)", "System response (masked)")}>
              <div className="p-3.5 rounded-erp bg-surface2/60 border border-line">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.audit.response_text}</p>
              </div>
            </Block>

            <div className="grid sm:grid-cols-2 gap-4">
              <Block title={l(`Sitasi dipakai (${detail.audit.citations.length})`, `Citations used (${detail.audit.citations.length})`)}>
                <div className="p-3.5 rounded-erp border border-line bg-surface flex flex-wrap gap-1.5 min-h-[52px] items-center">
                  {detail.audit.citations.length ? (
                    detail.audit.citations.map((c) => <SourceChip key={c} id={c} />)
                  ) : (
                    <span className="text-xs text-muted">{l("Tidak ada sitasi", "No citations")}</span>
                  )}
                </div>
              </Block>

              <Block
                title={l(
                  `Diambil (${detail.audit.retrieved_item_ids.length}) · Ditahan izin (${detail.audit.filtered_count ?? 0})`,
                  `Retrieved (${detail.audit.retrieved_item_ids.length}) · Filtered (${detail.audit.filtered_count ?? 0})`,
                )}
              >
                <div className="p-3.5 rounded-erp border border-line bg-surface flex flex-wrap gap-1.5 min-h-[52px] items-center">
                  {detail.audit.retrieved_item_ids.length ? (
                    detail.audit.retrieved_item_ids.map((c) => <SourceChip key={c} id={c} />)
                  ) : (
                    <span className="text-xs text-muted">{l("Tidak ada sumber diambil", "No sources retrieved")}</span>
                  )}
                </div>
              </Block>
            </div>
          </div>
        )}

        {detail && tab === "meta" && (
          <div className="flex flex-col gap-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Block title={l("Model per langkah", "Model per step")}>
                <div className="p-3.5 rounded-erp border border-line bg-surface">
                  <KV data={detail.audit.model_ids ?? {}} />
                </div>
              </Block>
              <Block title={l("Konteks eksekusi", "Execution context")}>
                <div className="p-3.5 rounded-erp border border-line bg-surface">
                  <KV
                    data={{
                      query_id: detail.audit.query_id,
                      channel: detail.audit.channel,
                      language: detail.audit.language,
                      intent: detail.audit.intent,
                      prompt_version: detail.audit.prompt_version,
                      permission_version: detail.audit.permission_version,
                      roles: detail.audit.roles_snapshot.join(", "),
                    }}
                  />
                </div>
              </Block>
            </div>

            <Block title={l("Detail tambahan", "Additional details")}>
              <Json value={detail.audit.details} />
            </Block>

            <Block title="SHA-256 row_hash">
              <button
                className="w-full p-3 rounded-erp border border-line bg-surface2/50 font-mono text-xs break-all text-left inline-flex gap-2 items-center hover:border-brand hover:text-brand transition-colors"
                onClick={() => copy(detail.audit.row_hash)}
              >
                <Copy size={14} className="shrink-0" />
                <span>{detail.audit.row_hash}</span>
              </button>
            </Block>
          </div>
        )}
      </div>
    </section>
  );
}

/** Readable view per pipeline step; anything unknown falls back to JSON. */
function StepDetail({ step, audit }: { step: TraceStepOut; audit: AuditRowOut }) {
  const l = useL();
  const d = (step.detail ?? {}) as Record<string, unknown>;
  if (d.skipped) return <p className="text-xs text-muted">{l("Langkah ini dilewati.", "This step was skipped.")}</p>;

  if (step.name === "understand" && d.understanding) {
    const u = d.understanding as Record<string, unknown>;
    return (
      <KV
        data={{
          intent: u.intent,
          category: u.category,
          language: u.language,
          topic: u.topic_phrase,
          needs_pii: String(u.needs_pii),
          search_queries: (u.search_queries as string[] | undefined)?.join(" | "),
          entities: (u.entities as string[] | undefined)?.join(", "),
          source_types: (u.source_types as string[] | undefined)?.join(", "),
        }}
      />
    );
  }
  if (step.name === "retrieve") {
    const calls =
      (d.tool_calls as
        | {
            tool: string;
            args: Record<string, unknown>;
            returned_ids: string[];
            filtered_ids?: string[];
            filtered_count: number;
            ms: number;
            vector: boolean;
          }[]
        | undefined) ?? [];
    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs text-muted">
          {l("Total sumber ditahan izin (tidak terlihat oleh penanya)", "Total filtered by permissions (hidden from user)")}:{" "}
          <b className="text-fg">{String(d.filtered_total ?? 0)}</b> · PII{" "}
          <b className="text-fg">{d.pii_released ? l("dibuka sesuai izin", "released per policy") : l("disamarkan", "masked")}</b>
        </p>
        {calls.map((c, i) => (
          <div key={i} className="rounded-erp border border-line bg-surface p-3 text-xs flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <b className="font-mono text-fg">{c.tool}</b>
              <span className="text-muted font-mono">{c.ms} ms</span>
              {c.tool.startsWith("search_") && !c.vector && (
                <StatusChip tone="warn">{l("tanpa vektor", "no vector")}</StatusChip>
              )}
              {!!c.filtered_count && (
                <StatusChip tone="warn">
                  {c.filtered_count} {l("ditahan izin", "filtered")}
                </StatusChip>
              )}
            </div>
            {Object.keys(c.args).length > 0 && (
              <p className="text-muted break-words">
                {Object.entries(c.args)
                  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                  .join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-muted mr-1">{l("Hasil:", "Returned:")}</span>
              {c.returned_ids.length ? (
                c.returned_ids.map((id) => <SourceChip key={id} id={id} />)
              ) : (
                <span className="text-muted">{l("tidak ada hasil", "no results")}</span>
              )}
            </div>
            {c.filtered_ids && c.filtered_ids.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center pt-1 border-t border-line/60">
                <span className="text-warn mr-1">{l("Ditahan:", "Filtered IDs:")}</span>
                {c.filtered_ids.map((id) => (
                  <SourceChip key={id} id={id} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "evidence") {
    const claims = (d.claims as Record<string, unknown>[] | undefined) ?? [];
    const res = (d.resolutions as Record<string, unknown>[] | undefined) ?? [];
    return (
      <div className="flex flex-col gap-2.5">
        {claims.length > 0 && (
          <div className="overflow-x-auto rounded-erp border border-line bg-surface">
            <table className="w-full text-xs">
              <thead className="bg-surface2 text-muted">
                <tr className="text-left">
                  <th className="py-2 px-3">{l("Topik", "Topic")}</th>
                  <th className="py-2 pr-3">{l("Nilai", "Value")}</th>
                  <th className="py-2 pr-3">{l("Sumber", "Source")}</th>
                  <th className="py-2 pr-3">{l("Otoritas", "Authority")}</th>
                  <th className="py-2 pr-3">{l("Tanggal", "Date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {claims.map((c, i) => (
                  <tr key={i}>
                    <td className="py-2 px-3 font-mono">{String(c.topic)}</td>
                    <td className="py-2 pr-3">{String(c.value)}</td>
                    <td className="py-2 pr-3">
                      <SourceChip id={String(c.citation_id)} />
                    </td>
                    <td className="py-2 pr-3">{String(c.authority)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{String(c.date ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {res
          .filter((r) => r.is_conflict || (r.competing as unknown[] | undefined)?.length)
          .map((r, i) => (
            <div key={i} className="rounded-erp border border-warn/40 bg-warn/5 p-3 text-xs">
              <b className="font-mono">{String(r.topic)}</b> · {String(r.reason)}
              {r.chosen ? (
                <p className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span>{l("Dipilih", "Chosen")}:</span>
                  <b>{String((r.chosen as Record<string, unknown>).value)}</b>
                  <SourceChip id={String((r.chosen as Record<string, unknown>).citation_id)} />
                </p>
              ) : null}
            </div>
          ))}
        {(d.dropped_citations as string[] | undefined)?.length ? (
          <p className="text-xs text-warn">
            {l("Sitasi dibuang (tidak diambil)", "Dropped citations (not retrieved)")}:{" "}
            {(d.dropped_citations as string[]).join(", ")}
          </p>
        ) : null}
        {!claims.length && (
          <p className="text-xs text-muted">
            {l("Tidak ada klaim yang didukung sumber.", "No claims supported by the sources.")}
          </p>
        )}
      </div>
    );
  }
  if (step.name === "validate") {
    const problems = [
      ...((audit.details?.validation_problems as string[] | undefined) ?? []),
      ...((audit.details?.validation_problems_retry as string[] | undefined) ?? []),
    ];
    return (
      <div className="flex flex-col gap-2">
        <KV
          data={{
            ok: String(d.ok ?? ""),
            retried: String(d.retried ?? false),
            pii_masked: String(d.pii_masked ?? 0),
          }}
        />
        {problems.length > 0 && (
          <ul className="text-xs text-warn list-disc pl-4">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (step.name === "compose") {
    return (
      <KV
        data={{
          model: audit.model_ids?.compose,
          first_token_ms: d.first_token_ms,
          hedged: String(d.hedged ?? false),
        }}
      />
    );
  }
  if (Object.keys(d).length === 0) return null;
  return <Json value={d} />;
}

function SourceChip({ id }: { id: string }) {
  return (
    <Link
      href={`/sources/${encodeURIComponent(id)}`}
      className="font-mono text-xs px-2 py-0.5 rounded-md bg-surface2/80 border border-line hover:border-brand hover:text-brand transition-colors"
    >
      {id}
    </Link>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow">{title}</p>
      {children}
    </div>
  );
}

function KV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return <p className="text-xs text-muted">—</p>;
  return (
    <dl className="grid grid-cols-[minmax(130px,auto)_1fr] gap-x-4 gap-y-2 text-xs">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted font-mono">{k}</dt>
          <dd className="break-words font-medium text-fg">{String(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-surface2/60 border border-line rounded-erp p-3.5 overflow-x-auto whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventsList({
  rows,
  loading,
  more,
  onMore,
}: {
  rows: AuditRowOut[];
  loading: boolean;
  more: boolean;
  onMore: () => void;
}) {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card overflow-hidden divide-y divide-line">
      {rows.map((r) => {
        const isOpen = open === r.seq;
        const details = (r.details ?? {}) as Record<string, unknown>;
        const action = String(details.action ?? r.event_type);
        const itemId = details.item_id ? String(details.item_id) : null;
        return (
          <div key={r.seq}>
            <button
              onClick={() => setOpen(isOpen ? null : r.seq)}
              className="w-full text-left px-5 py-3.5 flex gap-3 items-center hover:bg-surface2/60 transition-colors flex-wrap sm:flex-nowrap"
            >
              {isOpen ? (
                <ChevronDown size={15} className="text-muted shrink-0" />
              ) : (
                <ChevronRight size={15} className="text-muted shrink-0" />
              )}
              <NeutralChip>{r.event_type}</NeutralChip>
              <ChannelBadge channel={r.channel} />
              <span className="text-sm font-medium flex-1 min-w-[180px] truncate">
                <span className="font-mono">{action}</span>
                {itemId && <span className="text-muted font-mono ml-2">({itemId})</span>}
                {r.actor_name && <span className="text-muted font-normal"> · {r.actor_name}</span>}
              </span>
              <span className="text-xs text-muted whitespace-nowrap ml-auto">
                #{r.seq} · {relTime(r.ts, lang)}
              </span>
            </button>
            {isOpen && (
              <div className="px-5 pb-4 pt-2 bg-surface2/20 border-t border-line/60 flex flex-col gap-2">
                {r.roles_snapshot.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted">
                    <span>{l("Peran saat event:", "Roles at event:")}</span>
                    {r.roles_snapshot.map((role) => (
                      <RoleChip key={role} role={role} system={["owner", "admin", "auditor"].includes(role)} />
                    ))}
                  </div>
                )}
                <Json value={r.details} />
              </div>
            )}
          </div>
        );
      })}
      {!loading && rows.length === 0 && (
        <p className="p-8 text-sm text-muted text-center">{l("Belum ada event.", "No events yet.")}</p>
      )}
      {more && (
        <button
          className="w-full py-3 text-sm font-medium text-brand hover:bg-surface2"
          disabled={loading}
          onClick={onMore}
        >
          {l("Muat lebih banyak", "Load more")}
        </button>
      )}
    </div>
  );
}
