// Shared helpers for displaying character + owner information consistently
// across leaderboard, spectate, user profile, and character detail pages.
//
// Characters don't have globally unique names — two people can both name
// their mage "Wizard". To disambiguate we always show the owner alongside:
// "jimmy's Wizard" instead of bare "Wizard".
//
// `ownerLabel` — used everywhere we'd show a wallet or handle. Prefers the
// user-set handle if present, falls back to a shortened wallet address.
//
// `characterDisplayName` — the full "{owner}'s {name}" form used in
// leaderboard cells, active-session cards, and navigation breadcrumbs.
//
// `ownerProfileHref` — the canonical /user/[id] route for an owner, using
// the handle if one is set so the URL is readable, otherwise the wallet
// (which always resolves via the backend /users/:id fallback).

export interface OwnerLike {
  handle?: string | null
  wallet?: string | null
}

export function shortenWallet(wallet: string | null | undefined): string {
  if (!wallet) return ""
  if (wallet.length <= 10) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

/** Short label for an owner — handle first, falling back to shortened wallet. */
export function ownerLabel(owner: OwnerLike | null | undefined): string {
  if (!owner) return ""
  if (owner.handle && owner.handle.trim().length > 0) return owner.handle
  return shortenWallet(owner.wallet)
}

/** "{owner}'s {character_name}" form used to disambiguate non-unique
 *  character names across the UI. When the owner is unknown, falls back
 *  to the bare character name. */
export function characterDisplayName(
  characterName: string,
  owner: OwnerLike | null | undefined,
): string {
  const label = ownerLabel(owner)
  if (!label) return characterName
  // Naive possessive — "jimmy's", "jonas's". Good enough for human and
  // agent handles; we don't try to handle unicode edge cases or strict
  // English style guides.
  const suffix = label.endsWith("s") ? "'" : "'s"
  return `${label}${suffix} ${characterName}`
}

/** Canonical profile route for an owner. Prefers the handle (readable URL)
 *  but falls back to the wallet address because the backend /users/:id
 *  endpoint resolves both. */
export function ownerProfileHref(owner: OwnerLike | null | undefined): string | null {
  if (!owner) return null
  if (owner.handle && owner.handle.trim().length > 0) {
    return `/user/${encodeURIComponent(owner.handle)}`
  }
  if (owner.wallet) return `/user/${owner.wallet}`
  return null
}

/** Canonical detail route for a character. */
export function characterHref(characterId: string): string {
  return `/character/${characterId}`
}
