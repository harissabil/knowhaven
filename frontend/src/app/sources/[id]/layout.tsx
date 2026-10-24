import { Suspense } from "react";

export default function L({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
