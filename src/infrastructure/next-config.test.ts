import type { NextConfig } from "next";
import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";
import { describe, expect, it, vi } from "vitest";

const EXPECTED_PATTERN = {
  protocol: "https",
  hostname: "*.supabase.co",
  port: "",
  pathname: "/storage/v1/object/public/**",
  search: "",
};

type RemotePatternLike = {
  protocol?: string;
  hostname: string;
  port?: string;
  pathname?: string;
  search?: string;
};

const ENVIRONMENTS: Array<[string, string | undefined]> = [
  ["the env var is missing", undefined],
  [
    "the env var names the previous production project",
    "https://hqemhwhwwjdfzpwqbory.supabase.co",
  ],
  [
    "the env var names the staging project",
    "https://htuabezpfolwsqblckmx.supabase.co",
  ],
  ["the env var is invalid", "not-a-url"],
  [
    "the env var is not https",
    "http://htuabezpfolwsqblckmx.supabase.co",
  ],
  ["the env var contains a wildcard", "https://*.supabase.co"],
  ["the env var names a non-Supabase host", "https://example.com"],
];

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

describe("next.config images.remotePatterns", () => {
  it.each(ENVIRONMENTS)(
    "keeps exactly one bounded Supabase Storage pattern when %s",
    async (_description, value) => {
      const config = await loadConfig(value);

      expect(patterns(config)).toEqual([EXPECTED_PATTERN]);
    },
  );

  it("matches both Supabase projects and rejects non-public or non-Supabase URLs", () => {
    const pattern = EXPECTED_PATTERN as Parameters<typeof matchRemotePattern>[0];

    expect(
      matchRemotePattern(
        pattern,
        new URL(
          "https://htuabezpfolwsqblckmx.supabase.co/storage/v1/object/public/product-images/1/a.png",
        ),
      ),
    ).toBe(true);
    expect(
      matchRemotePattern(
        pattern,
        new URL(
          "https://hqemhwhwwjdfzpwqbory.supabase.co/storage/v1/object/public/product-images/1/a.png",
        ),
      ),
    ).toBe(true);
    expect(
      matchRemotePattern(
        pattern,
        new URL("https://example.com/storage/v1/object/public/product-images/1/a.png"),
      ),
    ).toBe(false);
    expect(
      matchRemotePattern(
        pattern,
        new URL(
          "https://htuabezpfolwsqblckmx.supabase.co/storage/v1/object/private/product-images/1/a.png",
        ),
      ),
    ).toBe(false);
    expect(
      matchRemotePattern(
        pattern,
        new URL(
          "https://htuabezpfolwsqblckmx.supabase.co/storage/v1/object/public/product-images/1/a.png?v=1",
        ),
      ),
    ).toBe(false);
  });

  it("does not relax image security or change unrelated config", async () => {
    const config = await loadConfig(undefined);
    const remotePatterns = patterns(config);

    expect(remotePatterns).toEqual([EXPECTED_PATTERN]);
    expect(config.images).toEqual({ remotePatterns: [EXPECTED_PATTERN] });
    expect(remotePatterns[0].hostname).toBe("*.supabase.co");
    expect(remotePatterns[0].hostname).not.toContain("**");
    expect(remotePatterns[0].pathname).toBe("/storage/v1/object/public/**");
    expect(remotePatterns[0].port).toBe("");
    expect(remotePatterns[0].search).toBe("");
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
