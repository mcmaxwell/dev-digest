/* Mounts AppShell once for /eval (see ShellLayout). */
import { ShellLayout } from "@/components/app-shell";

export default function EvalLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
