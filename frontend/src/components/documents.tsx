"use client";
import { FileText, FileType2, FolderLock, MessageCircle } from "lucide-react";
import { useL } from "@/lib/i18n";
import type { FolderOut } from "@/lib/contracts";

export function relTime(iso: string, lang: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === "id" ? "id-ID" : "en-US", { numeric: "auto" });
  if (d < 60) return rtf.format(-Math.round(d), "second");
  if (d < 3600) return rtf.format(-Math.round(d / 60), "minute");
  if (d < 86400) return rtf.format(-Math.round(d / 3600), "hour");
  if (d < 86400 * 30) return rtf.format(-Math.round(d / 86400), "day");
  return new Date(iso).toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function FileIcon({ filename, size = 18 }: { filename: string; size?: number }) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileType2 size={size} className="text-bad shrink-0" />;
  if (ext === "txt") return <MessageCircle size={size} className="text-ok shrink-0" />;
  return <FileText size={size} className="text-brand shrink-0" />;
}

export const nobodyCanRead = (f?: FolderOut) => !!f && (!f.mapped || f.role_names.length === 0);

/** Who can read a folder, in one line; empty = the default-deny warning. */
export function Readers({ folder }: { folder?: FolderOut }) {
  const l = useL();
  if (!folder) return null;
  if (nobodyCanRead(folder))
    return <span className="text-bad inline-flex items-center gap-1"><FolderLock size={13} /> {l("Belum bisa dibaca siapa pun", "Nobody can read this yet")}</span>;
  return <span className="text-muted">{l("Bisa dibaca", "Readable by")}: {folder.role_names.join(", ")}</span>;
}

/** Clean up indexed chunk text so numbered/bulleted lists stay on neat separate lines. */
export function formatChunkText(raw: string): string {
  if (!raw) return "";
  return (
    raw
      // Rejoin standalone list numbers that got split onto their own line ("1.\n\nabc" -> "1. abc")
      .replace(/(^|\n)(\d{1,3}[.)])\s*\n+\s*(?=\S)/g, "$1$2 ")
      // Put inline numbered items onto a new line ("1. abc. 2. def" -> "1. abc.\n2. def")
      .replace(/([.!?;:])\s+(\d{1,2}\.\s+\S)/g, "$1\n$2")
      // Collapse excessive blank lines between consecutive numbered list items
      .replace(/(^|\n)(\d{1,3}\.\s+[^\n]+)\n\n+(?=\d{1,3}\.\s+)/g, "$1$2\n")
  );
}
