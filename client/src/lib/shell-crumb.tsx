/* shell-crumb.tsx — lets a page set the shared AppShell's breadcrumb from a
   segment layout below it. AppShell (nav, command palette, g-then-key
   shortcuts) used to be mounted fresh inside every page component, so it
   remounted — and its shortcut listeners re-registered — on every navigation.
   A layout can mount AppShell once for a whole subtree, but a layout can't
   read props from the page it wraps; this context is the bridge: the layout
   renders AppShell reading `crumb` from context, and each page calls
   useSetCrumb(crumb) instead of rendering <AppShell crumb={...}> itself. */
"use client";

import React from "react";
import type { Crumb } from "@devdigest/ui";

const CrumbCtx = React.createContext<{
  crumb: Crumb[] | undefined;
  setCrumb: (c: Crumb[] | undefined) => void;
}>({ crumb: undefined, setCrumb: () => {} });

export function CrumbProvider({ children }: { children: React.ReactNode }) {
  const [crumb, setCrumb] = React.useState<Crumb[] | undefined>(undefined);
  const value = React.useMemo(() => ({ crumb, setCrumb }), [crumb]);
  return <CrumbCtx.Provider value={value}>{children}</CrumbCtx.Provider>;
}

/** Read by the layout that renders the shared <AppShell>. */
export function useShellCrumb() {
  return React.useContext(CrumbCtx).crumb;
}

/** Call from a page to set the shared AppShell's breadcrumb for as long as
   it's mounted. Keyed by JSON content (not reference) since callers rebuild
   the crumb array fresh every render. */
export function useSetCrumb(crumb: Crumb[]) {
  const { setCrumb } = React.useContext(CrumbCtx);
  const key = JSON.stringify(crumb);
  React.useEffect(() => {
    setCrumb(crumb);
    // key is the real dependency; crumb itself is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
