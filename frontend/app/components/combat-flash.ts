import type { AnimatedSprite } from "pixi.js"
import type { GameEvent } from "@adventure-fun/schemas"

const FLASH_DURATION = 1000
const FLASH_INTERVAL = 125
const FLASH_COLORS = [0xff4444, 0xffffff] as const

/**
 * Vanilla JS combat flash manager — zero React dependency.
 * Owns its own setInterval and tint lifecycle.
 */
export class CombatFlashManager {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastFlashedTurn = -1
  private sprites: AnimatedSprite[] = []
  private startTime = 0
  private active = false
  // Store which entities are flashing so we can rebuild refs after a redraw
  private hitEnemyIds = new Set<string>()
  private playerHit = false

  /**
   * Call BEFORE processEvents on every draw to keep sprite refs
   * in sync when the stage is torn down and rebuilt.
   */
  refreshSprites(
    enemySpriteMap: Map<string, AnimatedSprite>,
    playerSprite: AnimatedSprite | null,
  ) {
    if (!this.active) return
    const fresh: AnimatedSprite[] = []
    for (const id of this.hitEnemyIds) {
      const s = enemySpriteMap.get(id)
      if (s) fresh.push(s)
    }
    if (this.playerHit && playerSprite) fresh.push(playerSprite)
    this.sprites = fresh
    // Apply the current tint so there's no gap frame
    const elapsed = Date.now() - this.startTime
    if (elapsed < FLASH_DURATION) {
      const idx = Math.floor(elapsed / FLASH_INTERVAL) % 2
      for (const s of this.sprites) {
        if (!s.destroyed) s.tint = FLASH_COLORS[idx]!
      }
    }
  }

  /** Detect new combat events and kick off a flash cycle. */
  processEvents(
    events: GameEvent[],
    turn: number,
    enemySpriteMap: Map<string, AnimatedSprite>,
    playerSprite: AnimatedSprite | null,
  ) {
    if (events.length === 0) return
    if (turn <= this.lastFlashedTurn) return

    const hitEnemyIds = new Set<string>()
    let playerHit = false
    for (const e of events) {
      if (e.type === "attack_hit" && typeof e.data.target === "string") {
        hitEnemyIds.add(e.data.target)
      }
      if (e.type === "status_tick" && typeof e.data.enemy_id === "string") {
        hitEnemyIds.add(e.data.enemy_id)
      }
      if (e.type === "enemy_attack" || e.type === "trap_triggered") {
        playerHit = true
      }
    }

    if (hitEnemyIds.size === 0 && !playerHit) return

    const targetSprites: AnimatedSprite[] = []
    for (const id of hitEnemyIds) {
      const s = enemySpriteMap.get(id)
      if (s) targetSprites.push(s)
    }
    if (playerHit && playerSprite) targetSprites.push(playerSprite)
    if (targetSprites.length === 0) return

    // New turn — start fresh flash
    this.stop()
    this.lastFlashedTurn = turn
    this.hitEnemyIds = hitEnemyIds
    this.playerHit = playerHit
    this.sprites = targetSprites
    this.startTime = Date.now()
    this.active = true

    for (const s of this.sprites) {
      if (!s.destroyed) s.tint = FLASH_COLORS[0]
    }

    this.intervalId = setInterval(() => {
      const elapsed = Date.now() - this.startTime
      if (elapsed >= FLASH_DURATION) {
        for (const s of this.sprites) {
          if (!s.destroyed) s.tint = 0xffffff
        }
        this.stop()
        return
      }
      const idx = Math.floor(elapsed / FLASH_INTERVAL) % 2
      for (const s of this.sprites) {
        if (!s.destroyed) s.tint = FLASH_COLORS[idx]!
      }
    }, FLASH_INTERVAL)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.sprites = []
    this.hitEnemyIds = new Set()
    this.playerHit = false
    this.active = false
  }
}
