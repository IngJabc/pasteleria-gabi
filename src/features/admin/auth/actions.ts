"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "El correo electrónico es obligatorio.")
    .email("Ingresa un correo electrónico válido.")
    .max(254, "El correo electrónico es demasiado largo."),
  password: z
    .string()
    .min(1, "La contraseña es obligatoria.")
    .max(200, "La contraseña es demasiado larga."),
});

export type AdminLoginState = {
  ok: false;
  error: string;
  email?: string;
};

const INVALID_CREDENTIALS_ERROR =
  "El correo electrónico o la contraseña no son correctos.";
const INACTIVE_ADMIN_ERROR =
  "Tu cuenta no tiene acceso administrativo activo.";
const GENERIC_ERROR = "No se pudo iniciar sesión. Inténtalo de nuevo.";

function invalidState(error: string, email?: string): AdminLoginState {
  return { ok: false, error, email };
}

function isInvalidCredentialsMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid credentials")
  );
}

export async function loginAdmin(
  _previousState: AdminLoginState | null,
  formData: FormData,
): Promise<AdminLoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return invalidState(
      parsed.error.issues[0]?.message ?? GENERIC_ERROR,
      typeof formData.get("email") === "string" ? String(formData.get("email")) : undefined,
    );
  }

  const { email, password } = parsed.data;

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return invalidState(GENERIC_ERROR, email);
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    if (isInvalidCredentialsMessage(signInError.message)) {
      return invalidState(INVALID_CREDENTIALS_ERROR, email);
    }
    return invalidState(GENERIC_ERROR, email);
  }

  try {
    await requireActiveAdminId();
  } catch (error) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Fail closed: if sign-out fails, still deny access.
    }

    if (error instanceof AdminSessionError) {
      return invalidState(INACTIVE_ADMIN_ERROR, email);
    }
    return invalidState(GENERIC_ERROR, email);
  }

  redirect("/admin");
}

export async function logoutAdmin(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Always move the browser back to the login screen.
  }
  redirect("/admin/login");
}


