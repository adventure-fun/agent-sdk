import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import type { SpectatorObservation } from "@adventure-fun/schemas"

describe("spectate — active session listing", () => {
  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    mock.restore()
  })

  it("listSpectatableSessions maps registered handles to redacted rows", async () => {
    const { clearActiveSessions, registerActiveSession, listSpectatableSessions } = await import(
      `../src/game/active-sessions.js?listTest=${Date.now()}`,
    )
    clearActiveSessions()

    const observation = {
      turn: 12,
      character: {
        id: "char-live-1",
        class: "knight" as const,
        level: 5,
        hp_percent: 80,
        resource_percent: 100,
      },
      realm_info: {
        template_name: "tutorial-cellar",
        current_floor: 1,
        entrance_room_id: "r0",
        status: "active" as const,
      },
      position: { floor: 1, room_id: "r0" },
    }

    registerActiveSession("char-live-1", {
      addSpectator: () => {},
      removeSpectator: () => {},
      getSpectatorObservation: () =>
        ({
          ...observation,
          visible_tiles: [],
          known_map: { floors: {} },
          visible_entities: [],
          room_text: null,
          recent_events: [],
          position: { ...observation.position, tile: { x: 0, y: 0 } },
        }) as SpectatorObservation,
    })

    expect(listSpectatableSessions()).toEqual([
      {
        character_id: "char-live-1",
        turn: 12,
        character: observation.character,
        realm_info: observation.realm_info,
        position: { floor: 1, room_id: "r0" },
      },
    ])

    clearActiveSessions()
  })

  it("GET /spectate/active returns JSON sessions (route wiring)", async () => {
    const row = {
      character_id: "mock-char",
      turn: 1,
      character: {
        id: "mock-char",
        class: "rogue" as const,
        level: 2,
        hp_percent: 100,
        resource_percent: 50,
      },
      realm_info: {
        template_name: "test-realm",
        current_floor: 1,
        entrance_room_id: "r0",
        status: "active" as const,
      },
      position: { floor: 1, room_id: "r0" },
    }

    // Bun's mock.module is global across the test process — a partial mock
    // here leaks into any subsequent test file that imports active-sessions.js
    // and tries to call e.g. hasActiveSession, which would then be missing.
    // Match the full export surface to keep downstream tests green.
    mock.module("../src/game/active-sessions.js", () => ({
      listSpectatableSessions: () => [row],
      hasActiveSession: () => false,
      getActiveSession: () => undefined,
      registerActiveSession: () => {},
      unregisterActiveSession: () => {},
      clearActiveSessions: () => {},
    }))

    const { spectateRoutes } = await import(`../src/routes/spectate.js?routeTest=${Date.now()}`)
    const app = new Hono()
    app.route("/spectate", spectateRoutes)

    const response = await app.request("http://example.test/spectate/active")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ sessions: [row] })
  })
})
