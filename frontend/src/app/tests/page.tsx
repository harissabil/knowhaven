"use client";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { TESTS } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { CountUp } from "@/components/ui/CountUp";
import { useSession } from "@/store/session";

export default function Tests() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const fails = TESTS.filter((x) => x.r === "fail").length;
  return (
    <Shell title={t("tests")}>
      <div className="grid grid-cols-3 gap-4 mb-6 max-w-lg">
        <div className="card p-4"><p className="text-4xl font-semibold text-ok"><CountUp to={TESTS.length - fails} /></p><p className="eyebrow">{l("lulus", "passed")}</p></div>
        <div className="card p-4"><p className="text-4xl font-semibold text-bad"><CountUp to={fails} /></p><p className="eyebrow">{l("gagal", "failed")}</p></div>
        <div className="card p-4"><p className="text-4xl font-semibold"><CountUp to={TESTS.length} /></p><p className="eyebrow">{l("total", "total")}</p></div>
      </div>
      <p className="mb-3 text-sm text-muted">{l("Kegagalan ditampilkan apa adanya.", "Failures are shown as-is.")}</p>
      <Table head={["ID", l("Kasus", "Case"), l("Hasil", "Result")]} rows={TESTS.map((x) => [x.id, x.name[lang], <Badge key="b" v={x.r} />])} />
    </Shell>
  );
}
