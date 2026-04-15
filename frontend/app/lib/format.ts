// App-wide string formatting helpers. Lives under `app/lib` (not under a
// route-scoped folder) because it's consumed from pages and components.

export function titleCase(value: string): string {
  if (value.length === 0) return value
  const first = value.charAt(0).toUpperCase()
  const rest = value.slice(1)
  return `${first}${rest}`
}
