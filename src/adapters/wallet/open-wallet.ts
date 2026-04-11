import type { WalletConfig } from "../../config.js"
import type { TransactionRequest, WalletAdapter, WalletNetwork } from "./index.js"

interface OpenWalletAddressResponse {
  address: string
}

interface OpenWalletSignatureResponse {
  signature: string
}

/**
 * Experimental OpenWallet adapter.
 *
 * Expected HTTP contract:
 * - GET  /address -> { address: string }
 * - POST /sign/message -> { signature: string } with body { message, network }
 * - POST /sign/transaction -> { signature: string } with body { transaction, network }
 *
 * This keeps the integration boundary narrow while the OpenWallet SDK/API evolves.
 */
export class OpenWalletAdapter implements WalletAdapter {
  constructor(
    private readonly endpoint: string,
    private readonly network: WalletNetwork = "base",
    private readonly apiKey?: string,
  ) {}

  static async fromConfig(config: WalletConfig): Promise<OpenWalletAdapter> {
    if (!config.endpoint) {
      throw new Error("OpenWallet adapter requires an endpoint")
    }

    return new OpenWalletAdapter(config.endpoint, config.network ?? "base", config.apiKey)
  }

  getNetwork(): WalletNetwork {
    return this.network
  }

  async getAddress(): Promise<string> {
    const response = await this.request<OpenWalletAddressResponse>("/address", {
      method: "GET",
    })

    return response.address
  }

  async signMessage(message: string): Promise<string> {
    const response = await this.request<OpenWalletSignatureResponse>("/sign/message", {
      method: "POST",
      body: JSON.stringify({
        message,
        network: this.network,
      }),
    })

    return response.signature
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const response = await this.request<OpenWalletSignatureResponse>("/sign/transaction", {
      method: "POST",
      body: JSON.stringify({
        transaction: tx,
        network: this.network,
      }),
    })

    return response.signature
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers)
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`)
    }

    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers,
    })

    if (!response.ok) {
      throw new Error(`OpenWallet request failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }
}
