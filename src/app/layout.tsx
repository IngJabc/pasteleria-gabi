import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Title below is provisional: the commercial brand is still pending definition
// (see docs/ROADMAP.md — "Pending discovery" in SPEC.md section 18).
export const metadata: Metadata = {
  title: {
    default: "Pastelería Online",
    template: "%s | Pastelería Online",
  },
  description:
    "Tienda en línea de porciones de torta. Barquisimeto, Venezuela.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
