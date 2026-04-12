import { describe, expect, it } from "bun:test"
import { SpendingTracker } from "./spending-tracker.js"

type BeforePaymentHook = (context: {
  paymentRequired: { accepts: unknown[] }
  selectedRequirements: {
    scheme: string
    network: string
    asset: string
    amount: string
    payTo: string
    maxTimeoutSeconds: number
    extra: Record<string, unknown>
  }
}) => Promise<void | { abort: true; reason: string }>

type AfterPaymentHook = (context: {
  paymentRequired: { accepts: unknown[] }
  selectedRequirements: {
    scheme: string
    network: string
    asset: string
    amount: string
    payTo: string
    maxTimeoutSeconds: number
    extra: Record<string, unknown>
  }
  paymentPayload: {
    x402Version: number
    accepted: {
      scheme: string
      network: string
      asset: string
      amount: string
      payTo: string
      maxTimeoutSeconds: number
      extra: Record<string, unknown>
    }
    payload: Record<string, unknown>
  }
}) => Promise<void>

class MockX402Client {
  beforeHooks: BeforePaymentHook[] = []
  afterHooks: AfterPaymentHook[] = []

  onBeforePaymentCreation(hook: BeforePaymentHook): this {
    this.beforeHooks.push(hook)
    return this
  }

  onAfterPaymentCreation(hook: AfterPaymentHook): this {
    this.afterHooks.push(hook)
    return this
  }
}

describe("SpendingTracker", () => {
  it("records x402 spend and blocks requests that exceed the cap", async () => {
    const tracker = new SpendingTracker({ maxSpendUsd: 0.25, spendingWindow: "total" })
    const client = new MockX402Client()

    tracker.attach(client as never)
    expect(client.beforeHooks).toHaveLength(1)
    expect(client.afterHooks).toHaveLength(1)

    await client.afterHooks[0]?.({
      paymentRequired: { accepts: [] },
      selectedRequirements: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "200000",
        payTo: "0xpayee",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: "eip155:8453",
          asset: "USDC",
          amount: "200000",
          payTo: "0xpayee",
          maxTimeoutSeconds: 300,
          extra: {},
        },
        payload: {},
      },
    } as never)

    expect(tracker.canSpend(50_000n)).toBe(true)
    expect(tracker.canSpend(60_000n)).toBe(false)

    const blocked = await client.beforeHooks[0]?.({
      paymentRequired: { accepts: [] },
      selectedRequirements: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "60000",
        payTo: "0xpayee",
        maxTimeoutSeconds: 300,
        extra: {},
      },
    } as never)

    expect(blocked).toEqual({
      abort: true,
      reason: "spending cap reached",
    })
  })

  it("lets hard-cap sleep exit when the agent stops running", async () => {
    const tracker = new SpendingTracker({ maxSpendUsd: 0, spendingWindow: "total" })
    let running = true

    const sleeping = tracker.sleepUntilBudgetResets(() => running)
    setTimeout(() => {
      running = false
    }, 10)

    await expect(sleeping).resolves.toBeUndefined()
  })
})
