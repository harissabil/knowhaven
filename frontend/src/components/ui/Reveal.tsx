"use client";
import { motion, useReducedMotion } from "framer-motion";

/** Fade-up on scroll into view. `delay` staggers siblings. */
export function Reveal({ children, delay = 0, y = 24, className }: {
  children: React.ReactNode; delay?: number; y?: number; className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  );
}
