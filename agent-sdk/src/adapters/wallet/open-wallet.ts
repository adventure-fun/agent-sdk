import { x402Client } from "@x402/core/client"
import { registerExactEvmScheme } from "@x402/evm/exact/client"
import { parseSignature, serializeTransaction, type Address, type Hex, type SignableMessage } from "viem"
import { toAccount } from "viem/accounts"
import type { WalletConfig, WalletNetwork } from "../../config.js"
import type { TransactionRequest, X402CapableWalletAdapter } from "./index.js"
import { getNetworkFamily } from "./index.js"

interface OpenWalletAccountInfo {
  chainId: string
  address: string
  derivationPath: string
}

interface OpenWalletInfo {
  id: string
  name: string
  createdAt: string
  accounts: OpenWalletAccountInfo[]
}

interface OpenWalletSignResult {
  signature: string
  recoveryId?: number
}

interface OpenWalletSdkModule {
  getWallet: (nameOrId: string, vaultPath?: string) => Promise<OpenWalletInfo>
  signMessage: (
    wallet: string,
    chain: string,
    message: string,
    passphrase?: string,
    encoding?: "utf8" | "hex",
    index?: number,
    vaultPath?: string,
  ) => Promise<OpenWalletSignResult>
  signTransaction: (
    wallet: string,
    chain: string,
    transactionHex: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ) => Promise<OpenWalletSignResult>
  signTypedData: (
    wallet: string,
    chain: string,
    typedDataJson: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ) => Promise<OpenWalletSignResult>
}

const DEFAULT_CHAIN_IDS: Record<WalletNetwork, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:devnet",
}

let openWalletSdkPromise: Promise<OpenWalletSdkModule> | null = null

async function loadOpenWalletSdk(): Promise<OpenWalletSdkModule> {
  if (!openWalletSdkPromise) {
    openWalletSdkPromise = import("@open-wallet-standard/core")
      .then((module) => module as OpenWalletSdkModule)
      .catch((error) => {
        openWalletSdkPromise = null
        throw new Error(
          'OpenWallet adapter requires "@open-wallet-standard/core". Install @open-wallet-standard/core to use wallet.type="open-wallet".',
          { cause: error },
        )
      })
  }

  return openWalletSdkPromise
}

function toBigInt(value: string | undefined, field: string): bigint | undefined {
  if (value === undefined) {
    return undefined
  }

  try {
    return BigInt(value)
  } catch (error) {
    throw new Error(`Invalid bigint value for ${field}`, { cause: error })
  }
}

function toSerializableEvmTransaction(tx: TransactionRequest): Parameters<typeof serializeTransaction>[0] {
  if (!tx.chainId) {
    throw new Error("OpenWallet EVM transaction signing requires chainId")
  }

  return {
    type:
      tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined
        ? "eip1559"
        : tx.gasPrice !== undefined
          ? "legacy"
          : undefined,
    chainId: tx.chainId,
    to: tx.to as Address,
    value: BigInt(tx.value),
    data: tx.data as Hex | undefined,
    nonce: tx.nonce,
    gas: toBigInt(tx.gas, "gas"),
    gasPrice: toBigInt(tx.gasPrice, "gasPrice"),
    maxFeePerGas: toBigInt(tx.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: toBigInt(tx.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
  } as Parameters<typeof serializeTransaction>[0]
}

function stringifyTypedData(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) =>
    typeof currentValue === "bigint" ? currentValue.toString() : currentValue,
  )
}

function normalizeSignableMessage(message: SignableMessage): {
  message: string
  encoding?: "utf8" | "hex"
} {
  if (typeof message === "string") {
    return { message }
  }

  const raw = message.raw
  if (typeof raw === "string") {
    return {
      message: raw.startsWith("0x") ? raw.slice(2) : raw,
      encoding: "hex",
    }
  }

  return {
    message: Buffer.from(raw).toString("hex"),
    encoding: "hex",
  }
}

function describeOpenWalletError(
  error: unknown,
  walletName: string,
  action: string,
): Error {
  const detail =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error)

  if (detail.includes("WALLET_NOT_FOUND")) {
    return new Error(
      `OpenWallet wallet "${walletName}" was not found while attempting to ${action} (${detail})`,
      { cause: error },
    )
  }

  if (detail.includes("POLICY_DENIED")) {
    return new Error(
      `OpenWallet policy denied the request for wallet "${walletName}" while attempting to ${action} (${detail})`,
      { cause: error },
    )
  }

  if (detail.includes("API_KEY_EXPIRED")) {
    return new Error(
      `OpenWallet API key expired for wallet "${walletName}" while attempting to ${action} (${detail})`,
      { cause: error },
    )
  }

  return new Error(
    `OpenWallet request failed for wallet "${walletName}" while attempting to ${action} (${detail})`,
    { cause: error },
  )
}

export class OpenWalletAdapter implements X402CapableWalletAdapter {
  private constructor(
    private readonly sdk: OpenWalletSdkModule,
    private readonly walletName: string,
    private readonly chainId: string,
    private readonly network: WalletNetwork = "base",
    private readonly passphrase?: string,
    private readonly vaultPath?: string,
    private readonly accountIndex: number = 0,
  ) {}

  static async fromConfig(config: WalletConfig): Promise<OpenWalletAdapter> {
    const walletName = config.walletName
    if (!walletName) {
      throw new Error("OpenWallet adapter requires walletName")
    }

    const network = config.network ?? "base"
    const sdk = await loadOpenWalletSdk()

    return new OpenWalletAdapter(
      sdk,
      walletName,
      config.chainId ?? DEFAULT_CHAIN_IDS[network],
      network,
      config.passphrase,
      config.vaultPath,
      config.accountIndex ?? 0,
    )
  }

  getNetwork(): WalletNetwork {
    return this.network
  }

  async getAddress(): Promise<string> {
    try {
      const wallet = await this.sdk.getWallet(this.walletName, this.vaultPath)
      const account = wallet.accounts.find((candidate) => candidate.chainId === this.chainId)
      if (!account) {
        throw new Error(
          `Wallet "${this.walletName}" does not expose an account for chain ${this.chainId}`,
        )
      }

      return account.address
    } catch (error) {
      throw describeOpenWalletError(error, this.walletName, "resolve the wallet address")
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      const result = await this.sdk.signMessage(
        this.walletName,
        this.chainId,
        message,
        this.passphrase,
        undefined,
        this.accountIndex,
        this.vaultPath,
      )

      return result.signature
    } catch (error) {
      throw describeOpenWalletError(error, this.walletName, "sign a message")
    }
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    if (getNetworkFamily(this.network) !== "base") {
      throw new Error(
        "Direct Solana transaction signing is not exposed through TransactionRequest yet. OpenWallet supports Solana message signing, but this SDK only exposes EVM transaction serialization here.",
      )
    }

    const transaction = toSerializableEvmTransaction(tx)

    const unsignedTransactionHex = serializeTransaction(transaction)

    try {
      const result = await this.sdk.signTransaction(
        this.walletName,
        this.chainId,
        unsignedTransactionHex,
        this.passphrase,
        this.accountIndex,
        this.vaultPath,
      )

      return serializeTransaction(transaction, parseSignature(result.signature as Hex))
    } catch (error) {
      throw describeOpenWalletError(error, this.walletName, "sign a transaction")
    }
  }

  async createX402Client(): Promise<x402Client> {
    if (getNetworkFamily(this.network) !== "base") {
      throw new Error(
        "OpenWallet x402 integration currently supports EVM networks only. Use SolanaEnvWalletAdapter for Solana x402 payments.",
      )
    }

    const address = await this.getAddress()
    const account = toAccount({
      address: address as Address,
      signMessage: async ({ message }) => {
        const normalized = normalizeSignableMessage(message)
        const result = await this.sdk.signMessage(
          this.walletName,
          this.chainId,
          normalized.message,
          this.passphrase,
          normalized.encoding,
          this.accountIndex,
          this.vaultPath,
        )

        return result.signature as Hex
      },
      signTransaction: async (transaction, options) => {
        const serializer = options?.serializer ?? serializeTransaction
        const unsignedTransactionHex = await serializer(transaction)
        const result = await this.sdk.signTransaction(
          this.walletName,
          this.chainId,
          unsignedTransactionHex,
          this.passphrase,
          this.accountIndex,
          this.vaultPath,
        )

        return serializer(transaction, parseSignature(result.signature as Hex))
      },
      signTypedData: async (typedData) => {
        const result = await this.sdk.signTypedData(
          this.walletName,
          this.chainId,
          stringifyTypedData(typedData),
          this.passphrase,
          this.accountIndex,
          this.vaultPath,
        )

        return result.signature as Hex
      },
    })

    const client = new x402Client()
    return registerExactEvmScheme(client, { signer: account })
  }
}
