import { afterEach, describe, expect, it, mock } from "bun:test"

const ORIGINAL_ENV = {
  AGENT_PRIVATE_KEY: process.env["AGENT_PRIVATE_KEY"],
  SVM_PRIVATE_KEY: process.env["SVM_PRIVATE_KEY"],
}

async function importFreshWalletModule() {
  mock.module("@scure/base", () => ({
    base58: {
      decode: (value: string) => new Uint8Array([value.length, 7, 9]),
      encode: (value: Uint8Array) => `base58:${Array.from(value).join(",")}`,
    },
  }))
  mock.module("@solana/kit", () => ({
    createKeyPairSignerFromBytes: async (bytes: Uint8Array) => ({
      address: `Solana:${bytes[0]}`,
      keyPair: { privateKey: "private-key" as unknown as CryptoKey },
      signTransactions: async () => [],
    }),
    signBytes: async (_privateKey: CryptoKey, bytes: Uint8Array) =>
      new Uint8Array([bytes.length, 4, 2]),
  }))

  return import(`../../../src/adapters/wallet/index.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("solana env wallet adapter", () => {
  afterEach(() => {
    mock.restore()

    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it("creates a Solana wallet adapter with lazy-loaded dependencies", async () => {
    process.env["SVM_PRIVATE_KEY"] = "solana-private-key"
    const { SolanaEnvWalletAdapter, createWalletAdapter } = await importFreshWalletModule()

    const adapter = await createWalletAdapter({
      type: "env",
      network: "solana",
    })

    expect(adapter).toBeInstanceOf(SolanaEnvWalletAdapter)
    expect(adapter.getNetwork()).toBe("solana")
    expect(await adapter.getAddress()).toBe("Solana:18")
    expect(await adapter.signMessage("hello")).toBe("base58:5,4,2")
  })

  it("throws a descriptive error for generic direct Solana transaction signing", async () => {
    const { SolanaEnvWalletAdapter } = await importFreshWalletModule()
    const adapter = await SolanaEnvWalletAdapter.fromConfig({
      type: "env",
      network: "solana",
      privateKey: "solana-private-key",
    })

    await expect(
      adapter.signTransaction({
        to: "11111111111111111111111111111111",
        value: "0",
      }),
    ).rejects.toThrow("Direct Solana transaction signing")
  })
})
