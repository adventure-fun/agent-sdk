import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@adventure-fun/schemas", "@adventure-fun/agent-sdk"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001"
    // Use `fallback` (not the plain array) so dynamic file-system routes
    // like `/api/og/[type]/[id]` are checked BEFORE the backend proxy.
    // `fallback` rewrites run after all filesystem + dynamic route matching,
    // which is exactly what the local OG image endpoint needs.
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/:path*`,
        },
      ],
    }
  },
  experimental: {
    // Enable when needed: serverActions, ppr
  },
}

export default nextConfig
