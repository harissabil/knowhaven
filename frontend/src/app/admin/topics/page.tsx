"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { TOPICS as MOCK_TOPICS } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { RefreshCw } from "lucide-react";

interface TopicItem {
  id?: string;
  key: string;
  owner: string;
  fallback: string;
  tier: string;
}

export default function Topics() {
  const t = useT();
  const l = useL();
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadTopics() {
    setLoading(true);
    try {
      const res = await apiFetch<
        {
          id: string;
          name: string;
          visibility_tier: string;
          owner_name?: string;
          fallback_contact?: string;
        }[]
      >("/api/admin/topics");

      if (res && res.length > 0) {
        setTopics(
          res.map((x) => ({
            id: x.id,
            key: x.name,
            owner: x.owner_name || "HR (people@srn.example)",
            fallback: x.fallback_contact || "hr@srn-nusantara.co.id",
            tier: x.visibility_tier,
          })),
        );
        setLoading(false);
        return;
      }
    } catch {
      // fallback
    }

    setTopics(
      MOCK_TOPICS.map((x) => ({
        key: x.key,
        owner: x.owner,
        fallback: x.fallback,
        tier: x.tier,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadTopics();
  }, []);

  return (
    <Shell title={t("topics")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">
          {l(
            "Pemilik topik & fallback kontak saat informasi tidak ditemukan atau memerlukan eskalasi izin.",
            "Topic owners & fallback contacts when information is inaccessible or requires escalation.",
          )}
        </span>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadTopics}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[l("Topik", "Topic"), l("Pemilik", "Owner"), l("Kontak cadangan", "Fallback contact"), "Tier"]}
        rows={topics.map((x) => [
          x.key,
          x.owner,
          x.fallback,
          <Badge key="b" v={x.tier} />,
        ])}
      />
    </Shell>
  );
}
