/* Add-repository route — /onboarding. Thin wrapper; the screen lives in
   _components/AddRepoView. Server entry (no "use client") so it can export
   metadata. */
import type { Metadata } from "next";
import { AddRepoView } from "./_components/AddRepoView";

export const metadata: Metadata = {
  title: "Add repository · DevDigest",
};

export default function AddRepoPage() {
  return <AddRepoView />;
}
