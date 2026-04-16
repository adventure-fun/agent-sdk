import type {
  TransactionRequest,
  WalletAdapter,
  WalletNetwork,
} from "../../src/adapters/wallet/index.js"

const DEFAULT_ADDRESS = "0x000000000000000000000000000000000000dEaD"

export interface MockWalletAdapterOptions {
  address?: string
  network?: WalletNetwork
}

export class MockWalletAdapter implements WalletAdapter {
  private readonly address: string
  private readonly network: WalletNetwork

  constructor(options: MockWalletAdapterOptions = {}) {
    this.address = options.address ?? DEFAULT_ADDRESS
    this.network = options.network ?? "base"
  }

  async getAddress(): Promise<string> {
    return this.address
  }

  async signMessage(message: string): Promise<string> {
    return `mock-signature:${message}`
  }

  async signTransaction(_tx: TransactionRequest): Promise<string> {
    return "mock-tx-signature"
  }

  getNetwork(): WalletNetwork {
    return this.network
  }
}

export function createUniqueMockWalletAddress(label: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8)
  const body = `${label}${suffix}`.toLowerCase().replace(/[^0-9a-f]/g, "a").slice(0, 40)
  return `0x${body.padEnd(40, "0")}`
}
