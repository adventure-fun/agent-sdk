import { afterEach, describe, expect, it, mock } from "bun:test"

type OwsAccountInfo = {
  chainId: string
  address: string
  derivationPath: string
}

type OwsWalletInfo = {
  id: string
  name: string
  createdAt: string
  accounts: OwsAccountInfo[]
}

type MockedOwsModule = {
  getWallet: ReturnType<typeof mock>
  signMessage: ReturnType<typeof mock>
  signTransaction: ReturnType<typeof mock>
  signTypedData: ReturnType<typeof mock>
}

const TEST_ECDSA_SIGNATURE =
  "0x6e100a352ec6ad1b70802290e18aeed190704973570f3b8ed42cb9808e2ea6bf4a90a229a244495b41890987806fcbd2d5d23fc0dbe5f5256c2613c039d76db81c"

function createMockWallet(accounts: OwsAccountInfo[]): OwsWalletInfo {
  return {
    id: "wallet-1",
    name: "agent-treasury",
    createdAt: "2026-01-01T00:00:00Z",
    accounts,
  }
}

async function importFreshWalletModule(options?: {
  owsModule?: Partial<MockedOwsModule>
  missingOws?: boolean
}) {
  const owsModule: MockedOwsModule = {
    getWallet: mock(async () =>
      createMockWallet([
        {
          chainId: "eip155:8453",
          address: "0x1111111111111111111111111111111111111111",
          derivationPath: "m/44'/60'/0'/0/0",
        },
      ])),
    signMessage: mock(async () => ({ signature: "0xsigned-message" })),
    signTransaction: mock(async () => ({ signature: TEST_ECDSA_SIGNATURE })),
    signTypedData: mock(async () => ({ signature: "0xsigned-typed-data" })),
    ...options?.owsModule,
  }

  let capturedSigner: unknown

  class MockX402Client {}

  const registerExactEvmScheme = mock((client: unknown, config: { signer: unknown }) => {
    capturedSigner = config.signer
    return {
      client,
      signer: config.signer,
      registered: true,
    }
  })

  if (options?.missingOws) {
    mock.module("@open-wallet-standard/core", () => {
      throw new Error("Cannot find module '@open-wallet-standard/core'")
    })
  } else {
    mock.module("@open-wallet-standard/core", () => owsModule)
  }

  mock.module("@x402/core/client", () => ({ x402Client: MockX402Client }))
  mock.module("@x402/evm/exact/client", () => ({ registerExactEvmScheme }))

  const walletModule = await import(
    `../../../src/adapters/wallet/index.js?cacheBust=${Date.now()}-${Math.random()}`
  )

  return {
    ...walletModule,
    owsModule,
    registerExactEvmScheme,
    MockX402Client,
    getCapturedSigner: () => capturedSigner,
  }
}

describe("OpenWalletAdapter", () => {
  afterEach(() => {
    mock.restore()
  })

  it("requires the OWS SDK to be installed", async () => {
    const { OpenWalletAdapter } = await importFreshWalletModule({
      missingOws: true,
    })

    await expect(
      OpenWalletAdapter.fromConfig({
        type: "open-wallet",
        walletName: "agent-treasury",
      }),
    ).rejects.toThrow(/Install @open-wallet-standard\/core/)
  })

  it("creates an OpenWallet adapter from config", async () => {
    const { OpenWalletAdapter, createWalletAdapter } = await importFreshWalletModule()

    const adapter = await createWalletAdapter({
      type: "open-wallet",
      network: "base",
      walletName: "agent-treasury",
      passphrase: "ows_key_test",
      chainId: "eip155:8453",
      vaultPath: "/tmp/ows",
      accountIndex: 2,
    })

    expect(adapter).toBeInstanceOf(OpenWalletAdapter)
    expect(adapter.getNetwork()).toBe("base")
  })

  it("selects the configured wallet account by CAIP-2 chain id", async () => {
    const { OpenWalletAdapter, owsModule } = await importFreshWalletModule({
      owsModule: {
        getWallet: mock(async () =>
          createMockWallet([
            {
              chainId: "eip155:1",
              address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              derivationPath: "m/44'/60'/0'/0/0",
            },
            {
              chainId: "eip155:8453",
              address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              derivationPath: "m/44'/60'/0'/0/1",
            },
          ])),
      },
    })

    const adapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "agent-treasury",
      chainId: "eip155:8453",
      vaultPath: "/tmp/ows",
    })

    await expect(adapter.getAddress()).resolves.toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )
    expect(owsModule.getWallet).toHaveBeenCalledWith("agent-treasury", "/tmp/ows")
  })

  it("forwards message signing to the OWS SDK with the configured passphrase", async () => {
    const { OpenWalletAdapter, owsModule } = await importFreshWalletModule()
    const adapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "agent-treasury",
      passphrase: "ows_key_agent_token",
      chainId: "eip155:8453",
      vaultPath: "/tmp/ows",
      accountIndex: 3,
    })

    await expect(adapter.signMessage("hello")).resolves.toBe("0xsigned-message")
    expect(owsModule.signMessage).toHaveBeenCalledWith(
      "agent-treasury",
      "eip155:8453",
      "hello",
      "ows_key_agent_token",
      undefined,
      3,
      "/tmp/ows",
    )
  })

  it("serializes EVM transactions before delegating transaction signing", async () => {
    const { OpenWalletAdapter, owsModule } = await importFreshWalletModule()
    const adapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "agent-treasury",
      passphrase: "vault-passphrase",
      chainId: "eip155:8453",
      accountIndex: 1,
    })

    const signedTransaction = await adapter.signTransaction({
      to: "0x1111111111111111111111111111111111111111",
      value: "0",
      chainId: 8453,
      nonce: 0,
      gas: "21000",
      maxFeePerGas: "1",
      maxPriorityFeePerGas: "1",
    })

    expect(signedTransaction).toMatch(/^0x02/i)
    expect(signedTransaction.length).toBeGreaterThan(10)

    const [walletName, chainId, serializedTransaction, passphrase, index] =
      owsModule.signTransaction.mock.calls[0] ?? []

    expect(walletName).toBe("agent-treasury")
    expect(chainId).toBe("eip155:8453")
    expect(serializedTransaction).toMatch(/^0x02/i)
    expect(passphrase).toBe("vault-passphrase")
    expect(index).toBe(1)
  })

  it("wraps OWS signing inside an x402-compatible viem account for EVM", async () => {
    const { OpenWalletAdapter, createX402Client, registerExactEvmScheme, owsModule, getCapturedSigner } =
      await importFreshWalletModule({
        owsModule: {
          getWallet: mock(async () =>
            createMockWallet([
              {
                chainId: "eip155:8453",
                address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                derivationPath: "m/44'/60'/0'/0/0",
              },
            ])),
        },
      })

    const adapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      network: "base",
      walletName: "agent-treasury",
      passphrase: "ows_key_agent_token",
      chainId: "eip155:8453",
      accountIndex: 4,
      vaultPath: "/tmp/ows",
    })

    const x402Client = await createX402Client(adapter)

    expect(x402Client).toBeDefined()
    expect(registerExactEvmScheme).toHaveBeenCalledTimes(1)

    const signer = getCapturedSigner() as {
      address: string
      signMessage: (args: { message: string }) => Promise<string>
      signTypedData: (args: Record<string, unknown>) => Promise<string>
    }

    expect(signer.address).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    await expect(signer.signMessage({ message: "pay me" })).resolves.toBe("0xsigned-message")
    expect(owsModule.signMessage).toHaveBeenCalledWith(
      "agent-treasury",
      "eip155:8453",
      "pay me",
      "ows_key_agent_token",
      undefined,
      4,
      "/tmp/ows",
    )

    await expect(
      signer.signTypedData({
        domain: {
          name: "Adventure",
          chainId: 8453,
        },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "chainId", type: "uint256" },
          ],
          Transfer: [{ name: "amount", type: "uint256" }],
        },
        primaryType: "Transfer",
        message: {
          amount: "1",
        },
      }),
    ).resolves.toBe("0xsigned-typed-data")

    const typedDataCall = owsModule.signTypedData.mock.calls[0] ?? []
    expect(typedDataCall[0]).toBe("agent-treasury")
    expect(typedDataCall[1]).toBe("eip155:8453")
    expect(JSON.parse(String(typedDataCall[2]))).toEqual({
      domain: {
        name: "Adventure",
        chainId: 8453,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        Transfer: [{ name: "amount", type: "uint256" }],
      },
      primaryType: "Transfer",
      message: {
        amount: "1",
      },
    })
  })

  it("wraps OWS SDK errors with actionable adapter messages", async () => {
    const { OpenWalletAdapter } = await importFreshWalletModule({
      owsModule: {
        getWallet: mock(async () => {
          throw new Error("WALLET_NOT_FOUND")
        }),
      },
    })

    const adapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "missing-wallet",
      chainId: "eip155:8453",
    })

    await expect(adapter.getAddress()).rejects.toThrow(/missing-wallet/)
    await expect(adapter.getAddress()).rejects.toThrow(/WALLET_NOT_FOUND/)
  })

  it("forwards both vault passphrases and scoped API keys without special casing", async () => {
    const { OpenWalletAdapter, owsModule } = await importFreshWalletModule()

    const vaultAdapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "agent-treasury",
      passphrase: "correct horse battery staple",
      chainId: "eip155:8453",
    })

    await vaultAdapter.signMessage("owner-mode")

    const apiKeyAdapter = await OpenWalletAdapter.fromConfig({
      type: "open-wallet",
      walletName: "agent-treasury",
      passphrase: "ows_key_abc123",
      chainId: "eip155:8453",
    })

    await apiKeyAdapter.signMessage("agent-mode")

    expect(owsModule.signMessage.mock.calls[0]?.[3]).toBe("correct horse battery staple")
    expect(owsModule.signMessage.mock.calls[1]?.[3]).toBe("ows_key_abc123")
  })
})
