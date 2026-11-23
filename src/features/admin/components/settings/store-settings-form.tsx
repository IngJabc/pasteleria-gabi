"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSectionTitle } from "@/components/admin/admin-ui";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { describeBusinessHours } from "@/features/admin/components/ops/business-hours";
import {
  STORE_TIMEZONE,
  WEEKDAYS,
  type BusinessHours,
  type DaySchedule,
  type TimeInterval,
} from "@/features/settings/schemas";
import { updateStoreSettings } from "@/features/settings/admin-settings";

const DAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
};

type WeekKey = (typeof WEEKDAYS)[number];

function emptyWeek(): Record<WeekKey, DaySchedule> {
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

function cloneWeek(week: Record<WeekKey, DaySchedule>): Record<WeekKey, DaySchedule> {
  const out = emptyWeek();
  for (const day of WEEKDAYS) out[day] = week[day].map((i) => ({ ...i }));
  return out;
}

function normalizeHours(hours: BusinessHours | null): BusinessHours {
  if (hours) {
    return {
      timezone: STORE_TIMEZONE,
      attention: cloneWeek(hours.attention),
      pickup: cloneWeek(hours.pickup),
    };
  }
  return { timezone: STORE_TIMEZONE, attention: emptyWeek(), pickup: emptyWeek() };
}

function sortIntervals(intervals: TimeInterval[]): TimeInterval[] {
  return [...intervals].sort((a, b) => a.start.localeCompare(b.start));
}

function validIntervals(intervals: TimeInterval[]): string | null {
  const sorted = sortIntervals(intervals);
  for (const interval of sorted) {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(interval.start)) return "Hora de inicio inválida (HH:MM).";
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(interval.end)) return "Hora de fin inválida (HH:MM).";
    if (interval.start >= interval.end) return "La hora de inicio debe ser anterior a la de fin.";
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) return "Los intervalos no pueden solaparse.";
  }
  return null;
}

type ScheduleKind = "attention" | "pickup";

export function StoreSettingsForm({
  initialPickupAddress,
  initialWhatsappPhone,
  initialBusinessHours,
}: {
  initialPickupAddress: string | null;
  initialWhatsappPhone: string | null;
  initialBusinessHours: BusinessHours | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pickupAddress, setPickupAddress] = useState(initialPickupAddress ?? "");
  const [whatsappPhone, setWhatsappPhone] = useState(initialWhatsappPhone ?? "");
  const [hours, setHours] = useState<BusinessHours>(() => normalizeHours(initialBusinessHours));
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const { showToast } = useToast();

  function updateInterval(kind: ScheduleKind, day: WeekKey, index: number, field: "start" | "end", value: string) {
    setHours((current) => {
      const next = normalizeHours(current);
      const list = [...next[kind][day]];
      list[index] = { ...list[index], [field]: value };
      next[kind][day] = list;
      return next;
    });
  }

  function addInterval(kind: ScheduleKind, day: WeekKey) {
    setHours((current) => {
      const next = normalizeHours(current);
      next[kind][day] = [...next[kind][day], { start: "09:00", end: "17:00" }];
      return next;
    });
  }

  function removeInterval(kind: ScheduleKind, day: WeekKey, index: number) {
    setHours((current) => {
      const next = normalizeHours(current);
      next[kind][day] = next[kind][day].filter((_, i) => i !== index);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFeedback("");

    for (const kind of ["attention", "pickup"] as const) {
      for (const day of WEEKDAYS) {
        const err = validIntervals(hours[kind][day]);
        if (err) {
          setIsError(true);
          const msg = `${DAY_LABELS[day]} (${kind === "attention" ? "atención" : "retiro"}): ${err}`;
          setFeedback(msg);
          showToast(msg, "error");
          return;
        }
      }
    }

    const normalized: BusinessHours = {
      timezone: STORE_TIMEZONE,
      attention: emptyWeek(),
      pickup: emptyWeek(),
    };
    for (const day of WEEKDAYS) {
      normalized.attention[day] = sortIntervals(hours.attention[day]);
      normalized.pickup[day] = sortIntervals(hours.pickup[day]);
    }

    const trimmedAddress = pickupAddress.trim();
    const trimmedWhatsapp = whatsappPhone.trim();
    startTransition(async () => {
      const result = await updateStoreSettings({
        pickupAddress: trimmedAddress === "" ? null : trimmedAddress,
        whatsappPhone: trimmedWhatsapp === "" ? null : trimmedWhatsapp,
        businessHours: normalized,
      });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      setIsError(false);
      setFeedback("Configuración guardada.");
      showToast("Configuración guardada.", "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={isPending} className="space-y-6">
      <div>
        <AdminSectionTitle>Dirección y horarios</AdminSectionTitle>
        <p className="mt-1 text-sm leading-6 text-muted">
          Estos datos se muestran al cliente. No bloquean pedidos ni alteran reglas operativas.
        </p>
      </div>

      <Field id="pickup-address" label="Dirección de retiro" hint="Deja vacío si no quieres mostrar dirección.">
        <Input
          id="pickup-address"
          name="pickupAddress"
          value={pickupAddress}
          onChange={(e) => setPickupAddress(e.target.value)}
          maxLength={500}
          placeholder="Ej.: Calle, ciudad, referencia"
        />
      </Field>

      <Field
        id="whatsapp-phone"
        label="WhatsApp de contacto"
        hint="Número que verán los clientes para contactarte. Incluye código de país (ej.: 584121234567). Déjalo vacío si no quieres mostrarlo."
      >
        <Input
          id="whatsapp-phone"
          name="whatsappPhone"
          value={whatsappPhone}
          onChange={(e) => setWhatsappPhone(e.target.value)}
          maxLength={50}
          inputMode="tel"
          placeholder="Ej.: 584121234567"
        />
      </Field>

      <div className="space-y-4">
        <p className="font-display text-sm font-bold text-ink">Horarios ({STORE_TIMEZONE})</p>
        {WEEKDAYS.map((day) => (
          <div key={day} className="rounded-field border border-rose/60 bg-cream p-4">
            <p className="font-display font-bold text-plum">{DAY_LABELS[day]}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {(["attention", "pickup"] as const).map((kind) => (
                <div key={kind}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                    {kind === "attention" ? "Atención" : "Retiro"}
                  </p>
                  <div className="space-y-2">
                    {hours[kind][day].map((interval, index) => (
                      <div key={`${kind}-${day}-${index}`} className="flex items-center gap-2">
                        <label className="sr-only" htmlFor={`${kind}-${day}-${index}-start`}>
                          {DAY_LABELS[day]} {kind} inicio {index + 1}
                        </label>
                        <Input
                          id={`${kind}-${day}-${index}-start`}
                          type="time"
                          value={interval.start}
                          onChange={(e) => updateInterval(kind, day, index, "start", e.target.value)}
                          className="min-h-10 px-2 py-1"
                        />
                        <span className="text-muted">–</span>
                        <label className="sr-only" htmlFor={`${kind}-${day}-${index}-end`}>
                          {DAY_LABELS[day]} {kind} fin {index + 1}
                        </label>
                        <Input
                          id={`${kind}-${day}-${index}-end`}
                          type="time"
                          value={interval.end}
                          onChange={(e) => updateInterval(kind, day, index, "end", e.target.value)}
                          className="min-h-10 px-2 py-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 text-sm"
                          onClick={() => removeInterval(kind, day, index)}
                          aria-label={`Quitar intervalo ${index + 1} de ${DAY_LABELS[day]} ${kind}`}
                        >
                          Quitar
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" className="px-0 text-sm" onClick={() => addInterval(kind, day)}>
                      + Agregar intervalo
                    </Button>
                    {hours[kind][day].length === 0 ? (
                      <p className="text-sm text-muted">Cerrado</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar configuración"}
        </Button>
        <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
      </div>

      <details className="rounded-field border border-lavender/60 bg-lavender/20 px-4 py-3">
        <summary className="cursor-pointer font-display text-sm font-bold text-plum">Vista actual guardada</summary>
        <ul className="mt-2 space-y-1 text-sm leading-6 text-ink">
          {describeBusinessHours(initialBusinessHours).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </form>
  );
}