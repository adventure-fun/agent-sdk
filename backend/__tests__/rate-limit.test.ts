import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { createRateLimiter } from "../src/middleware/rate-limit.js"

describe("10.4 — createRateLimiter", () => {
  it("allows requests until the configured limit", async () => {
    const app = new Hono()
    app.use(
      "*",
      createRateLimiter({
        label: "test-limit",
        windowMs: 60_000,
        maxRequests: 2,
        keyFn: () => "shared-key",
      }),
    )
    app.get("/", (c) => c.json({ ok: true }))

    const first = await app.request("http://example.test/")
    const second = await app.request("http://example.test/")

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it("returns 429 and Retry-After after the limit is exceeded", async () => {
    const app = new Hono()
    app.use(
      "*",
      createRateLimiter({
        label: "test-limit-overflow",
        windowMs: 60_000,
        maxRequests: 1,
        keyFn: () => "shared-key",
      }),
    )
    app.get("/", (c) => c.json({ ok: true }))

    await app.request("http://example.test/")
    const blocked = await app.request("http://example.test/")

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).not.toBeNull()
  })
})
