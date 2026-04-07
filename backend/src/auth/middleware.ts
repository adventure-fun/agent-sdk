import type { Context, Next } from "hono"
import { verifySession, type SessionPayload } from "./jwt.js"

declare module "hono" {
  interface ContextVariableMap {
    session: SessionPayload
  }
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization")
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const token = header.slice(7)
  try {
    const session = await verifySession(token)
    c.set("session", session)
    await next()
  } catch {
    return c.json({ error: "Invalid or expired session" }, 401)
  }
}
