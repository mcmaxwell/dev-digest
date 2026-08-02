/* Global 404 — rendered when no route matches, or a page calls notFound().
   Styled like src/components/repo-not-found/RepoNotFound.tsx (same EmptyState
   shape), wrapped in the app shell so a mistyped/stale URL still lands
   somewhere navigable instead of a bare page. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function NotFound() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <AppShell crumb={[{ label: t("notFound.title") }]}>
      <EmptyState
        icon="Search"
        title={t("notFound.title")}
        body={t("notFound.body")}
        cta={t("notFound.cta")}
        onCta={() => router.push("/")}
      />
    </AppShell>
  );
}
