import type { NextConfig } from "next";
import { describe, expect, it, vi } from "vitest";

const KNOWN_HOSTNAME = "hqemhwhwwjdfzpwqbory.supabase.co";
const PUBLIC_PATHNAME = "/storage/v1/object/public/**";

type RemotePatternLike = {
  protocol?: string;
  hostname: string;
  port?: string;
  pathname?: string;
  search?: string;
};

async function loadConfig(value: string | undefined): Promise<NextConfig> {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = value;
  }

  try {
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    return config as NextConfig;
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  }
}

function patterns(config: NextConfig): RemotePatternLike[] {
  const configured = config.images?.remotePatterns;
  expect(configured).toBeDefined();
  return (configured ?? []).map((pattern) => {
    if (pattern instanceof URL) {
      return {
        protocol: pattern.protocol === "https:" ? "https" : "http",
        hostname: pattern.hostname,
        port: pattern.port,
        pathname: pattern.pathname,
        search: pattern.search,
      };
    }
    return pattern;
  });
}

function expectKnownPattern(pattern: RemotePatternLike): void {
  expect(pattern).toEqual({
    protocol: "https",
    hostname: KNOWN_HOSTNAME,
    port: "",
    pathname: PUBLIC_PATHNAME,
    search: "",
  });
}

describe("next.config images.remotePatterns", () => {
  it("falls back to the exact public Supabase path when the env var is missing", async () => {
    const config = await loadConfig(undefined);
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(1);
    expectKnownPattern(remotePatterns[0]);
  });

  it("dedupes when the env var names the same https origin", async () => {
    const config = await loadConfig(`https://${KNOWN_HOSTNAME}`);
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(1);
    expectKnownPattern(remotePatterns[0]);
  });

  it("keeps both patterns for a different valid Supabase origin", async () => {
    const config = await loadConfig("https://other-project.supabase.co");
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(2);
    expectKnownPattern(remotePatterns[0]);
    expect(remotePatterns[1]).toEqual({
      protocol: "https",
      hostname: "other-project.supabase.co",
      port: "",
      pathname: PUBLIC_PATHNAME,
      search: "",
    });
  });

  it("ignores an invalid env URL while keeping the exact pattern", async () => {
    const config = await loadConfig("not-a-url");
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(1);
    expectKnownPattern(remotePatterns[0]);
  });

  it("does not derive an insecure pattern from a non-https env URL", async () => {
    const config = await loadConfig("http://other-project.supabase.co");
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(1);
    expectKnownPattern(remotePatterns[0]);
  });

  it("rejects wildcard or metacharacter hostnames from the env URL", async () => {
    const config = await loadConfig("https://*.supabase.co");
    const remotePatterns = patterns(config);

    expect(remotePatterns).toHaveLength(1);
    expectKnownPattern(remotePatterns[0]);
  });

  it("does not relax image security or change unrelated config", async () => {
    const config = await loadConfig(undefined);
    const remotePatterns = patterns(config);

    expect(
      remotePatterns.every(({ hostname }) => !hostname.includes("*")),
    ).toBe(true);
    expect(config.images?.domains).toBeUndefined();
    expect(config.images?.unoptimized).toBeUndefined();
    expect(config.images?.dangerouslyAllowSVG).toBeUndefined();
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
    expect(config.experimental?.serverActions).toEqual({ bodySizeLimit: "6mb" });
    expect(config.turbopack?.rules).toMatchObject({
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    });
  });
});
