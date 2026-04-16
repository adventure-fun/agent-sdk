declare module "@open-wallet-standard/core" {
  export interface AccountInfo {
    chainId: string
    address: string
    derivationPath: string
  }

  export interface WalletInfo {
    id: string
    name: string
    createdAt: string
    accounts: AccountInfo[]
  }

  export interface SignResult {
    signature: string
    recoveryId?: number
  }

  export function getWallet(nameOrId: string, vaultPath?: string): Promise<WalletInfo>

  export function signMessage(
    wallet: string,
    chain: string,
    message: string,
    passphrase?: string,
    encoding?: "utf8" | "hex",
    index?: number,
    vaultPath?: string,
  ): Promise<SignResult>

  export function signTransaction(
    wallet: string,
    chain: string,
    transactionHex: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ): Promise<SignResult>

  export function signTypedData(
    wallet: string,
    chain: string,
    typedDataJson: string,
    passphrase?: string,
    index?: number,
    vaultPath?: string,
  ): Promise<SignResult>
}
