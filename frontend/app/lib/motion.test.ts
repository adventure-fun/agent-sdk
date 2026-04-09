import { describe, expect, it } from "bun:test"
import { listItemReveal, pageEnter, softSpring } from "./motion.js"

describe("frontend motion presets", () => {
  it("exports the shared spring transition", () => {
    expect(softSpring.type).toBe("spring")
    expect(softSpring.stiffness).toBeGreaterThan(0)
  })

  it("defines visible page and list item variants", () => {
    expect(pageEnter.visible).toBeDefined()
    expect(listItemReveal.visible).toBeDefined()
  })
})
