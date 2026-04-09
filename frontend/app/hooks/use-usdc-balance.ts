"use client"

import { useEffect, useMemo, useState } from "react"
import { createPublicClient, erc20Abi, formatUnits, http } from "viem"
import { base, baseSepolia } from "viem/chains"
import { useEvmAddress } from "@coinbase/cdp-hooks"

const TESTNET = (process.env["NEXT_PUBLIC_X402_TESTNET"] ?? "true").toLowerCase() !== "false"
const BASE_RPC_URL = process.env["NEXT_PUBLIC_BASE_RPC_URL"]
  ?? (TESTNET ? "https://sepolia.base.org" : "https://mainnet.base.org")
const USDC_ADDRESS = (
  TESTNET
    ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
) as `0x${string}`

export function useUsdcBalance() {
  const { evmAddress } = useEvmAddress()
  const [balance, setBalance] = useState<bigint | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const client = useMemo(
    () =>
      createPublicClient({
        chain: TESTNET ? baseSepolia : base,
        transport: http(BASE_RPC_URL),
      }),
    [],
  )

  useEffect(() => {
    let cancelled = false

    async function loadBalance() {
      if (!evmAddress) {
        setBalance(null)
        return
      }

      setIsLoading(true)
      setError(null)
      try {
        const value = await client.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [evmAddress],
        })
        if (!cancelled) {
          setBalance(value)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to read USDC balance")
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadBalance()
    const interval = globalThis.window.setInterval(loadBalance, 30_000)
    return () => {
      cancelled = true
      globalThis.window.clearInterval(interval)
    }
  }, [client, evmAddress])

  return {
    rawBalance: balance,
    balanceLabel: balance === null ? "--" : `${Number(formatUnits(balance, 6)).toFixed(2)} USDC`,
    isLoading,
    error,
    refetch: async () => {
      if (!evmAddress) return
      setIsLoading(true)
      try {
        const value = await client.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [evmAddress],
        })
        setBalance(value)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read USDC balance")
      } finally {
        setIsLoading(false)
      }
    },
    rpcUrl: BASE_RPC_URL,
    isTestnet: TESTNET,
  }
}
