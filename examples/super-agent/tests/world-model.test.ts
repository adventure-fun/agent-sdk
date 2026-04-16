import { describe, expect, it } from "bun:test"
import { WorldModel } from "../src/world-model/world-model.js"
import { buildObservation, enemy } from "../../../tests/helpers/mock-observation.js"

describe("WorldModel", () => {
  it("records a run lifecycle end-to-end", () => {
    const world = WorldModel.open(":memory:")
    const runId = world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)
    expect(runId).toBeGreaterThan(0)
    expect(world.countRuns()).toBe(1)

    world.endRun(runId, {
      outcome: "extracted",
      floorReached: 2,
      turnsPlayed: 42,
      goldEarned: 150,
      xpEarned: 300,
      realmCompleted: true,
    })

    const summary = world.summarizeForLLM("test-dungeon", "rogue")
    expect(summary).toContain("1 clears")
    expect(summary).toContain("Best floor reached: 2")
    world.close()
  })

  it("tracks enemy sightings and kills across turns", () => {
    const world = WorldModel.open(":memory:")
    world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)

    const turn1 = buildObservation({
      turn: 1,
      visible_entities: [enemy("e1", { name: "Goblin Scout", hp_current: 10 })],
    })
    world.ingestObservation(turn1)

    const profile1 = world.getEnemyProfile("test-dungeon", "Goblin Scout", "rogue")
    expect(profile1).not.toBeNull()
    expect(profile1!.sightings).toBe(1)
    expect(profile1!.kills).toBe(0)

    // Next turn, enemy gone — kill.
    const turn2 = buildObservation({ turn: 2, visible_entities: [] })
    world.ingestObservation(turn2)

    const profile2 = world.getEnemyProfile("test-dungeon", "Goblin Scout", "rogue")
    expect(profile2).not.toBeNull()
    expect(profile2!.kills).toBe(1)
    world.close()
  })

  it("upserts shop prices and retrieves by template id", () => {
    const world = WorldModel.open(":memory:")
    world.upsertShopPrices([
      {
        id: "iron-sword",
        name: "Iron Sword",
        type: "equipment",
        rarity: "common",
        equip_slot: "weapon",
        buy_price: 50,
        sell_price: 10,
        stats: { attack: 5 },
      },
    ])

    const record = world.getShopPrice("iron-sword")
    expect(record).not.toBeNull()
    expect(record!.buyPrice).toBe(50)
    expect(record!.sellPrice).toBe(10)
    expect(record!.stats).toEqual({ attack: 5 })
    world.close()
  })

  it("records a death and surfaces it in the summary", () => {
    const world = WorldModel.open(":memory:")
    world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)
    world.recordDeath("Giant Spider")
    const profile = world.getEnemyProfile("test-dungeon", "Giant Spider", "rogue")
    expect(profile).not.toBeNull()
    expect(profile!.deathsTo).toBe(1)
    world.close()
  })

  it("adds realm tips and surfaces them in summaryForLLM", () => {
    const world = WorldModel.open(":memory:")
    world.startRun("test-dungeon", "Test Dungeon", "rogue", 3)
    world.addRealmTip("test-dungeon", "rogue", "spike traps on floor 2")
    const summary = world.summarizeForLLM("test-dungeon", "rogue")
    expect(summary).toContain("spike traps on floor 2")
    world.close()
  })

  it("returns empty summary when nothing is known", () => {
    const world = WorldModel.open(":memory:")
    expect(world.summarizeForLLM("unknown", "rogue")).toBe("")
    world.close()
  })

  it("upserts and queries blocked doors by template", () => {
    const world = WorldModel.open(":memory:")
    world.upsertBlockedDoor({
      templateId: "sunken-crypt",
      targetId: "sc-iron-gate",
      floor: 1,
      roomId: "sc-offering-room",
      x: 7,
      y: 3,
      requiredKeyTemplateId: "crypt-key",
      name: "Iron Gate",
    })

    const records = world.getBlockedDoorsForTemplate("sunken-crypt")
    expect(records.length).toBe(1)
    expect(records[0]!.targetId).toBe("sc-iron-gate")
    expect(records[0]!.requiredKeyTemplateId).toBe("crypt-key")
    expect(records[0]!.name).toBe("Iron Gate")

    world.close()
  })

  it("preserves non-null required_key_template_id on re-upsert when later call omits it", () => {
    const world = WorldModel.open(":memory:")
    world.upsertBlockedDoor({
      templateId: "sunken-crypt",
      targetId: "sc-iron-gate",
      floor: 1,
      roomId: "sc-offering-room",
      x: 7,
      y: 3,
      requiredKeyTemplateId: "crypt-key",
    })
    // Re-upsert without key — e.g. on a fresh run where we only know the position.
    world.upsertBlockedDoor({
      templateId: "sunken-crypt",
      targetId: "sc-iron-gate",
      floor: 1,
      roomId: "sc-offering-room",
      x: 7,
      y: 3,
    })
    const records = world.getBlockedDoorsForTemplate("sunken-crypt")
    expect(records[0]!.requiredKeyTemplateId).toBe("crypt-key")
    world.close()
  })

  it("deletes a blocked door once it is opened", () => {
    const world = WorldModel.open(":memory:")
    world.upsertBlockedDoor({
      templateId: "sunken-crypt",
      targetId: "sc-iron-gate",
      floor: 1,
      roomId: "sc-offering-room",
      x: 7,
      y: 3,
    })
    world.deleteBlockedDoor("sunken-crypt", "sc-iron-gate")
    expect(world.getBlockedDoorsForTemplate("sunken-crypt").length).toBe(0)
    world.close()
  })
})
