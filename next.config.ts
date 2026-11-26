import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // `*` matches exactly one Supabase project subdomain. The bounded wildcard
    // is intentional: switching projects needs no code or config change, while
    // HTTPS public Storage paths remain the only allowed image sources.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
        search: "",
      },
    ],
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
