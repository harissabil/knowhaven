"use client";
import { Shell } from "@/components/Shell";
import { IntegrationCards } from "@/components/IntegrationCards";
import { useSession } from "@/store/session";
import { useT } from "@/lib/i18n";

export default function Integrations() {
  const t = useT();
  const tid = useSession((s) => s.tenantId) ?? "";
  return (
    <Shell title={t("integrations")}>
      <IntegrationCards tid={tid} />
    </Shell>
  );
}
