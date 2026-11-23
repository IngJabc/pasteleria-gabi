"use client";

import { useActionState } from "react";
import { loginAdmin, type AdminLoginState } from "@/features/admin/auth/actions";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";

const initialState: AdminLoginState | null = null;

export function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(loginAdmin, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <LiveRegion className="sr-only">
        {pending ? "Iniciando sesión." : state?.error ?? ""}
      </LiveRegion>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-field border border-pink-soft bg-rose px-4 py-3 text-sm text-ink"
        >
          {state.error}
        </p>
      ) : null}

      <Field id="admin-email" label="Correo electrónico">
        <Input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={state?.email ?? ""}
          aria-invalid={state?.error ? true : undefined}
        />
      </Field>

      <Field id="admin-password" label="Contraseña">
        <Input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          aria-invalid={state?.error ? true : undefined}
        />
      </Field>

      <Button type="submit" className="w-full justify-center" disabled={pending}>
        {pending ? "Ingresando..." : "Ingresar"}
      </Button>
    </form>
  );
}
