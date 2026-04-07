import { describe, it, expect } from "bun:test"
import { SeededRng, deriveSeed } from "../src/rng.js"

describe("SeededRng", () => {
  it("produces values in [0, 1)", () => {
    const rng = new SeededRng(42)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it("is deterministic — same seed produces same sequence", () => {
    const a = new SeededRng(12345)
    const b = new SeededRng(12345)
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it("different seeds produce different sequences", () => {
    const a = new SeededRng(1)
    const b = new SeededRng(2)
    let allSame = true
    for (let i = 0; i < 20; i++) {
      if (a.next() !== b.next()) { allSame = false; break }
    }
    expect(allSame).toBe(false)
  })

  it("nextInt returns integers in [min, max] inclusive", () => {
    const rng = new SeededRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it("chance returns roughly correct probability", () => {
    const rng = new SeededRng(777)
    let hits = 0
    const N = 10000
    for (let i = 0; i < N; i++) {
      if (rng.chance(0.3)) hits++
    }
    // Should be within 5% of expected
    expect(hits / N).toBeGreaterThan(0.25)
    expect(hits / N).toBeLessThan(0.35)
  })

  it("clone produces same sequence as original from that point", () => {
    const rng = new SeededRng(555)
    rng.next(); rng.next(); rng.next() // advance
    const clone = rng.clone()
    expect(rng.next()).toBe(clone.next())
    expect(rng.next()).toBe(clone.next())
  })
})

describe("deriveSeed", () => {
  it("returns a number for any input", () => {
    const s = deriveSeed(42, "floor_1")
    expect(typeof s).toBe("number")
  })

  it("is deterministic", () => {
    expect(deriveSeed(100, "floor_1")).toBe(deriveSeed(100, "floor_1"))
  })

  it("different keys produce different seeds", () => {
    expect(deriveSeed(100, "floor_1")).not.toBe(deriveSeed(100, "floor_2"))
  })
})
