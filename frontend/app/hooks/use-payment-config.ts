"use client"

import { useState, useCallback } from "react"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export type PaymentAction =
  | "stat_reroll"
  | "realm_generate"
  | "realm_regen"
  | "inn_rest"

export type PaymentPrices = Record<PaymentAction, string>

const FALLBACK_PRICES: PaymentPrices = {
  stat_reroll: "0.10",
  realm_generate: "0.25",
  realm_regen: "0.25",
  inn_rest: "0.05",
}

export function usePaymentConfig() {
  const [prices, setPrices] = useState<PaymentPrices>(FALLBACK_PRICES)

  const fetchPaymentConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/config/payments`)
      if (!res.ok) return FALLBACK_PRICES
      const data = await res.json()
      const fetched = (data.prices ?? {}) as Partial<PaymentPrices>
      const merged: PaymentPrices = { ...FALLBACK_PRICES, ...fetched }
      setPrices(merged)
      return merged
    } catch {
      return FALLBACK_PRICES
    }
  }, [])

  return { prices, fetchPaymentConfig }
}
