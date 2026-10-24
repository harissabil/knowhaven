"use client";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { TOPICS } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";

export default function Topics() {
  const t = useT();
  const l = useL();
  return (
    <Shell title={t("topics")}>
      <Table head={[l("Topik", "Topic"), l("Pemilik", "Owner"), l("Kontak cadangan", "Fallback contact"), "Tier"]} rows={TOPICS.map((x) => [x.key, x.owner, x.fallback, <Badge key="b" v={x.tier} />])} />
    </Shell>
  );
}
