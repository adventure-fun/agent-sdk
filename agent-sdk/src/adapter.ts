/** Wallet adapter interface — OpenWallet is the default, raw key is the fallback */
export interface WalletAdapter {
  getAddress(): Promise<string>
  signMessage(message: string): Promise<string>
  signTransaction(tx: TransactionRequest): Promise<string>
}

export interface TransactionRequest {
  to: string
  value: bigint
  data?: string
  chainId: number
}
