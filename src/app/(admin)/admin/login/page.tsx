import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminLoginForm } from "./login-form";
import { Card } from "@/components/ui/ui";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-12">
      <Suspense
        fallback={<p className="text-sm text-muted">Cargando acceso administrativo.</p>}
      >
        <AdminLoginContent />
      </Suspense>
    </main>
  );
}

async function AdminLoginContent() {
  try {
    await requireActiveAdminId();
    redirect("/admin");
  } catch (error) {
    if (!(error instanceof AdminSessionError)) throw error;
  }

  return (
    <Card className="w-full border border-rose/60 p-8 shadow-sm">
      <p className="text-eyebrow">EL ATELIER / ADMIN</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold text-plum">
        Iniciar sesión
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Accede con la cuenta de administración autorizada.
      </p>
      <div className="mt-8">
        <AdminLoginForm />
      </div>
    </Card>
  );
}
