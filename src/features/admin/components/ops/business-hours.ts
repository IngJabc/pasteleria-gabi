import {
  WEEKDAYS,
  type BusinessHours,
  type DaySchedule,
} from "@/features/settings/schemas";

/** Spanish labels for the stored weekday keys; no schedule value is invented. */
const DAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
};

function describeDay(schedule: DaySchedule): string {
  if (schedule.length === 0) return "Cerrado";
  return schedule.map(({ start, end }) => `${start}–${end}`).join(", ");
}

/**
 * Renders the real JSONB business-hours contract as readable lines.
 * A missing or invalid configuration renders a single truthful placeholder.
 */
export function describeBusinessHours(hours: BusinessHours | null): string[] {
  if (!hours) return ["Sin configurar"];

  return WEEKDAYS.map((day) => {
    const attention = describeDay(hours.attention[day]);
    const pickup = describeDay(hours.pickup[day]);
    return `${DAY_LABELS[day]} · Atención: ${attention} · Retiro: ${pickup}`;
  });
}
