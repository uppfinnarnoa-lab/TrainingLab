import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ColorSchemeProvider } from "@/components/color-scheme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "TrainingLab",
  description: "AI-powered personal training platform",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Leaflet CSS must be in <head> so it's parsed before Leaflet JS initializes */}
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" crossOrigin="" />
      </head>
      <body className="min-h-screen bg-background text-primary antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ColorSchemeProvider>
            {children}
          </ColorSchemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
