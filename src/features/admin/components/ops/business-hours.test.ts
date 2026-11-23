import { describe, expect, it } from "vitest";
import type { BusinessHours } from "@/features/settings/schemas";
import { describeBusinessHours } from "./business-hours";

function emptyWeek(): BusinessHours["attention"] {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

describe("describeBusinessHours", () => {
  it("is truthful when no configuration exists", () => {
    expect(describeBusinessHours(null)).toEqual(["Sin configurar"]);
  });

  it("renders the stored intervals without inventing values", () => {
    const hours: BusinessHours = {
      timezone: "America/Caracas",
      attention: {
        ...emptyWeek(),
        monday: [{ start: "09:00", end: "13:00" }],
      },
      pickup: {
        ...emptyWeek(),
        sunday: [{ start: "10:00", end: "12:00" }],
      },
    };

    const lines = describeBusinessHours(hours);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("Lunes · Atención: 09:00–13:00 · Retiro: Cerrado");
    expect(lines[4]).toBe("Viernes · Atención: Cerrado · Retiro: Cerrado");
    expect(lines[6]).toBe("Domingo · Atención: Cerrado · Retiro: 10:00–12:00");
  });
});
