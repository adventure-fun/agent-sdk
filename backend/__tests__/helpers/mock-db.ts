/**
 * Lightweight mock for the Supabase JS client's chaining API.
 * Tracks every call made through `db.from(table).<op>(...).<filter>(...)`.
 */

export interface DbCall {
  table: string
  operation: "select" | "insert" | "update" | "delete" | "upsert"
  payload?: unknown
  filters: Array<{ method: string; args: unknown[] }>
  terminal?: "single" | "maybeSingle"
}

export interface MockDbResult {
  data: unknown
  error: unknown
}

export function createMockDb() {
  const calls: DbCall[] = []
  const responseMap = new Map<string, MockDbResult[]>()

  function setResponse(table: string, op: string, result: MockDbResult) {
    const key = `${table}:${op}`
    const existing = responseMap.get(key) ?? []
    existing.push(result)
    responseMap.set(key, existing)
  }

  function getResponse(table: string, op: string): MockDbResult {
    const key = `${table}:${op}`
    const queue = responseMap.get(key)
    if (!queue || queue.length === 0) return { data: null, error: null }
    if (queue.length === 1) return queue[0]!
    return queue.shift()!
  }

  function makeChain(call: DbCall) {
    const chain: Record<string, unknown> = {}

    const filterMethods = ["eq", "neq", "in", "not", "or", "order", "limit"]
    for (const method of filterMethods) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push({ method, args })
        return chain
      }
    }

    chain.select = (...args: unknown[]) => {
      call.filters.push({ method: "select", args })
      return chain
    }

    chain.single = () => {
      call.terminal = "single"
      return Promise.resolve(getResponse(call.table, call.operation))
    }

    chain.maybeSingle = () => {
      call.terminal = "maybeSingle"
      return Promise.resolve(getResponse(call.table, call.operation))
    }

    // Allow awaiting the chain directly (e.g. `await db.from("x").delete().eq(...)`)
    chain.then = (onFulfilled?: (value: MockDbResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(getResponse(call.table, call.operation)).then(onFulfilled, onRejected)
    chain.catch = (onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(getResponse(call.table, call.operation)).catch(onRejected)

    return chain
  }

  const db = {
    from(table: string) {
      return {
        select(...args: unknown[]) {
          const call: DbCall = {
            table,
            operation: "select",
            filters: [{ method: "select", args }],
          }
          calls.push(call)
          return makeChain(call)
        },
        insert(payload: unknown) {
          const call: DbCall = {
            table,
            operation: "insert",
            payload,
            filters: [],
          }
          calls.push(call)
          return makeChain(call)
        },
        update(payload: unknown) {
          const call: DbCall = {
            table,
            operation: "update",
            payload,
            filters: [],
          }
          calls.push(call)
          return makeChain(call)
        },
        delete() {
          const call: DbCall = {
            table,
            operation: "delete",
            filters: [],
          }
          calls.push(call)
          return makeChain(call)
        },
        upsert(payload: unknown, opts?: unknown) {
          const call: DbCall = {
            table,
            operation: "upsert",
            payload,
            filters: [],
          }
          calls.push(call)
          return makeChain(call)
        },
      }
    },
  }

  function getCalls(table: string, operation?: string): DbCall[] {
    return calls.filter(
      (c) => c.table === table && (!operation || c.operation === operation),
    )
  }

  function reset() {
    calls.length = 0
    responseMap.clear()
  }

  return { db, calls, getCalls, setResponse, reset }
}
