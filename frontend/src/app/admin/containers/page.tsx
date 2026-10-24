"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { CONTAINERS as MOCK_CONTAINERS, UNMAPPED } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch } from "@/lib/api";
import { RefreshCw } from "lucide-react";

interface ContainerItem {
  id?: string;
  name: string;
  source: string;
  tier: string;
  roles: string;
}

export default function Containers() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadContainers() {
    setLoading(true);
    try {
      const res = await apiFetch<
        {
          id: string;
          name: string;
          source_type: string;
          visibility_tier: string;
          roles: string[];
        }[]
      >("/api/admin/containers");

      if (res && res.length > 0) {
        setContainers(
          res.map((c) => ({
            id: c.id,
            name: c.name,
            source: c.source_type,
            tier: c.visibility_tier,
            roles: c.roles.join(", ") || (lang === "id" ? "Semua anggota" : "All members"),
          })),
        );
        setLoading(false);
        return;
      }
    } catch {
      // fallback
    }

    setContainers(
      MOCK_CONTAINERS.map((c) => ({
        name: c.name,
        source: c.source,
        tier: c.tier,
        roles: c.roles[lang],
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadContainers();
  }, [lang]);

  return (
    <Shell title={t("containers")}>
      <div className="card p-4 mb-5">
        <b className="text-sm">
          {l(
            "Belum dipetakan (default-deny, tidak terlihat siapa pun sampai diberi izin):",
            "Not yet mapped (default-deny, invisible to everyone until permissions assigned):",
          )}
        </b>
        <ul className="list-disc ml-5 mt-2 text-sm flex flex-col gap-1.5">
          {UNMAPPED.map((u) => (
            <li key={u}>
              <span className="font-mono">{u}</span>{" "}
              <button className="btn !py-0.5 !px-2 text-xs ml-2">
                {l("Petakan", "Map")}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">
          {l(
            "Container data & tingkat visibilitas (System Design §8 RBAC).",
            "Data containers & visibility tiers (System Design §8 RBAC).",
          )}
        </span>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadContainers}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={["Container", l("Sumber", "Source"), "Tier", l("Peran yang boleh", "Allowed roles")]}
        rows={containers.map((c) => [
          c.name,
          c.source,
          <Badge key="b" v={c.tier} />,
          c.roles,
        ])}
      />
    </Shell>
  );
}
