import { Hono } from "hono"
import { isAddress, getAddress } from "viem"
import { requireAuth } from "../auth/middleware.js"
import {
  logPayment,
  mapPaymentError,
  return402Withdraw,
  verifyAndSettleWithdraw,
} from "../payments/x402.js"

const wallet = new Hono()

const WITHDRAW_MIN_USD = 0.25
const WITHDRAW_MAX_USD = 50

interface WithdrawBody {
  amount_usd?: unknown
  destination?: unknown
}

// POST /wallet/withdraw — gasless USDC withdraw via x402 dynamic payTo.
// EIP-3009 binds {from, to, value, nonce} cryptographically, so the user's
// signature can't be redirected by the server. The facilitator pays the gas.
wallet.post("/withdraw", requireAuth, async (c) => {
  const { account_id, wallet_address } = c.get("session")
  const body = (await c.req.json().catch(() => ({}))) as WithdrawBody

  const amount_usd = typeof body.amount_usd === "string" ? body.amount_usd.trim() : ""
  const destinationRaw = typeof body.destination === "string" ? body.destination.trim() : ""

  if (!amount_usd || !destinationRaw) {
    return c.json({ error: "amount_usd and destination are required", code: "invalid_request" }, 400)
  }

  if (!isAddress(destinationRaw)) {
    return c.json({ error: "Destination is not a valid EVM address", code: "invalid_destination" }, 400)
  }
  const destination = getAddress(destinationRaw)

  const amountNum = Number.parseFloat(amount_usd)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return c.json({ error: "Amount must be a positive number", code: "invalid_amount" }, 400)
  }
  if (amountNum < WITHDRAW_MIN_USD) {
    return c.json(
      { error: `Minimum withdraw is $${WITHDRAW_MIN_USD.toFixed(2)} USDC`, code: "amount_below_min" },
      400,
    )
  }
  if (amountNum > WITHDRAW_MAX_USD) {
    return c.json(
      { error: `Maximum single withdraw is $${WITHDRAW_MAX_USD.toFixed(2)} USDC`, code: "amount_above_max" },
      400,
    )
  }

  const platformWallet = (process.env["PLATFORM_WALLET_ADDRESS"] ?? "").toLowerCase()
  if (destination.toLowerCase() === platformWallet) {
    return c.json({ error: "Cannot withdraw to the platform wallet", code: "destination_blocked" }, 400)
  }
  if (wallet_address && destination.toLowerCase() === wallet_address.toLowerCase()) {
    return c.json({ error: "Destination matches your source wallet", code: "destination_self" }, 400)
  }

  // First request: no x-payment header → return 402 with dynamic payTo so the
  // x402 client can sign EIP-3009 transferWithAuthorization for this exact
  // destination + amount.
  let settled
  try {
    settled = await verifyAndSettleWithdraw(c, amount_usd, destination)
  } catch (err) {
    console.error("[wallet/withdraw] verifyAndSettleWithdraw failed", err)
    return c.json(mapPaymentError(err), 400)
  }

  if (!settled) {
    return return402Withdraw(c, amount_usd, destination)
  }

  Object.entries(settled.headers).forEach(([key, value]) => c.header(key, value))
  await logPayment(account_id, settled, destination)

  return c.json({
    txHash: settled.txHash,
    network: settled.network,
    amount_usd,
    destination,
  })
})

// GET /wallet/withdraw/limits — used by the frontend to show min/max in the modal
// without hardcoding the values in two places.
wallet.get("/withdraw/limits", (c) => {
  return c.json({
    min_usd: WITHDRAW_MIN_USD.toFixed(2),
    max_usd: WITHDRAW_MAX_USD.toFixed(2),
  })
})

export { wallet as walletRoutes }
