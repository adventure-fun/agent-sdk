import type { Metadata } from "next"
import "./globals.css"

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
      <body className="bg-gray-950 text-gray-100 font-mono antialiased">
        {children}
      </body>
    </html>
  )
}
