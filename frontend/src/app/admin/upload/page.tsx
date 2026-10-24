"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Shell } from "@/components/Shell";
import { CONTAINERS } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";

export default function UploadPage() {
  const t = useT();
  const l = useL();
  const [file, setFile] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Shell title={t("upload")}>
      <div className="card p-4 flex flex-col gap-3 max-w-xl">
        <label className="flex flex-col gap-1">{l("Container tujuan", "Target container")}
          <select className="input">{CONTAINERS.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
        <label className="flex flex-col gap-1">{l("File (PDF, DOCX, MD, export WhatsApp .txt)", "File (PDF, DOCX, MD, WhatsApp export .txt)")}
          <input type="file" className="input" onChange={(e) => { setFile(e.target.files?.[0]?.name ?? ""); setDone(false); }} /></label>
        <button className="btn btn-primary w-fit" disabled={!file} onClick={() => setDone(true)}><Upload size={16} /> Upload</button>
        {done && <p className="text-ok">{file} {l("diproses: PII dimasking, injeksi dicek, di-embed.", "processed: PII masked, injection checked, embedded.")}</p>}
      </div>
    </Shell>
  );
}
