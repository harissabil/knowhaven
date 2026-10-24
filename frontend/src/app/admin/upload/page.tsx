"use client";
import { useEffect, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { ContainerOut, UploadOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

// Only upload folders and WhatsApp groups accept files (backend api/uploads.py).
const UPLOADABLE = ["upload_folder", "whatsapp_group"];

export default function UploadPage() {
  const t = useT();
  const l = useL();
  const [containers, setContainers] = useState<ContainerOut[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<(UploadOut & { filename: string; container: string }) | null>(null);

  useEffect(() => {
    apiFetch<ContainerOut[]>("/api/admin/containers")
      .then((res) => {
        const ok = res.filter((c) => UPLOADABLE.includes(c.source));
        setContainers(ok);
        setSelected(ok[0]?.id ?? "");
      })
      .catch((e) => setLoadErr(errorText(e)));
  }, []);

  async function handleUpload() {
    if (!file || !selected) return;
    setUploading(true);
    setResult(null);
    setErr("");
    const form = new FormData();
    form.append("container_id", selected);
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    try {
      const res = await apiFetch<UploadOut>("/api/uploads", { method: "POST", body: form });
      setResult({ ...res, filename: file.name, container: containers.find((c) => c.id === selected)?.name ?? "" });
      toast(l("File diunggah dan diindeks", "File uploaded and indexed"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Shell title={t("upload")}>
      <div className="card p-6 flex flex-col gap-4 max-w-xl">
        {loadErr && (
          <p role="alert" className="text-bad text-sm">
            {l("Daftar container tidak bisa dimuat (hanya admin): ", "Could not load containers (admins only): ")}{loadErr}
          </p>
        )}
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {l("Container tujuan", "Target container")}
          <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.source === "whatsapp_group" ? "WhatsApp" : "Upload"}, {c.tier})</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {l("Judul (opsional)", "Title (optional)")}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {l(
            "File dokumen (PDF, DOCX, Markdown, export WhatsApp .txt)",
            "Document file (PDF, DOCX, Markdown, WhatsApp export .txt)",
          )}
          <input
            type="file"
            className="input file:mr-3 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-surface2"
            accept=".pdf,.docx,.txt,.md,.markdown"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
            }}
          />
        </label>

        <button className="btn btn-primary w-fit mt-1" disabled={!file || !selected || uploading} onClick={handleUpload}>
          <Upload size={16} />
          {uploading ? l("Memproses file…", "Processing file…") : "Upload & Ingest"}
        </button>
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}

        {result && (
          <div className="mt-3 p-4 rounded-erp bg-surface2/60 border border-line flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} className="text-ok" />
              <span>{result.filename}</span>
            </div>
            <div className="text-xs text-muted flex flex-col gap-1 pl-6">
              <p>{l("Container", "Container")}: <b>{result.container}</b></p>
              <p>{l("Item baru / diperbarui / tidak berubah", "Items created / updated / unchanged")}: <b>{result.created} / {result.updated} / {result.unchanged}</b></p>
            </div>
            {result.injection_flagged.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-warn bg-warn/10 p-2 rounded border border-warn/30">
                <AlertTriangle size={14} />
                <span>
                  {l(
                    `Pola prompt injection terdeteksi di ${result.injection_flagged.length} item; ditandai dan tidak pernah dijalankan sebagai instruksi.`,
                    `Prompt-injection pattern found in ${result.injection_flagged.length} item(s); flagged and never followed as instructions.`,
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
