import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const EVM_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044976f7d9f7ea3a4b64c9d8d0f9ac1c9c1a40add3521e"

const ORIGINAL_FETCH = globalThis.fetch

async function importFreshWalletModule() {
  return import(`../../../src/adapters/wallet/index.js?cacheBust=${Date.now()}-${Math.random()}`)
}

async function importFreshClientModule() {
  return import(`../../../src/client.js?cacheBust=${Date.now()}-${Math.random()}`)
}

describe("x402 wallet integration", () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    mock.restore()
  })

  it("delegates x402 client creation to x402-capable wallet adapters", async () => {
    const { createX402Client } = await importFreshWalletModule()
    const expectedClient = { kind: "x402-client" }

    const client = await createX402Client({
      getNetwork: () => "base",
      getAddress: async () => "0xabc",
      signMessage: async () => "sig",
      signTransaction: async () => "tx",
      createX402Client: async () => expectedClient as never,
    })

    expect(client).toBe(expectedClient)
  })

  it("registers the EVM x402 scheme for env wallets", async () => {
    mock.module("@x402/core/client", () => ({
      x402Client: class {
        registered?: unknown
      },
    }))
    mock.module("@x402/evm/exact/client", () => ({
      registerExactEvmScheme: (client: { registered?: unknown }, config: unknown) => {
        client.registered = config
        return client
      },
    }))

    const { EvmEnvWalletAdapter } = await import(
      `../../../src/adapters/wallet/env-wallet.js?cacheBust=${Date.now()}-${Math.random()}`
    )
    const adapter = await EvmEnvWalletAdapter.fromConfig({
      type: "env",
      network: "base",
      privateKey: EVM_PRIVATE_KEY,
    })

    const client = await adapter.createX402Client()

    expect(client).toHaveProperty("registered")
    expect((client as { registered: { signer: { address: string } } }).registered.signer.address)
      .toMatch(/^0x/)
  })

  it("registers the Solana x402 scheme for env wallets", async () => {
    mock.module("@x402/core/client", () => ({
      x402Client: class {
        registered?: unknown
      },
    }))
    mock.module("@x402/svm/exact/client", () => ({
      registerExactSvmScheme: (client: { registered?: unknown }, config: unknown) => {
        client.registered = config
        return client
      },
    }))
    mock.module("@scure/base", () => ({
      base58: {
        decode: () => new Uint8Array([1, 2, 3]),
        encode: () => "sig",
      },
    }))
    mock.module("@solana/kit", () => ({
      createKeyPairSignerFromBytes: async () => ({
        address: "Solana:adapter",
        keyPair: { privateKey: "private-key" as unknown as CryptoKey },
        signTransactions: async () => [],
      }),
      signBytes: async () => new Uint8Array([1, 2, 3]),
    }))

    const { SolanaEnvWalletAdapter } = await import(
      `../../../src/adapters/wallet/env-wallet.js?cacheBust=${Date.now()}-${Math.random()}`
    )
    const adapter = await SolanaEnvWalletAdapter.fromConfig({
      type: "env",
      network: "solana",
      privateKey: "solana-private-key",
    })

    const client = await adapter.createX402Client()

    expect(client).toHaveProperty("registered")
    expect((client as { registered: { signer: { address: string } } }).registered.signer.address)
      .toBe("Solana:adapter")
  })

  it("uses wrapFetchWithPayment and forwards payment headers in GameClient.request", async () => {
    let observedHeaders: Headers | null = null

    mock.module("@x402/fetch", () => ({
      wrapFetchWithPayment: (_fetch: typeof globalThis.fetch, _client: unknown) =>
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          observedHeaders = new Headers(init?.headers)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        },
    }))

    const { GameClient } = await importFreshClientModule()
    const client = new GameClient(
      "https://api.example.com",
      "wss://api.example.com",
      {
        token: "session-token",
        expires_at: Date.now() + 60_000,
      },
      {
        wallet: {
          getNetwork: () => "base",
          getAddress: async () => "0xabc",
          signMessage: async () => "sig",
          signTransaction: async () => "tx",
        },
        x402Client: {} as never,
      },
    )

    const response = await client.request<{ ok: boolean }>("/paid")

    expect(response.ok).toBe(true)
    expect(observedHeaders?.get("Authorization")).toBe("Bearer session-token")
    expect(observedHeaders?.get("X-Payment-Network")).toBe("base")
  })

  it("maps x402 wrapper failures to payment errors", async () => {
    mock.module("@x402/fetch", () => ({
      wrapFetchWithPayment: () => async () => {
        throw new Error("No scheme registered for payment network")
      },
    }))

    const { GameClient, GameClientError } = await importFreshClientModule()
    const client = new GameClient(
      "https://api.example.com",
      "wss://api.example.com",
      {
        token: "session-token",
        expires_at: Date.now() + 60_000,
      },
      {
        x402Client: {} as never,
      },
    )

    await expect(client.request("/paid")).rejects.toMatchObject({
      name: GameClientError.name,
      kind: "payment",
    })
  })
})
