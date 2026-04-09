#!/usr/bin/env bun
/**
 * Deletes all realms for a character and all associated database records.
 *
 * Usage:
 *   bun scripts/delete-character-realms.ts <character_id> [--dry-run]
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env["SUPABASE_URL"]
const SUPABASE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
  process.exit(1)
}

const characterId = process.argv[2]
const dryRun = process.argv.includes("--dry-run")

if (!characterId) {
  console.error("Usage: bun scripts/delete-character-realms.ts <character_id> [--dry-run]")
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  // Verify the character exists
  const { data: character, error: charErr } = await db
    .from("characters")
    .select("id, name, class, status, account_id")
    .eq("id", characterId)
    .maybeSingle()

  if (charErr) {
    console.error("Failed to look up character:", charErr.message)
    process.exit(1)
  }
  if (!character) {
    console.error(`Character "${characterId}" not found`)
    process.exit(1)
  }

  console.log(`Character: ${character.name} (${character.class}, ${character.status})`)

  // Get all realm IDs for this character
  const { data: realms, error: realmErr } = await db
    .from("realm_instances")
    .select("id, template_id, status")
    .eq("character_id", characterId)

  if (realmErr) {
    console.error("Failed to fetch realms:", realmErr.message)
    process.exit(1)
  }
  if (!realms || realms.length === 0) {
    console.log("No realms found for this character.")
    process.exit(0)
  }

  const realmIds = realms.map((r) => r.id)
  console.log(`Found ${realms.length} realm(s):`)
  for (const r of realms) {
    console.log(`  - ${r.id} (${r.template_id}, ${r.status})`)
  }

  // Get corpse container IDs (needed to clean up their inventory items)
  const { data: corpses } = await db
    .from("corpse_containers")
    .select("id")
    .in("realm_instance_id", realmIds)

  const corpseIds = corpses?.map((c) => c.id) ?? []

  if (dryRun) {
    console.log("\n[DRY RUN] Would delete:")
    console.log(`  - inventory_items for ${corpseIds.length} corpse container(s)`)
    console.log(`  - ${corpseIds.length} corpse_containers`)
    console.log(`  - run_logs for ${realmIds.length} realm(s)`)
    console.log(`  - realm_mutations for ${realmIds.length} realm(s)`)
    console.log(`  - realm_discovered_map for ${realmIds.length} realm(s)`)
    console.log(`  - ${realmIds.length} realm_instances`)
    process.exit(0)
  }

  console.log("\nDeleting...")

  // 1. Delete corpse inventory items
  if (corpseIds.length > 0) {
    const { error, count } = await db
      .from("inventory_items")
      .delete({ count: "exact" })
      .eq("owner_type", "corpse")
      .in("owner_id", corpseIds)
    if (error) console.error("  inventory_items error:", error.message)
    else console.log(`  inventory_items (corpse): ${count} deleted`)
  }

  // 2. Delete corpse containers
  if (corpseIds.length > 0) {
    const { error, count } = await db
      .from("corpse_containers")
      .delete({ count: "exact" })
      .in("realm_instance_id", realmIds)
    if (error) console.error("  corpse_containers error:", error.message)
    else console.log(`  corpse_containers: ${count} deleted`)
  }

  // 3. Delete run logs
  const { error: runErr, count: runCount } = await db
    .from("run_logs")
    .delete({ count: "exact" })
    .in("realm_instance_id", realmIds)
  if (runErr) console.error("  run_logs error:", runErr.message)
  else console.log(`  run_logs: ${runCount} deleted`)

  // 4. Delete realm mutations
  const { error: mutErr, count: mutCount } = await db
    .from("realm_mutations")
    .delete({ count: "exact" })
    .in("realm_instance_id", realmIds)
  if (mutErr) console.error("  realm_mutations error:", mutErr.message)
  else console.log(`  realm_mutations: ${mutCount} deleted`)

  // 5. Delete discovered map
  const { error: mapErr, count: mapCount } = await db
    .from("realm_discovered_map")
    .delete({ count: "exact" })
    .in("realm_instance_id", realmIds)
  if (mapErr) console.error("  realm_discovered_map error:", mapErr.message)
  else console.log(`  realm_discovered_map: ${mapCount} deleted`)

  // 6. Delete realm instances
  const { error: realmDelErr, count: realmDelCount } = await db
    .from("realm_instances")
    .delete({ count: "exact" })
    .eq("character_id", characterId)
  if (realmDelErr) console.error("  realm_instances error:", realmDelErr.message)
  else console.log(`  realm_instances: ${realmDelCount} deleted`)

  console.log("\nDone.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
