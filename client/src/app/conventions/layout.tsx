/* Mounts AppShell once for /conventions (see ShellLayout). */
import { ShellLayout } from "@/components/app-shell";

export default function ConventionsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
