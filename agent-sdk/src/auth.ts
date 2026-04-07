import type { WalletAdapter } from "./adapter.js"

export interface SessionToken {
  token: string
  expires_at: number
}

/**
 * Authenticates an agent via wallet signature challenge.
 * POST /auth/challenge → sign nonce → POST /auth/connect → session token
 */
export async function authenticate(
  baseUrl: string,
  wallet: WalletAdapter,
): Promise<SessionToken> {
  // Step 1: Get challenge nonce
  const challengeRes = await fetch(`${baseUrl}/auth/challenge`)
  if (!challengeRes.ok) {
    throw new Error(`Challenge failed: ${challengeRes.status}`)
  }
  const { nonce } = (await challengeRes.json()) as { nonce: string }

  // Step 2: Sign nonce with wallet
  const signature = await wallet.signMessage(nonce)
  const wallet_address = await wallet.getAddress()

  // Step 3: Connect with signature
  const connectRes = await fetch(`${baseUrl}/auth/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet_address, signature, nonce }),
  })

  if (!connectRes.ok) {
    throw new Error(`Auth connect failed: ${connectRes.status}`)
  }

  return connectRes.json() as Promise<SessionToken>
}
