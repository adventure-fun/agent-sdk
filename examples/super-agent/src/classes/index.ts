import { createClassProfileRegistry, type ClassProfileRegistry } from "./profile.js"
import { rogueProfile } from "./rogue.js"
import { knightProfile } from "./knight.js"
import { mageProfile } from "./mage.js"
import { archerProfile } from "./archer.js"

export { type ClassProfile, type ClassProfileRegistry, findReadyAbility } from "./profile.js"
export { rogueProfile, knightProfile, mageProfile, archerProfile }

export const DEFAULT_CLASS_PROFILES = [
  rogueProfile,
  knightProfile,
  mageProfile,
  archerProfile,
] as const

export function createDefaultClassProfileRegistry(): ClassProfileRegistry {
  return createClassProfileRegistry(DEFAULT_CLASS_PROFILES)
}
