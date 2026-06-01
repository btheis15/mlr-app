import type { Metadata, Viewport } from "next";
import { Yellowtail } from "next/font/google";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { InstallHint } from "@/components/InstallHint";
import { IdentityProvider } from "@/components/IdentityProvider";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { getAnnouncements } from "@/lib/announcements";

// Brush script for the resort wordmark (echoes the official logo's hand-script
// "Muskellunge Lake"). Self-hosted by next/font (works in static export + PWA);
// feeds --font-script in globals.css via the .font-script utility.
const yellowtail = Yellowtail({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-yellowtail",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Muskellunge Lake Resort",
  description: "Muskellunge Lake Resort — activities, dining, Family Fest, and resort chat.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MLR",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f6f3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const announcements = await getAnnouncements();

  return (
    <html lang="en" className={`h-full ${yellowtail.variable}`}>
      <body className="min-h-full bg-background text-foreground antialiased">
        <IdentityProvider>
          <InstallHint />
          <main
            className="mx-auto w-full max-w-md px-4 pb-24 pt-2"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="pt-2">
              <AnnouncementBanner items={announcements} />
            </div>
            {children}
          </main>
          <TabBar />
        </IdentityProvider>
      </body>
    </html>
  );
}
