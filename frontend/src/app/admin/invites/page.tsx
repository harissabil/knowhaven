"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { INVITES as MOCK_INVITES } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { RefreshCw, KeyRound, UserPlus } from "lucide-react";

interface InviteItem {
  id?: string;
  code: string;
  role: string;
  expires: string;
  uses: string;
  active: boolean;
}

export default function Invites() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [list, setList] = useState<InviteItem[]>([]);
  const [companyCode, setCompanyCode] = useState("SRN-4821");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const codeRes = await apiFetch<{ code: string }>("/api/admin/company-code");
      if (codeRes?.code) {
        setCompanyCode(codeRes.code);
      }
    } catch {
      // fallback
    }

    try {
      const invitesRes = await apiFetch<
        {
          id: string;
          email: string;
          roles: string[];
          token: string;
          expires_at: string;
          revoked: boolean;
        }[]
      >("/api/admin/invites");

      if (invitesRes && invitesRes.length > 0) {
        setList(
          invitesRes.map((i) => ({
            id: i.id,
            code: i.token.slice(0, 8).toUpperCase(),
            role: i.roles.join(", "),
            expires: new Date(i.expires_at).toLocaleDateString(
              lang === "id" ? "id-ID" : "en-US",
            ),
            uses: i.email,
            active: !i.revoked,
          })),
        );
        setLoading(false);
        return;
      }
    } catch {
      // fallback
    }

    setList(
      MOCK_INVITES.map((i) => ({
        code: i.code,
        role: i.role,
        expires: i.expires[lang],
        uses: i.uses,
        active: i.active,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [lang]);

  async function rotateCode() {
    try {
      const res = await apiFetch<{ code: string }>("/api/admin/company-code/rotate", {
        method: "POST",
      });
      if (res?.code) {
        setCompanyCode(res.code);
        toast(l("Kode perusahaan berhasil dirotasi", "Company code rotated"));
        return;
      }
    } catch {
      // fallback
    }
    const mock = "SRN-" + Math.floor(1000 + Math.random() * 9000);
    setCompanyCode(mock);
    toast(l("Kode perusahaan dirotasi (mode demo)", "Company code rotated (demo mode)"));
  }

  async function addInvite() {
    const defaultEmail = `invite-${Math.random().toString(36).slice(2, 7)}@srn-nusantara.co.id`;
    try {
      const res = await apiFetch<{
        id: string;
        token: string;
        roles: string[];
        expires_at: string;
      }>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ email: defaultEmail, roles: ["new_hire", "staff"] }),
      });

      if (res) {
        toast(l("Undangan baru dibuat", "New invite created"));
        await loadData();
        return;
      }
    } catch {
      // fallback
    }

    const newCode = "INV-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    setList((prev) => [
      {
        code: newCode,
        role: "new_hire",
        expires: lang === "id" ? "7 hari lagi" : "in 7 days",
        uses: "0/10",
        active: true,
      },
      ...prev,
    ]);
    toast(l("Undangan baru dibuat (mode demo)", "New invite created (demo mode)"));
  }

  async function revokeInvite(inv: InviteItem) {
    if (inv.id) {
      try {
        await apiFetch(`/api/admin/invites/${inv.id}/revoke`, { method: "POST" });
        toast(l("Undangan dicabut", "Invite revoked"));
      } catch {
        // ignore
      }
    }
    setList((prev) =>
      prev.map((x) => (x.code === inv.code ? { ...x, active: false } : x)),
    );
  }

  return (
    <Shell title={t("invites")}>
      <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {l("Kode perusahaan aktif (untuk pendaftaran mandiri)", "Active company code (for self-signup)")}:{" "}
          <b className="font-mono text-base px-2 py-0.5 rounded bg-surface2 border border-line ml-1.5">
            {companyCode}
          </b>
        </p>
        <button className="btn" onClick={rotateCode}>
          <KeyRound size={15} /> {l("Rotasi kode", "Rotate code")}
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <button className="btn btn-primary" onClick={addInvite}>
          <UserPlus size={16} /> {l("Buat undangan baru", "Create new invite")}
        </button>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadData}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[
          l("Kode", "Code"),
          l("Peran awal", "Starting role"),
          l("Berlaku sampai", "Valid until"),
          l("Penerima / Pemakaian", "Recipient / Uses"),
          "Status",
          l("Aksi", "Action"),
        ]}
        rows={list.map((i) => [
          <a key="c" className="underline font-mono" href={`/join/${i.code}`}>
            {i.code}
          </a>,
          i.role,
          i.expires,
          i.uses,
          <Badge key="b" v={i.active ? "open" : "hidden"} />,
          i.active ? (
            <button key="r" className="btn" onClick={() => revokeInvite(i)}>
              {l("Cabut", "Revoke")}
            </button>
          ) : (
            "-"
          ),
        ])}
      />
    </Shell>
  );
}
