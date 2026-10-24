"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";
import { useL } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { ApiError, apiFetch, errorText } from "@/lib/api";

export default function Join() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const l = useL();
  const { currentUser, syncMe } = useSession();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const next = encodeURIComponent(`/join/${token}`);

  useEffect(() => { syncMe().finally(() => setChecked(true)); }, [syncMe]);

  async function accept() {
    setBusy(true);
    setErr("");
    try {
      const res = await apiFetch<{ tenant_id: string; tenant_name: string; status: string }>(`/api/join/${encodeURIComponent(token)}`, { method: "POST" });
      await syncMe();
      router.push(res.status === "pending" ? "/pending" : "/chat");
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 404
        ? l("Undangan tidak valid, sudah dipakai, atau kedaluwarsa.", "This invite is invalid, used up, or expired.")
        : errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card p-6 max-w-md flex flex-col items-center gap-3 text-center">
        <Mascot state={err ? "idk" : "celebrate"} size={110} />
        <SpeechBubble>
          {l("Anda diundang bergabung ke sebuah perusahaan di Knowhaven.", "You're invited to join a company on Knowhaven.")}
        </SpeechBubble>
        {err && <p role="alert" className="text-bad text-sm">{err}</p>}
        {!checked ? null : currentUser ? (
          <>
            <p className="text-sm text-muted">{l("Masuk sebagai", "Signed in as")} <b>{currentUser.email}</b></p>
            <button className="btn btn-primary" onClick={accept} disabled={busy}>
              {busy ? l("Bergabung…", "Joining…") : l("Terima undangan", "Accept invite")}
            </button>
          </>
        ) : (
          <div className="flex gap-2">
            <Link className="btn btn-primary" href={`/login?next=${next}`}>{l("Masuk", "Sign in")}</Link>
            <Link className="btn" href={`/onboarding?next=${next}`}>{l("Daftar", "Sign up")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
