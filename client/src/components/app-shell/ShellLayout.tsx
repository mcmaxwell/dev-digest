/* ShellLayout — mounts <AppShell> once for a route segment (nav, command
   palette, g-then-key shortcuts persist across navigations within it) instead
   of every page under it remounting its own AppShell. Segment layout.tsx
   files render this directly; pages call useSetCrumb(crumb) instead of
   rendering <AppShell crumb={...}> themselves. */
"use client";

import React from "react";
import { AppShell } from "./AppShell";
import { CrumbProvider, useShellCrumb } from "@/lib/shell-crumb";

function ShellWithCrumb({ children }: { children: React.ReactNode }) {
  const crumb = useShellCrumb();
  return <AppShell crumb={crumb}>{children}</AppShell>;
}

export function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <CrumbProvider>
      <ShellWithCrumb>{children}</ShellWithCrumb>
    </CrumbProvider>
  );
}
