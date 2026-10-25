"use client";
import { Shell } from "@/components/Shell";
import { CompanyProfileCard } from "@/components/CompanyProfile";
import { useT } from "@/lib/i18n";

export default function CompanySettingsPage() {
  const t = useT();
  return (
    <Shell title={t("company")}>
      <div className="flex flex-col gap-6 max-w-2xl">
        <CompanyProfileCard />
      </div>
    </Shell>
  );
}
