"use client";

import { Button } from "@/components/ui/ui";

export function CopyQuoteMessageButton({ message }: { message: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // ignore; user can still select text from WhatsApp draft if needed
    }
  }

  return (
    <Button type="button" variant="ghost" className="min-h-10 px-3 py-2 text-sm" onClick={copy}>
      Copiar mensaje
    </Button>
  );
}
