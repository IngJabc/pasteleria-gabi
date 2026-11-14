import { describe, expect, it } from "vitest";
import { getPublicEnv, parsePublicEnv } from "./env";

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
};

function withEnv(
  overrides: Partial<typeof validEnv>,
  run: () => void,
): void {
  const original = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = overrides.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = overrides.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    run();
  } finally {
    if (original.NEXT_PUBLIC_SUPABASE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = original.NEXT_PUBLIC_SUPABASE_URL;
    }
    if (original.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = original.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
  }
}

describe("parsePublicEnv", () => {
  it("returns validated values for a valid input", () => {
    expect(parsePublicEnv(validEnv)).toEqual(validEnv);
  });

  it("throws a descriptive error naming the missing variable", () => {
    expect(() => parsePublicEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("throws when the Supabase URL is not a valid URL", () => {
    expect(() => parsePublicEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("throws when the anon key is empty", () => {
    expect(() =>
      parsePublicEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("getPublicEnv", () => {
  it("fails fast with a clear message when variables are not configured", () => {
    withEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }, () => {
      expect(() => getPublicEnv()).toThrow(/Invalid public environment variables/);
    });
  });

  it("reads the configured variables from process.env", () => {
    withEnv(validEnv, () => {
      expect(getPublicEnv()).toEqual(validEnv);
    });
  });
});
