"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";
import { useL } from "@/lib/i18n";

export default function Join() {
  const { token } = useParams<{ token: string }>();
  const l = useL();
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card p-6 max-w-md flex flex-col items-center gap-3 text-center">
        <Mascot state="celebrate" size={110} />
        <SpeechBubble>
          {l("Anda diundang bergabung ke ", "You're invited to join ")}<b>PT Sinar Rantai Nusantara</b>
          {l(" sebagai ", " as ")}<b>{l("Karyawan Baru", "New Hire")}</b>.
        </SpeechBubble>
        <p className="text-xs text-muted font-mono">{l("undangan", "invite")}: {token}</p>
        <Link className="btn btn-primary" href="/login">{l("Masuk / daftar untuk bergabung", "Sign in / sign up to join")}</Link>
      </div>
    </div>
  );
}
