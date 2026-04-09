import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const ORIGINAL_ENV = {
  X402_TESTNET: process.env["X402_TESTNET"],
  X402_FACILITATOR_URL: process.env["X402_FACILITATOR_URL"],
  BASE_RPC_URL: process.env["BASE_RPC_URL"],
  SOLANA_RPC_URL: process.env["SOLANA_RPC_URL"],
}

async function importFreshX402Module() {
  mock.module("../src/db/client.js", () => ({
    db: {
      from() {
        return {
          insert() {
            return Promise.resolve({ data: null, error: null })
          },
        }
      },
    },
  }))

  return import(`../src/payments/x402.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("10.1 — x402 defaults", () => {
  beforeEach(() => {
    delete process.env["X402_FACILITATOR_URL"]
    delete process.env["BASE_RPC_URL"]
    delete process.env["SOLANA_RPC_URL"]
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("uses testnet defaults when X402_TESTNET is true", async () => {
    process.env["X402_TESTNET"] = "true"
    const mod = await importFreshX402Module()
    const defaults = mod.getX402Defaults()

    expect(defaults.baseNetwork).toBe("eip155:84532")
    expect(defaults.solanaNetwork).toBe("solana:devnet")
    expect(defaults.baseRpcUrl).toBe("https://sepolia.base.org")
    expect(defaults.solanaRpcUrl).toBe("https://api.devnet.solana.com")
  })

  it("uses mainnet defaults when X402_TESTNET is false", async () => {
    process.env["X402_TESTNET"] = "false"
    const mod = await importFreshX402Module()
    const defaults = mod.getX402Defaults()

    expect(defaults.baseNetwork).toBe("eip155:8453")
    expect(defaults.solanaNetwork).toBe("solana:mainnet")
    expect(defaults.baseRpcUrl).toBe("https://mainnet.base.org")
    expect(defaults.solanaRpcUrl).toBe("https://api.mainnet-beta.solana.com")
  })
})
