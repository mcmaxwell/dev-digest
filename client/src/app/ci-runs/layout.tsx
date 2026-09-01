/* Mounts AppShell once for /ci-runs (see ShellLayout). */
import { ShellLayout } from "@/components/app-shell";

export default function CiRunsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
