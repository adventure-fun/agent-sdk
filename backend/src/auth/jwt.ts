import { SignJWT, jwtVerify } from "jose"

const DEFAULT_SECRET = "dev-secret-change-in-production-min-32-chars"
const sessionSecret = process.env["SESSION_SECRET"] ?? DEFAULT_SECRET

// Development and test (CI) are allowed to fall back to the default secret.
// Production must set SESSION_SECRET to a strong value.
const isNonProdEnv =
  process.env["NODE_ENV"] === "development" ||
  process.env["NODE_ENV"] === "test"
if (
  !isNonProdEnv
  && (!process.env["SESSION_SECRET"] || sessionSecret === DEFAULT_SECRET)
) {
  throw new Error("SESSION_SECRET must be set to a strong value outside development")
}

const secret = new TextEncoder().encode(sessionSecret)

export interface SessionPayload {
  account_id: string
  wallet_address: string
  player_type: "human" | "agent"
}

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
