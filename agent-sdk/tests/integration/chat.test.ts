import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { authenticate } from "../../src/auth.js"
import { ChatManager } from "../../src/chat/index.js"
import { GameClient } from "../../src/client.js"
import type { SanitizedChatMessage } from "../../src/protocol.js"
import { delay, startDevServer, withTimeout, type DevServerHandle } from "../helpers/dev-server.js"
import { MockLLMAdapter } from "../helpers/mock-llm.js"
import {
  createUniqueMockWalletAddress,
  MockWalletAdapter,
} from "../helpers/mock-wallet.js"

describe("Phase 8 integration: chat", () => {
  let server: DevServerHandle

  beforeAll(async () => {
    server = await startDevServer()
  })

  afterAll(() => {
    server.stop()
  })

  it("sends and receives lobby chat through GameClient and enforces server rate limiting", async () => {
    const wallet = new MockWalletAdapter({
      address: createUniqueMockWalletAddress("chatclient"),
    })
    const client = await createAuthenticatedClient(server, wallet, "ChatClientAgent")

    const receivedMessage = waitForChatMessage(client, "gameclient-message")

    try {
      await client.connectLobby()
      await delay(25)

      await client.request("/lobby/chat", {
        method: "POST",
        body: JSON.stringify({ message: "gameclient-message" }),
      })

      const message = await withTimeout(
        receivedMessage,
        5_000,
        "Timed out waiting for lobby chat message on GameClient",
      )
      expect(message.message).toBe("gameclient-message")

      await expect(
        client.request("/lobby/chat", {
          method: "POST",
          body: JSON.stringify({ message: "gameclient-rate-limit" }),
        }),
      ).rejects.toMatchObject({ status: 429 })

      await delay(5_100)

      const afterWindow = waitForChatMessage(client, "gameclient-after-window")
      await client.request("/lobby/chat", {
        method: "POST",
        body: JSON.stringify({ message: "gameclient-after-window" }),
      })

      expect(
        await withTimeout(
          afterWindow,
          5_000,
          "Timed out waiting for lobby chat after the rate-limit window elapsed",
        ),
      ).toMatchObject({ message: "gameclient-after-window" })
    } finally {
      client.disconnect()
    }
  }, 15_000)

  it("uses ChatManager to send chat and reject rapid consecutive sends client-side", async () => {
    const wallet = new MockWalletAdapter({
      address: createUniqueMockWalletAddress("chatmanager"),
    })
    const client = await createAuthenticatedClient(server, wallet, "ChatManagerAgent")
    const llm = new MockLLMAdapter()
    const chatManager = new ChatManager(
      client,
      {
        enabled: true,
        maxHistoryLength: 10,
      },
      llm,
      {
        minSendIntervalMs: 5_000,
      },
    )

    const receivedMessage = new Promise<SanitizedChatMessage>((resolve) => {
      const handler = (message: SanitizedChatMessage) => {
        if (message.message === "chat-manager-message") {
          chatManager.off("chatMessage", handler)
          resolve(message)
        }
      }
      chatManager.on("chatMessage", handler)
    })

    try {
      await chatManager.connect()
      await delay(25)
      await chatManager.sendMessage("chat-manager-message")

      expect(
        await withTimeout(
          receivedMessage,
          5_000,
          "Timed out waiting for ChatManager to observe the sent message",
        ),
      ).toMatchObject({ message: "chat-manager-message" })

      await expect(
        chatManager.sendMessage("chat-manager-too-fast"),
      ).rejects.toThrow("Chat message rate limited by SDK client")
    } finally {
      chatManager.disconnect()
      client.disconnect()
    }
  }, 10_000)
})

async function createAuthenticatedClient(
  server: DevServerHandle,
  wallet: MockWalletAdapter,
  characterName: string,
): Promise<GameClient> {
  const session = await authenticate(server.apiUrl, wallet)
  const client = new GameClient(server.apiUrl, server.wsUrl, session)

  await client.request("/characters/roll", {
    method: "POST",
    body: JSON.stringify({
      class: "rogue",
      name: characterName,
    }),
  })

  return client
}

function waitForChatMessage(
  client: GameClient,
  expectedMessage: string,
): Promise<SanitizedChatMessage> {
  return new Promise((resolve) => {
    const handler = (message: SanitizedChatMessage) => {
      if (message.message === expectedMessage) {
        client.off("chatMessage", handler)
        resolve(message)
      }
    }

    client.on("chatMessage", handler)
  })
}
