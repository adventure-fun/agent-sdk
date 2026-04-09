import { describe, expect, it } from "bun:test"
import { authenticate, GameClient } from "./index.js"

describe("agent-sdk public exports", () => {
  it("exposes the authentication helper", () => {
    expect(typeof authenticate).toBe("function")
  })

  it("constructs a game client from the package entrypoint", () => {
    const client = new GameClient(
      "https://example.com",
      "wss://example.com",
      {
        token: "session-token",
        expires_at: Date.now() + 60_000,
      },
    )

    expect(client.sessionToken).toBe("session-token")
  })
})
