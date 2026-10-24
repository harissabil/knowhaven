"use client";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef } from "react";

export type MascotState =
  | "idle" | "listening" | "thinking" | "answering" | "idk"
  | "refusing" | "conflict" | "waiting" | "celebrate";

const MOUTH: Record<MascotState, string> = {
  idle: "M44 66 Q60 76 76 66",
  listening: "M52 68 Q60 72 68 68",
  thinking: "M52 70 L68 70",
  answering: "M42 64 Q60 84 78 64",
  idk: "M48 72 Q60 66 72 72",
  refusing: "M50 70 L70 70",
  conflict: "M48 72 Q60 66 72 72",
  waiting: "M52 70 Q60 74 68 70",
  celebrate: "M40 62 Q60 90 80 62 Z",
};

/** Original SVG mascot "Havi": a friendly brain wearing a little house-roof cap (know + haven). */
export function Mascot({ state = "idle", size = 96 }: { state?: MascotState; size?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const ex = useSpring(mx, { stiffness: 180, damping: 18 }), ey = useSpring(my, { stiffness: 180, damping: 18 });
  // eyes follow the cursor (clamped), skipped for tiny avatars
  useEffect(() => {
    if (size < 40) return;
    const h = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 220) * 3.2;
      mx.set((dx / d) * k); my.set((dy / d) * k);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, [size, mx, my]);
  const bob = state === "thinking" ? { y: [0, -3, 0], rotate: [-3, 3, -3] }
    : state === "celebrate" ? { y: [0, -14, 0] }
    : { y: [0, -4, 0] };
  return (
    <motion.svg
      ref={ref} viewBox="0 0 120 120" width={size} height={size} role="img"
      aria-label={`Havi, Knowhaven mascot (${state})`}
      animate={bob}
      transition={{ duration: state === "celebrate" ? 0.6 : 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* brain body */}
      <path d="M22 62 C14 40 34 24 50 30 C58 20 78 22 84 34 C104 34 110 58 98 70 C102 90 80 100 66 94 C54 102 30 98 28 82 C20 80 18 70 22 62Z"
        fill="#ff9fc4" stroke="#c2417a" strokeWidth="3" />
      <path d="M60 34 C56 48 64 56 58 70 M40 50 C46 52 48 58 44 62 M82 50 C76 52 74 58 78 62"
        fill="none" stroke="#c2417a" strokeWidth="2.5" strokeLinecap="round" />
      {/* house-roof cap: the "haven" */}
      <rect x="78" y="8" width="8" height="14" rx="1.5" fill="#92400e" stroke="#78350f" strokeWidth="2" />
      <path d="M26 38 L60 8 L94 38 Z" fill="#f59e0b" stroke="#b45309" strokeWidth="3" strokeLinejoin="round" />
      <rect x="22" y="36" width="76" height="6" rx="3" fill="#fbbf24" stroke="#b45309" strokeWidth="2.5" />
      <motion.rect x="55" y="22" width="10" height="9" rx="1.5" stroke="#b45309" strokeWidth="1.5"
        fill={state === "thinking" ? "#fef08a" : "#fff7d6"}
        animate={state === "thinking" ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
        transition={{ duration: 1.2, repeat: Infinity }} />
      {/* eyes */}
      <motion.g style={{ x: ex, y: ey }}>
      <g fill="#172033">
        <motion.ellipse cx="46" cy="56" rx="6" ry="7.5"
          animate={{ scaleY: state === "idk" ? 1 : [1, 1, 0.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }} style={{ originY: "56px" }} />
        <motion.ellipse cx="74" cy="56" rx="6" ry="7.5"
          animate={{ scaleY: [1, 1, 0.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }} style={{ originY: "56px" }} />
      </g>
      <circle cx="48" cy="53" r="2" fill="#fff" /><circle cx="76" cy="53" r="2" fill="#fff" />
      </motion.g>
      {/* cheeks + mouth */}
      <circle cx="36" cy="66" r="4" fill="#ff6b9a" opacity=".5" /><circle cx="84" cy="66" r="4" fill="#ff6b9a" opacity=".5" />
      <path d={MOUTH[state]} fill={state === "celebrate" ? "#7f1d1d" : "none"} stroke="#172033" strokeWidth="3" strokeLinecap="round" />
      {/* state props */}
      {state === "thinking" && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} style={{ originX: "60px", originY: "60px" }}>
          <circle cx="104" cy="60" r="4" fill="#6d4aff" /><circle cx="16" cy="60" r="3" fill="#22c55e" />
        </motion.g>
      )}
      {state === "refusing" && <path d="M96 78 l14 4 v12 c0 8 -8 12 -14 14 c-6 -2 -14 -6 -14 -14 v-12z" fill="#1d4ed8" stroke="#fff" strokeWidth="2" />}
      {state === "conflict" && <g><text x="6" y="22" fontSize="16">⚖️</text></g>}
      {state === "waiting" && <text x="92" y="30" fontSize="18">⏳</text>}
      {state === "idk" && <text x="92" y="30" fontSize="20">🤷</text>}
      {state === "celebrate" && <text x="4" y="24" fontSize="20">🎉</text>}
    </motion.svg>
  );
}

export function SpeechBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="card relative px-3 py-2 text-sm" style={{ borderRadius: "var(--radius)" }}>
      {children}
    </div>
  );
}
