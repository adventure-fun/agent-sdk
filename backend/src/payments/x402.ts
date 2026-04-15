import type { Context } from "hono"
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server"
import { registerExactEvmScheme } from "@x402/evm/exact/server"
import { registerExactSvmScheme } from "@x402/svm/exact/server"
import { generateJwt } from "@coinbase/cdp-sdk/auth"
import type { PaymentAcceptOption402, PaymentRequired402 } from "@adventure-fun/schemas"
import { db } from "../db/client.js"

const COINBASE_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402"
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator"
const BASE_MAINNET = "eip155:8453"
const BASE_SEPOLIA = "eip155:84532"
const SOLANA_MAINNET = "solana:mainnet"
const SOLANA_DEVNET = "solana:devnet"
const BASE_USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const BASE_USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const SOLANA_USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const SOLANA_USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

export type PaymentAction =
  | "stat_reroll"
  | "realm_generate"
  | "realm_regen"
  | "inn_rest"

export type PaymentNetwork = "base" | "solana"

interface PaymentActionConfig {
  action: PaymentAction
  priceUsd: string
  description: string
}

export interface SettledPayment {
  action: PaymentAction | "withdraw"
  txHash: string
  network: string
  amountUsd: string
  headers: Record<string, string>
}

type PaymentPayloadLike = {
  x402Version: number
  accepted: PaymentAcceptOption402
}
type Caip2 = `${string}:${string}`

function isTestnet(): boolean {
  return (process.env["X402_TESTNET"] ?? "true").toLowerCase() !== "false"
}

function getBaseNetwork(): Caip2 {
  return (isTestnet() ? BASE_SEPOLIA : BASE_MAINNET) as Caip2
}

function getSolanaNetwork(): Caip2 {
  return (isTestnet() ? SOLANA_DEVNET : SOLANA_MAINNET) as Caip2
}

export function getDefaultBaseRpcUrl(): string {
  return isTestnet() ? "https://sepolia.base.org" : "https://mainnet.base.org"
}

export function getDefaultSolanaRpcUrl(): string {
  return isTestnet()
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com"
}

export function getConfiguredBaseRpcUrl(): string {
  return process.env["BASE_RPC_URL"] ?? getDefaultBaseRpcUrl()
}

export function getConfiguredSolanaRpcUrl(): string {
  return process.env["SOLANA_RPC_URL"] ?? getDefaultSolanaRpcUrl()
}

function getEvmAsset(): string {
  return isTestnet() ? BASE_USDC_SEPOLIA : BASE_USDC_MAINNET
}

function getSolanaAsset(): string {
  return isTestnet() ? SOLANA_USDC_DEVNET : SOLANA_USDC_MAINNET
}

function getActionConfig(action: PaymentAction): PaymentActionConfig {
  switch (action) {
    case "stat_reroll":
      return {
        action,
        priceUsd: process.env["PRICE_STAT_REROLL"] ?? "0.10",
        description: "Re-roll character stats",
      }
    case "realm_generate":
      return {
        action,
        priceUsd: process.env["PRICE_REALM_GENERATE"] ?? "0.25",
        description: "Generate a new realm",
      }
    case "realm_regen":
      return {
        action,
        priceUsd: process.env["PRICE_REALM_REGEN"] ?? "0.25",
        description: "Regenerate a completed realm",
      }
    case "inn_rest":
      return {
        action,
        priceUsd: process.env["PRICE_INN_REST"] ?? "0.05",
        description: "Rest at the inn",
      }
  }
}

function getFacilitatorUrl(): string {
  return process.env["X402_FACILITATOR_URL"]
    ?? (isTestnet() ? TESTNET_FACILITATOR_URL : COINBASE_FACILITATOR_URL)
}

function usesCoinbaseFacilitator(url: string): boolean {
  try {
    return new URL(url).host === "api.cdp.coinbase.com"
  } catch {
    return false
  }
}

function getCdpCredentials() {
  return {
    apiKeyId: process.env["CDP_API_KEY_ID"],
    apiKeySecret: process.env["CDP_API_KEY_SECRET"],
  }
}

async function createCoinbaseAuthHeaders(
  facilitatorUrl: string,
): Promise<{ verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string> }> {
  const { apiKeyId, apiKeySecret } = getCdpCredentials()
  if (!apiKeyId || !apiKeySecret) {
    throw new Error(
      "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required when using the Coinbase x402 facilitator",
    )
  }

  const url = new URL(facilitatorUrl)
  const host = url.host
  const basePath = url.pathname.replace(/\/+$/, "")

  const createHeader = async (requestPath: string, method: string = "POST") => {
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: host,
      requestPath,
      expiresIn: 120,
    })
    return { Authorization: `Bearer ${jwt}` }
  }

  return {
    verify: await createHeader(`${basePath}/verify`),
    settle: await createHeader(`${basePath}/settle`),
    supported: await createHeader(`${basePath}/supported`, "GET"),
  }
}

const facilitatorUrl = getFacilitatorUrl()
const facilitatorClient = new HTTPFacilitatorClient({
  url: facilitatorUrl,
  createAuthHeaders: usesCoinbaseFacilitator(facilitatorUrl)
    ? () => createCoinbaseAuthHeaders(facilitatorUrl)
    : undefined,
})

const resourceServer = new x402ResourceServer(facilitatorClient)
registerExactEvmScheme(resourceServer)
registerExactSvmScheme(resourceServer)

const httpResourceServer = new x402HTTPResourceServer(resourceServer as never, {})

let initializationPromise: Promise<void> | null = null

async function ensureInitialized(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await resourceServer.initialize()
      await httpResourceServer.initialize()
    })()
  }
  return initializationPromise
}

async function buildRequirement(
  action: PaymentAction,
  network: Caip2,
  payTo: string,
): Promise<PaymentAcceptOption402> {
  const config = getActionConfig(action)
  const requirements = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network,
    price: `$${config.priceUsd}`,
    payTo,
    maxTimeoutSeconds: 300,
    extra: {
      action,
      displayPriceUsd: config.priceUsd,
      description: config.description,
      baseRpcUrl: getConfiguredBaseRpcUrl(),
      solanaRpcUrl: getConfiguredSolanaRpcUrl(),
    },
  })

  const [requirement] = requirements as PaymentAcceptOption402[]
  if (!requirement) {
    throw new Error(`Failed to build x402 payment requirements for ${action} on ${network}`)
  }
  return requirement
}

export async function buildPaymentRequirements(
  action: PaymentAction,
  networks: PaymentNetwork[] = ["base"],
): Promise<PaymentRequired402> {
  await ensureInitialized()

  const accepts: PaymentAcceptOption402[] = []

  if (networks.includes("base")) {
    const evmPayTo = process.env["PLATFORM_WALLET_ADDRESS"]
    if (!evmPayTo) {
      throw new Error("PLATFORM_WALLET_ADDRESS must be set for Base payments")
    }
    accepts.push(await buildRequirement(action, getBaseNetwork(), evmPayTo))
  }

  if (networks.includes("solana")) {
    const solanaPayTo = process.env["PLATFORM_WALLET_ADDRESS_SOLANA"]
    if (!solanaPayTo) {
      throw new Error("PLATFORM_WALLET_ADDRESS_SOLANA must be set for Solana payments")
    }
    accepts.push(await buildRequirement(action, getSolanaNetwork(), solanaPayTo))
  }

  if (accepts.length === 0) {
    throw new Error("At least one payment network must be specified")
  }

  const config = getActionConfig(action)
  return {
    x402Version: 2,
    accepts,
    description: config.description,
    mimeType: "application/json",
  }
}

const VALID_NETWORKS: PaymentNetwork[] = ["base", "solana"]

export function getRequestedNetworks(c: Context): PaymentNetwork[] {
  const header = c.req.header("X-Payment-Network")
  if (!header) return ["base"]
  const requested = header.split(",").map((s) => s.trim().toLowerCase()) as PaymentNetwork[]
  const valid = requested.filter((n) => VALID_NETWORKS.includes(n))
  return valid.length > 0 ? valid : ["base"]
}

function getAdapter(c: Context) {
  return {
    getHeader(name: string): string | undefined {
      return c.req.header(name)
    },
  }
}

// Map CAIP-2 network IDs to friendly names expected by x402-fetch client
const CAIP2_TO_FRIENDLY: Record<string, string> = {
  "eip155:8453": "base",
  "eip155:84532": "base-sepolia",
  "solana:mainnet": "solana",
  "solana:devnet": "solana-devnet",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana-devnet",
}

// Reverse map: friendly names back to CAIP-2
const FRIENDLY_TO_CAIP2: Record<string, string> = Object.fromEntries(
  Object.entries(CAIP2_TO_FRIENDLY).map(([k, v]) => [v, k]),
)

export async function return402(c: Context, action: PaymentAction, networks?: PaymentNetwork[]): Promise<Response> {
  const paymentRequired = await buildPaymentRequirements(action, networks)
  const headers = ((httpResourceServer as unknown as {
    createHTTPPaymentRequiredResponse: (paymentRequired: PaymentRequired402) => { headers: Record<string, string> }
  }).createHTTPPaymentRequiredResponse(paymentRequired).headers)
  Object.entries(headers).forEach(([key, value]) => c.header(key as string, value))

  const resource = c.req.url

  // Transform accepts to the format expected by x402-fetch (v1 schema)
  const accepts = paymentRequired.accepts.map((opt) => ({
    ...opt,
    network: CAIP2_TO_FRIENDLY[opt.network] ?? opt.network,
    maxAmountRequired: (opt as Record<string, unknown>).amount as string,
    resource,
    description: paymentRequired.description,
    mimeType: paymentRequired.mimeType,
  }))

  return c.json(
    {
      x402Version: paymentRequired.x402Version,
      accepts,
      error: "Payment required",
      action,
      price_usd: getActionConfig(action).priceUsd,
    },
    402,
  )
}

function extractPaymentPayload(c: Context): PaymentPayloadLike | null {
  // x402-fetch v1 sends "X-PAYMENT", @x402/core v2 expects "PAYMENT-SIGNATURE"
  const header = c.req.header("x-payment") ?? c.req.header("payment-signature")
  if (!header) return null
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"))

    // Convert friendly network names back to CAIP-2
    if (decoded.network && FRIENDLY_TO_CAIP2[decoded.network]) {
      decoded.network = FRIENDLY_TO_CAIP2[decoded.network]
    }
    if (decoded.accepted?.network && FRIENDLY_TO_CAIP2[decoded.accepted.network]) {
      decoded.accepted.network = FRIENDLY_TO_CAIP2[decoded.accepted.network]
    }

    return decoded as PaymentPayloadLike
  } catch {
    return null
  }
}

export async function verifyAndSettle(
  c: Context,
  action: PaymentAction,
  networks?: PaymentNetwork[],
): Promise<SettledPayment | null> {
  await ensureInitialized()

  const paymentPayload = extractPaymentPayload(c)
  if (!paymentPayload) return null

  const paymentRequired = await buildPaymentRequirements(action, networks)

  // x402-fetch v1 sends {scheme, network} at root level, not in an "accepted" field.
  // @x402/core v2 findMatchingRequirements expects deepEqual on the full accepted option,
  // which won't work. Match on scheme + network ourselves.
  const payloadScheme = paymentPayload.accepted?.scheme ?? (paymentPayload as Record<string, unknown>).scheme as string
  const payloadNetwork = paymentPayload.accepted?.network ?? (paymentPayload as Record<string, unknown>).network as string
  const requirements = paymentRequired.accepts.find(
    (opt) => opt.scheme === payloadScheme && opt.network === payloadNetwork,
  )

  if (!requirements) {
    throw new Error("Payment requirements did not match the submitted payment signature")
  }

  // Reconstruct v2-compatible payload with the full accepted option for verify/settle
  paymentPayload.x402Version = 2
  paymentPayload.accepted = requirements

  const verifyResult = await resourceServer.verifyPayment(paymentPayload as never, requirements as never)
  if (!verifyResult.isValid) {
    throw new Error(verifyResult.invalidMessage ?? verifyResult.invalidReason ?? "Payment verification failed")
  }

  const settleResult = await resourceServer.settlePayment(paymentPayload as never, requirements as never)
  if (!settleResult.success) {
    throw new Error(settleResult.errorMessage ?? settleResult.errorReason ?? "Payment settlement failed")
  }

  const headers = (httpResourceServer as unknown as {
    createSettlementHeaders: (settleResponse: unknown) => Record<string, string>
  }).createSettlementHeaders(settleResult)
  return {
    action,
    txHash: settleResult.transaction,
    network: settleResult.network,
    amountUsd: getActionConfig(action).priceUsd,
    headers,
  }
}

// ── Withdraw flow ───────────────────────────────────────────────────────────
// A withdraw is a user-initiated x402 payment with a dynamic amount and a
// dynamic payTo (the user's chosen destination). EIP-3009's
// transferWithAuthorization cryptographically binds {from, to, value, nonce},
// so the backend cannot redirect funds or alter the amount after the user
// signs. The facilitator pays the gas, making the transfer gasless.

export async function buildWithdrawRequirements(
  amountUsd: string,
  destination: string,
): Promise<PaymentRequired402> {
  await ensureInitialized()

  const network = getBaseNetwork()
  const requirements = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network,
    price: `$${amountUsd}`,
    payTo: destination,
    maxTimeoutSeconds: 300,
    extra: {
      action: "withdraw",
      displayPriceUsd: amountUsd,
      description: `Withdraw ${amountUsd} USDC`,
      baseRpcUrl: getConfiguredBaseRpcUrl(),
    },
  })

  const [requirement] = requirements as PaymentAcceptOption402[]
  if (!requirement) {
    throw new Error("Failed to build withdraw payment requirements")
  }

  return {
    x402Version: 2,
    accepts: [requirement],
    description: `Withdraw ${amountUsd} USDC`,
    mimeType: "application/json",
  }
}

export async function return402Withdraw(
  c: Context,
  amountUsd: string,
  destination: string,
): Promise<Response> {
  const paymentRequired = await buildWithdrawRequirements(amountUsd, destination)
  const headers = ((httpResourceServer as unknown as {
    createHTTPPaymentRequiredResponse: (paymentRequired: PaymentRequired402) => { headers: Record<string, string> }
  }).createHTTPPaymentRequiredResponse(paymentRequired).headers)
  Object.entries(headers).forEach(([key, value]) => c.header(key as string, value))

  const resource = c.req.url

  const accepts = paymentRequired.accepts.map((opt) => ({
    ...opt,
    network: CAIP2_TO_FRIENDLY[opt.network] ?? opt.network,
    maxAmountRequired: (opt as unknown as Record<string, unknown>).amount as string,
    resource,
    description: paymentRequired.description,
    mimeType: paymentRequired.mimeType,
  }))

  return c.json(
    {
      x402Version: paymentRequired.x402Version,
      accepts,
      error: "Payment required",
      action: "withdraw",
      price_usd: amountUsd,
    },
    402,
  )
}

export async function verifyAndSettleWithdraw(
  c: Context,
  amountUsd: string,
  destination: string,
): Promise<SettledPayment | null> {
  await ensureInitialized()

  const paymentPayload = extractPaymentPayload(c)
  if (!paymentPayload) return null

  const paymentRequired = await buildWithdrawRequirements(amountUsd, destination)

  const payloadScheme = paymentPayload.accepted?.scheme ?? (paymentPayload as Record<string, unknown>).scheme as string
  const payloadNetwork = paymentPayload.accepted?.network ?? (paymentPayload as Record<string, unknown>).network as string
  const requirements = paymentRequired.accepts.find(
    (opt) => opt.scheme === payloadScheme && opt.network === payloadNetwork,
  )

  if (!requirements) {
    throw new Error("Payment requirements did not match the submitted payment signature")
  }

  paymentPayload.x402Version = 2
  paymentPayload.accepted = requirements

  const verifyResult = await resourceServer.verifyPayment(paymentPayload as never, requirements as never)
  if (!verifyResult.isValid) {
    throw new Error(verifyResult.invalidMessage ?? verifyResult.invalidReason ?? "Payment verification failed")
  }

  const settleResult = await resourceServer.settlePayment(paymentPayload as never, requirements as never)
  if (!settleResult.success) {
    throw new Error(settleResult.errorMessage ?? settleResult.errorReason ?? "Payment settlement failed")
  }

  const headers = (httpResourceServer as unknown as {
    createSettlementHeaders: (settleResponse: unknown) => Record<string, string>
  }).createSettlementHeaders(settleResult)
  return {
    action: "withdraw",
    txHash: settleResult.transaction,
    network: settleResult.network,
    amountUsd,
    headers,
  }
}

export async function logPayment(
  accountId: string,
  payment: { action: PaymentAction | "withdraw"; amountUsd: string; network: string; txHash: string },
  destination?: string,
): Promise<void> {
  await db.from("payment_log").insert({
    account_id: accountId,
    action: payment.action,
    amount_usd: payment.amountUsd,
    chain: payment.network,
    tx_hash: payment.txHash,
    destination: destination ?? null,
  })
}

export function getX402Defaults() {
  return {
    facilitatorUrl: getFacilitatorUrl(),
    baseNetwork: getBaseNetwork(),
    solanaNetwork: getSolanaNetwork(),
    evmAsset: getEvmAsset(),
    solanaAsset: getSolanaAsset(),
    baseRpcUrl: getConfiguredBaseRpcUrl(),
    solanaRpcUrl: getConfiguredSolanaRpcUrl(),
  }
}

const ALL_PAYMENT_ACTIONS: readonly PaymentAction[] = [
  "stat_reroll",
  "realm_generate",
  "realm_regen",
  "inn_rest",
] as const

export function getAllActionPrices(): Record<PaymentAction, string> {
  const out = {} as Record<PaymentAction, string>
  for (const action of ALL_PAYMENT_ACTIONS) {
    out[action] = getActionConfig(action).priceUsd
  }
  return out
}

// A price of "0" (or any non-positive value) means the action is free — skip
// x402 entirely. The facilitator can't settle a $0 payment, so we must not
// return 402 for these actions.
export function isActionFree(action: PaymentAction): boolean {
  const n = parseFloat(getActionConfig(action).priceUsd)
  return Number.isFinite(n) && n <= 0
}

// Stable error codes surfaced by paid routes. Frontend's `friendlyPaymentError`
// matches on these, so don't rename without coordinating both sides.
export type PaymentErrorCode =
  | "insufficient_funds"
  | "invalid_signature"
  | "nonce_already_used"
  | "authorization_expired"
  | "facilitator_unreachable"
  | "verification_failed"
  | "settlement_failed"
  | "invalid_payload"
  | "invalid_network"
  | "unknown"

export interface PaymentErrorResponse {
  error: string
  code: PaymentErrorCode
}

export function mapPaymentError(err: unknown): PaymentErrorResponse {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()

  if (lower.includes("insufficient")) {
    return { error: "Not enough USDC in your wallet to settle this payment.", code: "insufficient_funds" }
  }
  if (lower.includes("nonce") && (lower.includes("used") || lower.includes("replay"))) {
    return { error: "This payment was already submitted. Refresh and try again.", code: "nonce_already_used" }
  }
  if (lower.includes("expired") || lower.includes("valid_before") || lower.includes("valid_after")) {
    return { error: "Payment authorization expired before settlement. Try again.", code: "authorization_expired" }
  }
  if (lower.includes("signature") || lower.includes("invalid_exact_evm_payload_signature")) {
    return { error: "Payment signature could not be verified. Try again.", code: "invalid_signature" }
  }
  if (lower.includes("facilitator") || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("network")) {
    return { error: "Payment network is taking too long to respond. Try again in a moment.", code: "facilitator_unreachable" }
  }
  if (lower.includes("verification")) {
    return { error: "Payment verification failed. Please try again.", code: "verification_failed" }
  }
  if (lower.includes("settlement") || lower.includes("settle")) {
    return { error: "Payment settlement failed. Please try again.", code: "settlement_failed" }
  }
  if (lower.includes("invalid_payload") || lower.includes("malformed")) {
    return { error: "Payment payload was malformed. Refresh and try again.", code: "invalid_payload" }
  }
  if (lower.includes("invalid_network") || lower.includes("unsupported network")) {
    return { error: "Unsupported network. Make sure you're on Base.", code: "invalid_network" }
  }
  return { error: "Payment could not be completed. Please try again.", code: "unknown" }
}
