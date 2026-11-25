import { describe, expect, it } from "vitest";
import { isForbiddenAutopilotChange } from "../../../scripts/validate-autopilot.mjs";

describe("validate-autopilot env file detection", () => {
  it("allows .env.example but rejects real env files", () => {
    expect(isForbiddenAutopilotChange(".env.example")).toBe(false);
    expect(isForbiddenAutopilotChange("docs/.env.example")).toBe(false);

    expect(isForbiddenAutopilotChange(".env")).toBe(true);
    expect(isForbiddenAutopilotChange(".env.local")).toBe(true);
    expect(isForbiddenAutopilotChange(".env.production")).toBe(true);
    expect(isForbiddenAutopilotChange(".env.development.local")).toBe(true);
    expect(isForbiddenAutopilotChange("config/.env.test")).toBe(true);
  });

  it("still flags generated/secret artifacts", () => {
    expect(isForbiddenAutopilotChange("node_modules/pkg/index.js")).toBe(true);
    expect(isForbiddenAutopilotChange(".next/build/output")).toBe(true);
    expect(isForbiddenAutopilotChange("dist/app.js")).toBe(true);
    expect(isForbiddenAutopilotChange("coverage/lcov.info")).toBe(true);
    expect(isForbiddenAutopilotChange("tsconfig.tsbuildinfo")).toBe(true);
    expect(isForbiddenAutopilotChange("logs/app.log")).toBe(true);
  });

  it("does not flag normal source files", () => {
    expect(isForbiddenAutopilotChange("src/app/page.tsx")).toBe(false);
    expect(isForbiddenAutopilotChange("scripts/validate-autopilot.mjs")).toBe(false);
  });
});
