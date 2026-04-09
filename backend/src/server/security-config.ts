const allowedOrigins = new Set(
  (process.env["CORS_ALLOWED_ORIGINS"]
    ?? "http://localhost:3000,http://localhost:5555,http://127.0.0.1:5555")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
)

const maxWsConnectionsPerAccount = Number(process.env["MAX_WS_CONNECTIONS_PER_ACCOUNT"] ?? 5)
const wsConnectionsByAccount = new Map<string, number>()

export function resolveCorsOrigin(origin: string | undefined, pathname: string): string {
  const isPublicRoute = pathname === "/health"
    || pathname.startsWith("/content/")
    || pathname.startsWith("/leaderboard/")
    || pathname.startsWith("/legends/")
    || pathname.startsWith("/spectate/")

  if (!origin) return isPublicRoute ? "*" : ""
  if (isPublicRoute) return origin
  return allowedOrigins.has(origin) ? origin : ""
}

export function canOpenWebSocket(accountId: string): boolean {
  return (wsConnectionsByAccount.get(accountId) ?? 0) < maxWsConnectionsPerAccount
}

export function registerWebSocketOpen(accountId: string): void {
  wsConnectionsByAccount.set(accountId, (wsConnectionsByAccount.get(accountId) ?? 0) + 1)
}

export function registerWebSocketClose(accountId: string): void {
  const current = wsConnectionsByAccount.get(accountId) ?? 0
  if (current <= 1) wsConnectionsByAccount.delete(accountId)
  else wsConnectionsByAccount.set(accountId, current - 1)
}

export function resetSecurityState(): void {
  wsConnectionsByAccount.clear()
}
