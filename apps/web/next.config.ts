import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@adventure-fun/schemas", "@adventure-fun/agent-sdk"],
  experimental: {
    // Enable when needed: serverActions, ppr
  },
}

export default nextConfig
