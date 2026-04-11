/**
 * Seeded deterministic RNG (Mulberry32).
 * Same seed = same sequence, always. Critical for server-authoritative simulation.
 */
export class SeededRng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Returns float in [0, 1) */
  next(): number {
    this.state += 0x6d2b79f5
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Returns integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /** Returns true with given probability [0, 1] */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /** Picks a random element from an array */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Cannot pick from empty array")
    const item = arr[Math.floor(this.next() * arr.length)]
    if (item === undefined) throw new Error("Pick out of bounds")
    return item
  }

  /** Returns the internal state for serialization (e.g. DB persistence) */
  getState(): number {
    return this.state
  }

  /** Restores internal state from a previously saved value */
  setState(state: number): void {
    this.state = state >>> 0
  }

  /** Clones the current RNG state */
  clone(): SeededRng {
    const clone = new SeededRng(0)
    clone.state = this.state
    return clone
  }
}

/** Derive a child seed deterministically from parent seed + string key */
export function deriveSeed(parentSeed: number, key: string): number {
  let hash = parentSeed
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x9e3779b9)
    hash ^= hash >>> 16
  }
  return hash >>> 0
}
