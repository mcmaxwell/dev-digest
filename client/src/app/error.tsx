/* Route-level error boundary — catches render/render-time errors thrown by
   any page under the root layout. The root layout itself (providers, theme,
   NextIntlClientProvider) keeps rendering around this, so translations and
   design tokens are still available. Root-layout-level failures instead hit
   global-error.tsx, which cannot rely on any of that. */
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
     
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <ErrorState fullScreen title={t("errorPage.title")} body={t("errorPage.body")} onRetry={reset} />
    </div>
  );
}
