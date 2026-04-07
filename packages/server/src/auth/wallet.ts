import { verifyMessage } from "viem"

/**
 * Verifies an EVM wallet signature against a message (nonce).
 * Works for both Coinbase embedded wallets and raw key signers.
 */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })
    return valid
  } catch {
    return false
  }
}
