import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Archivo, Courier_Prime } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({ variable: "--font-bebas", weight: "400", subsets: ["latin"] });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const courier = Courier_Prime({ variable: "--font-courier", weight: ["400", "700"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CastSignal — cast for the audience, not just the headline",
  description:
    "An AI casting agent that scores your shortlist on real audience fit and reach using Qloo taste data, finds cross-over wildcards and proposes the widest-reaching ensemble.",
};
export const viewport: Viewport = { themeColor: "#121110" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bebas.variable} ${archivo.variable} ${courier.variable}`} suppressHydrationWarning>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
