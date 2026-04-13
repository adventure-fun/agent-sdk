/** Matches dev API `POST /characters/roll` name length cap. */
export const CHARACTER_NAME_MAX_LEN = 24

/**
 * Picks the character name for roll attempt `attempt` (0-based).
 * - Attempt 0: trimmed `baseName`, clamped to max length.
 * - Later attempts: if `baseName` ends with digits, increment that suffix; otherwise append `2`, `3`, …
 */
export function computeCharacterRollNameForAttempt(baseName: string, attempt: number): string {
  const trimmed = baseName.trim()
  if (attempt === 0) {
    return trimmed.slice(0, CHARACTER_NAME_MAX_LEN)
  }

  const m = trimmed.match(/^(.*?)(\d+)$/)
  if (m?.[2] !== undefined) {
    const prefix = m[1] ?? ""
    const n = Number.parseInt(m[2], 10)
    if (!Number.isNaN(n)) {
      const next = n + attempt
      return `${prefix}${next}`.slice(0, CHARACTER_NAME_MAX_LEN)
    }
  }

  const suffix = String(attempt + 1)
  return `${trimmed}${suffix}`.slice(0, CHARACTER_NAME_MAX_LEN)
}
