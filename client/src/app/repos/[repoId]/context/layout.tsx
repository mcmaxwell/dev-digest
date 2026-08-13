/* Mounts AppShell once for /repos/:repoId/context, the same way the sibling
   `pulls/` segment does — a page that renders its own <AppShell> remounts the
   nav and re-registers its shortcut listeners on every navigation. */
import { ShellLayout } from "@/components/app-shell";

export default function ContextLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
