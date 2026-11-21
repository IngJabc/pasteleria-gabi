import type { NextConfig } from "next";

// Public product photos live in the project's Supabase Storage bucket. Derive
// the origin from configuration so no project hostname is hardcoded here.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseOrigin: URL | null = null;
try {
  supabaseOrigin = supabaseUrl ? new URL(supabaseUrl) : null;
} catch {
  // An invalid/missing URL yields no remote pattern; the catalog then simply
  // cannot render remote photos until the environment is configured.
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: supabaseOrigin
      ? [
          {
            protocol: supabaseOrigin.protocol === "https:" ? "https" : "http",
            hostname: supabaseOrigin.hostname,
            port: supabaseOrigin.port,
            pathname: "/storage/v1/object/public/product-images/**",
            search: "",
          },
        ]
      : [],
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
