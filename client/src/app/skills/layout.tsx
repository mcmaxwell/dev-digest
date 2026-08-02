/* Mounts AppShell once for /skills (see ShellLayout). */
import { ShellLayout } from "@/components/app-shell";

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
