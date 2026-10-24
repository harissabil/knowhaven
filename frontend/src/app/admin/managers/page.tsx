"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { MANAGERS as MOCK_MANAGERS } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch } from "@/lib/api";
import { RefreshCw } from "lucide-react";

interface ManagerItem {
  id?: string;
  scope: string;
  target: string;
  manager: string;
}

export default function Managers() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [managers, setManagers] = useState<ManagerItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadManagers() {
    setLoading(true);
    try {
      const res = await apiFetch<
        {
          id: string;
          manager_name?: string;
          scope: string;
          target: string;
        }[]
      >("/api/admin/managers");

      if (res && res.length > 0) {
        setManagers(
          res.map((m) => ({
            id: m.id,
            scope: m.scope,
            target: m.target,
            manager: m.manager_name || "Manager",
          })),
        );
        setLoading(false);
        return;
      }
    } catch {
      // fallback
    }

    setManagers(
      MOCK_MANAGERS.map((m) => ({
        scope: m.scope,
        target: m.target[lang],
        manager: m.manager,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadManagers();
  }, [lang]);

  return (
    <Shell title={t("managers")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">
          {l(
            "Penugasan manager dan approver persetujuan akses.",
            "Manager assignments and access approval routing.",
          )}
        </span>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadManagers}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[l("Lingkup", "Scope"), l("Target", "Target"), "Approver"]}
        rows={managers.map((m) => [m.scope, m.target, m.manager])}
      />
    </Shell>
  );
}
