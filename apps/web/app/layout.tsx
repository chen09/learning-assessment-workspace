import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { LanguageProvider } from "@/components/language-provider";
import { PwaRegistration } from "@/components/pwa-registration";

export const metadata: Metadata = {
  title: {
    default: "Luma · Family learning",
    template: "%s · Luma",
  },
  description:
    "Family worksheets, handwritten work, thoughtful feedback, and spaced review.",
  manifest: "/manifest.webmanifest",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
};

export const viewport: Viewport = {
  themeColor: "#f7f5ef",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          {children}
          <PwaRegistration />
        </LanguageProvider>
      </body>
    </html>
  );
}
