/* Mounts AppShell once for /agents and /agents/:id — both pages used to
   render their own <AppShell>, remounting nav/shortcuts on every navigation
   between the list and an agent's editor. See ShellLayout. */
import { ShellLayout } from "@/components/app-shell";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
