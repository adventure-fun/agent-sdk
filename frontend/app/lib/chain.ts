// Single source of truth for the chain identity Adventure.fun settles
// payments on. Every surface that mentions "Base" or "Base Sepolia" — the
// site header account menu, the in-game account panel, the payment modal,
// the GetUsdcModal, and error messages — imports from here so the strings
// stay consistent and swapping testnet → mainnet needs a single env-var
// flip, not a grep-and-replace pass.

export const IS_TESTNET =
  (process.env["NEXT_PUBLIC_X402_TESTNET"] ?? "true").toLowerCase() !== "false"

/** Short chain label used in inline badges and subscripts. */
export const CHAIN_NAME = IS_TESTNET ? "Base Sepolia" : "Base"

/** Longer form used in testnet pills and helper copy where extra clarity helps. */
export const CHAIN_FULL = IS_TESTNET ? "Base Sepolia testnet" : "Base mainnet"

/** Canonical "currency on chain" label — used next to balances and prices. */
export const USDC_CHAIN_LABEL = `USDC on ${CHAIN_NAME}`

// Only outbound link in the entire GetUsdcModal. Mainnet has no links at
// all (no onramp partnership, no bridge endorsement) — the mainnet path
// explains options in plain text and surfaces the wallet address instead.
export const TESTNET_FAUCET_URL = "https://faucet.circle.com/"
