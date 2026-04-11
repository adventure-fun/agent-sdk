import devApi from "../../dev/api/index.js"

export interface DevServerHandle {
  apiUrl: string
  wsUrl: string
  port: number
  stop(): void
}

export async function startDevServer(): Promise<DevServerHandle> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: devApi.fetch,
    websocket: devApi.websocket,
  })

  const port = server.port
  const apiUrl = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}`

  await waitForHealthyServer(apiUrl)

  return {
    apiUrl,
    wsUrl,
    port,
    stop() {
      server.stop(true)
    },
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message))
    }, ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function waitForHealthyServer(apiUrl: string): Promise<void> {
  const timeoutAt = Date.now() + 5_000

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${apiUrl}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // Server startup races are expected for a short period.
    }

    await delay(25)
  }

  throw new Error(`Timed out waiting for dev server health check at ${apiUrl}/health`)
}
