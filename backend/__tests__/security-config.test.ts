import { beforeEach, describe, expect, it } from "bun:test"
import {
  canOpenWebSocket,
  registerWebSocketClose,
  registerWebSocketOpen,
  resetSecurityState,
  resolveCorsOrigin,
} from "../src/server/security-config.js"

describe("10.5 / 10.7 — security config helpers", () => {
  beforeEach(() => {
    resetSecurityState()
  })

  it("allows public routes from any origin", () => {
    expect(resolveCorsOrigin("https://evil.example", "/health")).toBe("https://evil.example")
    expect(resolveCorsOrigin("https://evil.example", "/content/classes")).toBe("https://evil.example")
    expect(resolveCorsOrigin("https://evil.example", "/spectate/active")).toBe("https://evil.example")
  })

  it("rejects non-whitelisted origins for protected routes", () => {
    expect(resolveCorsOrigin("https://evil.example", "/auth/challenge")).toBe("")
  })

  it("tracks websocket connection counts per account", () => {
    expect(canOpenWebSocket("acct-1")).toBe(true)

    for (let i = 0; i < 5; i++) {
      registerWebSocketOpen("acct-1")
    }

    expect(canOpenWebSocket("acct-1")).toBe(false)

    registerWebSocketClose("acct-1")
    expect(canOpenWebSocket("acct-1")).toBe(true)
  })
})
