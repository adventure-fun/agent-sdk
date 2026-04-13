import { CLASSES, PERKS, SKILL_TREES } from "@adventure-fun/engine"
import type {
  CharacterClass,
  CharacterStats,
  PerkTemplate,
  SkillNodeTemplate,
  SkillTier,
} from "@adventure-fun/schemas"

export interface SkillAllocationResult {
  ok: boolean
  error?: string
  node?: SkillNodeTemplate
}

export interface PerkAllocationResult {
  ok: boolean
  error?: string
  perk?: PerkTemplate
}

/**
 * Validate whether a character can unlock a given skill node.
 * Pure function — no DB or side effects.
 */
export function validateSkillAllocation(
  characterClass: CharacterClass,
  characterLevel: number,
  currentSkillTree: Record<string, boolean>,
  nodeId: string,
): SkillAllocationResult {
  const classTemplate = CLASSES[characterClass]
  if (!classTemplate) return { ok: false, error: "Unknown class" }

  const treeId =
    "skill_tree_id" in classTemplate && typeof classTemplate.skill_tree_id === "string"
      ? classTemplate.skill_tree_id
      : undefined
  const tree: { tiers: SkillTier[] } | undefined = treeId ? SKILL_TREES[treeId] : classTemplate.skill_tree
  if (!tree) return { ok: false, error: "No skill tree for class" }

  let targetNode: SkillNodeTemplate | undefined
  let targetTier: SkillTier | undefined

  for (const tier of tree.tiers) {
    for (const choice of tier.choices) {
      if (choice.id === nodeId) {
        targetNode = choice
        targetTier = tier
      }
    }
  }

  if (!targetNode || !targetTier) {
    return { ok: false, error: "Unknown skill node" }
  }

  if (currentSkillTree[nodeId]) {
    return { ok: false, error: "Skill already unlocked" }
  }

  if (characterLevel < targetTier.unlock_level) {
    return { ok: false, error: `Requires level ${targetTier.unlock_level}` }
  }

  for (const prereqId of targetNode.prerequisites) {
    if (!currentSkillTree[prereqId]) {
      return { ok: false, error: `Missing prerequisite: ${prereqId}` }
    }
  }

  for (const sibling of targetTier.choices) {
    if (sibling.id !== nodeId && currentSkillTree[sibling.id]) {
      return { ok: false, error: "Another skill in this tier is already unlocked" }
    }
  }

  return { ok: true, node: targetNode }
}

/**
 * Apply passive-stat bonuses from a skill tree to a base stats object.
 * Returns a new stats object with bonuses applied.
 */
export function applySkillTreePassives(
  characterClass: CharacterClass,
  baseStats: CharacterStats,
  skillTree: Record<string, boolean>,
): CharacterStats {
  const result = { ...baseStats }
  const classTemplate = CLASSES[characterClass]
  if (!classTemplate) return result

  const treeId =
    "skill_tree_id" in classTemplate && typeof classTemplate.skill_tree_id === "string"
      ? classTemplate.skill_tree_id
      : undefined
  const tree: { tiers: SkillTier[] } | undefined = treeId ? SKILL_TREES[treeId] : classTemplate.skill_tree
  if (!tree) return result

  for (const tier of tree.tiers) {
    for (const choice of tier.choices) {
      if (!skillTree[choice.id]) continue
      if (choice.effect.type === "passive-stat" && choice.effect.stat && choice.effect.value) {
        const stat = choice.effect.stat as keyof CharacterStats
        if (stat in result) {
          result[stat] += choice.effect.value
        }
      }
    }
  }

  return result
}

/**
 * Validate whether a character can buy one more stack of a shared perk.
 * Pure function — no DB or side effects.
 */
export function validatePerkAllocation(
  characterLevel: number,
  currentPerks: Record<string, number>,
  perkId: string,
): PerkAllocationResult {
  const perk = PERKS[perkId]
  if (!perk) return { ok: false, error: "Unknown perk" }

  const currentStack = currentPerks[perkId] ?? 0
  if (currentStack >= perk.max_stacks) {
    return { ok: false, error: `Perk already at max stacks (${perk.max_stacks})` }
  }

  const totalSpent = Object.values(currentPerks).reduce((sum, n) => sum + (n ?? 0), 0)
  const availablePoints = (characterLevel - 1) - totalSpent
  if (availablePoints < 1) {
    return { ok: false, error: "Not enough perk points" }
  }

  return { ok: true, perk }
}

/**
 * Apply stackable passive-stat bonuses from the shared perk pool to a base stats
 * object. Returns a new stats object. Composes cleanly with `applySkillTreePassives`:
 * call tree first, then perks, on the same running `CharacterStats`.
 */
export function applyPerkPassives(
  baseStats: CharacterStats,
  perks: Record<string, number>,
): CharacterStats {
  const result = { ...baseStats }
  for (const [perkId, stackCount] of Object.entries(perks)) {
    const perk = PERKS[perkId]
    if (!perk || stackCount <= 0) continue
    const stat = perk.stat as keyof CharacterStats
    if (stat in result) {
      result[stat] += perk.value_per_stack * stackCount
    }
  }
  return result
}
