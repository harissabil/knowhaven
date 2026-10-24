"use client";
import { useEffect } from "react";
import { useSession } from "@/store/session";

/** Applies theme and font scale to <html> on every page (login, onboarding, landing included). */
export function ThemeSync() {
  const theme = useSession((s) => s.theme);
  const fontScale = useSession((s) => s.fontScale);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.fontSize = `calc(15px * ${fontScale})`;
  }, [theme, fontScale]);
  return null;
}
