import type { Context, Next } from "hono"
import { SignJWT, jwtVerify } from "jose"
import type { SessionPayload } from "./store.js"

declare module "hono" {
  interface ContextVariableMap {
    session: SessionPayload
  }
}

const DEFAULT_SECRET = "agent-sdk-dev-secret-change-before-production"
const secret = new TextEncoder().encode(process.env["SESSION_SECRET"] ?? DEFAULT_SECRET)

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret)
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret)
  return payload as unknown as SessionPayload
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
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
