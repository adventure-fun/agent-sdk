import { x402Client } from "@x402/core/client"
import { registerExactEvmScheme } from "@x402/evm/exact/client"
import type { SvmClientConfig } from "@x402/svm/exact/client"
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import type { WalletConfig } from "../../config.js"
import type { TransactionRequest, WalletNetwork, X402CapableWalletAdapter } from "./index.js"

type Base58Codec = {
  encode(bytes: Uint8Array): string
  decode(value: string): Uint8Array
}

type SolanaSigner = SvmClientConfig["signer"] & {
  keyPair: {
    privateKey: CryptoKey
  }
  signTransactions: (...args: unknown[]) => Promise<unknown>
}

function requirePrivateKey(config: WalletConfig, network: WalletNetwork): string {
  const envFallback =
    network === "solana"
      ? process.env["AGENT_PRIVATE_KEY"] ?? process.env["SVM_PRIVATE_KEY"]
      : process.env["AGENT_PRIVATE_KEY"] ?? process.env["EVM_PRIVATE_KEY"]

  const privateKey = config.privateKey ?? envFallback
  if (!privateKey) {
    throw new Error(`Missing private key for ${network} wallet adapter`)
  }

  return privateKey
}

function normalizeHexPrivateKey(privateKey: string): Hex {
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex
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

export class EvmEnvWalletAdapter implements X402CapableWalletAdapter {
  readonly account

  private constructor(privateKey: string) {
    this.account = privateKeyToAccount(normalizeHexPrivateKey(privateKey))
  }

  static async fromConfig(config: WalletConfig): Promise<EvmEnvWalletAdapter> {
    return new EvmEnvWalletAdapter(requirePrivateKey(config, "base"))
  }

  getNetwork(): WalletNetwork {
    return "base"
  }

  async getAddress(): Promise<string> {
    return this.account.address
  }

  async signMessage(message: string): Promise<string> {
    return this.account.signMessage({ message })
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    if (!tx.chainId) {
      throw new Error("EVM transaction signing requires chainId")
    }

    const request = {
      chainId: tx.chainId,
      to: tx.to as `0x${string}`,
      value: BigInt(tx.value),
      data: tx.data as Hex | undefined,
      nonce: tx.nonce,
      gas: toBigInt(tx.gas, "gas"),
      gasPrice: toBigInt(tx.gasPrice, "gasPrice"),
      maxFeePerGas: toBigInt(tx.maxFeePerGas, "maxFeePerGas"),
      maxPriorityFeePerGas: toBigInt(tx.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    } as Parameters<typeof this.account.signTransaction>[0]

    return this.account.signTransaction(request)
  }

  async createX402Client(): Promise<x402Client> {
    const client = new x402Client()
    return registerExactEvmScheme(client, { signer: this.account })
  }
}

export class SolanaEnvWalletAdapter implements X402CapableWalletAdapter {
  private constructor(
    readonly signer: SolanaSigner,
    private readonly base58: Base58Codec,
    private readonly signBytes: (privateKey: CryptoKey, bytes: Uint8Array) => Promise<Uint8Array>,
  ) {}

  static async fromConfig(config: WalletConfig): Promise<SolanaEnvWalletAdapter> {
    const privateKey = requirePrivateKey(config, "solana")
    const [{ base58 }, solana] = await Promise.all([
      import("@scure/base"),
      import("@solana/kit"),
    ])

    const signer = await solana.createKeyPairSignerFromBytes(base58.decode(privateKey))
    return new SolanaEnvWalletAdapter(
      signer as SolanaSigner,
      base58,
      solana.signBytes as (
        privateKey: CryptoKey,
        bytes: Uint8Array,
      ) => Promise<Uint8Array>,
    )
  }

  getNetwork(): WalletNetwork {
    return "solana"
  }

  async getAddress(): Promise<string> {
    return this.signer.address
  }

  async signMessage(message: string): Promise<string> {
    const bytes = new TextEncoder().encode(message)
    const signature = await this.signBytes(this.signer.keyPair.privateKey, bytes)
    return this.base58.encode(signature)
  }

  async signTransaction(_tx: TransactionRequest): Promise<string> {
    throw new Error(
      "Direct Solana transaction signing is not exposed through TransactionRequest yet. Use createX402Client() for x402 payments.",
    )
  }

  async createX402Client(): Promise<x402Client> {
    const client = new x402Client()
    const { registerExactSvmScheme } = await import("@x402/svm/exact/client")
    return registerExactSvmScheme(client, { signer: this.signer })
  }
}
