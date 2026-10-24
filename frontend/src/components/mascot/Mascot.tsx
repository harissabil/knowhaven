"use client";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useId, useRef } from "react";

export type MascotState =
  | "idle"
  | "listening"
  | "thinking"
  | "answering"
  | "idk"
  | "refusing"
  | "conflict"
  | "waiting"
  | "celebrate";

const STATE_COLOR: Record<MascotState, string> = {
  idle: "#38bdf8",
  listening: "#38bdf8",
  thinking: "#60a5fa",
  answering: "#34d399",
  idk: "#94a3b8",
  refusing: "#f87171",
  conflict: "#fbbf24",
  waiting: "#38bdf8",
  celebrate: "#38bdf8",
};

/**
 * Havi — Minimalist geometric visor companion.
 * Clean squircle silhouette, obsidian visor, and expressive LED eyes (no antennas, ear pods, mouths, or corner badges).
 */
export function Mascot({ state = "idle", size = 96 }: { state?: MascotState; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const ex = useSpring(mx, { stiffness: 180, damping: 22 });
  const ey = useSpring(my, { stiffness: 180, damping: 22 });

  const interactive = size > 44;

  useEffect(() => {
    if (!interactive) {
      mx.set(0);
      my.set(0);
      return;
    }
    const h = (e: MouseEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 240) * 3.8;
      mx.set((dx / d) * k);
      my.set((dy / d) * k);
    };
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, [interactive, mx, my]);

  const led = STATE_COLOR[state];

  const bob =
    !interactive && state === "idle"
      ? undefined
      : state === "celebrate"
        ? { y: [0, -6, 0] }
        : { y: [0, -2.5, 0] };

  return (
    <motion.svg
      ref={ref}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`Havi, Knowhaven mascot (${state})`}
      animate={bob}
      transition={
        bob
          ? { duration: state === "celebrate" ? 0.7 : 3.2, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
      className="shrink-0 select-none"
    >
      <defs>
        <linearGradient id={`body-${uid}`} x1="20" y1="18" x2="100" y2="102" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e8f1fa" />
        </linearGradient>
        <linearGradient id={`visor-${uid}`} x1="28" y1="36" x2="92" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#090d16" />
        </linearGradient>
      </defs>

      {/* Clean outer squircle shell */}
      <rect
        x="18"
        y="18"
        width="84"
        height="84"
        rx="28"
        fill={`url(#body-${uid})`}
        stroke="#cbd5e1"
        strokeWidth="1.75"
      />

      {/* Minimal top status pill (Knowhaven accent) */}
      <rect x="51" y="26" width="18" height="3.5" rx="1.75" fill={led} opacity="0.9" />

      {/* Obsidian glass visor */}
      <rect
        x="28"
        y="36"
        width="64"
        height="48"
        rx="18"
        fill={`url(#visor-${uid})`}
      />

      {/* Subtle glass reflection */}
      <path
        d="M38 42 H62"
        stroke="#ffffff"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.14"
      />

      {/* Minimalist LED eyes inside the visor */}
      <motion.g style={{ x: ex, y: ey }}>
        {state === "thinking" ? (
          /* Three clean pulsing nodes */
          <g fill={led}>
            {[46, 60, 74].map((cx, i) => (
              <motion.circle
                key={cx}
                cx={cx}
                cy="60"
                r="4"
                animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.1, 0.85] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </g>
        ) : state === "answering" || state === "celebrate" ? (
          /* Clean upward chevron/arc eyes */
          <g fill="none" stroke={led} strokeWidth="3.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M40 62 Q46 53 52 62" />
            <path d="M68 62 Q74 53 80 62" />
          </g>
        ) : state === "refusing" ? (
          /* Guarded horizontal bar eyes */
          <g fill={led}>
            <rect x="39" y="57.5" width="14" height="5" rx="2.5" />
            <rect x="67" y="57.5" width="14" height="5" rx="2.5" />
          </g>
        ) : state === "conflict" ? (
          /* Weighing two sides: slightly offset heights */
          <g fill={led}>
            <rect x="41" y="55" width="10" height="12" rx="5" />
            <rect x="69" y="51" width="10" height="12" rx="5" />
          </g>
        ) : state === "idk" ? (
          /* Curious asymmetric eyes */
          <g fill={led}>
            <rect x="41" y="56" width="10" height="9" rx="4.5" />
            <rect x="69" y="51" width="10" height="15" rx="5" />
          </g>
        ) : (
          /* Default / listening / waiting: two clean vertical pill LEDs */
          <g fill={led}>
            <motion.rect
              x="41"
              y="52"
              width="10"
              height="16"
              rx="5"
              animate={interactive ? { scaleY: [1, 1, 0.1, 1] } : undefined}
              transition={{ duration: 4.2, repeat: Infinity, times: [0, 0.93, 0.96, 1] }}
              style={{ originY: "60px" }}
            />
            <motion.rect
              x="69"
              y="52"
              width="10"
              height="16"
              rx="5"
              animate={interactive ? { scaleY: [1, 1, 0.1, 1] } : undefined}
              transition={{ duration: 4.2, repeat: Infinity, times: [0, 0.93, 0.96, 1] }}
              style={{ originY: "60px" }}
            />
          </g>
        )}
      </motion.g>
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
