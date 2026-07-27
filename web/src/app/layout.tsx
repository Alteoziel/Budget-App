import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

const sans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Alte' Budgeting",
  description: "A calm, mobile-first budget you actually want to open — including offline.",
  applicationName: "Alte' Budgeting",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Match the app wash so iOS doesn't force a white status bar on launch.
    statusBarStyle: "black-translucent",
    title: "Alte' Budgeting",
  },
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e3d6" },
    { media: "(prefers-color-scheme: dark)", color: "#080c0b" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Runs before paint: set class + background + color-scheme so dark mode never
// flashes browser-default white while CSS is still loading.
const themeScript = `(function(){try{var p=localStorage.getItem("alte-theme");var d=p==="dark"||((!p||p==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light";r.style.backgroundColor=d?"#080c0b":"#e9e3d6";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",d?"#080c0b":"#e9e3d6");}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading headers opts the tree into dynamic rendering so the CSP nonce can apply.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Alte' Budgeting" />
      </head>
      <body className={`${display.variable} ${sans.variable} font-sans antialiased`}>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
