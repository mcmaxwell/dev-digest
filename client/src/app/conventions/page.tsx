import type { Metadata } from "next";
import { ConventionsView } from "./_components/ConventionsView";

/* Route: /conventions (L02 Conventions extractor). Thin route entry — the view,
   its modal, styles, helpers and i18n are colocated under _components. */
export const metadata: Metadata = {
  title: "Conventions · DevDigest",
};

export default function ConventionsPage() {
  return <ConventionsView />;
}
