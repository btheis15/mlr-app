import type { Metadata, Viewport } from "next";
import { Yellowtail } from "next/font/google";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { InstallHint } from "@/components/InstallHint";
import { PushPrompt } from "@/components/PushPrompt";
import { IdentityProvider } from "@/components/IdentityProvider";
import { PreviewBanner } from "@/components/PreviewBanner";
import { MemberSheetHost } from "@/components/MemberSheetHost";
import { AssistantButton } from "@/components/AssistantButton";
import { DemoDateProvider } from "@/lib/DemoDateProvider";
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
  description: "Muskellunge Lake Resort — activities, dining, Family Fest, and committees.",
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
  // Allow pinch-to-zoom (accessibility). Pinning maximumScale:1 /
  // userScalable:false blocks zoom for low-vision users — a real barrier for the
  // older family members this app is for. The app already scales well; let them
  // zoom on top of that and the in-app Text-size control.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  // Resize the layout (not just overlay) when the on-screen keyboard opens, so
  // bottom-pinned UI like the chat composer stays above it on Android Chrome.
  // (iOS Safari ignores this; the chat handles iOS via the visualViewport API.)
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const announcements = await getAnnouncements();

  return (
    <html lang="en" className={`h-full ${yellowtail.variable}`}>
      <head>
        {/* Apply the saved "Text size" choice before first paint so there's no
            flash of small text. Keep the size map in sync with TextSizeControl. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var v=localStorage.getItem('mlr-text-scale');var m={normal:17,large:19,largest:21};if(v&&m[v]){document.documentElement.style.fontSize=m[v]+'px';}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full text-foreground antialiased">
        <DemoDateProvider>
          <IdentityProvider>
            <InstallHint />
            <PushPrompt />
          <main
            className="mx-auto w-full max-w-md px-4 pt-2"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              // Clear the fixed TabBar, which grows by the home-indicator inset
              // on notched iPhones — without the inset the last card hides
              // behind the bar.
              paddingBottom: "calc(6rem + env(safe-area-inset-bottom))",
            }}
          >
            <div className="pt-2">
              <AnnouncementBanner items={announcements} />
            </div>
            {children}
          </main>
          <TabBar />
          <AssistantButton />
          <PreviewBanner />
          <MemberSheetHost />
          </IdentityProvider>
        </DemoDateProvider>
      </body>
    </html>
  );
}
