import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * - `node` environment: Phase 0 tests cover framework-free domain/infrastructure
 *   code. jsdom + React Testing Library will be added only when there is UI worth
 *   testing (see docs/DECISIONS.md).
 * - Tests are colocated with the code they cover as `*.test.ts(x)` under `src/`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Database migration suites spin up a disposable PostgreSQL cluster and
    // issue many short psql invocations per case; the default 5s is too tight.
    testTimeout: 30_000,
    clearMocks: true,
  },
});
