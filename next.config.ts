import type { NextConfig } from "next";

type ImageRemotePattern = {
  protocol: "https";
  hostname: string;
  port: string;
  pathname: string;
  search: string;
};

const SUPABASE_HOSTNAME = "hqemhwhwwjdfzpwqbory.supabase.co";
const SUPABASE_PUBLIC_PATHNAME = "/storage/v1/object/public/**";
// Next matches `hostname` with picomatch, so only literal DNS hostnames may be
// derived from the environment. This rejects wildcard/metacharacter patterns.
const EXACT_DNS_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// The exact hostname is a fallback because the affected build did not expose
// NEXT_PUBLIC_SUPABASE_URL reliably at config evaluation time. A valid HTTPS
// env value still adds its own exact hostname below when it differs.
const knownSupabasePattern: ImageRemotePattern = {
  protocol: "https",
  hostname: SUPABASE_HOSTNAME,
  port: "",
  pathname: SUPABASE_PUBLIC_PATHNAME,
  search: "",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let envSupabaseHostname: string | null = null;
try {
  const parsed = supabaseUrl ? new URL(supabaseUrl) : null;
  if (
    parsed?.protocol === "https:" &&
    parsed.hostname &&
    EXACT_DNS_HOSTNAME.test(parsed.hostname)
  ) {
    envSupabaseHostname = parsed.hostname;
  }
} catch {
  // An invalid URL yields no derived pattern; the exact fallback still applies.
}

const remotePatterns: ImageRemotePattern[] = [knownSupabasePattern];
if (envSupabaseHostname && envSupabaseHostname !== SUPABASE_HOSTNAME) {
  remotePatterns.push({ ...knownSupabasePattern, hostname: envSupabaseHostname });
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns,
  },
  experimental: {
    // Receipt Server Actions accept files up to 5 MB; leave room for the
    // multipart/form-data overhead enforced by the framework.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
