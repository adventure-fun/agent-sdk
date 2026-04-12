import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("test-arena content", () => {
  it("grants a portal scroll after the arena room is cleared", () => {
    const roomPath = join(
      import.meta.dir,
      "../../../dev/content/rooms/test-arena/test-arena-gauntlet.json",
    )
    const room = JSON.parse(readFileSync(roomPath, "utf8")) as {
      interactables?: Array<{
        conditions?: Array<{ type?: string }>
        effects?: Array<{ type?: string; item_template_id?: string }>
      }>
    }

    const exitCache = room.interactables?.find((interactable) =>
      interactable.conditions?.some((condition) => condition.type === "room-cleared")
      && interactable.effects?.some((effect) =>
        effect.type === "grant-item" && effect.item_template_id === "portal-scroll"
      ),
    )

    expect(exitCache).toBeDefined()
  })
})
