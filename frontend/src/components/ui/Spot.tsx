"use client";

/** Card with a cursor-following orange glow (see .spot in globals.css). */
export function Spot({ children, className = "", as: Tag = "div" }: {
  children: React.ReactNode; className?: string; as?: "div" | "li" | "article";
}) {
  return (
    <Tag
      className={`spot ${className}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      <div className="relative z-[1] h-full">{children}</div>
    </Tag>
  );
}
