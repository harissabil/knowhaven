"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Download, Lock, MessageSquare, ShieldAlert, Trash2, Upload, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot } from "@/components/mascot/Mascot";
import { FileIcon, Readers, relTime } from "@/components/documents";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import type { DocumentOut, FolderOut, SourceOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const docId = decodeURIComponent(id || "");
  const t = useT();
  const l = useL();
  const router = useRouter();
  const lang = useSession((s) => s.lang);
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const [folder, setFolder] = useState<FolderOut | undefined>();
  const [source, setSource] = useState<SourceOut | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<DocumentOut>(`/api/documents/${encodeURIComponent(docId)}`);
      setDoc(d);
      const [folders, src, orig] = await Promise.all([
        apiFetch<FolderOut[]>("/api/documents/folders"),
        d.can_read ? apiFetch<SourceOut>(`/api/sources/${encodeURIComponent(docId)}`) : Promise.resolve(null),
        d.can_download ? apiFetch<{ url: string }>(`/api/documents/${encodeURIComponent(docId)}/original`) : Promise.resolve(null),
      ]);
      setFolder(folders.find((f) => f.id === d.folder_id));
      setSource(src);
      setOriginal(orig?.url ?? null);
      setState("ok");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState("missing");
      else { setErr(errorText(e)); setState("error"); }
    }
  }, [docId]);
  useEffect(() => { if (docId) load(); }, [docId, load]);

  async function newVersion(file: File) {
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const d = await apiFetch<DocumentOut>(`/api/documents/${encodeURIComponent(docId)}/file`, { method: "PUT", body: form });
      toast(l(`Versi ${d.revisions} disimpan dan diindeks ulang`, `Version ${d.revisions} saved and re-indexed`));
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(`/api/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
      toast(l("Dokumen dihapus dari pencarian dan jawaban", "Document removed from search and answers"));
      router.push("/documents");
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const isPdf = doc?.filename.toLowerCase().endsWith(".pdf");

  return (
    <Shell title={t("documents")}>
      {state === "loading" && <p className="text-muted animate-pulse">{l("Memeriksa izin dan memuat dokumen…", "Checking permissions and loading the document…")}</p>}
      {state === "error" && <p role="alert" className="text-bad">{err}</p>}
      {state === "missing" && (
        <div className="flex items-center gap-4 py-8">
          <Mascot state="idk" size={64} />
          <div>
            <p className="font-semibold text-lg">{l("Dokumen tidak ditemukan.", "Document not found.")}</p>
            <p className="text-sm text-muted">{l("Dokumen mungkin tidak ada, sudah dihapus, atau di luar akses peran Anda.", "It may not exist, may have been deleted, or is outside your roles' access.")}</p>
            <Link className="btn mt-3" href="/documents">{l("Kembali ke Dokumen", "Back to Documents")}</Link>
          </div>
        </div>
      )}

      {state === "ok" && doc && (
        <div className="flex flex-col gap-4">
          <p className="text-sm flex items-center gap-1 text-muted">
            <Link className="hover:underline" href="/documents">{t("documents")}</Link>
            <ChevronRight size={14} /> <span>{doc.folder_name}</span>
          </p>

          <div className="card p-5 flex flex-wrap items-start gap-4">
            <FileIcon filename={doc.filename} size={34} />
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight break-words">{doc.title || doc.filename}</h2>
              <p className="text-sm text-muted flex flex-wrap gap-x-3 gap-y-1 mt-1">
                <span className="font-mono">{doc.filename}</span>
                <span>v{doc.revisions}</span>
                <span title={new Date(doc.updated_at).toLocaleString()}>{l("Diperbarui", "Updated")} {relTime(doc.updated_at, lang)}</span>
                {doc.uploaded_by && <span>{l("oleh", "by")} {doc.uploaded_by}</span>}
                <span>{doc.chunk_count} {l("bagian terindeks", "indexed sections")}</span>
                <span className="font-mono">{doc.id}</span>
              </p>
              <p className="text-sm mt-2"><Readers folder={folder} /></p>
            </div>
            <div className="flex flex-wrap gap-2">
              {doc.can_read && (
                <Link className="btn" href={`/chat?q=${encodeURIComponent(lang === "id" ? `Ringkas dokumen "${doc.title || doc.filename}"` : `Summarize the document "${doc.title || doc.filename}"`)}`}>
                  <MessageSquare size={15} /> {l("Tanya Havi", "Ask Havi")}
                </Link>
              )}
              {original && <a className="btn" href={original} target="_blank" rel="noreferrer"><Download size={15} /> {l("Unduh asli", "Download original")}</a>}
              {doc.can_manage && (
                <>
                  <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} /> {l("Versi baru", "New version")}</button>
                  <button className="btn text-bad" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> {l("Hapus", "Delete")}</button>
                  <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.md,.markdown"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) newVersion(f); }} />
                </>
              )}
            </div>
          </div>

          {doc.injection_flag && (
            <p className="text-sm p-3 rounded-erp border border-warn/40 bg-warn/10 text-warn flex items-center gap-2">
              <AlertTriangle size={15} /> {l("Dokumen ini berisi teks mirip instruksi untuk AI. Isinya diperlakukan sebagai data, tidak pernah dijalankan.", "This document contains instruction-like text aimed at the AI. It is treated as data and never followed.")}
            </p>
          )}

          {!doc.can_read ? (
            <div className="card p-6 flex items-center gap-3 text-muted">
              <Lock size={20} />
              {l("Peran Anda tidak bisa membaca isi dokumen ini. Admin bisa mengelola file, tetapi isi hanya terbuka untuk peran yang diberi akses ke foldernya.",
                "Your roles can't read this document's content. Admins can manage files, but content is only open to roles given access to its folder.")}
            </div>
          ) : (
            <div className={`grid gap-4 ${original && isPdf ? "lg:grid-cols-2" : ""}`}>
              {original && isPdf && (
                <iframe title={doc.filename} src={original} className="card w-full h-[75vh] bg-surface2" />
              )}
              <div className="card p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold flex-1">{l("Teks yang diindeks", "Indexed text")}</h3>
                  {doc.has_pii && !doc.can_download && (
                    <span className="text-xs text-warn inline-flex items-center gap-1" title={l("File asli memuat jenis data pribadi yang dibatasi untuk peran Anda. Jenis data pribadi yang diizinkan tetap ditampilkan pada teks di bawah.", "The original file contains personal data types restricted for your roles. Permitted personal data types remain visible in the text below.")}>
                      <ShieldAlert size={13} /> {l("Sebagian data pribadi disamarkan sesuai izin; file asli tidak tersedia", "Restricted personal data masked per role permissions; original not available")}
                    </span>
                  )}
                </div>
                {source?.chunks.map((c) => (
                  <div key={c.citation_id} className="p-3 rounded-erp bg-surface2/60 border border-line whitespace-pre-wrap text-[0.95rem] leading-relaxed">
                    {c.anchor && <p className="eyebrow mb-1">{c.anchor} · <span className="font-mono normal-case">{c.citation_id}</span></p>}
                    {c.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {confirmDelete && doc && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setConfirmDelete(false)}>
          <div role="alertdialog" aria-modal="true" className="card p-5 max-w-md w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center"><h2 className="font-semibold flex-1">{l("Hapus dokumen?", "Delete document?")}</h2>
              <button className="btn !p-1.5" onClick={() => setConfirmDelete(false)} aria-label="close"><X size={16} /></button></div>
            <p className="text-sm text-muted">
              {l(`"${doc.title || doc.filename}" akan hilang dari pencarian dan jawaban, dan file aslinya dihapus. Catatan audit tetap disimpan.`,
                `"${doc.title || doc.filename}" will disappear from search and answers, and the original file is deleted. The audit record is kept.`)}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmDelete(false)}>{l("Batal", "Cancel")}</button>
              <button className="btn btn-primary !bg-bad !border-bad" disabled={busy} onClick={remove}><Trash2 size={15} /> {l("Hapus", "Delete")}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
