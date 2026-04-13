// Anonymous handle generator for new accounts.
//
// Every account needs a display handle because character pages render as
// "{owner}'s {character_name}" (e.g. "jimmy's Wizard" — see
// frontend/app/lib/character-display.ts). Before this generator, accounts
// with a null handle were falling back to a wallet fragment and rendered
// as "0xce19…ab88's jimmy" which is ugly and leaks wallet info in chat
// messages, leaderboard rows, etc.
//
// Requirements:
//   1. Must NOT require an LLM or any network call — runs per account
//      creation, so it has to be cheap.
//   2. Format must clearly signal "this is an auto-assigned anon handle"
//      so users feel motivated to set something custom. Leading `anon-`
//      prefix does that.
//   3. Must be funny and game-flavored.
//   4. Profanity filter — three random words multiplied together will
//      occasionally produce something accidentally offensive, so we run
//      every candidate through `obscenity` and retry until it's clean.
//      The same matcher is re-used for user-set handle validation (see
//      isProfane below).
//
// Layout: `anon-{adj1}-{adj2}-{noun}` where adjectives are silly and
// nouns lean into classic dungeon-crawl fauna. ~50 adjectives + 30 nouns
// gives ~75k combinations before collisions start mattering. On a unique
// constraint collision, the caller retries and we generate a fresh one.

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity"

// Prebuilt matcher — safe to share across calls because it's stateless.
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

/** Word pools.
 *
 *  Adjectives are adjectives a 10-year-old would find funny — "smelly",
 *  "wobbly", "greasy", "soggy". We intentionally avoid anything that
 *  could read as a slur even when combined with another word.
 *
 *  Nouns are classic D&D / roguelike monsters and party-member classes.
 *  They're all short so the full handle stays under ~40 chars. */
const ADJECTIVES = [
  "silly", "smelly", "wobbly", "greasy", "soggy", "crunchy", "fluffy",
  "bouncy", "grumpy", "sneaky", "sparkly", "clumsy", "drowsy", "jumpy",
  "snappy", "sloppy", "dopey", "lumpy", "mushy", "chunky", "gooey",
  "scruffy", "spooky", "cranky", "giggly", "groggy", "rowdy", "mopey",
  "dizzy", "bumpy", "mangy", "shifty", "twitchy", "scrappy", "pudgy",
  "wiggly", "prickly", "squishy", "rusty", "dusty", "moldy", "stinky",
  "tipsy", "loopy", "nutty", "goofy", "crusty", "fuzzy", "itchy", "feisty",
  "grubby", "clumsy", "cheery", "jolly", "nervy", "shabby", "slimy",
] as const

const NOUNS = [
  "rat", "goblin", "slime", "bat", "imp", "kobold", "orc", "troll",
  "wizard", "knight", "bard", "cleric", "druid", "ranger", "rogue",
  "witch", "ghost", "ghoul", "mummy", "vampire", "skeleton", "zombie",
  "dragon", "ogre", "giant", "lich", "gnome", "dwarf", "elf", "fairy",
  "harpy", "hydra", "kraken", "mimic", "naga", "phoenix", "sphinx",
  "wraith", "wyvern", "chimera",
] as const

/** Generate a fresh anonymous handle. Returns e.g. "anon-silly-smelly-rat".
 *
 *  If the first attempt trips the profanity filter, we retry with fresh
 *  words up to 20 times. That's a near-impossible failure case, but on
 *  the 20th retry we fall back to a timestamp-seeded handle so the
 *  caller NEVER gets `null`. */
export function generateAnonHandle(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    if (adj1 === adj2) continue
    const candidate = `anon-${adj1}-${adj2}-${noun}`
    if (!profanityMatcher.hasMatch(candidate)) return candidate
  }
  // Fallback that still starts with `anon-` so the UI's "is this user
  // anonymous?" heuristic stays valid.
  return `anon-${Date.now().toString(36)}`
}

/** True if the given handle (or any other text) trips the profanity filter.
 *  Used by the account edit endpoint to reject user-set handles before
 *  they go into the DB. Also used to validate anon candidates above. */
export function isProfane(text: string): boolean {
  return profanityMatcher.hasMatch(text)
}

/** Convention check: is this a generator-assigned anon handle?
 *  Used by the frontend to show a "you're using an auto-assigned handle,
 *  consider picking your own" nudge in the profile UI. */
export function isAnonHandle(handle: string | null | undefined): boolean {
  return typeof handle === "string" && /^anon-/.test(handle)
}
