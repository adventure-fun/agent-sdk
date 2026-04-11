#!/usr/bin/env bun
/**
 * Wipes all realms and inventory for every character owned by a wallet address.
 *
 * Usage:
 *   bun scripts/wipe-account.ts <wallet_address> [--dry-run]
 */

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env["SUPABASE_URL"]
const SUPABASE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
  process.exit(1)
}

const wallet = process.argv[2]
const dryRun = process.argv.includes("--dry-run")

if (!wallet) {
  console.error("Usage: bun scripts/wipe-account.ts <wallet_address> [--dry-run]")
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  // 1. Look up account by wallet
  const { data: account, error: accErr } = await db
    .from("accounts")
    .select("id, wallet_address, handle")
    .eq("wallet_address", wallet)
    .maybeSingle()

  if (accErr) {
    console.error("Failed to look up account:", accErr.message)
    process.exit(1)
  }
  if (!account) {
    console.error(`No account found for wallet "${wallet}"`)
    process.exit(1)
  }

  console.log(`Account: ${account.handle ?? account.id} (${account.wallet_address})`)

  // 2. Get all characters for this account
  const { data: characters, error: charErr } = await db
    .from("characters")
    .select("id, name, class, status")
    .eq("account_id", account.id)

  if (charErr) {
    console.error("Failed to fetch characters:", charErr.message)
    process.exit(1)
  }
  if (!characters || characters.length === 0) {
    console.log("No characters found for this account.")
    process.exit(0)
  }

  const characterIds = characters.map((c) => c.id)
  console.log(`Found ${characters.length} character(s):`)
  for (const c of characters) {
    console.log(`  - ${c.name} (${c.class}, ${c.status}) [${c.id}]`)
  }

  // 3. Get all realm IDs across all characters
  const { data: realms, error: realmErr } = await db
    .from("realm_instances")
    .select("id, template_id, status, character_id")
    .in("character_id", characterIds)

  if (realmErr) {
    console.error("Failed to fetch realms:", realmErr.message)
    process.exit(1)
  }

  const realmIds = realms?.map((r) => r.id) ?? []
  console.log(`Found ${realmIds.length} realm(s)`)

  // 4. Get corpse container IDs
  let corpseIds: string[] = []
  if (realmIds.length > 0) {
    const { data: corpses } = await db
      .from("corpse_containers")
      .select("id")
      .in("realm_instance_id", realmIds)
    corpseIds = corpses?.map((c) => c.id) ?? []
  }

  // 5. Count character inventory items
  const { count: inventoryCount } = await db
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("owner_type", "character")
    .in("owner_id", characterIds)

  if (dryRun) {
    console.log("\n[DRY RUN] Would delete:")
    console.log(`  - ${inventoryCount ?? 0} inventory_items (character)`)
    console.log(`  - inventory_items for ${corpseIds.length} corpse container(s)`)
    console.log(`  - ${corpseIds.length} corpse_containers`)
    if (realmIds.length > 0) {
      console.log(`  - run_logs for ${realmIds.length} realm(s)`)
      console.log(`  - realm_mutations for ${realmIds.length} realm(s)`)
      console.log(`  - realm_discovered_map for ${realmIds.length} realm(s)`)
      console.log(`  - ${realmIds.length} realm_instances`)
    }
    process.exit(0)
  }

  console.log("\nDeleting...")

  // Delete character inventory items
  {
    const { error, count } = await db
      .from("inventory_items")
      .delete({ count: "exact" })
      .eq("owner_type", "character")
      .in("owner_id", characterIds)
    if (error) console.error("  inventory_items (character) error:", error.message)
    else console.log(`  inventory_items (character): ${count} deleted`)
  }

  // Delete corpse inventory items
  if (corpseIds.length > 0) {
    const { error, count } = await db
      .from("inventory_items")
      .delete({ count: "exact" })
      .eq("owner_type", "corpse")
      .in("owner_id", corpseIds)
    if (error) console.error("  inventory_items (corpse) error:", error.message)
    else console.log(`  inventory_items (corpse): ${count} deleted`)
  }

  // Delete corpse containers
  if (corpseIds.length > 0) {
    const { error, count } = await db
      .from("corpse_containers")
      .delete({ count: "exact" })
      .in("realm_instance_id", realmIds)
    if (error) console.error("  corpse_containers error:", error.message)
    else console.log(`  corpse_containers: ${count} deleted`)
  }

  if (realmIds.length > 0) {
    // Delete run logs
    const { error: runErr, count: runCount } = await db
      .from("run_logs")
      .delete({ count: "exact" })
      .in("realm_instance_id", realmIds)
    if (runErr) console.error("  run_logs error:", runErr.message)
    else console.log(`  run_logs: ${runCount} deleted`)

    // Delete realm mutations
    const { error: mutErr, count: mutCount } = await db
      .from("realm_mutations")
      .delete({ count: "exact" })
      .in("realm_instance_id", realmIds)
    if (mutErr) console.error("  realm_mutations error:", mutErr.message)
    else console.log(`  realm_mutations: ${mutCount} deleted`)

    // Delete discovered map
    const { error: mapErr, count: mapCount } = await db
      .from("realm_discovered_map")
      .delete({ count: "exact" })
      .in("realm_instance_id", realmIds)
    if (mapErr) console.error("  realm_discovered_map error:", mapErr.message)
    else console.log(`  realm_discovered_map: ${mapCount} deleted`)

    // Delete realm instances
    const { error: realmDelErr, count: realmDelCount } = await db
      .from("realm_instances")
      .delete({ count: "exact" })
      .in("character_id", characterIds)
    if (realmDelErr) console.error("  realm_instances error:", realmDelErr.message)
    else console.log(`  realm_instances: ${realmDelCount} deleted`)
  }

  console.log("\nDone.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
