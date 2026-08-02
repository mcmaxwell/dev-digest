/* Mounts AppShell once for /settings/:section — kept consistent with the
   pulls/ and agents/ segments even though settings has a single dynamic page
   today, so a future section doesn't have to remember to add this. See
   ShellLayout. */
import { ShellLayout } from "@/components/app-shell";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <ShellLayout>{children}</ShellLayout>;
}
