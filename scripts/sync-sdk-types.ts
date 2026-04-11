#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CANONICAL_FILE,
  DEV_ENGINE_WATCHLIST,
  ENGINE_WATCHLIST,
  MANIFEST_FILE,
  ROOT_DIR,
  VENDORED_FILE,
  buildManifest,
  buildTypeHashes,
  findChangedTypes,
  generateVendoredProtocol,
} from "./sdk-sync-lib.js"
import { syncDevEngine } from "./sync-dev-engine.js"

async function readExistingHashes(): Promise<Record<string, string>> {
  try {
    const manifestText = await readFile(MANIFEST_FILE, "utf8")
    const manifest = JSON.parse(manifestText) as {
      sources?: Array<{ typeHashes?: Record<string, string> }>
    }
    return manifest.sources?.[0]?.typeHashes ?? {}
  } catch {
    return {}
  }
}

async function readEngineFiles(): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  for (const entry of ENGINE_WATCHLIST) {
    try {
      const filePath = path.join(ROOT_DIR, entry.file)
      const content = await readFile(filePath, "utf8")
      contents.set(entry.file, content)
    } catch {
      console.warn(`Warning: Could not read engine file ${entry.file}`)
    }
  }
  return contents
}

async function readDevEngineFiles(): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  for (const entry of DEV_ENGINE_WATCHLIST) {
    for (const file of [entry.source, entry.vendored]) {
      if (contents.has(file)) continue
      try {
        const filePath = path.join(ROOT_DIR, file)
        const content = await readFile(filePath, "utf8")
        contents.set(file, content)
      } catch {
        console.warn(`Warning: Could not read dev engine file ${file}`)
      }
    }
  }
  return contents
}

async function main(): Promise<void> {
  const canonicalSource = await readFile(CANONICAL_FILE, "utf8")
  const previousHashes = await readExistingHashes()
  const nextHashes = buildTypeHashes(canonicalSource)
  const generatedProtocol = generateVendoredProtocol(canonicalSource)

  await mkdir(path.dirname(VENDORED_FILE), { recursive: true })
  await mkdir(path.dirname(MANIFEST_FILE), { recursive: true })

  await writeFile(VENDORED_FILE, generatedProtocol, "utf8")
  await syncDevEngine()
  const [engineFileContents, devEngineFileContents] = await Promise.all([
    readEngineFiles(),
    readDevEngineFiles(),
  ])
  const manifest = buildManifest(canonicalSource, engineFileContents, devEngineFileContents)
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  const changedTypes = findChangedTypes(previousHashes, nextHashes)

  console.log(`Synced ${path.relative(ROOT_DIR, VENDORED_FILE)} from canonical schemas.`)
  console.log(`Updated ${path.relative(ROOT_DIR, MANIFEST_FILE)}.`)
  if (changedTypes.length > 0) {
    console.log(`Changed tracked exports: ${changedTypes.join(", ")}`)
  } else {
    console.log("No tracked export changes detected; manifest hashes refreshed.")
  }
  console.log(`Engine watchlist: ${manifest.engineWatchlist?.length ?? 0} files tracked.`)
  console.log(`Dev engine watchlist: ${manifest.devEngineWatchlist?.length ?? 0} files tracked.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
