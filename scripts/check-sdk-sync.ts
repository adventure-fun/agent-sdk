#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  CANONICAL_FILE,
  DEV_ENGINE_WATCHLIST,
  ENGINE_WATCHLIST,
  MANIFEST_FILE,
  ROOT_DIR,
  VENDORED_FILE,
  buildManifest,
  findChangedDevEngineFiles,
  buildTypeHashes,
  findChangedEngineFiles,
  findChangedTypes,
  generateVendoredProtocol,
  normalizeContent,
  sha256,
  summarizeFirstDiff,
  type EngineWatchEntry,
  type SyncManifest,
} from "./sdk-sync-lib.js"
import { generateContentSource, generateIndexSource, generateTypesSource, rewriteEngineImports } from "./sync-dev-engine.js"

async function readEngineFiles(): Promise<Map<string, string>> {
  const contents = new Map<string, string>()
  for (const entry of ENGINE_WATCHLIST) {
    try {
      const filePath = path.join(ROOT_DIR, entry.file)
      const content = await readFile(filePath, "utf8")
      contents.set(entry.file, content)
    } catch {
      // File may not exist in all environments
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
        // File may not exist in all environments
      }
    }
  }
  return contents
}

async function main(): Promise<void> {
  const [canonicalSource, vendoredSource, manifestText] = await Promise.all([
    readFile(CANONICAL_FILE, "utf8"),
    readFile(VENDORED_FILE, "utf8"),
    readFile(MANIFEST_FILE, "utf8"),
  ])

  const manifest = JSON.parse(manifestText) as SyncManifest
  const sourceEntry = manifest.sources?.[0]
  if (!sourceEntry) {
    throw new Error("Sync manifest does not contain a source entry.")
  }

  const [engineFileContents, devEngineFileContents] = await Promise.all([
    readEngineFiles(),
    readDevEngineFiles(),
  ])
  const expectedManifest = buildManifest(canonicalSource, engineFileContents, devEngineFileContents)
  const expectedEntry = expectedManifest.sources[0]
  const expectedVendored = generateVendoredProtocol(canonicalSource)
  const currentTypeHashes = buildTypeHashes(canonicalSource)
  const changedTypes = findChangedTypes(sourceEntry.typeHashes ?? {}, currentTypeHashes)

  const manifestMatches =
    sourceEntry.canonicalHash === expectedEntry.canonicalHash &&
    sourceEntry.generatedHash === expectedEntry.generatedHash
  const vendoredMatches =
    normalizeContent(vendoredSource) === normalizeContent(expectedVendored)

  let hasErrors = false

  if (!manifestMatches || !vendoredMatches || changedTypes.length > 0) {
    hasErrors = true
    console.error("Agent SDK vendored protocol is out of sync.")
    if (changedTypes.length > 0) {
      console.error(`Canonical schema changes detected in: ${changedTypes.join(", ")}`)
    }
    if (!manifestMatches) {
      console.error("Manifest hashes do not match the current canonical schemas source.")
    }
    if (!vendoredMatches) {
      const diffSummary = summarizeFirstDiff(expectedVendored, vendoredSource)
      if (diffSummary) {
        console.error(diffSummary)
      }
      console.error(
        `Run "bun run ${path.relative(ROOT_DIR, path.join(ROOT_DIR, "scripts/sync-sdk-types.ts"))}" to regenerate the vendored protocol.`,
      )
    }
  }

  const previousWatchlist = manifest.engineWatchlist ?? []
  const currentWatchlist: EngineWatchEntry[] = ENGINE_WATCHLIST.map((entry) => ({
    file: entry.file,
    hash: sha256(normalizeContent(engineFileContents.get(entry.file) ?? "")),
    affectedModules: entry.affectedModules,
  }))

  const changedEngineFiles = findChangedEngineFiles(previousWatchlist, currentWatchlist)

  if (changedEngineFiles.length > 0) {
    hasErrors = true
    console.error("\nEngine files affecting SDK modules have changed:")
    for (const entry of changedEngineFiles) {
      console.error(`  ${entry.file} -> affects SDK modules: ${entry.affectedModules.join(", ")}`)
    }
    console.error(
      `\nRun "bun run ${path.relative(ROOT_DIR, path.join(ROOT_DIR, "scripts/sync-sdk-types.ts"))}" to update the manifest after verifying SDK modules still work correctly.`,
    )
    console.error("Then re-run SDK tests: cd agent-sdk && bun test")
  }

  const previousDevWatchlist = manifest.devEngineWatchlist ?? []
  const currentDevWatchlist = expectedManifest.devEngineWatchlist ?? []
  const changedDevEngineFiles = findChangedDevEngineFiles(previousDevWatchlist, currentDevWatchlist)
  const expectedDevOutputs = new Map<string, string>([
    ["agent-sdk/dev/engine/types.ts", generateTypesSource(canonicalSource)],
    ["agent-sdk/dev/engine/content.ts", generateContentSource()],
    ["agent-sdk/dev/engine/index.ts", generateIndexSource()],
  ])
  for (const entry of DEV_ENGINE_WATCHLIST) {
    if (entry.vendored.endsWith("/content.ts") || entry.vendored.endsWith("/index.ts") || entry.vendored.endsWith("/types.ts")) {
      continue
    }
    const source = devEngineFileContents.get(entry.source)
    if (source) {
      expectedDevOutputs.set(entry.vendored, rewriteEngineImports(source))
    }
  }

  const mismatchedDevOutputs = Array.from(expectedDevOutputs.entries())
    .filter(([file, expected]) => normalizeContent(devEngineFileContents.get(file) ?? "") !== normalizeContent(expected))
    .map(([file]) => file)

  if (changedDevEngineFiles.length > 0 || mismatchedDevOutputs.length > 0) {
    hasErrors = true
    console.error("\nDev engine files are out of sync with their canonical sources:")
    for (const entry of changedDevEngineFiles) {
      console.error(`  ${entry.source} -> ${entry.vendored} (${entry.affectedModules.join(", ")})`)
    }
    for (const file of mismatchedDevOutputs) {
      console.error(`  Generated output mismatch: ${file}`)
    }
    console.error(
      `\nRun "bun run ${path.relative(ROOT_DIR, path.join(ROOT_DIR, "scripts/sync-sdk-types.ts"))}" to refresh both the protocol and local dev engine copies.`,
    )
  }

  if (hasErrors) {
    process.exit(1)
  }

  console.log("Agent SDK vendored protocol is in sync with shared/schemas.")
  if (previousWatchlist.length > 0) {
    console.log(`Engine watchlist: ${previousWatchlist.length} files unchanged.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
