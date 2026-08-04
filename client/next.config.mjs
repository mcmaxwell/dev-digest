import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_* env vars are inlined automatically by Next — no `env` block
  // needed here. src/lib/api.ts:5-6 is the single source of truth for the
  // localhost:3001 fallback when the var isn't set.
  //
  // Because those vars are inlined AT COMPILE TIME and the build cache is keyed
  // only by directory, two `next dev` servers sharing this folder with different
  // NEXT_PUBLIC_API_BASE values poison each other's chunks — the e2e stack
  // compiled `:3101` into pages the dev server on :3000 then served. Any such
  // server must therefore claim its own dist dir (scripts/e2e.sh sets this).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default withNextIntl(nextConfig);
