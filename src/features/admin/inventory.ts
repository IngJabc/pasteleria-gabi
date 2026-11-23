import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";

/**
 * Read-only inventory views plus the two existing atomic RPCs.
 *
 * Column names mirror migrations 002/003: `inventory_batches` uses
 * `initial_quantity`, `remaining_quantity`, `production_date` and `created_by`;
 * `inventory_movements` is append-only. The RPCs are SECURITY INVOKER and call
 * `private.is_admin()` themselves, so they are invoked with the cookie-bound
 * client and no administrator id is ever passed from the client.
 */

const unavailableError =
  "La información de inventario no está disponible en este momento.";
const invalidSessionError = "La sesión del administrador no es válida.";
const invalidInputError = "Los datos del inventario no son válidos.";
const capabilityUnavailable =
  "La capacidad de gestionar el inventario no está disponible en este momento.";

const MAX_BATCH_QUANTITY = 1_000_000;
const MAX_ADJUSTMENT_QUANTITY = 1_000_000;
const MAX_REASON_LENGTH = 240;
const MAX_ROWS = 200;

const batchRowSchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  initial_quantity: z.number().int().positive(),
  remaining_quantity: z.number().int().nonnegative(),
  production_date: z.string().min(1),
  created_at: z.string().min(1),
});

const productNameRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const reservationRowSchema = z.object({
  batch_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

const movementRowSchema = z.object({
  id: z.number().int().positive(),
  batch_id: z.number().int().positive(),
  type: z.string().min(1),
  quantity: z.number().int().refine((value) => value !== 0),
  reason: z.string().nullable(),
  admin_id: z.string().nullable(),
  created_at: z.string().min(1),
});

const positiveIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/, "El identificador no es válido.")
  .transform((value) => Number(value));

const productionDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de producción no es válida.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "La fecha de producción no es válida.");

const createBatchSchema = z.strictObject({
  productId: positiveIdSchema,
  quantity: z
    .number()
    .int("La cantidad debe ser un número entero.")
    .positive("La cantidad debe ser mayor que cero.")
    .max(MAX_BATCH_QUANTITY, "La cantidad es demasiado alta."),
  productionDate: productionDateSchema.optional(),
});

const adjustBatchSchema = z.strictObject({
  batchId: positiveIdSchema,
  quantity: z
    .number()
    .int("La cantidad debe ser un número entero.")
    .refine((value) => value !== 0, "La cantidad no puede ser cero.")
    .refine(
      (value) => Math.abs(value) <= MAX_ADJUSTMENT_QUANTITY,
      "La cantidad es demasiado alta.",
    ),
  reason: z
    .string()
    .trim()
    .min(1, "El motivo del ajuste es obligatorio.")
    .max(MAX_REASON_LENGTH, "El motivo del ajuste es demasiado largo."),
});

export type AdminInventoryBatchItem = {
  batchId: number;
  productId: number;
  productName: string | null;
  initialQuantity: number;
  remainingQuantity: number;
  /** Administrative only, never served to the storefront. */
  productionDate: string;
  createdAt: string;
  /** `null` when the reservations relation is not queryable. */
  reservedUnits: number | null;
  /** `null` when the reservations relation is not queryable. */
  availableUnits: number | null;
};

export type AdminInventorySummary = {
  /** Sum of physical remaining units across the listed batches. */
  totalUnits: number;
  reservedUnits: number | null;
  availableUnits: number | null;
};

export type AdminInventoryResult = {
  unavailable: boolean;
  message: string;
  items: AdminInventoryBatchItem[];
  summary: AdminInventorySummary;
};

export type AdminMovementItem = {
  id: number;
  batchId: number;
  type: string;
  quantity: number;
  reason: string | null;
  adminId: string | null;
  createdAt: string;
};

export type AdminMovementsResult = {
  unavailable: boolean;
  message: string;
  items: AdminMovementItem[];
};

export type AdminMutationResult = {
  ok: boolean;
  message: string;
};

function unavailableInventory(): AdminInventoryResult {
  return {
    unavailable: true,
    message: unavailableError,
    items: [],
    summary: { totalUnits: 0, reservedUnits: null, availableUnits: null },
  };
}

function unavailableMovements(message: string): AdminMovementsResult {
  return { unavailable: true, message, items: [] };
}

export async function listInventoryBatches(): Promise<AdminInventoryResult> {
  try {
    await requireActiveAdminId();
  } catch {
    return unavailableInventory();
  }

  try {
    const supabase = await createSupabaseServerClient();

    const batchesResult = await supabase
      .from("inventory_batches")
      .select("id, product_id, initial_quantity, remaining_quantity, production_date, created_at")
      .order("production_date", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_ROWS);
    if (batchesResult.error) return unavailableInventory();

    const batches: z.infer<typeof batchRowSchema>[] = [];
    for (const row of batchesResult.data ?? []) {
      const parsed = batchRowSchema.safeParse(row);
      if (parsed.success) batches.push(parsed.data);
    }
    if (batches.length === 0) {
      return {
        unavailable: false,
        message: "",
        items: [],
        summary: { totalUnits: 0, reservedUnits: 0, availableUnits: 0 },
      };
    }

    const productIds = [...new Set(batches.map((batch) => batch.product_id))];
    const productsResult = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);
    if (productsResult.error) return unavailableInventory();

    const productNames = new Map<number, string>();
    for (const row of productsResult.data ?? []) {
      const parsed = productNameRowSchema.safeParse(row);
      if (parsed.success) productNames.set(parsed.data.id, parsed.data.name);
    }

    // Optional relation: if it is not queryable, reservation figures stay null
    // instead of being silently reported as zero.
    let reservedByBatch: Map<number, number> | null = null;
    const reservationsResult = await supabase
      .from("inventory_reservations")
      .select("batch_id, quantity")
      .eq("status", "active")
      .limit(MAX_ROWS * 5);
    if (!reservationsResult.error) {
      reservedByBatch = new Map<number, number>();
      for (const row of reservationsResult.data ?? []) {
        const parsed = reservationRowSchema.safeParse(row);
        if (!parsed.success) continue;
        const previous = reservedByBatch.get(parsed.data.batch_id) ?? 0;
        reservedByBatch.set(parsed.data.batch_id, previous + parsed.data.quantity);
      }
    }

    let totalUnits = 0;
    let totalReserved = 0;
    let totalAvailable = 0;
    const items: AdminInventoryBatchItem[] = batches.map((batch) => {
      const reserved = reservedByBatch?.get(batch.id) ?? 0;
      const available = Math.max(batch.remaining_quantity - reserved, 0);
      totalUnits += batch.remaining_quantity;
      totalReserved += reserved;
      totalAvailable += available;
      return {
        batchId: batch.id,
        productId: batch.product_id,
        productName: productNames.get(batch.product_id) ?? null,
        initialQuantity: batch.initial_quantity,
        remainingQuantity: batch.remaining_quantity,
        productionDate: batch.production_date,
        createdAt: batch.created_at,
        reservedUnits: reservedByBatch === null ? null : reserved,
        availableUnits: reservedByBatch === null ? null : available,
      };
    });

    return {
      unavailable: false,
      message: "",
      items,
      summary: {
        totalUnits,
        reservedUnits: reservedByBatch === null ? null : totalReserved,
        availableUnits: reservedByBatch === null ? null : totalAvailable,
      },
    };
  } catch {
    return unavailableInventory();
  }
}

export async function listInventoryMovements(
  batchId?: string,
): Promise<AdminMovementsResult> {
  try {
    await requireActiveAdminId();
  } catch {
    return unavailableMovements(invalidSessionError);
  }

  let parsedBatchId: number | null = null;
  if (batchId !== undefined) {
    const parsed = positiveIdSchema.safeParse(batchId);
    if (!parsed.success) {
      return unavailableMovements("El filtro de lote no es válido.");
    }
    parsedBatchId = parsed.data;
  }

  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from("inventory_movements")
      .select("id, batch_id, type, quantity, reason, admin_id, created_at");
    if (parsedBatchId !== null) query = query.eq("batch_id", parsedBatchId);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_ROWS);
    if (error) return unavailableMovements(unavailableError);

    const items: AdminMovementItem[] = [];
    for (const row of data ?? []) {
      const parsed = movementRowSchema.safeParse(row);
      if (!parsed.success) continue;
      items.push({
        id: parsed.data.id,
        batchId: parsed.data.batch_id,
        type: parsed.data.type,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        adminId: parsed.data.admin_id,
        createdAt: parsed.data.created_at,
      });
    }

    return { unavailable: false, message: "", items };
  } catch {
    return unavailableMovements(unavailableError);
  }
}

export async function createInventoryBatch(input: {
  productId: string;
  quantity: number;
  productionDate?: string;
}): Promise<AdminMutationResult> {
  "use server";

  try {
    await requireActiveAdminId();
  } catch {
    return { ok: false, message: invalidSessionError };
  }

  const parsed = createBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidInputError };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_inventory_batch", {
      p_product_id: parsed.data.productId,
      p_initial_quantity: parsed.data.quantity,
      ...(parsed.data.productionDate
        ? { p_production_date: parsed.data.productionDate }
        : {}),
    });
    if (error) return { ok: false, message: capabilityUnavailable };
    return { ok: true, message: "El lote de inventario se registró correctamente." };
  } catch {
    return { ok: false, message: capabilityUnavailable };
  }
}

export async function adjustInventory(input: {
  batchId: string;
  quantity: number;
  reason: string;
}): Promise<AdminMutationResult> {
  "use server";

  try {
    await requireActiveAdminId();
  } catch {
    return { ok: false, message: invalidSessionError };
  }

  const parsed = adjustBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidInputError };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("adjust_inventory", {
      p_batch_id: parsed.data.batchId,
      p_quantity: parsed.data.quantity,
      p_reason: parsed.data.reason,
    });
    if (error) return { ok: false, message: capabilityUnavailable };
    return { ok: true, message: "El ajuste de inventario se registró correctamente." };
  } catch {
    return { ok: false, message: capabilityUnavailable };
  }
}
