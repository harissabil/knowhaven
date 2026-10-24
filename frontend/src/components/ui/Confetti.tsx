"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

const COLORS = ["#ff4801", "#ff9910", "#ffdd99", "#ff9fc4", "#1a7f4b", "#2684ff"];

/** One-shot confetti burst. Mount it to fire; unmount to reset. */
export function Confetti({ count = 36 }: { count?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 520,
    y: -80 - Math.random() * 260,
    r: Math.random() * 720 - 360,
    c: COLORS[i % COLORS.length],
    w: 6 + Math.random() * 6,
    d: 0.9 + Math.random() * 0.7,
  })), [count]);
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-50">
      {bits.map((b) => (
        <motion.span
          key={b.id}
          className="absolute rounded-[2px]"
          style={{ width: b.w, height: b.w * 0.5, background: b.c }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 320], opacity: [1, 1, 0], rotate: b.r }}
          transition={{ duration: b.d + 0.8, ease: "easeOut", times: [0, 0.35, 1] }}
        />
      ))}
    </div>
  );
}
