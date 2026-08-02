/* Mounts AppShell once for /repos/:repoId/pulls and /repos/:repoId/pulls/:number
   — both pages used to render their own <AppShell>, remounting nav/shortcuts
   on every navigation between the list and a PR's detail. See ShellLayout. */
import { ShellLayout } from "@/components/app-shell";

export default function PullsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
