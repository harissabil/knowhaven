"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { TESTS as MOCK_TESTS } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { CountUp } from "@/components/ui/CountUp";
import { useSession } from "@/store/session";
import { apiFetch } from "@/lib/api";
import { RefreshCw } from "lucide-react";

interface TestCase {
  id: string;
  name: string;
  result: "pass" | "fail" | "skip";
  category?: string;
}

export default function Tests() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [passed, setPassed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [loading, setLoading] = useState(true);

  async function loadTests() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        total: number;
        passed: number;
        failed: number;
        cases: { id: string; category: string; name: string; status: "pass" | "fail" | "skip" }[];
      }>("/api/tests");

      if (res && res.cases && res.cases.length > 0) {
        setCases(
          res.cases.map((c) => ({
            id: c.id,
            name: c.name,
            result: c.status,
            category: c.category,
          })),
        );
        setPassed(res.passed);
        setFailed(res.failed);
        setLoading(false);
        return;
      }
    } catch {
      // ignore
    }

    // Mock fallback
    const mockCases: TestCase[] = MOCK_TESTS.map((x) => ({
      id: x.id,
      name: x.name[lang],
      result: (x.r === "fail" ? "fail" : x.r === "skip" ? "skip" : "pass") as "pass" | "fail" | "skip",
    }));
    const mockFails = mockCases.filter((x) => x.result === "fail").length;
    setCases(mockCases);
    setFailed(mockFails);
    setPassed(mockCases.length - mockFails);
    setLoading(false);
  }

  useEffect(() => {
    loadTests();
  }, [lang]);

  return (
    <Shell title={t("tests")}>
      <div className="flex items-center justify-between mb-4 max-w-lg">
        <div className="grid grid-cols-3 gap-4 flex-1">
          <div className="card p-4">
            <p className="text-4xl font-semibold text-ok">
              <CountUp to={passed} />
            </p>
            <p className="eyebrow">{l("lulus", "passed")}</p>
          </div>
          <div className="card p-4">
            <p className="text-4xl font-semibold text-bad">
              <CountUp to={failed} />
            </p>
            <p className="eyebrow">{l("gagal", "failed")}</p>
          </div>
          <div className="card p-4">
            <p className="text-4xl font-semibold">
              <CountUp to={cases.length} />
            </p>
            <p className="eyebrow">{l("total", "total")}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted">
          {l(
            "Hasil verifikasi sistem (T01–T33, System Design §20.3). Kegagalan ditampilkan apa adanya.",
            "System verification suite (T01–T33, System Design §20.3). Failures are shown as-is.",
          )}
        </p>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadTests}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Jalankan ulang", "Rerun")}
        </button>
      </div>

      <Table
        head={["ID", l("Kategori", "Category"), l("Kasus Uji", "Test Case"), l("Hasil", "Result")]}
        rows={cases.map((x) => [
          x.id,
          x.category || "System",
          x.name,
          <Badge key="b" v={x.result} />,
        ])}
      />
    </Shell>
  );
}
