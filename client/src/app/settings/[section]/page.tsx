import type { Metadata } from "next";
import { SettingsView } from "./_components/SettingsView";

/* Route: /settings/:section. Thin route entry — the view, its section panels,
   styles, constants and i18n are colocated under _components/SettingsView. */
export const metadata: Metadata = {
  title: "Settings · DevDigest",
};

export default function SettingsPage() {
  return <SettingsView />;
}
