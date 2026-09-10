import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Used for LaTeX source, compiler logs, and anything else that must preserve
// exact characters and alignment.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // `template` gives every route its own tab title without repeating the
  // product name: a page exporting `title: "Resumes"` becomes
  // "Resumes · RoleTeX", while this layout's own pages fall back to `default`.
  title: {
    default: "RoleTeX",
    template: "%s · RoleTeX",
  },
  description:
    "Save resumes and job descriptions, tailor any pairing with AI, and review every suggested change before you download.",
  applicationName: "RoleTeX",
};

export const viewport: Viewport = {
  // Must track --background in app/globals.css, or mobile browsers paint their
  // chrome a different colour from the page. These are the sRGB equivalents of
  // oklch(0.985 0.002 265) and oklch(0.171 0.008 265).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-full flex flex-col">
        {/* Keyboard users land here first, ahead of the header and nav, so
            reaching the page content does not cost a tab through the shell. */}
        <a
          href="#main-content"
          className="focus:bg-card focus:ring-ring focus:text-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-3 focus:outline-none"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
