import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { InstallHint } from "@/components/InstallHint";

export const metadata: Metadata = {
  title: "MLR App",
  description: "MLR App — mobile-first PWA.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MLR App",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-background text-foreground antialiased">
        <InstallHint />
        <main
          className="mx-auto w-full max-w-md px-4 pb-24 pt-2"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {children}
        </main>
        <TabBar />
      </body>
    </html>
  );
}
