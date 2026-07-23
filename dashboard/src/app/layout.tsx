import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Budget App · Governance Review",
  description:
    "Human review gate for Budget App PRs — AST, OWASP, fuzz, Big-O, copyright.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} font-sans antialiased`}>
        <div className="mx-auto max-w-6xl px-5 py-10">{children}</div>
      </body>
    </html>
  );
}
