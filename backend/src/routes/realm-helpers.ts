import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Removes stale data from a previous realm run and resets session columns.
 * Called during realm regeneration so the next GameSession.create
 * doesn't load mutations/map from an old seed.
 */
export async function cleanupRealmForRegeneration(
  db: SupabaseClient,
  realmId: string,
): Promise<void> {
  await Promise.all([
    db.from("realm_mutations").delete().eq("realm_instance_id", realmId),
    db.from("realm_discovered_map").delete().eq("realm_instance_id", realmId),
    db
      .from("realm_instances")
      .update({
        last_turn: 0,
        current_room_id: null,
        tile_x: null,
        tile_y: null,
        last_active_at: null,
      })
      .eq("id", realmId),
  ])

  await db.from("realm_discovered_map").insert({
    realm_instance_id: realmId,
    floor: 1,
    discovered_tiles: [],
  })
}
