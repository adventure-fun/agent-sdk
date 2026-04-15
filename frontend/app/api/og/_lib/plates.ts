import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CharacterClass } from "@adventure-fun/schemas"

// Reads a plate PNG off disk and returns it as a data URL Satori can embed
// inside <img src>. Cached per (class,state) so repeated card renders don't
// re-read the file. Falls back to the default OG image on error.

type PlateState = "alive" | "fallen"

const plateCache = new Map<string, string>()

async function readPlate(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  return `data:image/png;base64,${buffer.toString("base64")}`
}

export async function getPlateDataUrl(
  characterClass: CharacterClass,
  state: PlateState,
): Promise<string> {
  const key = `${characterClass}-${state}`
  const cached = plateCache.get(key)
  if (cached) return cached

  const platePath = path.join(process.cwd(), "public", "plates", `${key}.png`)
  try {
    const dataUrl = await readPlate(platePath)
    plateCache.set(key, dataUrl)
    return dataUrl
  } catch {
    return getDefaultPlateDataUrl()
  }
}

let defaultPlateCache: string | null = null

export async function getDefaultPlateDataUrl(): Promise<string> {
  if (defaultPlateCache) return defaultPlateCache
  const defaultPath = path.join(process.cwd(), "public", "og", "default.png")
  defaultPlateCache = await readPlate(defaultPath)
  return defaultPlateCache
}
