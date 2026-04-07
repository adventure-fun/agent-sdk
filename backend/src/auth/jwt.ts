import { SignJWT, jwtVerify } from "jose"

const secret = new TextEncoder().encode(
  process.env["SESSION_SECRET"] ?? "dev-secret-change-in-production-min-32-chars"
)

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
