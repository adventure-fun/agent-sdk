import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { authenticate } from "../../src/auth.js"
import { BaseAgent } from "../../src/agent.js"
import { GameClient } from "../../src/client.js"
import { createDefaultConfig } from "../../src/config.js"
import type { AgentEvents } from "../../src/agent.js"
import { startDevServer, withTimeout, type DevServerHandle } from "../helpers/dev-server.js"
import { MockLLMAdapter } from "../helpers/mock-llm.js"
import {
  createUniqueMockWalletAddress,
  MockWalletAdapter,
} from "../helpers/mock-wallet.js"

describe("Phase 8 integration: full tutorial run", () => {
  let server: DevServerHandle

  beforeAll(async () => {
    server = await startDevServer()
  })

  afterAll(() => {
    server.stop()
  })

  it("authenticates, rolls a character, generates a realm, and extracts", async () => {
    const wallet = new MockWalletAdapter({
      address: createUniqueMockWalletAddress("fullrun"),
    })
    const llm = new MockLLMAdapter({
      actionPicker: createTutorialActionPicker(),
    })
    const characterName = `Run${Date.now().toString().slice(-8)}`
    const config = createDefaultConfig({
      apiUrl: server.apiUrl,
      wsUrl: server.wsUrl,
      realmTemplateId: "test-tutorial",
      realmProgression: {
        strategy: "auto",
        continueOnExtraction: false,
      },
      characterClass: "rogue",
      characterName,
      llm: {
        provider: "openai",
        apiKey: "test-key",
      },
      wallet: {
        type: "env",
      },
      decision: {
        strategy: "llm-every-turn",
      },
    })

    const agent = new BaseAgent(config, {
      llmAdapter: llm,
      walletAdapter: wallet,
    })

    const observations: AgentEvents["observation"][] = []
    const actions: AgentEvents["action"][] = []
    const plannerDecisions: AgentEvents["plannerDecision"][] = []
    const errors: Error[] = []
    let extracted: AgentEvents["extracted"] | null = null

    agent.on("observation", (observation) => {
      observations.push(observation)
    })
    agent.on("action", (action) => {
      actions.push(action)
    })
    agent.on("plannerDecision", (decision) => {
      plannerDecisions.push(decision)
    })
    agent.on("error", (error) => {
      errors.push(error)
    })
    agent.on("extracted", (payload) => {
      extracted = payload
    })

    try {
      await withTimeout(
        agent.start(),
        20_000,
        "Timed out waiting for BaseAgent to complete the tutorial realm",
      )
    } finally {
      agent.stop()
    }

    expect(errors).toHaveLength(0)
    expect(observations.length).toBeGreaterThan(0)
    expect(actions.length).toBeGreaterThan(0)
    expect(plannerDecisions.length).toBeGreaterThan(0)
    expect(extracted).not.toBeNull()
    expect(
      actions.some(({ action }) => action.type === "use_portal" || action.type === "retreat"),
    ).toBeTrue()
    expect(
      llm.getHistory().some((entry) => entry.kind === "decide"),
    ).toBeTrue()

    const session = await authenticate(server.apiUrl, wallet)
    const client = new GameClient(server.apiUrl, server.wsUrl, session)

    try {
      const character = await client.request<{
        name: string
        class: string
        status: string
      }>("/characters/me")
      const realms = await client.request<{
        realms: Array<{ id: string; template_id: string; status: string }>
      }>("/realms/mine")

      expect(character.name).toBe(characterName)
      expect(character.class).toBe("rogue")
      expect(character.status).toBe("alive")
      expect(realms.realms.length).toBeGreaterThan(0)
      expect(
        realms.realms.some(
          (realm) =>
            realm.template_id === "test-tutorial"
            && (realm.status === "completed" || realm.status === "dead_end"),
        ),
      ).toBeTrue()
    } finally {
      client.disconnect()
    }
  }, 30_000)
})

function createTutorialActionPicker(): (observation: AgentEvents["observation"]) => AgentEvents["action"]["action"] {
  let previousRoomId: string | null = null
  let lastMoveDirection: "up" | "down" | "left" | "right" | null = null
  const cameFromDirectionByRoom = new Map<string, "up" | "down" | "left" | "right">()

  return (observation) => {
    if (
      previousRoomId
      && previousRoomId !== observation.position.room_id
      && lastMoveDirection
      && !cameFromDirectionByRoom.has(observation.position.room_id)
    ) {
      cameFromDirectionByRoom.set(
        observation.position.room_id,
        reverseDirection(lastMoveDirection),
      )
    }

    const attack = observation.legal_actions.find(
      (action): action is Extract<AgentEvents["action"]["action"], { type: "attack" }> =>
        action.type === "attack" && action.target_id !== "self",
    )
    const retreat = observation.legal_actions.find(
      (action): action is Extract<AgentEvents["action"]["action"], { type: "retreat" }> =>
        action.type === "retreat",
    )
    if (attack) {
      previousRoomId = observation.position.room_id
      lastMoveDirection = null
      return attack
    }

    const useItem = observation.legal_actions.find(
      (action): action is Extract<AgentEvents["action"]["action"], { type: "use_item" }> =>
        action.type === "use_item" && observation.character.hp.current < observation.character.hp.max,
    )
    if (useItem) {
      previousRoomId = observation.position.room_id
      lastMoveDirection = null
      return useItem
    }
    if (retreat && !observation.visible_entities.some((entity) => entity.type === "enemy")) {
      previousRoomId = observation.position.room_id
      lastMoveDirection = null
      return retreat
    }
    if (observation.legal_actions.some((action) => action.type === "use_portal")) {
      previousRoomId = observation.position.room_id
      lastMoveDirection = null
      return { type: "use_portal" }
    }

    const move = chooseTutorialMove(
      observation,
      cameFromDirectionByRoom.get(observation.position.room_id) ?? null,
    )
    previousRoomId = observation.position.room_id
    lastMoveDirection = move.direction
    return move
  }
}

function chooseTutorialMove(
  observation: AgentEvents["observation"],
  cameFromDirection: "up" | "down" | "left" | "right" | null,
): Extract<AgentEvents["action"]["action"], { type: "move" }> {
  const moveActions = observation.legal_actions.filter(
    (action): action is Extract<AgentEvents["action"]["action"], { type: "move" }> => action.type === "move",
  )
  const current = observation.position.tile
  const tileByCoordinate = new Map(
    observation.visible_tiles.map((tile) => [`${tile.x},${tile.y}`, tile] as const),
  )
  const target =
    observation.visible_entities.find((entity) => entity.type === "enemy")?.position
    ?? nearestTraversalTile(observation, cameFromDirection)
    ?? current

  const passableMoves = moveActions.filter((action) => {
    const next = nextPosition(current, action.direction)
    const nextTile = tileByCoordinate.get(`${next.x},${next.y}`)
    return nextTile !== undefined && nextTile.type !== "wall"
  })

  const forwardMove = passableMoves.find((action) => {
    if (cameFromDirection && action.direction === cameFromDirection) {
      return false
    }

    const next = nextPosition(current, action.direction)
    return manhattanDistance(next, target) < manhattanDistance(current, target)
  })
  if (forwardMove) {
    return forwardMove
  }

  return passableMoves.find((action) => action.direction !== cameFromDirection)
    ?? passableMoves[0]
    ?? moveActions[0]
    ?? { type: "move", direction: "right" }
}

function nearestTraversalTile(
  observation: AgentEvents["observation"],
  cameFromDirection: "up" | "down" | "left" | "right" | null,
): { x: number; y: number } | null {
  const current = observation.position.tile
  const traversalTiles = observation.visible_tiles.filter((tile) =>
    tile.type === "door" || tile.type === "stairs" || tile.type === "stairs_up",
  )

  const preferredTiles = traversalTiles.filter((tile) =>
    !isTileInDirection(current, tile, cameFromDirection),
  )

  return (preferredTiles.length > 0 ? preferredTiles : traversalTiles).sort((left, right) =>
    manhattanDistance(current, left) - manhattanDistance(current, right),
  )[0] ?? null
}

function nextPosition(
  position: { x: number; y: number },
  direction: "up" | "down" | "left" | "right",
): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - 1 }
    case "down":
      return { x: position.x, y: position.y + 1 }
    case "left":
      return { x: position.x - 1, y: position.y }
    case "right":
      return { x: position.x + 1, y: position.y }
  }
}

function reverseDirection(direction: "up" | "down" | "left" | "right") {
  switch (direction) {
    case "up":
      return "down"
    case "down":
      return "up"
    case "left":
      return "right"
    case "right":
      return "left"
  }
}

function manhattanDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
}

function isTileInDirection(
  current: { x: number; y: number },
  tile: { x: number; y: number },
  direction: "up" | "down" | "left" | "right" | null,
): boolean {
  switch (direction) {
    case "up":
      return tile.y < current.y
    case "down":
      return tile.y > current.y
    case "left":
      return tile.x < current.x
    case "right":
      return tile.x > current.x
    case null:
      return false
  }
}
