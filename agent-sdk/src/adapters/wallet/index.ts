import type { WalletConfig, WalletNetwork } from "../../config.js"
import { EvmEnvWalletAdapter, SolanaEnvWalletAdapter } from "./env-wallet.js"
import { OpenWalletAdapter } from "./open-wallet.js"
import type { x402Client as X402Client } from "@x402/core/client"
export type { WalletNetwork } from "../../config.js"
export type WalletNetworkFamily = "base" | "solana"

export interface TransactionRequest {
  to: string
  value: string
  data?: string
  chainId?: number
  nonce?: number
  gas?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  serializedTransaction?: string
}

export interface WalletAdapter {
  getAddress(): Promise<string>
  signMessage(message: string): Promise<string>
  signTransaction(tx: TransactionRequest): Promise<string>
  getNetwork(): WalletNetwork
}

export interface X402CapableWalletAdapter extends WalletAdapter {
  createX402Client(): Promise<X402Client>
}

export function getNetworkFamily(network: WalletNetwork): WalletNetworkFamily {
  return network.startsWith("solana") ? "solana" : "base"
}

export function isX402CapableWalletAdapter(
  adapter: WalletAdapter,
): adapter is X402CapableWalletAdapter {
  return typeof (adapter as Partial<X402CapableWalletAdapter>).createX402Client === "function"
}

export async function createWalletAdapter(config: WalletConfig): Promise<WalletAdapter> {
  switch (config.type) {
    case "env":
      return getNetworkFamily(config.network ?? "base") === "solana"
        ? SolanaEnvWalletAdapter.fromConfig(config)
        : EvmEnvWalletAdapter.fromConfig(config)
    case "open-wallet":
      return OpenWalletAdapter.fromConfig(config)
  }

  throw new Error(`Unsupported wallet config type: ${config.type}`)
}

export async function createX402Client(adapter: WalletAdapter): Promise<X402Client> {
  if (!isX402CapableWalletAdapter(adapter)) {
    throw new Error(
      `Wallet adapter for network "${adapter.getNetwork()}" does not expose x402 payment support`,
    )
  }

  return adapter.createX402Client()
}

export * from "./env-wallet.js"
export * from "./open-wallet.js"
