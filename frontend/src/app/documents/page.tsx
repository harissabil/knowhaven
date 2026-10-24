"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Folder, FolderLock, FolderOpen, Lock, MessageCircle, RefreshCw, Search, ShieldAlert, Upload, X } from "lucide-react";
import { FileIcon, Readers, nobodyCanRead, relTime } from "@/components/documents";
import { Shell } from "@/components/Shell";
import { useL, useT } from "@/lib/i18n";
import { useSession, usePersona } from "@/store/session";
import { can } from "@/lib/permissions";
import { apiFetch, errorText } from "@/lib/api";
import type { DocumentOut, FolderOut, UploadOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

export default function Documents() {
  const t = useT();
  const l = useL();
  const router = useRouter();
  const lang = useSession((s) => s.lang);
  const { roles } = usePersona();
  const isAdmin = can(roles, "admin");
  const [folders, setFolders] = useState<FolderOut[]>([]);
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [current, setCurrent] = useState<string | null>(null); // folder id; null = all
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [fs, ds] = await Promise.all([
        apiFetch<FolderOut[]>("/api/documents/folders"),
        apiFetch<DocumentOut[]>("/api/documents"),
      ]);
      setFolders(fs);
      setDocs(ds);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const folder = folders.find((f) => f.id === current);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => (!current || d.folder_id === current)
      && (!needle || `${d.title ?? ""} ${d.filename} ${d.folder_name}`.toLowerCase().includes(needle)));
  }, [docs, current, q]);
  const uploadTargets = folders.filter((f) => f.can_upload && f.source === "upload_folder");

  return (
    <Shell title={t("documents")}>
      <div className="grid md:grid-cols-[240px_1fr] gap-5 items-start">
        {/* folder tree */}
        <nav aria-label={l("Folder", "Folders")} className="card p-2 flex flex-col gap-0.5 md:sticky md:top-20">
          <button onClick={() => setCurrent(null)}
            className={`flex items-center gap-2 px-3 py-2 rounded-erp text-sm text-left ${current === null ? "bg-tint text-brand font-medium" : "hover:bg-surface2"}`}>
            <FolderOpen size={16} /> <span className="flex-1">{l("Semua dokumen", "All documents")}</span>
            <span className="text-xs text-muted">{docs.length}</span>
          </button>
          {folders.map((f) => {
            const nobody = nobodyCanRead(f);
            return (
              <button key={f.id} onClick={() => setCurrent(f.id)} title={nobody ? l("Belum bisa dibaca siapa pun", "Nobody can read this yet") : f.role_names.join(", ")}
                className={`flex items-center gap-2 px-3 py-2 rounded-erp text-sm text-left ${current === f.id ? "bg-tint text-brand font-medium" : "hover:bg-surface2"}`}>
                {nobody ? <FolderLock size={16} className="text-bad shrink-0" /> : f.source === "whatsapp_group" ? <MessageCircle size={16} className="shrink-0" /> : <Folder size={16} className="shrink-0" />}
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted">{f.document_count}</span>
              </button>
            );
          })}
          {!loading && folders.length === 0 && <p className="text-xs text-muted px-3 py-2">{l("Belum ada folder yang bisa Anda lihat.", "No folders you can see yet.")}</p>}
        </nav>

        <section className="flex flex-col gap-3 min-w-0">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm flex items-center gap-1 flex-1 min-w-0">
              <button className="hover:underline" onClick={() => setCurrent(null)}>{t("documents")}</button>
              {folder && <><ChevronRight size={14} className="text-muted" /><b className="truncate">{folder.name}</b></>}
            </p>
            <label className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input !pl-8 !py-1.5 !w-56" value={q} onChange={(e) => setQ(e.target.value)} placeholder={l("Cari dokumen…", "Search documents…")} />
            </label>
            <button className="btn !py-1.5" onClick={load} disabled={loading} aria-label={l("Segarkan", "Refresh")}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            {uploadTargets.length > 0 && (
              <button className="btn btn-primary !py-1.5" onClick={() => setUploadOpen(true)}><Upload size={15} /> {l("Unggah", "Upload")}</button>
            )}
          </div>

          {folder && (
            <div className={`text-sm p-3 rounded-erp border flex items-center gap-2 flex-wrap ${nobodyCanRead(folder) ? "border-bad/40 bg-bad/5" : "border-line bg-surface2/50"}`}>
              <Readers folder={folder} />
              {nobodyCanRead(folder) && (
                <span className="text-muted">
                  {l("Dokumen di sini tidak muncul di jawaban siapa pun sampai folder diberi peran.", "Documents here won't appear in anyone's answers until the folder is given roles.")}
                  {isAdmin && <> <Link className="underline text-fg" href="/admin/containers">{l("Atur akses", "Set access")}</Link></>}
                </span>
              )}
            </div>
          )}
          {err && <p role="alert" className="text-bad text-sm">{err}</p>}

          {/* file list */}
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_130px_120px] gap-3 px-4 py-2 bg-surface2 text-xs text-muted font-medium">
              <span>{l("Nama", "Name")}</span>
              <span className="hidden md:block">{l("Folder", "Folder")}</span>
              <span className="hidden md:block">{l("Diunggah oleh", "Uploaded by")}</span>
              <span className="text-right">{l("Diperbarui", "Updated")}</span>
            </div>
            {shown.map((d) => (
              <button key={d.id} onClick={() => router.push(`/documents/${encodeURIComponent(d.id)}`)}
                className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_130px_120px] gap-3 px-4 py-3 border-t border-line hover:bg-surface2/60 items-center">
                <span className="flex items-center gap-2.5 min-w-0">
                  <FileIcon filename={d.filename} />
                  <span className="min-w-0">
                    <span className="font-medium truncate block">{d.title || d.filename}</span>
                    <span className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{d.filename}</span>
                      {d.revisions > 1 && <span className="px-1.5 rounded border border-line2 font-mono">v{d.revisions}</span>}
                      {!d.can_read && <span className="inline-flex items-center gap-0.5"><Lock size={11} /> {l("isi terkunci", "content locked")}</span>}
                      {d.has_pii && <span className="inline-flex items-center gap-0.5 text-warn"><ShieldAlert size={11} /> PII</span>}
                      {d.injection_flag && <span className="inline-flex items-center gap-0.5 text-warn"><AlertTriangle size={11} /> {l("instruksi tersembunyi", "hidden instructions")}</span>}
                    </span>
                  </span>
                </span>
                <span className="hidden md:block text-sm truncate text-muted">{d.folder_name}</span>
                <span className="hidden md:block text-sm truncate text-muted">{d.uploaded_by ?? "—"}</span>
                <span className="text-sm text-muted text-right whitespace-nowrap" title={new Date(d.updated_at).toLocaleString()}>{relTime(d.updated_at, lang)}</span>
              </button>
            ))}
            {!loading && shown.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted border-t border-line">
                {q ? l("Tidak ada dokumen yang cocok.", "No matching documents.") : l("Belum ada dokumen di sini.", "No documents here yet.")}
              </p>
            )}
          </div>
        </section>
      </div>

      {uploadOpen && (
        <UploadDialog folders={uploadTargets} initial={folder?.can_upload ? folder.id : uploadTargets[0]?.id}
          onClose={() => setUploadOpen(false)} onDone={async () => { setUploadOpen(false); await load(); }} />
      )}
    </Shell>
  );
}

function UploadDialog({ folders, initial, onClose, onDone }: { folders: FolderOut[]; initial?: string; onClose: () => void; onDone: () => void }) {
  const l = useL();
  const [folderId, setFolderId] = useState(initial ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const target = folders.find((f) => f.id === folderId);

  async function submit() {
    if (!file || !folderId) return;
    setBusy(true);
    setErr("");
    const form = new FormData();
    form.append("container_id", folderId);
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    try {
      const r = await apiFetch<UploadOut>("/api/uploads", { method: "POST", body: form });
      toast(r.updated ? l("Versi baru disimpan", "New version saved") : l("Dokumen diunggah dan diindeks", "Document uploaded and indexed"));
      onDone();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={l("Unggah dokumen", "Upload document")} className="card p-5 w-full max-w-md flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center"><h2 className="font-semibold flex-1">{l("Unggah dokumen", "Upload document")}</h2>
          <button className="btn !p-1.5" onClick={onClose} aria-label="close"><X size={16} /></button></div>
        <label className="field">{l("Folder", "Folder")}
          <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        {target && <p className="text-xs"><Readers folder={target} /></p>}
        <label className="field">{l("Judul (opsional)", "Title (optional)")}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="button" onClick={() => input.current?.click()}
          className="border-2 border-dashed border-line2 rounded-erp p-6 text-sm text-muted hover:border-brand hover:text-fg flex flex-col items-center gap-1"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files?.[0] ?? null); }}>
          <Upload size={20} />
          {file ? <b className="text-fg">{file.name}</b> : l("Pilih atau seret file (PDF, DOCX, Markdown)", "Choose or drop a file (PDF, DOCX, Markdown)")}
        </button>
        <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="text-xs text-muted">{l("File dengan nama sama di folder yang sama disimpan sebagai versi baru.", "A file with the same name in the same folder is saved as a new version.")}</p>
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>{l("Batal", "Cancel")}</button>
          <button className="btn btn-primary" onClick={submit} disabled={!file || !folderId || busy}>{busy ? l("Mengunggah…", "Uploading…") : l("Unggah", "Upload")}</button>
        </div>
      </div>
    </div>
  );
}
