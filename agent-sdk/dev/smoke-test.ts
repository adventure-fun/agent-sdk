import { authenticate } from "../src/auth.js"
import { GameClient } from "../src/client.js"
import type { Action, Observation } from "../src/protocol.js"
import type { TransactionRequest, WalletAdapter, WalletNetwork } from "../src/adapters/wallet/index.js"

const API_URL = process.env["API_URL"] ?? "http://localhost:3001"
const WS_URL = process.env["WS_URL"] ?? "ws://localhost:3001"
const REALM_TEMPLATE = process.env["REALM_TEMPLATE"] ?? "test-tutorial"
const CHARACTER_CLASS = process.env["CHARACTER_CLASS"] ?? "rogue"
const CHARACTER_NAME = process.env["CHARACTER_NAME"] ?? "SmokeTestAgent"
const CHAT_MESSAGE = process.env["CHAT_MESSAGE"] ?? "Smoke test ping from the Agent SDK dev stack."

class DevWalletAdapter implements WalletAdapter {
  async getAddress(): Promise<string> {
    return "0x000000000000000000000000000000000000dEaD"
  }

  async signMessage(message: string): Promise<string> {
    return `dev-signature:${message}`
  }

  async signTransaction(_tx: TransactionRequest): Promise<string> {
    return "dev-transaction-signature"
  }

  getNetwork(): WalletNetwork {
    return "base"
  }
}

function chooseAction(observation: Observation): Action {
  const legalActions = observation.legal_actions
  return (
    legalActions.find((action) => action.type === "use_portal")
    ?? legalActions.find((action) => action.type === "interact")
    ?? legalActions.find((action) => action.type === "pickup")
    ?? legalActions.find((action) => action.type === "equip")
    ?? legalActions.find((action) => action.type === "attack")
    ?? legalActions.find((action) => action.type === "move" && action.direction === "right")
    ?? legalActions.find((action) => action.type === "move" && action.direction === "down")
    ?? legalActions.find((action) => action.type === "move")
    ?? { type: "wait" }
  )
}

async function ensureCharacter(client: GameClient): Promise<void> {
  try {
    await client.request("/characters/me")
  } catch {
    await client.request("/characters/roll", {
      method: "POST",
      body: JSON.stringify({
        class: CHARACTER_CLASS,
        name: CHARACTER_NAME,
      }),
    })
  }
}

async function main(): Promise<void> {
  const wallet = new DevWalletAdapter()
  const session = await authenticate(API_URL, wallet)
  const client = new GameClient(API_URL, WS_URL, session)

  await ensureCharacter(client)
  const realm = await client.request<{ id: string }>("/realms/generate", {
    method: "POST",
    body: JSON.stringify({ template_id: REALM_TEMPLATE }),
  })

  await client.connectLobby({
    onChatMessage(message) {
      console.log("[lobby]", message.character_name, ">", message.message)
    },
    onLobbyEvent(event) {
      console.log("[lobby-event]", event.type, event.detail)
    },
  })

  await client.request("/lobby/chat", {
    method: "POST",
    body: JSON.stringify({ message: CHAT_MESSAGE }),
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Smoke test timed out after 60s"))
    }, 60_000)

    void client.connect(realm.id, {
      onObservation(observation) {
        console.log(`[turn ${observation.turn}] ${observation.room_text ?? "no-room-text"}`)
        const action = chooseAction(observation)
        console.log(" -> action", JSON.stringify(action))
        client.sendAction(action)
      },
      onExtracted(data) {
        clearTimeout(timeout)
        console.log("Extracted successfully", JSON.stringify(data, null, 2))
        client.disconnect()
        resolve()
      },
      onDeath(data) {
        clearTimeout(timeout)
        reject(new Error(`Agent died during smoke test: ${JSON.stringify(data)}`))
      },
      onError(error) {
        clearTimeout(timeout)
        reject(error)
      },
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
