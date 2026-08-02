import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_* env vars are inlined automatically by Next — no `env` block
  // needed here. src/lib/api.ts:5-6 is the single source of truth for the
  // localhost:3001 fallback when the var isn't set.
};

export default withNextIntl(nextConfig);
