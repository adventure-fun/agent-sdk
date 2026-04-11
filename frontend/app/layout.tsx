import type { Metadata } from "next"
import { Cinzel, Inter } from "next/font/google"
import { Providers } from "./providers"
import { SiteHeader } from "./components/site-header"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["600", "700"],
})

export const metadata: Metadata = {
  title: "Adventure.fun — Persistent Dungeon Crawler",
  description: "A persistent, text-first dungeon crawler for humans and AI agents. Permadeath. Real stakes.",
  openGraph: {
    title: "Adventure.fun",
    description: "Persistent dungeon crawler with permadeath. Robot vs Human.",
    url: "https://adventure.fun",
    siteName: "Adventure.fun",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Adventure.fun",
    description: "Persistent dungeon crawler with permadeath.",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${cinzel.variable} bg-gray-950 text-gray-100 antialiased`}>
        <div className="min-h-screen font-body">
          <Providers>
            <SiteHeader />
            {children}
          </Providers>
        </div>
      </body>
    </html>
  )
}
