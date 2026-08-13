/* Add-repository route — /repos/new. Thin wrapper; the screen lives in
   _components/AddRepoView. Server entry (no "use client") so it can export
   metadata.

   It used to live at /onboarding. That name now belongs to the repo-scoped
   Onboarding Tour (/repos/:repoId/onboarding), which is a prominent nav item —
   and `activeKeyFor` maps any path containing that segment to the tour's nav
   key, so leaving the add-repository screen there would highlight the wrong
   item. `/repos/new` is a STATIC segment and takes precedence over the sibling
   `[repoId]` dynamic one. */
import type { Metadata } from "next";
import { AddRepoView } from "./_components/AddRepoView";

export const metadata: Metadata = {
  title: "Add repository · DevDigest",
};

export default function AddRepoPage() {
  return <AddRepoView />;
}
