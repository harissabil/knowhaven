"use client";
import { copyText } from "@/lib/clipboard";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Filter, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
import type { AuditRowOut, QueryDetailOut, SummaryOut, TraceStepOut, VerifyOut } from "@/lib/contracts";
import { relTime } from "@/components/documents";
import { toast } from "@/components/ui/Toast";

const PAGE = 50;
const PATH_STYLE: Record<string, string> = {
  answer: "bg-ok", conflict: "bg-warn", idk: "bg-muted", policy_refusal: "bg-brand", error: "bg-bad",
};
const PATH_LABEL: Record<string, [string, string]> = {
  answer: ["Dijawab", "Answered"], conflict: ["Konflik diselesaikan", "Conflict resolved"], idk: ["Tidak tahu", "Don't know"],
  policy_refusal: ["Ditolak kebijakan", "Policy refusal"], error: ["Error", "Error"],
};
const STEP_NAME: Record<string, [string, string]> = {
  identify: ["Identitas & izin", "Identity & permissions"], understand: ["Pahami pertanyaan", "Understand question"],
  policy_gate: ["Gerbang kebijakan", "Policy gate"], retrieve: ["Retrieval", "Retrieval"],
  evidence: ["Bukti & konflik", "Evidence & conflicts"], compose: ["Susun jawaban", "Compose answer"],
  validate: ["Validasi", "Validation"], record: ["Catat audit", "Record audit"],
};

type Tab = "trace" | "io" | "meta";

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
      {/* stats strip */}
      {summary && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Stat label={l("Run (7 hari)", "Runs (7 days)")} value={String(summary.queries)} />
          <Stat label="p50" value={summary.p50_latency_ms != null ? `${(summary.p50_latency_ms / 1000).toFixed(1)} s` : "–"} />
          <Stat label="p95" value={summary.p95_latency_ms != null ? `${(summary.p95_latency_ms / 1000).toFixed(1)} s` : "–"} />
          {Object.entries(summary.by_decision).map(([k, v]) => (
            <Stat key={k} label={l(...(PATH_LABEL[k] ?? [k, k]))} value={String(v)} dot={PATH_STYLE[k]} />
          ))}
          <Stat label={l("Sumber terfilter", "Sources filtered")} value={String(summary.total_filtered)} />
          <div className="ml-auto flex items-center gap-2">
            {verify && (verify.ok
              ? <span className="text-ok text-sm flex items-center gap-1"><ShieldCheck size={15} /> {l(`Rantai utuh (${verify.rows})`, `Chain intact (${verify.rows})`)}</span>
              : <span className="text-bad text-sm flex items-center gap-1"><AlertTriangle size={15} /> {l(`Rusak di #${verify.first_bad_seq}`, `Broken at #${verify.first_bad_seq}`)}</span>)}
            <button className="btn" onClick={runVerify} disabled={verifying}><ShieldCheck size={15} /> {verifying ? l("Memeriksa…", "Checking…") : l("Verifikasi rantai", "Verify chain")}</button>
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-full border border-line p-0.5 bg-surface">
          {(["runs", "events"] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); setSelected(null); setRows([]); }}
              className={`px-3.5 py-1 rounded-full text-sm ${view === v ? "bg-brand text-brandfg" : "text-muted hover:text-fg"}`}>
              {v === "runs" ? l("Run pertanyaan", "Question runs") : l("Event admin", "Admin events")}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-8 !py-1.5 !w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder={l("Cari pertanyaan…", "Search questions…")} />
        </form>
        {view === "runs" && (
          <label className="inline-flex items-center gap-1 text-sm text-muted"><Filter size={14} />
            <select className="input !w-auto !py-1.5" value={path} onChange={(e) => setPath(e.target.value)}>
              <option value="">{l("Semua hasil", "All outcomes")}</option>
              {Object.keys(PATH_LABEL).map((k) => <option key={k} value={k}>{l(...PATH_LABEL[k])}</option>)}
            </select>
          </label>
        )}
        <select className="input !w-auto !py-1.5" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={l("Kanal", "Channel")}>
          <option value="">{l("Semua kanal", "All channels")}</option>
          <option value="web">Web</option>
          <option value="mcp">WorkBuddy (MCP)</option>
        </select>
        <button className="btn !py-1.5" onClick={() => load()} disabled={loading} aria-label={l("Segarkan", "Refresh")}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>
      {err && <p role="alert" className="text-bad mb-3 text-sm">{err}</p>}

      {view === "runs" ? (
        <div className="grid lg:grid-cols-[minmax(320px,420px)_1fr] gap-4 items-start">
          {/* runs list */}
          <div className="card overflow-hidden lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            {rows.map((r) => (
              <button key={r.seq} onClick={() => setSelected(r)}
                className={`w-full text-left px-3.5 py-2.5 border-b border-line flex gap-2.5 items-start ${selected?.seq === r.seq ? "bg-tint" : "hover:bg-surface2/60"}`}>
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PATH_STYLE[r.decision_path ?? ""] ?? "bg-line2"}`} title={r.decision_path ?? ""} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{r.query_text}</span>
                  <span className="text-xs text-muted flex gap-2 flex-wrap">
                    <span>{r.actor_name ?? "—"}</span>
                    <span>{r.channel}</span>
                    {r.latency_ms != null && <span className="font-mono">{(r.latency_ms / 1000).toFixed(1)}s</span>}
                    {!!r.filtered_count && <span className="text-warn">{r.filtered_count} {l("terfilter", "filtered")}</span>}
                  </span>
                </span>
                <span className="text-xs text-muted whitespace-nowrap" title={new Date(r.ts).toLocaleString()}>{relTime(r.ts, lang)}</span>
              </button>
            ))}
            {!loading && rows.length === 0 && <p className="p-6 text-sm text-muted text-center">{l("Belum ada run.", "No runs yet.")}</p>}
            {more && <button className="w-full py-2.5 text-sm text-brand hover:bg-surface2" disabled={loading} onClick={() => load(rows[rows.length - 1]?.seq)}>{l("Muat lebih banyak", "Load more")}</button>}
          </div>

          {/* run detail */}
          {selected ? <RunDetail key={selected.seq} row={selected} onClose={() => setSelected(null)} /> : (
            <div className="card p-10 text-center text-muted text-sm hidden lg:block">{l("Pilih run untuk melihat trace-nya.", "Select a run to see its trace.")}</div>
          )}
        </div>
      ) : (
        <EventsList rows={rows} loading={loading} more={more} onMore={() => load(rows[rows.length - 1]?.seq)} />
      )}

      <p className="text-xs text-muted mt-4">
        {l("Pertanyaan dan jawaban disimpan dalam bentuk tersamarkan. Setiap baris menyimpan hash SHA-256 baris sebelumnya, jadi perubahan apa pun memutus rantai.",
          "Questions and answers are stored masked. Each row stores a SHA-256 hash over the previous row, so any edit breaks the chain.")}
      </p>
    </Shell>
  );
}

function Stat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="card px-3.5 py-2 flex items-center gap-2">
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      <span className="text-xs text-muted">{label}</span>
      <b className="text-sm">{value}</b>
    </div>
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
      .then((d) => { setDetail(d); const first = d.trace.find((s) => s.name === "retrieve") ?? d.trace[0]; setOpen(first?.step ?? null); })
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
  const copy = async (text: string) => { toast((await copyText(text)) ? l("Disalin", "Copied") : l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually.")); };

  return (
    <section className="card overflow-hidden flex flex-col lg:max-h-[calc(100vh-220px)]">
      {/* header */}
      <div className="p-4 border-b border-line flex gap-3 items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-line2`}>
              <span className={`w-2 h-2 rounded-full ${PATH_STYLE[a.decision_path ?? ""] ?? "bg-line2"}`} />{l(...(PATH_LABEL[a.decision_path ?? ""] ?? [a.decision_path ?? "", a.decision_path ?? ""]))}
            </span>
            {a.latency_ms != null && <span className="text-xs font-mono text-muted">{(a.latency_ms / 1000).toFixed(2)} s</span>}
            <span className="text-xs text-muted">#{a.seq} · {new Date(a.ts).toLocaleString()}</span>
          </div>
          <h2 className="font-semibold text-lg leading-snug break-words">{a.query_text}</h2>
          <p className="text-xs text-muted mt-1">
            {a.actor_name ?? "—"} · {a.roles_snapshot.join(", ") || "—"} · {l("izin", "perm")} v{a.permission_version ?? "–"} · {a.channel}
            {a.intent && <> · <span className="font-mono">{a.intent}</span></>}
          </p>
        </div>
        <button className="btn !p-1.5 lg:hidden" onClick={onClose} aria-label="close"><X size={16} /></button>
      </div>

      <div className="flex gap-1 px-4 pt-2 border-b border-line">
        {([["trace", l("Trace", "Trace")], ["io", l("Input / Output", "Input / Output")], ["meta", l("Metadata", "Metadata")]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? "border-brand text-fg font-medium" : "border-transparent text-muted hover:text-fg"}`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}
        {!detail && !err && <p className="text-muted text-sm animate-pulse">{l("Memuat trace…", "Loading trace…")}</p>}

        {detail && tab === "trace" && (
          <div className="flex flex-col">
            {detail.trace.map((s, i) => {
              const start = timeline.starts[i] != null ? (timeline.starts[i]! - timeline.t0) / timeline.total : 0;
              const width = Math.max(0.006, (s.ms ?? 0) / timeline.total);
              const skipped = !!s.detail?.skipped;
              const isOpen = open === s.step;
              return (
                <div key={s.step} className="border-b border-line last:border-0">
                  <button onClick={() => setOpen(isOpen ? null : s.step)} className={`w-full grid grid-cols-[18px_150px_1fr_64px] md:grid-cols-[18px_200px_1fr_64px] gap-2 items-center py-2 text-left hover:bg-surface2/50 ${skipped ? "opacity-50" : ""}`}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[0.6rem] font-semibold px-1.5 py-0.5 rounded font-mono ${s.label.includes("LLM") ? "bg-tint text-brand" : "bg-surface2 text-muted"}`}>{s.label}</span>
                      <span className="text-sm truncate">{l(...(STEP_NAME[s.name] ?? [s.name, s.name]))}</span>
                    </span>
                    <span className="relative h-2.5 rounded bg-surface2 overflow-hidden" title={s.summary ?? ""}>
                      <span className={`absolute top-0 h-full rounded ${s.label.includes("LLM") ? "bg-brand" : "bg-muted/60"}`} style={{ left: `${start * 100}%`, width: `${width * 100}%` }} />
                    </span>
                    <span className="text-xs font-mono text-right text-muted">{skipped ? "—" : `${s.ms ?? 0} ms`}</span>
                  </button>
                  {isOpen && (
                    <div className="pb-3 pl-6 pr-1 flex flex-col gap-2">
                      {s.summary && <p className="text-sm">{s.summary}</p>}
                      <StepDetail step={s} audit={detail.audit} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {detail && tab === "io" && (
          <div className="flex flex-col gap-4">
            <Block title={l("Input (tersamarkan)", "Input (masked)")}><p className="whitespace-pre-wrap text-sm">{detail.audit.query_text}</p></Block>
            <Block title={l("Output (tersamarkan)", "Output (masked)")}><p className="whitespace-pre-wrap text-sm">{detail.audit.response_text}</p></Block>
            <Block title={l("Sitasi", "Citations")}>
              <div className="flex flex-wrap gap-1.5">
                {detail.audit.citations.length ? detail.audit.citations.map((c) => <SourceChip key={c} id={c} />) : <span className="text-sm text-muted">—</span>}
              </div>
            </Block>
            <Block title={l(`Diambil (${detail.audit.retrieved_item_ids.length}) · terfilter ${detail.audit.filtered_count ?? 0}`, `Retrieved (${detail.audit.retrieved_item_ids.length}) · filtered ${detail.audit.filtered_count ?? 0}`)}>
              <div className="flex flex-wrap gap-1.5">{detail.audit.retrieved_item_ids.map((c) => <SourceChip key={c} id={c} />)}</div>
            </Block>
          </div>
        )}

        {detail && tab === "meta" && (
          <div className="flex flex-col gap-4">
            <Block title={l("Model per langkah", "Model per step")}>
              <KV data={detail.audit.model_ids ?? {}} />
            </Block>
            <Block title={l("Lainnya", "Other")}>
              <KV data={{ query_id: detail.audit.query_id, language: detail.audit.language, intent: detail.audit.intent, prompt_version: detail.audit.prompt_version, permission_version: detail.audit.permission_version, roles: detail.audit.roles_snapshot.join(", ") }} />
            </Block>
            <Block title={l("Detail", "Details")}><Json value={detail.audit.details} /></Block>
            <Block title="row_hash">
              <button className="font-mono text-xs break-all text-left inline-flex gap-1.5 items-start hover:text-brand" onClick={() => copy(detail.audit.row_hash)}><Copy size={12} className="shrink-0 mt-0.5" />{detail.audit.row_hash}</button>
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
  if (d.skipped) return <p className="text-xs text-muted">{l("Langkah dilewati.", "Step skipped.")}</p>;

  if (step.name === "understand" && d.understanding) {
    const u = d.understanding as Record<string, unknown>;
    return (
      <KV data={{ intent: u.intent, category: u.category, language: u.language, topic: u.topic_phrase, needs_pii: String(u.needs_pii),
        search_queries: (u.search_queries as string[] | undefined)?.join(" | "), entities: (u.entities as string[] | undefined)?.join(", "),
        source_types: (u.source_types as string[] | undefined)?.join(", ") }} />
    );
  }
  if (step.name === "retrieve") {
    const calls = (d.tool_calls as { tool: string; args: Record<string, unknown>; returned_ids: string[]; filtered_count: number; ms: number; vector: boolean }[] | undefined) ?? [];
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted">{l("Total terfilter (tidak boleh dilihat user)", "Total filtered (not visible to the user)")}: <b>{String(d.filtered_total ?? 0)}</b> · PII {d.pii_released ? l("dibuka", "released") : l("disamarkan", "masked")}</p>
        {calls.map((c, i) => (
          <div key={i} className="rounded-erp border border-line p-2.5 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <b className="font-mono">{c.tool}</b>
              <span className="text-muted font-mono">{c.ms} ms</span>
              {c.tool.startsWith("search_") && !c.vector && <span className="text-warn">{l("tanpa vektor", "no vector")}</span>}
              {!!c.filtered_count && <span className="text-warn">{c.filtered_count} {l("terfilter", "filtered")}</span>}
            </div>
            {Object.keys(c.args).length > 0 && <p className="text-muted mb-1 break-words">{Object.entries(c.args).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ")}</p>}
            <div className="flex flex-wrap gap-1">{c.returned_ids.length ? c.returned_ids.map((id) => <SourceChip key={id} id={id} />) : <span className="text-muted">{l("tidak ada hasil", "no results")}</span>}</div>
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "evidence") {
    const claims = (d.claims as Record<string, unknown>[] | undefined) ?? [];
    const res = (d.resolutions as Record<string, unknown>[] | undefined) ?? [];
    return (
      <div className="flex flex-col gap-2">
        {claims.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted"><tr className="text-left"><th className="py-1 pr-2">{l("Topik", "Topic")}</th><th className="pr-2">{l("Nilai", "Value")}</th><th className="pr-2">{l("Sumber", "Source")}</th><th className="pr-2">{l("Otoritas", "Authority")}</th><th>{l("Tanggal", "Date")}</th></tr></thead>
              <tbody>{claims.map((c, i) => (
                <tr key={i} className="border-t border-line"><td className="py-1 pr-2 font-mono">{String(c.topic)}</td><td className="pr-2">{String(c.value)}</td><td className="pr-2"><SourceChip id={String(c.citation_id)} /></td><td className="pr-2">{String(c.authority)}</td><td>{String(c.date ?? "")}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {res.filter((r) => r.is_conflict || (r.competing as unknown[] | undefined)?.length).map((r, i) => (
          <div key={i} className="rounded-erp border border-warn/40 bg-warn/5 p-2.5 text-xs">
            <b className="font-mono">{String(r.topic)}</b> · {String(r.reason)}
            {r.chosen ? <p className="mt-1">{l("Dipilih", "Chosen")}: {String((r.chosen as Record<string, unknown>).value)} <SourceChip id={String((r.chosen as Record<string, unknown>).citation_id)} /></p> : null}
          </div>
        ))}
        {(d.dropped_citations as string[] | undefined)?.length ? <p className="text-xs text-warn">{l("Sitasi dibuang (tidak diambil)", "Dropped citations (not retrieved)")}: {(d.dropped_citations as string[]).join(", ")}</p> : null}
        {!claims.length && <p className="text-xs text-muted">{l("Tidak ada klaim yang didukung sumber.", "No claims supported by the sources.")}</p>}
      </div>
    );
  }
  if (step.name === "validate") {
    const problems = [...((audit.details?.validation_problems as string[] | undefined) ?? []), ...((audit.details?.validation_problems_retry as string[] | undefined) ?? [])];
    return (
      <div className="flex flex-col gap-1.5">
        <KV data={{ ok: String(d.ok ?? ""), retried: String(d.retried ?? false), pii_masked: String(d.pii_masked ?? 0) }} />
        {problems.length > 0 && <ul className="text-xs text-warn list-disc pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      </div>
    );
  }
  if (step.name === "compose") return <KV data={{ model: audit.model_ids?.compose, first_token_ms: d.first_token_ms, hedged: String(d.hedged ?? false) }} />;
  if (Object.keys(d).length === 0) return null;
  return <Json value={d} />;
}

function SourceChip({ id }: { id: string }) {
  return <Link href={`/sources/${encodeURIComponent(id)}`} className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded border border-line hover:border-brand hover:text-brand">{id}</Link>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="eyebrow mb-1.5">{title}</p>{children}</div>;
}

function KV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return <p className="text-xs text-muted">—</p>;
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([k, v]) => (<Fragment key={k}><dt className="text-muted font-mono">{k}</dt><dd className="break-words">{String(v)}</dd></Fragment>))}
    </dl>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="text-[0.7rem] bg-surface2/60 border border-line rounded-erp p-2.5 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
}

function EventsList({ rows, loading, more, onMore }: { rows: AuditRowOut[]; loading: boolean; more: boolean; onMore: () => void }) {
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card overflow-hidden">
      {rows.map((r) => (
        <div key={r.seq} className="border-b border-line">
          <button onClick={() => setOpen(open === r.seq ? null : r.seq)} className="w-full text-left px-4 py-2.5 flex gap-3 items-center hover:bg-surface2/60">
            {open === r.seq ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface2">{r.event_type}</span>
            <span className="text-sm flex-1 truncate">{String((r.details as Record<string, unknown> | null)?.action ?? "")} {r.actor_name ? `· ${r.actor_name}` : ""}</span>
            <span className="text-xs text-muted">#{r.seq} · {relTime(r.ts, lang)}</span>
          </button>
          {open === r.seq && <div className="px-4 pb-3"><Json value={r.details} /></div>}
        </div>
      ))}
      {!loading && rows.length === 0 && <p className="p-6 text-sm text-muted text-center">{l("Belum ada event.", "No events yet.")}</p>}
      {more && <button className="w-full py-2.5 text-sm text-brand hover:bg-surface2" disabled={loading} onClick={onMore}>{l("Muat lebih banyak", "Load more")}</button>}
    </div>
  );
}
