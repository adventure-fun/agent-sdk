import type { Tile, Entity, SpectatorEntity, CharacterClass, GameEvent } from "@adventure-fun/schemas"
import { Application, AnimatedSprite, Assets, Graphics, Texture, Sprite, Container, BlurFilter, Rectangle } from "pixi.js"
import {
  TILE_SIZE,
  COLORS,
  PLAYER_COLOR,
  ENEMY_SPRITE_REGISTRY,
  ITEM_SPRITE_REGISTRY,
  ITEM_SIZE_OVERRIDES,
  ENEMY_DEFAULT_FACING,
  PLAYER_DEFAULT_FACING,
  LOCKED_GATE_IDS,
  INTERACTABLE_SPRITE_REGISTRY,
  REALM_ENEMIES,
  PLAYER_SPRITE_REGISTRY,
  HP_BAR_WIDTH,
  HP_BAR_HEIGHT,
  HP_BAR_GAP,
  HP_BAR_BG,
  HP_COLOR_HIGH,
  HP_COLOR_MID,
  HP_COLOR_LOW,
} from "./sprite-registries"
import { CombatFlashManager } from "./combat-flash"

export interface RendererProps {
  visibleTiles: Tile[]
  knownTiles: Tile[]
  playerPosition: { x: number; y: number }
  playerHpPercent: number | undefined
  entities: (Entity | SpectatorEntity)[]
  recentEvents: GameEvent[]
  turn: number
}

function getHpColor(pct: number): number {
  if (pct > 50) return HP_COLOR_HIGH
  if (pct > 25) return HP_COLOR_MID
  return HP_COLOR_LOW
}

function getEntityHpPercent(entity: Entity | SpectatorEntity): number | null {
  if ("hp_current" in entity && "hp_max" in entity && entity.hp_max && entity.hp_max > 0) {
    return Math.round(((entity.hp_current ?? 0) / entity.hp_max) * 100)
  }
  if ("health_indicator" in entity && entity.health_indicator) {
    switch (entity.health_indicator) {
      case "full": return 100
      case "high": return 80
      case "medium": return 50
      case "low": return 25
      case "critical": return 10
    }
  }
  return null
}

function drawHealthBar(gfx: Graphics, px: number, py: number, pct: number) {
  const barX = px + (TILE_SIZE - HP_BAR_WIDTH) / 2
  const barY = py - HP_BAR_HEIGHT - HP_BAR_GAP
  gfx.rect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT).fill(HP_BAR_BG)
  const fillWidth = Math.round((pct / 100) * HP_BAR_WIDTH)
  if (fillWidth > 0) {
    gfx.rect(barX, barY, fillWidth, HP_BAR_HEIGHT).fill(getHpColor(pct))
  }
}

/**
 * Pure vanilla JS dungeon renderer. No React.
 * Create one instance, call init() once, then update() on every state change.
 */
export class DungeonRenderer {
  private app: Application | null = null
  private container: HTMLDivElement | null = null
  private initPromise: Promise<void> | null = null
  private ready = false
  private destroyed = false

  // Textures
  private floorTexture: Texture | null = null
  private wallTexture: Texture | null = null
  private wallCornerTexture: Texture | null = null
  private stairsTexture: Texture | null = null
  private doorTexture: Texture | null = null
  private lockedGateTexture: Texture | null = null
  private playerFrames: Texture[] | null = null
  private enemyFrames: Record<string, Texture[]> = {}
  private itemFrames: Record<string, Texture[]> = {}
  private interactableFrames: Record<string, Texture[]> = {}
  private notFoundFrames: Texture[] | null = null

  // Facing state
  private prevPlayerPos: { x: number; y: number } | null = null
  private playerFacing: "left" | "right" = PLAYER_DEFAULT_FACING
  private prevEnemyPos = new Map<string, number>()
  private enemyFacing = new Map<string, "left" | "right">()

  // Realm tracking
  private loadedRealm: string | null = null

  // Combat flash
  private flashManager = new CombatFlashManager()

  // Stash latest props so realm-load callback can redraw
  private lastProps: RendererProps | null = null

  async init(container: HTMLDivElement, playerClass?: CharacterClass) {
    if (this.initPromise) return this.initPromise
    this.container = container

    this.initPromise = (async () => {
      const app = new Application()
      await app.init({ background: 0x000000, antialias: true })

      const [floor, wall, wallCorner, stairs, door, lockedGate] = await Promise.all([
        Assets.load("/sprites/world/dungeon-floor.png"),
        Assets.load("/sprites/world/dungeon-wall.png"),
        Assets.load("/sprites/world/dungeon-wall-corner.png"),
        Assets.load("/sprites/world/dungeon-stairs.png"),
        Assets.load("/sprites/world/dungeon-door.png"),
        Assets.load("/sprites/world/dungeon-locked-iron-gate.png"),
      ])
      this.floorTexture = floor
      this.wallTexture = wall
      this.wallCornerTexture = wallCorner
      this.stairsTexture = stairs
      this.doorTexture = door
      this.lockedGateTexture = lockedGate

      const playerReg = playerClass ? PLAYER_SPRITE_REGISTRY[playerClass] : PLAYER_SPRITE_REGISTRY.knight
      const [playerSheet, notFoundSheet] = await Promise.all([
        Assets.load(playerReg.json),
        Assets.load("/sprites/not-found.json"),
      ])
      if (playerSheet.animations?.[playerReg.animKey]) {
        this.playerFrames = playerSheet.animations[playerReg.animKey]
      }
      if (notFoundSheet.animations?.["not-found"]) {
        this.notFoundFrames = notFoundSheet.animations["not-found"]
      }

      // Items
      const itemEntries = Object.entries(ITEM_SPRITE_REGISTRY)
      const itemSheets = await Promise.all(itemEntries.map(([, reg]) => Assets.load(reg.json)))
      for (let i = 0; i < itemEntries.length; i++) {
        const [templateId, reg] = itemEntries[i]!
        const sheet = itemSheets[i]
        if (sheet.animations?.[reg.animKey]) {
          this.itemFrames[templateId] = sheet.animations[reg.animKey]
        }
      }

      // Interactables
      const interactableEntries = Object.entries(INTERACTABLE_SPRITE_REGISTRY)
      const uniqueJsons = [...new Set(interactableEntries.map(([, reg]) => reg.json))]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheetMap = new Map<string, any>()
      const loadedSheets = await Promise.all(uniqueJsons.map((json) => Assets.load(json)))
      for (let i = 0; i < uniqueJsons.length; i++) {
        sheetMap.set(uniqueJsons[i]!, loadedSheets[i])
      }
      for (const [id, reg] of interactableEntries) {
        const sheet = sheetMap.get(reg.json)
        if (sheet?.animations?.[reg.animKey]) {
          this.interactableFrames[id] = sheet.animations[reg.animKey]
        }
      }

      // Bail if destroy() was called while we were loading (React strict mode)
      if (this.destroyed) {
        app.destroy(true)
        return
      }

      container.appendChild(app.canvas)
      this.app = app
      this.ready = true

      // Props may have arrived while we were loading — draw now
      if (this.lastProps) this.draw(this.lastProps)
    })()

    return this.initPromise
  }

  async loadRealmEnemies(realmTemplateId: string) {
    if (!realmTemplateId || realmTemplateId === this.loadedRealm) return
    const slugs = REALM_ENEMIES[realmTemplateId] ?? []
    const entries = slugs
      .map((slug) => {
        const reg = ENEMY_SPRITE_REGISTRY[slug]
        return reg ? { slug, ...reg } : null
      })
      .filter((e): e is { slug: string; json: string; animKey: string } => e != null)
    if (entries.length === 0) return

    this.loadedRealm = realmTemplateId
    if (this.initPromise) await this.initPromise
    if (this.destroyed) return
    const sheets = await Promise.all(entries.map((e) => Assets.load(e.json)))
    if (this.destroyed) return
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const sheet = sheets[i]
      if (sheet.animations?.[entry.animKey]) {
        this.enemyFrames[entry.slug] = sheet.animations[entry.animKey]
      }
    }
    // Redraw with latest props now that enemy textures are loaded
    if (this.lastProps) this.draw(this.lastProps)
  }

  update(props: RendererProps) {
    this.lastProps = props
    if (!this.ready || !this.app) return
    this.draw(props)
  }

  private draw(props: RendererProps) {
    const app = this.app!
    const { visibleTiles, knownTiles, playerPosition, playerHpPercent, entities, recentEvents, turn } = props

    app.stage.removeChildren()

    const allTiles = [...visibleTiles, ...knownTiles]
    if (allTiles.length === 0) return

    const xs = allTiles.map((t) => t.x)
    const ys = allTiles.map((t) => t.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    const mapWidth = (maxX - minX + 1) * TILE_SIZE
    const mapHeight = (maxY - minY + 1) * TILE_SIZE

    const containerWidth = this.container?.clientWidth ?? mapWidth
    app.renderer.resize(containerWidth, mapHeight)

    const offsetX = Math.max(0, (containerWidth - mapWidth) / 2)

    const world = new Container()
    world.x = offsetX
    world.y = 0
    app.stage.addChild(world)

    const visibleSet = new Set(visibleTiles.map((t) => `${t.x},${t.y}`))
    const tileMap = new Map(allTiles.map((t) => [`${t.x},${t.y}`, t]))

    // -- Tiles --
    const tileGfx = new Graphics()
    for (const [key, tile] of tileMap) {
      const color = COLORS[tile.type] ?? COLORS.floor
      const px = (tile.x - minX) * TILE_SIZE
      const py = (tile.y - minY) * TILE_SIZE

      const isStairs = tile.type === "stairs" || tile.type === "stairs_up" || tile.type === "entrance"
      const isFloor = tile.type === "floor" || isStairs

      let wallTex: Texture | null = null
      let wallRotation = 0
      if (tile.type === "wall") {
        const below = tileMap.get(`${tile.x},${tile.y + 1}`)
        const above = tileMap.get(`${tile.x},${tile.y - 1}`)
        const right = tileMap.get(`${tile.x + 1},${tile.y}`)
        const left = tileMap.get(`${tile.x - 1},${tile.y}`)

        const isOpen = (t: Tile | undefined) => t != null && t.type === "floor"
        const isWall = (t: Tile | undefined) => t != null && (t.type === "wall" || t.type === "door")

        const ne = tileMap.get(`${tile.x + 1},${tile.y - 1}`)
        const nw = tileMap.get(`${tile.x - 1},${tile.y - 1}`)
        const se = tileMap.get(`${tile.x + 1},${tile.y + 1}`)
        const sw = tileMap.get(`${tile.x - 1},${tile.y + 1}`)

        if (isWall(above) && isWall(right) && isOpen(ne) && this.wallCornerTexture) {
          wallTex = this.wallCornerTexture; wallRotation = Math.PI
        } else if (isWall(above) && isWall(left) && isOpen(nw) && this.wallCornerTexture) {
          wallTex = this.wallCornerTexture; wallRotation = Math.PI / 2
        } else if (isWall(below) && isWall(left) && isOpen(sw) && this.wallCornerTexture) {
          wallTex = this.wallCornerTexture; wallRotation = 0
        } else if (isWall(below) && isWall(right) && isOpen(se) && this.wallCornerTexture) {
          wallTex = this.wallCornerTexture; wallRotation = -Math.PI / 2
        }
        else if (isOpen(below) && this.wallTexture) {
          wallTex = this.wallTexture; wallRotation = 0
        } else if (isOpen(left) && this.wallTexture) {
          wallTex = this.wallTexture; wallRotation = Math.PI / 2
        } else if (isOpen(above) && this.wallTexture) {
          wallTex = this.wallTexture; wallRotation = Math.PI
        } else if (isOpen(right) && this.wallTexture) {
          wallTex = this.wallTexture; wallRotation = -Math.PI / 2
        }
      }

      if (tile.type === "door" && this.doorTexture) {
        const below = tileMap.get(`${tile.x},${tile.y + 1}`)
        const above = tileMap.get(`${tile.x},${tile.y - 1}`)
        const right = tileMap.get(`${tile.x + 1},${tile.y}`)
        const left = tileMap.get(`${tile.x - 1},${tile.y}`)
        const isOpenTile = (t: Tile | undefined) => t != null && t.type !== "wall" && t.type !== "door"

        let rotation = 0
        if (isOpenTile(below)) rotation = 0
        else if (isOpenTile(left)) rotation = Math.PI / 2
        else if (isOpenTile(above)) rotation = Math.PI
        else if (isOpenTile(right)) rotation = -Math.PI / 2

        const sprite = new Sprite(this.doorTexture)
        sprite.anchor.set(0.5, 0.5)
        sprite.x = px + TILE_SIZE / 2
        sprite.y = py + TILE_SIZE / 2
        sprite.width = TILE_SIZE
        sprite.height = TILE_SIZE
        sprite.rotation = rotation
        world.addChild(sprite)
      } else if (isStairs && this.stairsTexture) {
        const below = tileMap.get(`${tile.x},${tile.y + 1}`)
        const above = tileMap.get(`${tile.x},${tile.y - 1}`)
        const right = tileMap.get(`${tile.x + 1},${tile.y}`)
        const left = tileMap.get(`${tile.x - 1},${tile.y}`)
        const isFloorTile = (t: Tile | undefined) => t != null && t.type === "floor"

        let rotation = 0
        if (isFloorTile(below)) rotation = 0
        else if (isFloorTile(left)) rotation = Math.PI / 2
        else if (isFloorTile(above)) rotation = Math.PI
        else if (isFloorTile(right)) rotation = -Math.PI / 2

        const sprite = new Sprite(this.stairsTexture)
        sprite.anchor.set(0.5, 0.5)
        sprite.x = px + TILE_SIZE / 2
        sprite.y = py + TILE_SIZE / 2
        sprite.width = TILE_SIZE
        sprite.height = TILE_SIZE
        sprite.rotation = rotation
        world.addChild(sprite)
      } else if (isFloor && this.floorTexture) {
        const sprite = new Sprite(this.floorTexture)
        sprite.x = px
        sprite.y = py
        sprite.width = TILE_SIZE
        sprite.height = TILE_SIZE
        world.addChild(sprite)
      } else if (tile.type === "wall" && wallTex) {
        const sprite = new Sprite(wallTex)
        sprite.anchor.set(0.5, 0.5)
        sprite.x = px + TILE_SIZE / 2
        sprite.y = py + TILE_SIZE / 2
        sprite.width = TILE_SIZE
        sprite.height = TILE_SIZE
        sprite.rotation = wallRotation
        world.addChild(sprite)
      } else {
        tileGfx.rect(px, py, TILE_SIZE, TILE_SIZE).fill(color)
      }

      if (tile.type === "wall" && !wallTex) {
        tileGfx.rect(px, py, TILE_SIZE, 3).fill(0x555555)
      }
    }
    world.addChild(tileGfx)

    // -- Fog of war --
    const fogGfx = new Graphics()
    for (const [key, tile] of tileMap) {
      if (!visibleSet.has(key)) {
        const px = (tile.x - minX) * TILE_SIZE
        const py = (tile.y - minY) * TILE_SIZE
        fogGfx.rect(px, py, TILE_SIZE, TILE_SIZE).fill(0x000000)
      }
    }
    const fogContainer = new Container()
    fogContainer.addChild(fogGfx)
    const fogBlur = 12
    fogContainer.filters = [new BlurFilter({ strength: fogBlur, quality: 2 })]
    fogContainer.filterArea = new Rectangle(
      -fogBlur * 2, -fogBlur * 2,
      mapWidth + fogBlur * 4, mapHeight + fogBlur * 4,
    )
    fogContainer.alpha = 0.6
    world.addChild(fogContainer)

    // -- Entities --
    const addFallbackSprite = (px: number, py: number, size: number, offset: number) => {
      if (this.notFoundFrames && this.notFoundFrames.length > 0) {
        const sprite = new AnimatedSprite(this.notFoundFrames)
        sprite.x = px + offset
        sprite.y = py + offset
        sprite.width = size
        sprite.height = size
        sprite.animationSpeed = 0.12
        sprite.play()
        world.addChild(sprite)
      }
    }

    const visibleEntities = entities.filter((e) => visibleSet.has(`${e.position.x},${e.position.y}`))

    // Items (bottom layer)
    for (const entity of visibleEntities) {
      if (entity.type !== "item") continue
      const px = (entity.position.x - minX) * TILE_SIZE
      const py = (entity.position.y - minY) * TILE_SIZE
      const templateId = (entity as { template_id?: string }).template_id
      const frames = templateId ? this.itemFrames[templateId] : undefined
      if (frames && frames.length > 0) {
        const sizeOverride = templateId ? ITEM_SIZE_OVERRIDES[templateId] : undefined
        const size = sizeOverride?.size ?? TILE_SIZE
        const offset = sizeOverride?.offset ?? 0
        const sprite = new AnimatedSprite(frames)
        sprite.x = px + offset
        sprite.y = py + offset
        sprite.width = size
        sprite.height = size
        sprite.animationSpeed = 0.12
        sprite.play()
        world.addChild(sprite)
      } else {
        addFallbackSprite(px, py, TILE_SIZE, 0)
      }
    }

    // Interactables and traps
    for (const entity of visibleEntities) {
      if (entity.type === "interactable") {
        const px = (entity.position.x - minX) * TILE_SIZE
        const py = (entity.position.y - minY) * TILE_SIZE
        if (this.lockedGateTexture && LOCKED_GATE_IDS.has(entity.id)) {
          const below = tileMap.get(`${entity.position.x},${entity.position.y + 1}`)
          const above = tileMap.get(`${entity.position.x},${entity.position.y - 1}`)
          const right = tileMap.get(`${entity.position.x + 1},${entity.position.y}`)
          const left = tileMap.get(`${entity.position.x - 1},${entity.position.y}`)
          const isOpenTile = (t: Tile | undefined) => t != null && t.type !== "wall" && t.type !== "door"

          let rotation = 0
          if (isOpenTile(below)) rotation = 0
          else if (isOpenTile(above)) rotation = Math.PI
          else if (isOpenTile(right)) rotation = -Math.PI / 2
          else if (isOpenTile(left)) rotation = Math.PI / 2

          const sprite = new Sprite(this.lockedGateTexture)
          sprite.anchor.set(0.5, 0.5)
          sprite.x = px + TILE_SIZE / 2
          sprite.y = py + TILE_SIZE / 2
          sprite.width = TILE_SIZE
          sprite.height = TILE_SIZE
          sprite.rotation = rotation
          world.addChild(sprite)
        } else {
          const frames = this.interactableFrames[entity.id]
          if (frames && frames.length > 0) {
            const sprite = new AnimatedSprite(frames)
            sprite.x = px
            sprite.y = py
            sprite.width = TILE_SIZE
            sprite.height = TILE_SIZE
            sprite.animationSpeed = 0.12
            sprite.play()
            world.addChild(sprite)
          } else {
            addFallbackSprite(px, py, TILE_SIZE, 0)
          }
        }
      } else if (entity.type === "trap_visible") {
        const px = (entity.position.x - minX) * TILE_SIZE
        const py = (entity.position.y - minY) * TILE_SIZE
        addFallbackSprite(px, py, 32, 16)
      }
    }

    // Enemies (top layer)
    const healthBarGfx = new Graphics()
    const enemySpriteMap = new Map<string, AnimatedSprite>()
    for (const entity of visibleEntities) {
      if (entity.type !== "enemy") continue
      const px = (entity.position.x - minX) * TILE_SIZE
      const py = (entity.position.y - minY) * TILE_SIZE
      const slug = entity.name.toLowerCase().replace(/\s+/g, "-")

      const prevX = this.prevEnemyPos.get(entity.id)
      const defaultFacing = ENEMY_DEFAULT_FACING[slug] ?? "right"
      if (prevX != null && entity.position.x !== prevX && Math.abs(entity.position.x - prevX) === 1) {
        this.enemyFacing.set(entity.id, entity.position.x < prevX ? "left" : "right")
      } else if (prevX == null) {
        this.enemyFacing.set(entity.id, defaultFacing)
      } else if (!this.enemyFacing.has(entity.id)) {
        this.enemyFacing.set(entity.id, defaultFacing)
      }
      this.prevEnemyPos.set(entity.id, entity.position.x)
      const facing = this.enemyFacing.get(entity.id) ?? defaultFacing
      const shouldFlip = facing !== defaultFacing

      const frames = this.enemyFrames[slug]
      if (frames && frames.length > 0) {
        const sprite = new AnimatedSprite(frames)
        sprite.anchor.set(0.5, 0.5)
        sprite.x = px + TILE_SIZE / 2
        sprite.y = py + TILE_SIZE / 2
        sprite.width = TILE_SIZE
        sprite.height = TILE_SIZE
        if (shouldFlip) sprite.scale.x *= -1
        sprite.animationSpeed = 0.12
        sprite.play()
        world.addChild(sprite)
        enemySpriteMap.set(entity.id, sprite)
      } else {
        addFallbackSprite(px, py, TILE_SIZE, 0)
      }
      const hpPct = getEntityHpPercent(entity)
      if (hpPct != null) {
        drawHealthBar(healthBarGfx, px, py, hpPct)
      }
    }

    // Player
    const prevPP = this.prevPlayerPos
    if (prevPP && playerPosition.x !== prevPP.x) {
      const dx = playerPosition.x - prevPP.x
      if (Math.abs(dx) === 1) {
        this.playerFacing = dx < 0 ? "left" : "right"
      } else {
        this.playerFacing = dx > 0 ? "left" : "right"
      }
    }
    this.prevPlayerPos = { ...playerPosition }
    const playerShouldFlip = this.playerFacing !== PLAYER_DEFAULT_FACING

    const ppx = (playerPosition.x - minX) * TILE_SIZE
    const ppy = (playerPosition.y - minY) * TILE_SIZE

    let playerSprite: AnimatedSprite | null = null
    if (this.playerFrames && this.playerFrames.length > 0) {
      playerSprite = new AnimatedSprite(this.playerFrames)
      playerSprite.anchor.set(0.5, 0.5)
      playerSprite.x = ppx + TILE_SIZE / 2
      playerSprite.y = ppy + TILE_SIZE / 2
      playerSprite.width = TILE_SIZE
      playerSprite.height = TILE_SIZE
      if (playerShouldFlip) playerSprite.scale.x *= -1
      playerSprite.animationSpeed = 0.12
      playerSprite.play()
      world.addChild(playerSprite)
    } else {
      const playerGfx = new Graphics()
      const pcx = ppx + TILE_SIZE / 2
      const pcy = ppy + TILE_SIZE / 2
      playerGfx.circle(pcx, pcy, TILE_SIZE / 3).fill(PLAYER_COLOR)
      world.addChild(playerGfx)
    }
    if (playerHpPercent != null) {
      drawHealthBar(healthBarGfx, ppx, ppy, playerHpPercent)
    }
    world.addChild(healthBarGfx)

    // Flash: refresh sprite refs first (handles mid-flash redraws), then check for new events
    this.flashManager.refreshSprites(enemySpriteMap, playerSprite)
    this.flashManager.processEvents(recentEvents, turn, enemySpriteMap, playerSprite)
  }

  destroy() {
    this.destroyed = true
    this.flashManager.stop()
    if (this.app) {
      this.app.destroy(true)
      this.app = null
    }
    this.ready = false
    this.initPromise = null
  }
}
