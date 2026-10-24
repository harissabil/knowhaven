"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { CountUp } from "@/components/ui/CountUp";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
import type { TestsSummaryOut } from "@/lib/contracts";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

export default function Tests() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [data, setData] = useState<TestsSummaryOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setData(await apiFetch<TestsSummaryOut>("/api/tests"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US") : "–");

  return (
    <Shell title={t("tests")}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 max-w-2xl">
        <div className="card p-4"><p className="text-4xl font-semibold text-ok"><CountUp to={data?.passed ?? 0} /></p><p className="eyebrow">{l("lulus", "passed")}</p></div>
        <div className="card p-4"><p className="text-4xl font-semibold text-bad"><CountUp to={data?.failed ?? 0} /></p><p className="eyebrow">{l("gagal", "failed")}</p></div>
        <div className="card p-4"><p className="text-4xl font-semibold text-warn"><CountUp to={data?.pending ?? 0} /></p><p className="eyebrow">{l("belum teruji", "pending")}</p></div>
        <div className="card p-4"><p className="text-4xl font-semibold"><CountUp to={data?.total ?? 0} /></p><p className="eyebrow">{l("total", "total")}</p></div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-sm text-muted">
          {l(
            "Kasus T01–T33 (System Design §20.3), dipetakan ke tes otomatis backend. Status berasal dari hasil pytest terakhir yang tercatat; kasus tanpa tes atau belum dijalankan tampil 'pending'.",
            "Cases T01–T33 (System Design §20.3), mapped to backend automated tests. Status comes from the last recorded pytest results; cases with no test or no run show 'pending'.",
          )}
          {" "}{l("Hasil terakhir", "Last results")}: <b>{fmt(data?.results_updated_at)}</b>
        </p>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface2">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">{l("Persona", "Persona")}</th>
              <th className="p-3">{l("Skenario", "Scenario")}</th>
              <th className="p-3">{l("Harapan", "Expected")}</th>
              <th className="p-3">{l("Prinsip", "Principle")}</th>
              <th className="p-3">{l("Hasil", "Result")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.cases.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-t border-line cursor-pointer hover:bg-surface2/50" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <td className="p-3 font-mono flex items-center gap-1">{open === c.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{c.id}</td>
                  <td className="p-3">{c.persona}</td>
                  <td className="p-3">{lang === "id" ? c.scenario_id : c.scenario_en}</td>
                  <td className="p-3">{lang === "id" ? c.expected_id : c.expected_en}</td>
                  <td className="p-3">{c.principle}</td>
                  <td className="p-3"><Badge v={c.status} /></td>
                </tr>
                {open === c.id && (
                  <tr className="bg-surface2/40">
                    <td colSpan={6} className="p-3">
                      {c.tests.length === 0 ? (
                        <p className="text-muted text-xs">{l("Belum ada tes otomatis untuk kasus ini.", "No automated test covers this case yet.")}</p>
                      ) : (
                        <ul className="font-mono text-xs flex flex-col gap-1">
                          {c.tests.map((x) => (
                            <li key={x.test} className="flex gap-2 items-center">
                              <Badge v={x.outcome} /> <span className="flex-1 break-all">{x.test}</span> <span className="text-muted">{fmt(x.at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
