import { afterEach, describe, expect, it } from "bun:test"

const ORIGINAL_NODE_ENV = process.env["NODE_ENV"]
const ORIGINAL_SESSION_SECRET = process.env["SESSION_SECRET"]

async function importFreshJwtModule() {
  return import(`../src/auth/jwt.js?cacheBust=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env["NODE_ENV"]
  else process.env["NODE_ENV"] = ORIGINAL_NODE_ENV

  if (ORIGINAL_SESSION_SECRET === undefined) delete process.env["SESSION_SECRET"]
  else process.env["SESSION_SECRET"] = ORIGINAL_SESSION_SECRET
})

describe("10.2 — SESSION_SECRET guard", () => {
  it("allows the development fallback secret in development", async () => {
    process.env["NODE_ENV"] = "development"
    delete process.env["SESSION_SECRET"]

    const mod = await importFreshJwtModule()
    expect(typeof mod.signSession).toBe("function")
  })

  it("throws outside development when SESSION_SECRET is missing", async () => {
    process.env["NODE_ENV"] = "production"
    delete process.env["SESSION_SECRET"]

    await expect(importFreshJwtModule()).rejects.toThrow(
      "SESSION_SECRET must be set to a strong value outside development",
    )
  })
})
