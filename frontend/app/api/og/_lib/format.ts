// Title-cases a known-finite lowercase class identifier (e.g. "knight" →
// "Knight"). Narrowed to the 4 valid classes so TypeScript doesn't complain
// about possibly-undefined string indexing under `noUncheckedIndexedAccess`.

export function titleCase(value: string): string {
  if (value.length === 0) return value
  const first = value.charAt(0).toUpperCase()
  const rest = value.slice(1)
  return `${first}${rest}`
}
