"use client";
import { Shell } from "@/components/Shell";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";
import { useL } from "@/lib/i18n";

export default function Pending() {
  const l = useL();
  return (
    <Shell title={l("Menunggu persetujuan admin", "Waiting for admin approval")}>
      <div className="flex flex-col items-center gap-3 mt-10">
        <Mascot state="waiting" size={140} />
        <SpeechBubble>{l("Permintaan Anda sedang ditinjau admin. Anda belum bisa melihat data apa pun sampai disetujui.",
          "Your request is being reviewed by an admin. You can't see any data until it's approved.")}</SpeechBubble>
      </div>
    </Shell>
  );
}
