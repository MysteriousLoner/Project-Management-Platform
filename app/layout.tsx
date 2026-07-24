import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n";
import PwaInstallPrompt from "./pwa-install";
import "./globals.css";

export const metadata: Metadata = {
  title: "协策达 — Project Management",
  description: "Locally hosted project management for internal teams",
  applicationName: "协策达",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "协策达"
  },
  formatDetection: {
    telephone: false
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          {children}
          <PwaInstallPrompt />
        </I18nProvider>
      </body>
    </html>
  );
}
