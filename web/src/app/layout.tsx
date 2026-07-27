import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { ThemeInit } from "@/components/ThemeInit";
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

// Blocking CSS paints before JS/CSS bundles — kills white FOUC on cold start.
const themeBootStyle = `html,body{background-color:#080c0b;color-scheme:dark}
@media (prefers-color-scheme:light){html:not(.dark),html:not(.dark) body{background-color:#e9e3d6;color-scheme:light}}
html.dark,html.dark body{background-color:#080c0b!important;color-scheme:dark}
html.light,html.light body{background-color:#e9e3d6!important;color-scheme:light}`;

// Runs in <head>: honor saved theme even when it differs from system.
const themeScript = `(function(){try{var p=localStorage.getItem("alte-theme");var d=p==="dark"||((!p||p==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;var bg=d?"#080c0b":"#e9e3d6";r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.style.colorScheme=d?"dark":"light";r.style.backgroundColor=bg;var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",bg);}catch(e){}})();`;

// Body exists here — paint it before React hydrates / data streams.
const bodyThemeScript = `(function(){try{var d=document.documentElement.classList.contains("dark");document.body.style.backgroundColor=d?"#080c0b":"#e9e3d6";}catch(e){}})();`;

const appleSplashes: Array<{ href: string; media: string }> = [
  {
    href: "/splash/apple-splash-2048x2732.png",
    media:
      "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1668x2388.png",
    media:
      "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1290x2796.png",
    media:
      "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1179x2556.png",
    media:
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1284x2778.png",
    media:
      "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1170x2532.png",
    media:
      "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1242x2688.png",
    media:
      "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-1125x2436.png",
    media:
      "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    href: "/splash/apple-splash-750x1334.png",
    media:
      "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
  },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading headers opts the tree into dynamic rendering so the CSP nonce can apply.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeBootStyle }}
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        {appleSplashes.map((splash) => (
          <link
            key={splash.href}
            rel="apple-touch-startup-image"
            href={splash.href}
            media={splash.media}
          />
        ))}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Alte' Budgeting" />
      </head>
      <body className={`${display.variable} ${sans.variable} font-sans antialiased`}>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: bodyThemeScript }}
        />
        {children}
        <ThemeInit />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
