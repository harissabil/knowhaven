"use client";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

interface T { id: number; text: string }
const useToasts = create<{ list: T[]; push: (text: string) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (text) => {
    const id = Date.now() + Math.random();
    set((s) => ({ list: [...s.list, { id, text }] }));
    setTimeout(() => set((s) => ({ list: s.list.filter((t) => t.id !== id) })), 3200);
  },
  drop: (id) => set((s) => ({ list: s.list.filter((t) => t.id !== id) })),
}));

export const toast = (text: string) => useToasts.getState().push(text);

export function ToastHost() {
  const list = useToasts((s) => s.list);
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center" role="status" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="card flex items-center gap-2 px-4 py-2.5 !rounded-full">
            <span className="w-5 h-5 rounded-full bg-ok text-brandfg grid place-items-center"><Check size={12} /></span>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
