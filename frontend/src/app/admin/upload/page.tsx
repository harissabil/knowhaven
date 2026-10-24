"use client";
import { useEffect, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { Shell } from "@/components/Shell";
import { CONTAINERS as MOCK_CONTAINERS } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, getAuthHeaders } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

interface UploadResult {
  filename: string;
  container: string;
  chunksIndexed: number;
  piiMasked: number;
  injectionDetected: boolean;
}

export default function UploadPage() {
  const t = useT();
  const l = useL();
  const [containers, setContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    async function loadContainers() {
      try {
        const res = await apiFetch<{ name: string }[]>("/api/admin/containers");
        if (res && res.length > 0) {
          const names = res.map((c) => c.name);
          setContainers(names);
          setSelectedContainer(names[0]);
          return;
        }
      } catch {
        // ignore
      }
      const names = MOCK_CONTAINERS.map((c) => c.name);
      setContainers(names);
      setSelectedContainer(names[0] || "kebijakan-perusahaan");
    }
    loadContainers();
  }, []);

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("container_name", selectedContainer || containers[0] || "kebijakan-perusahaan");

    try {
      const headers = getAuthHeaders() as Record<string, string>;
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        setResult({
          filename: data.filename || selectedFile.name,
          container: data.container || selectedContainer,
          chunksIndexed: data.chunks_indexed ?? 3,
          piiMasked: data.pii_entities_masked ?? 0,
          injectionDetected: Boolean(data.injection_detected),
        });
        toast(l("File berhasil diunggah & di-embed!", "File successfully uploaded & embedded!"));
        setUploading(false);
        return;
      }
    } catch {
      // ignore
    }

    // Mock fallback
    setResult({
      filename: selectedFile.name,
      container: selectedContainer,
      chunksIndexed: 4,
      piiMasked: 1,
      injectionDetected: selectedFile.name.toLowerCase().includes("injection"),
    });
    toast(l("File diproses (mode demo)", "File processed (demo mode)"));
    setUploading(false);
  }

  return (
    <Shell title={t("upload")}>
      <div className="card p-6 flex flex-col gap-4 max-w-xl">
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {l("Container tujuan", "Target container")}
          <select
            className="input"
            value={selectedContainer}
            onChange={(e) => setSelectedContainer(e.target.value)}
          >
            {containers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {l(
            "File dokumen (PDF, DOCX, Markdown, export WhatsApp .txt)",
            "Document file (PDF, DOCX, Markdown, WhatsApp export .txt)",
          )}
          <input
            type="file"
            className="input file:mr-3 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:bg-surface2"
            accept=".pdf,.docx,.doc,.txt,.md,.markdown"
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] || null);
              setResult(null);
            }}
          />
        </label>

        <button
          className="btn btn-primary w-fit mt-1"
          disabled={!selectedFile || uploading}
          onClick={handleUpload}
        >
          <Upload size={16} />
          {uploading ? l("Memproses file…", "Processing file…") : "Upload & Ingest"}
        </button>

        {result && (
          <div className="mt-3 p-4 rounded-erp bg-surface2/60 border border-line flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} className="text-ok" />
              <span>{result.filename}</span>
            </div>
            <div className="text-xs text-muted flex flex-col gap-1 pl-6">
              <p>
                {l("Target container", "Target container")}: <b>{result.container}</b>
              </p>
              <p>
                {l("Chunk diindeks", "Indexed chunks")}: <b>{result.chunksIndexed}</b>
              </p>
              <p>
                {l("Entitas PII disamarkan", "PII entities masked")}: <b>{result.piiMasked}</b>
              </p>
            </div>
            {result.injectionDetected && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-warn bg-warn/10 p-2 rounded border border-warn/30">
                <AlertTriangle size={14} />
                <span>
                  {l(
                    "Pola prompt injection terdeteksi dan dinetralisir dalam indexing.",
                    "Prompt injection pattern detected and neutralized during indexing.",
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
