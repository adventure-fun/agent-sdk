"use client"

import { useRef, useEffect, useCallback } from "react"
import type { Tile, Entity, SpectatorEntity, CharacterClass } from "@adventure-fun/schemas"
import { Application, AnimatedSprite, Assets, Graphics, Texture, Sprite, Container } from "pixi.js"

const TILE_SIZE = 64
// Largest room currently in shared/engine/content/rooms is 10 tiles tall
// (sc-warden-chamber, cm-sentinel-chamber). We pin the canvas container
// to that height so smaller rooms don't visually shrink the map area
// and pull the d-pad / room text upward each turn. The PixiJS draw
// function already centers tiles inside the canvas via offsetX/offsetY,
// so smaller rooms render centered with empty black space around them.
// Bump this if room content grows past 10 tiles tall.
const MAX_ROOM_TILES = 10
const CANVAS_RESERVED_HEIGHT_PX = MAX_ROOM_TILES * TILE_SIZE

const COLORS: Record<string, number> = {
  wall: 0x3b3b3b,
  floor: 0x1a1a2e,
  door: 0x8b6914,
  stairs: 0x4a90d9,
  stairs_up: 0x4a90d9,
  entrance: 0x4a90d9,
}

const COLORS_DIM: Record<string, number> = {
  wall: 0x2a2a2a,
  floor: 0x111122,
  door: 0x5a4510,
  stairs: 0x2e5a8a,
  stairs_up: 0x2e5a8a,
  entrance: 0x2e5a8a,
}

const PLAYER_COLOR = 0x2ecc71

// Registry: enemy slug → spritesheet JSON path + animation key
const ENEMY_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  "hollow-rat": { json: "/sprites/enemies/common/hollow-rat-idle.json", animKey: "hollow-rat-idle" },
  "cave-crawler": { json: "/sprites/enemies/collapsed-passage/cave-crawler-idle.json", animKey: "cave-crawler-idle" },
  "blighted-wolf": { json: "/sprites/enemies/blighted-hollow/blighted-wolf-idle.json", animKey: "blighted-wolf-idle" },
  "hollow-spore": { json: "/sprites/enemies/blighted-hollow/hollow-spore-idle.json", animKey: "hollow-spore-idle" },
  "skeleton-warrior": { json: "/sprites/enemies/sunken-crypt/skeleton-warrior-idle.json", animKey: "skeleton-warrior-idle" },
  "drowned-husk": { json: "/sprites/enemies/sunken-crypt/drowned-husk-idle.json", animKey: "drowned-husk-idle" },
  "stone-golem": { json: "/sprites/enemies/collapsed-mines/stone-golem-idle.json", animKey: "stone-golem-idle" },
  "iron-automaton": { json: "/sprites/enemies/collapsed-mines/iron-automaton-idle.json", animKey: "iron-automaton-idle" },
  "mine-drone": { json: "/sprites/enemies/collapsed-mines/mine-drone-idle.json", animKey: "mine-drone-idle" },
  "forge-construct": { json: "/sprites/enemies/collapsed-mines/forge-construct-idle.json", animKey: "forge-construct-idle" },
  "iron-sentinel": { json: "/sprites/enemies/collapsed-mines/iron-sentinel-idle.json", animKey: "iron-sentinel-idle" },
  "hollow-warden": { json: "/sprites/enemies/sunken-crypt/hollow-warden-idle.json", animKey: "hollow-warden-idle" },
  "lich-king": { json: "/sprites/enemies/common/lich-king-idle.json", animKey: "lich-king-idle" },
  "ghost": { json: "/sprites/enemies/common/ghost-idle.json", animKey: "ghost-idle" },
  "necromancer": { json: "/sprites/enemies/common/necromancer-idle.json", animKey: "necromancer-idle" },
  "zombie": { json: "/sprites/enemies/common/zombie-idle.json", animKey: "zombie-idle" },
}

// Registry: item template_id → spritesheet JSON path + animation key
const ITEM_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  // Loot
  "gold-coins": { json: "/sprites/loot/gold-coins.json", animKey: "gold-coins-idle" },
  "loot-crude-gem": { json: "/sprites/loot/loot-crude-gem.json", animKey: "loot-crude-gem" },
  "loot-old-coin": { json: "/sprites/loot/loot-old-coin.json", animKey: "loot-old-coin" },
  // Consumables
  "health-potion": { json: "/sprites/consumables/health-potion.json", animKey: "health-potion" },
  "mana-potion": { json: "/sprites/consumables/mana-potion.json", animKey: "mana-potion" },
  "antidote": { json: "/sprites/consumables/antidote.json", animKey: "antidote" },
  "buff-potion": { json: "/sprites/consumables/buff-potion.json", animKey: "buff-potion" },
  "elixir-of-focus": { json: "/sprites/consumables/elixir-of-focus.json", animKey: "elixir-of-focus" },
  "berserker-draught": { json: "/sprites/consumables/berserker-draught.json", animKey: "berserker-draught" },
  "ironflask": { json: "/sprites/consumables/ironflask.json", animKey: "ironflask" },
  "smelling-salts": { json: "/sprites/consumables/smelling-salts.json", animKey: "smelling-salts" },
  "portal-scroll": { json: "/sprites/consumables/portal-scroll.json", animKey: "portal-scroll" },
  "greater-health-potion": { json: "/sprites/consumables/health-potion.json", animKey: "health-potion" },
  "greater-mana-potion": { json: "/sprites/consumables/mana-potion.json", animKey: "mana-potion" },
  "ammo-arrows-10": { json: "/sprites/consumables/ammo-arrows-10.json", animKey: "ammo-arrows-10" },
  "ammo-bolts-10": { json: "/sprites/consumables/ammo-bolts-10.json", animKey: "ammo-bolts-10" },
  // Loot (realm-specific)
  "gear-bone-fragment": { json: "/sprites/loot/gear-bone-fragment.json", animKey: "gear-bone-fragment" },
  "gear-construct-core": { json: "/sprites/loot/gear-construct-core.json", animKey: "gear-construct-core" },
  "loot-ancient-gear": { json: "/sprites/loot/loot-ancient-gear.json", animKey: "loot-ancient-gear" },
  "loot-blighted-fang": { json: "/sprites/loot/loot-blighted-fang.json", animKey: "loot-blighted-fang" },
  "loot-crypt-relic": { json: "/sprites/loot/loot-crypt-relic.json", animKey: "loot-crypt-relic" },
  "loot-guardian-sigil": { json: "/sprites/loot/loot-guardian-sigil.json", animKey: "loot-guardian-sigil" },
  "loot-sentinel-fragment": { json: "/sprites/loot/loot-sentinel-fragment.json", animKey: "loot-sentinel-fragment" },
  "loot-steam-crystal": { json: "/sprites/loot/loot-steam-crystal.json", animKey: "loot-steam-crystal" },
  "loot-violet-crystal": { json: "/sprites/loot/loot-violet-crystal.json", animKey: "loot-violet-crystal" },
  "loot-violet-shard": { json: "/sprites/loot/loot-violet-shard.json", animKey: "loot-violet-shard" },
  // Key items
  "crypt-key": { json: "/sprites/keys/crypt-key.json", animKey: "crypt-key" },
  "mine-key": { json: "/sprites/keys/mine-key.json", animKey: "mine-key" },
  "shaft-access-key": { json: "/sprites/keys/shaft-access-key.json", animKey: "shaft-access-key" },
  "shaft-master-key": { json: "/sprites/keys/shaft-master-key.json", animKey: "shaft-master-key" },
  // Equipment (weapons)
  "gear-bone-wand": { json: "/sprites/equipment/gear-bone-wand.json", animKey: "gear-bone-wand" },
  "gear-combat-dagger": { json: "/sprites/equipment/gear-combat-dagger.json", animKey: "gear-combat-dagger" },
  "gear-crypt-blade": { json: "/sprites/equipment/gear-crypt-blade.json", animKey: "gear-crypt-blade" },
  "gear-crypt-longbow": { json: "/sprites/equipment/gear-crypt-longbow.json", animKey: "gear-crypt-longbow" },
  "gear-piston-daggers": { json: "/sprites/equipment/gear-piston-daggers.json", animKey: "gear-piston-daggers" },
  "gear-pneumatic-crossbow": { json: "/sprites/equipment/gear-pneumatic-crossbow.json", animKey: "gear-pneumatic-crossbow" },
  "gear-sentinels-hammer": { json: "/sprites/equipment/gear-sentinels-hammer.json", animKey: "gear-sentinels-hammer" },
  "gear-shadow-knife": { json: "/sprites/equipment/gear-shadow-knife.json", animKey: "gear-shadow-knife" },
  "gear-steamforged-blade": { json: "/sprites/equipment/gear-steamforged-blade.json", animKey: "gear-steamforged-blade" },
  "gear-venom-blade": { json: "/sprites/equipment/gear-venom-blade.json", animKey: "gear-venom-blade" },
  "gear-voltaic-staff": { json: "/sprites/equipment/gear-voltaic-staff.json", animKey: "gear-voltaic-staff" },
  "gear-wardens-blade": { json: "/sprites/equipment/gear-wardens-blade.json", animKey: "gear-wardens-blade" },
  "hunters-bow": { json: "/sprites/equipment/hunters-bow.json", animKey: "hunters-bow" },
  "iron-sword": { json: "/sprites/equipment/iron-sword.json", animKey: "iron-sword" },
  "oak-staff": { json: "/sprites/equipment/oak-staff.json", animKey: "oak-staff" },
  "weapon-iron-sword": { json: "/sprites/equipment/weapon-iron-sword.json", animKey: "weapon-iron-sword" },
  "weapon-oak-staff": { json: "/sprites/equipment/weapon-oak-staff.json", animKey: "weapon-oak-staff" },
  "weapon-rusty-dagger": { json: "/sprites/equipment/weapon-rusty-dagger.json", animKey: "weapon-rusty-dagger" },
  "weapon-short-bow": { json: "/sprites/equipment/weapon-short-bow.json", animKey: "weapon-short-bow" },
  // Equipment (armor/shields)
  "gear-chainmail": { json: "/sprites/equipment/gear-chainmail.json", animKey: "gear-chainmail" },
  "gear-crypt-shield": { json: "/sprites/equipment/gear-crypt-shield.json", animKey: "gear-crypt-shield" },
  "gear-leather-vest": { json: "/sprites/equipment/gear-leather-vest.json", animKey: "gear-leather-vest" },
  "gear-sentinels-chassis": { json: "/sprites/equipment/gear-sentinels-chassis.json", animKey: "gear-sentinels-chassis" },
  "gear-steamplate": { json: "/sprites/equipment/gear-steamplate.json", animKey: "gear-steamplate" },
  "gear-wardens-plate": { json: "/sprites/equipment/gear-wardens-plate.json", animKey: "gear-wardens-plate" },
  "leather-armor": { json: "/sprites/equipment/leather-armor.json", animKey: "leather-armor" },
  "wooden-shield": { json: "/sprites/equipment/wooden-shield.json", animKey: "wooden-shield" },
  // Equipment (gloves)
  "gear-chain-gloves": { json: "/sprites/equipment/gear-chain-gloves.json", animKey: "gear-chain-gloves" },
  "gear-leather-gloves": { json: "/sprites/equipment/gear-leather-gloves.json", animKey: "gear-leather-gloves" },
  "gear-plated-gloves": { json: "/sprites/equipment/gear-plated-gloves.json", animKey: "gear-plated-gloves" },
  "gear-pressure-gauntlets": { json: "/sprites/equipment/gear-pressure-gauntlets.json", animKey: "gear-pressure-gauntlets" },
  "gear-sentinels-grips": { json: "/sprites/equipment/gear-sentinels-grips.json", animKey: "gear-sentinels-grips" },
  "gear-warden-gauntlets": { json: "/sprites/equipment/gear-warden-gauntlets.json", animKey: "gear-warden-gauntlets" },
  // Equipment (rings/accessories)
  "gear-blight-ward": { json: "/sprites/equipment/gear-blight-ward.json", animKey: "gear-blight-ward" },
  "gear-builders-signet": { json: "/sprites/equipment/gear-builders-signet.json", animKey: "gear-builders-signet" },
  "gear-core-fragment-ring": { json: "/sprites/equipment/gear-core-fragment-ring.json", animKey: "gear-core-fragment-ring" },
  "gear-guardian-amulet": { json: "/sprites/equipment/gear-guardian-amulet.json", animKey: "gear-guardian-amulet" },
  "gear-hollow-ward": { json: "/sprites/equipment/gear-hollow-ward.json", animKey: "gear-hollow-ward" },
  "gear-iron-band": { json: "/sprites/equipment/gear-iron-band.json", animKey: "gear-iron-band" },
  "gear-tomb-ring": { json: "/sprites/equipment/gear-tomb-ring.json", animKey: "gear-tomb-ring" },
  "iron-ring": { json: "/sprites/equipment/iron-ring.json", animKey: "iron-ring" },
  // Equipment (helms)
  "gear-crypt-crown": { json: "/sprites/equipment/gear-crypt-crown.json", animKey: "gear-crypt-crown" },
  "gear-forged-visor": { json: "/sprites/equipment/gear-forged-visor.json", animKey: "gear-forged-visor" },
  "gear-iron-helm": { json: "/sprites/equipment/gear-iron-helm.json", animKey: "gear-iron-helm" },
  "gear-leather-cap": { json: "/sprites/equipment/gear-leather-cap.json", animKey: "gear-leather-cap" },
  "gear-miners-helm": { json: "/sprites/equipment/gear-miners-helm.json", animKey: "gear-miners-helm" },
  "gear-sentinels-crest": { json: "/sprites/equipment/gear-sentinels-crest.json", animKey: "gear-sentinels-crest" },
}

// Item size overrides: render smaller than full tile
const ITEM_SIZE_OVERRIDES: Record<string, { size: number; offset: number }> = {
  "gold-coins": { size: 32, offset: 16 },
}

// Locked gate/door interactables — rendered wall-style with rotation
const LOCKED_GATE_IDS = new Set(["cp-iron-gate", "sc-locked-door-f2"])

// Interactable entity ID → spritesheet JSON path + animation key
const INTERACTABLE_SPRITE_REGISTRY: Record<string, { json: string; animKey: string }> = {
  "tutorial-chest-supplies": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "tutorial-chest-weapon": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "tutorial-wall-scratches": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  "cm-workshop-lockbox": { json: "/sprites/interactables/chest.json", animKey: "chest" },
  // Collapsed Passage
  "cp-overseer-journal": { json: "/sprites/interactables/overseers-journal.json", animKey: "overseers-journal" },
  "cp-lockbox": { json: "/sprites/interactables/corroded-lockbox.json", animKey: "corroded-lockbox" },
  "cp-scattered-tools": { json: "/sprites/interactables/scattered-mining-tools.json", animKey: "scattered-mining-tools" },
  // Blighted Hollow
  "bh-carved-stone": { json: "/sprites/interactables/carved-stone-fragment.json", animKey: "carved-stone-fragment" },
  "bh-ranger-pack": { json: "/sprites/interactables/decayed-rangers-pack.json", animKey: "decayed-rangers-pack" },
  "bh-clear-spring": { json: "/sprites/interactables/clear-spring.json", animKey: "clear-spring" },
  "bh-broken-seal": { json: "/sprites/interactables/the-cracked-seal.json", animKey: "the-cracked-seal" },
  "bh-dead-tree": { json: "/sprites/interactables/violet-veined-tree.json", animKey: "violet-veined-tree" },
}

// Realm template ID → enemy slugs (roster + boss)
// Enemy roster IDs use underscores in some realms; we normalise to hyphens for sprite lookup
const REALM_ENEMIES: Record<string, string[]> = {
  "tutorial-cellar": ["hollow-rat"],
  "collapsed-passage": ["hollow-rat", "cave-crawler"],
  "blighted-hollow": ["blighted-wolf", "hollow-spore"],
  "sunken-crypt": ["skeleton-warrior", "drowned-husk", "hollow-warden"],
  "collapsed-mines": ["stone-golem", "iron-automaton", "mine-drone", "forge-construct", "iron-sentinel"],
}

// Player class → spritesheet JSON path + animation key
const PLAYER_SPRITE_REGISTRY: Record<CharacterClass, { json: string; animKey: string }> = {
  knight: { json: "/sprites/player/knight-idle.json", animKey: "knight-idle" },
  mage: { json: "/sprites/player/mage-idle.json", animKey: "mage-idle" },
  rogue: { json: "/sprites/player/rogue-idle.json", animKey: "rogue-idle" },
  archer: { json: "/sprites/player/archer-idle.json", animKey: "archer-idle" },
}

interface PixiJSWorldProps {
  visibleTiles: Tile[]
  knownTiles?: Tile[]
  playerPosition: { x: number; y: number }
  entities: (Entity | SpectatorEntity)[]
  realmTemplateId?: string
  playerClass?: CharacterClass
}

export function PixiJSWorld({
  visibleTiles,
  knownTiles = [],
  playerPosition,
  entities,
  realmTemplateId,
  playerClass,
}: PixiJSWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const initPromiseRef = useRef<Promise<void> | null>(null)

  const floorTextureRef = useRef<Texture | null>(null)
  const wallDownTextureRef = useRef<Texture | null>(null)
  const wallUpTextureRef = useRef<Texture | null>(null)
  const wallRightTextureRef = useRef<Texture | null>(null)
  const wallLeftTextureRef = useRef<Texture | null>(null)
  const wallCornerNERef = useRef<Texture | null>(null)
  const wallCornerNWRef = useRef<Texture | null>(null)
  const wallCornerSERef = useRef<Texture | null>(null)
  const wallCornerSWRef = useRef<Texture | null>(null)
  const doorTextureRef = useRef<Texture | null>(null)
  const doorUpTextureRef = useRef<Texture | null>(null)
  const lockedGateTextureRef = useRef<Texture | null>(null)
  const playerFramesRef = useRef<Texture[] | null>(null)
  const enemyFramesRef = useRef<Record<string, Texture[]>>({})
  const itemFramesRef = useRef<Record<string, Texture[]>>({})
  const interactableFramesRef = useRef<Record<string, Texture[]>>({})
  const notFoundFramesRef = useRef<Texture[] | null>(null)

  // Always reserve enough height for the tallest room in the content
  // library (see CANVAS_RESERVED_HEIGHT_PX). This stops the dungeon
  // viewport from collapsing when the player walks into a small room,
  // which previously yanked the room text + d-pad upward and made the
  // controls feel like they were jumping around the screen.
  const mapHeight = CANVAS_RESERVED_HEIGHT_PX

  const draw = useCallback(
    (app: Application) => {
      const floorTexture = floorTextureRef.current
      const wallDownTexture = wallDownTextureRef.current
      const wallUpTexture = wallUpTextureRef.current
      const wallRightTexture = wallRightTextureRef.current
      const wallLeftTexture = wallLeftTextureRef.current
      const wallCornerNE = wallCornerNERef.current
      const wallCornerNW = wallCornerNWRef.current
      const wallCornerSE = wallCornerSERef.current
      const wallCornerSW = wallCornerSWRef.current
      // Remove previous children
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

      // Center the map in the canvas
      const offsetX = Math.max(0, (app.canvas.width - mapWidth) / 2)
      const offsetY = Math.max(0, (app.canvas.height - mapHeight) / 2)

      const world = new Container()
      world.x = offsetX
      world.y = offsetY
      app.stage.addChild(world)

      const visibleSet = new Set(visibleTiles.map((t) => `${t.x},${t.y}`))
      const tileMap = new Map(allTiles.map((t) => [`${t.x},${t.y}`, t]))
      const entityMap = new Map(
        entities.map((e) => [`${e.position.x},${e.position.y}`, e])
      )

      // Draw tiles
      const tileGfx = new Graphics()
      for (const [key, tile] of tileMap) {
        const isVisible = visibleSet.has(key)
        const colors = isVisible ? COLORS : COLORS_DIM
        const color = colors[tile.type] ?? colors.floor
        const px = (tile.x - minX) * TILE_SIZE
        const py = (tile.y - minY) * TILE_SIZE

        const isFloor = tile.type === "floor" || tile.type === "stairs" || tile.type === "stairs_up" || tile.type === "entrance"
        const doorTexture = doorTextureRef.current

        // Determine wall texture based on adjacent floor direction
        let wallTexture: Texture | null = null
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

          // Corner walls: wall on both adjacent sides, floor on the diagonal
          if (isWall(above) && isWall(right) && isOpen(ne) && wallCornerNE) wallTexture = wallCornerNE
          else if (isWall(above) && isWall(left) && isOpen(nw) && wallCornerNW) wallTexture = wallCornerNW
          else if (isWall(below) && isWall(right) && isOpen(se) && wallCornerSE) wallTexture = wallCornerSE
          else if (isWall(below) && isWall(left) && isOpen(sw) && wallCornerSW) wallTexture = wallCornerSW
          // Straight edge walls
          else if (isOpen(below) && wallDownTexture) wallTexture = wallDownTexture
          else if (isOpen(above) && wallUpTexture) wallTexture = wallUpTexture
          else if (isOpen(right) && wallRightTexture) wallTexture = wallRightTexture
          else if (isOpen(left) && wallLeftTexture) wallTexture = wallLeftTexture
        }

        if (tile.type === "door" && doorTexture) {
          // Rotate door sprite toward nearest floor
          const below = tileMap.get(`${tile.x},${tile.y + 1}`)
          const above = tileMap.get(`${tile.x},${tile.y - 1}`)
          const right = tileMap.get(`${tile.x + 1},${tile.y}`)
          const left = tileMap.get(`${tile.x - 1},${tile.y}`)
          const isOpenTile = (t: Tile | undefined) => t != null && t.type !== "wall" && t.type !== "door"

          // Use dedicated up texture when floor is below, otherwise rotate default
          const doorUpTexture = doorUpTextureRef.current
          let rotation = 0
          let tex = doorTexture
          if (isOpenTile(below) && doorUpTexture) {
            tex = doorUpTexture
            rotation = 0
          } else if (isOpenTile(above)) rotation = Math.PI          // floor above: 180°
          else if (isOpenTile(right)) rotation = -Math.PI / 2 // floor right: -90°
          else if (isOpenTile(left)) rotation = Math.PI / 2   // floor left: 90°

          const sprite = new Sprite(tex)
          sprite.anchor.set(0.5, 0.5)
          sprite.x = px + TILE_SIZE / 2
          sprite.y = py + TILE_SIZE / 2
          sprite.width = TILE_SIZE
          sprite.height = TILE_SIZE
          sprite.rotation = rotation
          if (!isVisible) sprite.alpha = 0.4
          world.addChild(sprite)
        } else if (isFloor && floorTexture) {
          const sprite = new Sprite(floorTexture)
          sprite.x = px
          sprite.y = py
          sprite.width = TILE_SIZE
          sprite.height = TILE_SIZE
          if (!isVisible) sprite.alpha = 0.4
          world.addChild(sprite)
        } else if (tile.type === "wall" && wallTexture) {
          const sprite = new Sprite(wallTexture)
          sprite.x = px
          sprite.y = py
          sprite.width = TILE_SIZE
          sprite.height = TILE_SIZE
          if (!isVisible) sprite.alpha = 0.4
          world.addChild(sprite)
        } else {
          tileGfx.rect(px, py, TILE_SIZE, TILE_SIZE).fill(color)
        }

        // Wall top highlight for depth (only for non-textured walls)
        if (tile.type === "wall" && !wallTexture) {
          tileGfx
            .rect(px, py, TILE_SIZE, 3)
            .fill(isVisible ? 0x555555 : 0x3a3a3a)
        }

        // Stairs arrow indicator
        if (
          tile.type === "stairs" ||
          tile.type === "stairs_up" ||
          tile.type === "entrance"
        ) {
          tileGfx
            .rect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8)
            .fill(isVisible ? 0x6ab4f2 : 0x3a6a9e)
        }
      }
      world.addChild(tileGfx)

      // Draw entities (only on visible tiles)
      const notFoundFrames = notFoundFramesRef.current
      const addFallbackSprite = (px: number, py: number, size: number, offset: number) => {
        if (notFoundFrames && notFoundFrames.length > 0) {
          const sprite = new AnimatedSprite(notFoundFrames)
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

      // Pass 1: items (bottom layer)
      for (const entity of visibleEntities) {
        if (entity.type !== "item") continue
        const px = (entity.position.x - minX) * TILE_SIZE
        const py = (entity.position.y - minY) * TILE_SIZE
        const templateId = (entity as { template_id?: string }).template_id
        const frames = templateId ? itemFramesRef.current[templateId] : undefined
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

      // Pass 2: interactables and traps
      for (const entity of visibleEntities) {
        if (entity.type === "interactable") {
          const px = (entity.position.x - minX) * TILE_SIZE
          const py = (entity.position.y - minY) * TILE_SIZE
          const gateTexture = lockedGateTextureRef.current
          if (gateTexture && LOCKED_GATE_IDS.has(entity.id)) {
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

            const sprite = new Sprite(gateTexture)
            sprite.anchor.set(0.5, 0.5)
            sprite.x = px + TILE_SIZE / 2
            sprite.y = py + TILE_SIZE / 2
            sprite.width = TILE_SIZE
            sprite.height = TILE_SIZE
            sprite.rotation = rotation
            world.addChild(sprite)
          } else {
            const frames = interactableFramesRef.current[entity.id]
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

      // Pass 3: enemies (top layer)
      for (const entity of visibleEntities) {
        if (entity.type !== "enemy") continue
        const px = (entity.position.x - minX) * TILE_SIZE
        const py = (entity.position.y - minY) * TILE_SIZE
        const slug = entity.name.toLowerCase().replace(/\s+/g, "-")
        const frames = enemyFramesRef.current[slug]
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

      // Draw player
      const ppx = (playerPosition.x - minX) * TILE_SIZE
      const ppy = (playerPosition.y - minY) * TILE_SIZE
      const playerFrames = playerFramesRef.current

      if (playerFrames && playerFrames.length > 0) {
        const playerSprite = new AnimatedSprite(playerFrames)
        playerSprite.x = ppx
        playerSprite.y = ppy
        playerSprite.width = TILE_SIZE
        playerSprite.height = TILE_SIZE
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
    },
    [visibleTiles, knownTiles, playerPosition, entities]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const app = new Application()
        await app.init({
          background: 0x000000,
          resizeTo: container,
          antialias: true,
        })
        const [floor, wallDown, wallUp, wallRight, wallLeft, cornerNE, cornerNW, cornerSE, cornerSW, door, doorUp, lockedGate] = await Promise.all([
          Assets.load("/sprites/world/dungeon-floor-a.png"),
          Assets.load("/sprites/world/dungeon-wall-down-a.png"),
          Assets.load("/sprites/world/dungeon-wall-up-a.png"),
          Assets.load("/sprites/world/dungeon-wall-right-a.png"),
          Assets.load("/sprites/world/dungeon-wall-left-a.png"),
          Assets.load("/sprites/world/dungeon-wall-corner-ne-a.png"),
          Assets.load("/sprites/world/dungeon-wall-corner-nw-a.png"),
          Assets.load("/sprites/world/dungeon-wall-corner-se-a.png"),
          Assets.load("/sprites/world/dungeon-wall-corner-sw-a.png"),
          Assets.load("/sprites/world/dungeon-door-a.png"),
          Assets.load("/sprites/world/dungeon-door-up-a.png"),
          Assets.load("/sprites/world/dungeon-locked-iron-gate.png"),
        ])
        floorTextureRef.current = floor
        wallDownTextureRef.current = wallDown
        wallUpTextureRef.current = wallUp
        wallRightTextureRef.current = wallRight
        wallLeftTextureRef.current = wallLeft
        wallCornerNERef.current = cornerNE
        wallCornerNWRef.current = cornerNW
        wallCornerSERef.current = cornerSE
        wallCornerSWRef.current = cornerSW
        doorTextureRef.current = door
        doorUpTextureRef.current = doorUp
        lockedGateTextureRef.current = lockedGate

        // Load animated spritesheets — player + fallback always, enemies based on realm, all items
        const playerReg = playerClass ? PLAYER_SPRITE_REGISTRY[playerClass] : PLAYER_SPRITE_REGISTRY.knight
        const [playerSheet, notFoundSheet] = await Promise.all([
          Assets.load(playerReg.json),
          Assets.load("/sprites/not-found.json"),
        ])
        if (playerSheet.animations?.[playerReg.animKey]) {
          playerFramesRef.current = playerSheet.animations[playerReg.animKey]
        }
        if (notFoundSheet.animations?.["not-found"]) {
          notFoundFramesRef.current = notFoundSheet.animations["not-found"]
        }

        // Load all item spritesheets (items are common across realms)
        const itemEntries = Object.entries(ITEM_SPRITE_REGISTRY)
        const itemSheets = await Promise.all(
          itemEntries.map(([, reg]) => Assets.load(reg.json))
        )
        for (let i = 0; i < itemEntries.length; i++) {
          const [templateId, reg] = itemEntries[i]!
          const sheet = itemSheets[i]
          if (sheet.animations?.[reg.animKey]) {
            itemFramesRef.current[templateId] = sheet.animations[reg.animKey]
          }
        }

        // Load interactable spritesheets (deduplicate shared JSON paths)
        const interactableEntries = Object.entries(INTERACTABLE_SPRITE_REGISTRY)
        const uniqueInteractableJsons = [...new Set(interactableEntries.map(([, reg]) => reg.json))]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interactableSheetMap = new Map<string, any>()
        const loadedInteractableSheets = await Promise.all(
          uniqueInteractableJsons.map((json) => Assets.load(json))
        )
        for (let i = 0; i < uniqueInteractableJsons.length; i++) {
          interactableSheetMap.set(uniqueInteractableJsons[i]!, loadedInteractableSheets[i])
        }
        for (const [id, reg] of interactableEntries) {
          const sheet = interactableSheetMap.get(reg.json)
          if (sheet?.animations?.[reg.animKey]) {
            interactableFramesRef.current[id] = sheet.animations[reg.animKey]
          }
        }

        container.appendChild(app.canvas)
        appRef.current = app
        draw(app)
      })()
    } else {
      initPromiseRef.current.then(() => {
        if (appRef.current) draw(appRef.current)
      })
    }

    return () => {
      // Cleanup only on unmount — we let the init promise ref guard against double-init
    }
  }, [draw])

  // Load enemy spritesheets when realmTemplateId becomes available or changes
  const loadedRealmRef = useRef<string | null>(null)
  useEffect(() => {
    if (!realmTemplateId || realmTemplateId === loadedRealmRef.current) return
    const slugs = REALM_ENEMIES[realmTemplateId] ?? []
    const entries = slugs
      .map((slug) => {
        const reg = ENEMY_SPRITE_REGISTRY[slug]
        return reg ? { slug, ...reg } : null
      })
      .filter((e): e is { slug: string; json: string; animKey: string } => e != null)
    if (entries.length === 0) return

    loadedRealmRef.current = realmTemplateId
    ;(async () => {
      // Wait for init to finish before loading enemy sheets
      if (initPromiseRef.current) await initPromiseRef.current
      const sheets = await Promise.all(entries.map((e) => Assets.load(e.json)))
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const sheet = sheets[i]
        if (sheet.animations?.[entry.animKey]) {
          enemyFramesRef.current[entry.slug] = sheet.animations[entry.animKey]
        }
      }
      if (appRef.current) draw(appRef.current)
    })()
  }, [realmTemplateId, draw])

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      if (appRef.current) {
        appRef.current.destroy(true)
        appRef.current = null
        initPromiseRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ height: mapHeight }}
      className="w-full rounded overflow-hidden"
    />
  )
}
