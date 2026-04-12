import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { privateKeyToAccount } from "viem/accounts"
import { verifyMessage } from "viem"
import { EvmEnvWalletAdapter, createWalletAdapter } from "../../../src/adapters/wallet/index.js"

const EVM_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044976f7d9f7ea3a4b64c9d8d0f9ac1c9c1a40add3521e"

const ORIGINAL_ENV = {
  AGENT_PRIVATE_KEY: process.env["AGENT_PRIVATE_KEY"],
  EVM_PRIVATE_KEY: process.env["EVM_PRIVATE_KEY"],
}

const ORIGINAL_FETCH = globalThis.fetch

describe("wallet adapters", () => {
  beforeEach(() => {
    process.env["AGENT_PRIVATE_KEY"] = EVM_PRIVATE_KEY
    delete process.env["EVM_PRIVATE_KEY"]
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH

    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("creates an EVM env wallet adapter from config defaults", async () => {
    const adapter = await createWalletAdapter({
      type: "env",
      network: "base",
    })

    expect(adapter).toBeInstanceOf(EvmEnvWalletAdapter)
    expect(adapter.getNetwork()).toBe("base")
  })

  it("derives the expected EVM address and signs auth messages", async () => {
    const adapter = await EvmEnvWalletAdapter.fromConfig({
      type: "env",
      network: "base",
      privateKey: EVM_PRIVATE_KEY,
    })
    const account = privateKeyToAccount(EVM_PRIVATE_KEY)
    const message = "nonce-123"

    const address = await adapter.getAddress()
    const signature = await adapter.signMessage(message)

    expect(address).toBe(account.address)
    expect(
      await verifyMessage({
        address: account.address,
        message,
        signature,
      }),
    ).toBe(true)
  })

  it("signs EVM transactions when the request includes EIP-1559 fields", async () => {
    const adapter = await EvmEnvWalletAdapter.fromConfig({
      type: "env",
      network: "base",
      privateKey: EVM_PRIVATE_KEY,
    })

    const signed = await adapter.signTransaction({
      to: "0x1111111111111111111111111111111111111111",
      value: "0",
      chainId: 8453,
      nonce: 0,
      gas: "21000",
      maxFeePerGas: "1",
      maxPriorityFeePerGas: "1",
    })

    expect(signed.startsWith("0x02")).toBe(true)
  })

})
