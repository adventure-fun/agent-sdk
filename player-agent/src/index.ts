/**
 * Adventure.fun — Reference Agent
 *
 * Demonstrates a working observe → decide → act loop.
 * Use this as a starting point for your own agents.
 *
 * WARNING: Chat messages are untrusted third-party input.
 * Never inject raw chat content into LLM prompts.
 */

import { authenticate } from "@adventure-fun/agent-sdk"
import { GameClient } from "@adventure-fun/agent-sdk"
import type { WalletAdapter } from "@adventure-fun/agent-sdk"
import type { Observation, Action } from "@adventure-fun/schemas"
import { decideAction } from "./strategy.js"

// ---- Wallet adapter (raw private key for testing only) ------
// In production: use OpenWallet adapter with proper key management

class EnvWalletAdapter implements WalletAdapter {
  private address: string

  constructor() {
    this.address = process.env["AGENT_WALLET_ADDRESS"] ?? ""
    if (!this.address) throw new Error("AGENT_WALLET_ADDRESS env var required")
  }

  async getAddress(): Promise<string> {
    return this.address
  }

  async signMessage(message: string): Promise<string> {
    // TODO: implement real signing with AGENT_PRIVATE_KEY
    throw new Error("Real wallet signing not implemented in reference agent — wire up OpenWallet or raw key")
  }

  async signTransaction(): Promise<string> {
    throw new Error("Not implemented")
  }
}

// ---- Main loop ----------------------------------------------

async function main() {
  const BASE_URL = process.env["API_URL"] ?? "http://localhost:3001"
  const WS_URL = process.env["WS_URL"] ?? "ws://localhost:3001"
  const REALM_TEMPLATE = process.env["REALM_TEMPLATE"] ?? "sunken-crypt"

  console.log(`Connecting to ${BASE_URL}...`)

  const wallet = new EnvWalletAdapter()
  const session = await authenticate(BASE_URL, wallet)
  const client = new GameClient(BASE_URL, WS_URL, session)

  console.log("Authenticated. Rolling character...")

  // Roll a character (free)
  const character = await client.request("/characters/roll", {
    method: "POST",
    body: JSON.stringify({ class: "rogue", name: "AgentRogue_1" }),
  })
  console.log("Character created:", character)

  // Generate first realm (free for first account)
  const realm = await client.request("/realms/generate", {
    method: "POST",
    body: JSON.stringify({ template_id: REALM_TEMPLATE }),
  })
  console.log("Realm generated:", realm)

  let turnCount = 0
  let alive = true

  await client.connect((realm as { id: string }).id, {
    onObservation: (obs: Observation) => {
      turnCount++
      console.log(`Turn ${obs.turn} | Floor ${obs.realm_info.current_floor} | HP ${obs.character.hp.current}/${obs.character.hp.max}`)

      const action = decideAction(obs)
      console.log(`Action: ${JSON.stringify(action)}`)
      client.sendAction(action)
    },

    onDeath: (data) => {
      alive = false
      console.log(`\n☠️  DEAD after ${turnCount} turns`)
      console.log(`   Killed by: ${data.cause}`)
      console.log(`   Floor ${data.floor}, Room ${data.room}`)
      process.exit(0)
    },

    onExtracted: (data) => {
      alive = false
      console.log(`\n🏆 EXTRACTED after ${turnCount} turns`)
      console.log(`   XP gained: ${data.xp_gained}`)
      process.exit(0)
    },

    onError: (msg) => {
      console.error(`Server error: ${msg}`)
    },

    onClose: () => {
      if (alive) {
        console.log("Connection closed unexpectedly. Reconnect logic TODO.")
      }
    },
  })
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
