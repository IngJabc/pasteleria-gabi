import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "./admin-session";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const fromFn = vi.fn(() => ({ select }));
const select = vi.fn(() => ({ eq: eq1 }));
const eq1 = vi.fn(() => ({ eq: eq2 }));
const eq2 = vi.fn(() => ({ maybeSingle }));

describe("requireActiveAdminId", () => {
  beforeEach(() => {
    getUser.mockReset();
    maybeSingle.mockReset();
    fromFn.mockClear();
    select.mockClear();
    eq1.mockClear();
    eq2.mockClear();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser },
      from: fromFn,
    } as never);
  });

  it("returns the session-derived id only when the active administrator row exists", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: ADMIN } },
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: { id: ADMIN }, error: null });

    await expect(requireActiveAdminId()).resolves.toBe(ADMIN);
    expect(fromFn).toHaveBeenCalledWith("administrators");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq1).toHaveBeenCalledWith("id", ADMIN);
    expect(eq2).toHaveBeenCalledWith("is_active", true);
  });

  it.each([
    ["no user", { data: { user: null }, error: { message: "not signed in" } }],
    ["a lookup error", { data: { user: { id: ADMIN } }, error: { message: "jwt expired" } }],
  ])("fails closed for %s", async (_label, authResult) => {
    getUser.mockResolvedValue(authResult);

    await expect(requireActiveAdminId()).rejects.toThrow(
      "La sesión del administrador no es válida.",
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user who is not an active administrator", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ADMIN } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(requireActiveAdminId()).rejects.toThrow(
      "La sesión del administrador no es válida.",
    );
  });
});
