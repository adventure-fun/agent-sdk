import type { x402Client as X402Client } from "@x402/core/client"
import type { AgentLimitsConfig, SpendingWindow } from "./config.js"

const USDC_DECIMALS = 1_000_000n
const HARD_CAP_SLEEP_MS = 1_000
const WINDOW_SLEEP_MS = 1_000

export class SpendingTracker {
  private readonly maxSpendAtomic: bigint | null
  private readonly window: SpendingWindow
  private readonly enabled: boolean
  private attached = false
  private spentAtomic = 0n
  private windowKey: string

  constructor(limits?: AgentLimitsConfig) {
    this.maxSpendAtomic =
      typeof limits?.maxSpendUsd === "number" && Number.isFinite(limits.maxSpendUsd)
        ? usdToAtomic(limits.maxSpendUsd)
        : null
    this.window = limits?.spendingWindow ?? "total"
    this.enabled = this.maxSpendAtomic !== null
    this.windowKey = getWindowKey(this.window, Date.now())
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  get spendingWindow(): SpendingWindow {
    return this.window
  }

  attach(client: X402Client): void {
    if (!this.enabled || this.attached) {
      return
    }

    this.attached = true
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      this.refreshWindow()
      const nextAmount = parseAtomicAmount(selectedRequirements.amount)
      if (this.canSpend(nextAmount)) {
        return
      }

      return {
        abort: true as const,
        reason: "spending cap reached",
      }
    })

    client.onAfterPaymentCreation(async ({ selectedRequirements }) => {
      this.refreshWindow()
      this.spentAtomic += parseAtomicAmount(selectedRequirements.amount)
    })
  }

  canSpend(nextAmountAtomic: bigint = 0n): boolean {
    this.refreshWindow()
    return this.maxSpendAtomic === null || this.spentAtomic + nextAmountAtomic <= this.maxSpendAtomic
  }

  async sleepUntilBudgetResets(isRunning: () => boolean): Promise<void> {
    if (!this.enabled) {
      return
    }

    if (this.window === "total") {
      while (isRunning()) {
        await sleep(HARD_CAP_SLEEP_MS)
      }
      return
    }

    while (isRunning()) {
      this.refreshWindow()
      if (this.canSpend()) {
        return
      }

      const nextResetAt = this.getNextResetAt()
      if (nextResetAt === null) {
        return
      }

      const remainingMs = nextResetAt - Date.now()
      if (remainingMs <= 0) {
        this.refreshWindow()
        continue
      }

      await sleep(Math.min(remainingMs, WINDOW_SLEEP_MS))
    }
  }

  private refreshWindow(): void {
    if (!this.enabled || this.window === "total") {
      return
    }

    const currentKey = getWindowKey(this.window, Date.now())
    if (currentKey === this.windowKey) {
      return
    }

    this.windowKey = currentKey
    this.spentAtomic = 0n
  }

  private getNextResetAt(): number | null {
    if (!this.enabled || this.window === "total") {
      return null
    }

    const now = new Date()
    if (this.window === "hourly") {
      const nextHour = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours() + 1,
        0,
        0,
        0,
      )
      return nextHour
    }

    return Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    )
  }
}

function getWindowKey(window: SpendingWindow, timestamp: number): string {
  const date = new Date(timestamp)
  switch (window) {
    case "hourly":
      return [
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
      ].join(":")
    case "daily":
      return [
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      ].join(":")
    case "total":
      return "total"
  }
}

function usdToAtomic(usd: number): bigint {
  return BigInt(Math.max(0, Math.round(usd * Number(USDC_DECIMALS))))
}

function parseAtomicAmount(amount: string): bigint {
  try {
    return BigInt(amount)
  } catch {
    return 0n
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
