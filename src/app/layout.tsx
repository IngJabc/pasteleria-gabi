import type { Metadata } from "next";
import { DM_Sans, Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// Brand identity comes from the supplied design-system reference
// ("Dulce Atelier" — "Un poquito de alegría, en cada bocado.").
export const metadata: Metadata = {
  title: {
    default: "Dulce Atelier",
    template: "%s | Dulce Atelier",
  },
  description:
    "Pequeños antojos. Grandes momentos. Horneado artesanal en Barquisimeto, Venezuela.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${nunito.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
