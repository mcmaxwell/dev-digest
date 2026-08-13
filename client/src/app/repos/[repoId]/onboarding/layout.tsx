/* Mounts AppShell once for /repos/:repoId/onboarding, the same way the sibling
   `context/` and `pulls/` segments do — a page that renders its own <AppShell>
   remounts the nav and re-registers its shortcut listeners on every
   navigation. */
import { ShellLayout } from "@/components/app-shell";

export default function OnboardingTourLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
