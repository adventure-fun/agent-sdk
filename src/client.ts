import type { Action, Observation, ServerMessage } from "@adventure-fun/schemas"
import type { SessionToken } from "./auth.js"

export type ObservationHandler = (obs: Observation) => void
export type DeathHandler = (data: { cause: string; floor: number; room: string; turn: number }) => void
export type ExtractedHandler = (data: { loot_summary: unknown[]; xp_gained: number }) => void

export class GameClient {
  private ws: WebSocket | null = null
  private token: SessionToken

  constructor(
    private baseUrl: string,
    private wsUrl: string,
    token: SessionToken,
  ) {
    this.token = token
  }

  get sessionToken(): string {
    return this.token.token
  }

  /** Opens a WebSocket game session for a realm instance */
  connect(
    realmId: string,
    handlers: {
      onObservation: ObservationHandler
      onDeath?: DeathHandler
      onExtracted?: ExtractedHandler
      onError?: (msg: string) => void
      onClose?: () => void
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}/realms/${realmId}/enter`
      this.ws = new WebSocket(url, ["Bearer", this.token.token])

      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(new Error("WebSocket connection failed"))
      this.ws.onclose = () => handlers.onClose?.()

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMessage
        switch (msg.type) {
          case "observation":
            handlers.onObservation(msg.data)
            break
          case "death":
            handlers.onDeath?.(msg.data)
            break
          case "extracted":
            handlers.onExtracted?.(msg.data)
            break
          case "error":
            handlers.onError?.(msg.message)
            break
        }
      }
    })
  }

  /** Sends an action to the game server */
  sendAction(action: Action): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected")
    }
    this.ws.send(JSON.stringify({ type: "action", data: action }))
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  /** REST helper with auth header */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token.token}`,
        ...options.headers,
      },
    })

    if (res.status === 402) {
      // x402 Payment Required — caller must handle
      const paymentHeader = res.headers.get("PAYMENT-REQUIRED")
      const err = new Error("Payment required") as Error & { paymentRequired: unknown; status: number }
      err.status = 402
      err.paymentRequired = paymentHeader ? JSON.parse(atob(paymentHeader)) : null
      throw err
    }

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText}`)
    }

    return res.json() as Promise<T>
  }
}
