export const REALM_TEMPLATES = {
  "sunken-crypt": {
    id: "sunken-crypt",
    name: "The Sunken Crypt",
    description: "Undead horrors lurk in flooded stone corridors. Poison traps line the deeper halls. The Lich King waits on the final floor.",
    theme: "undead",
  },
  "collapsed-mines": {
    id: "collapsed-mines",
    name: "The Collapsed Mines",
    description: "Constructs and golems patrol crumbling tunnels. Cave-ins reshape the path. The Iron Sentinel guards the deepest shaft.",
    theme: "constructs",
  },
} as const

export const ALL_TEMPLATE_IDS = Object.keys(REALM_TEMPLATES) as (keyof typeof REALM_TEMPLATES)[]

export const REALM_STATUS_LABELS: Record<string, string> = {
  generated: "Ready",
  active: "In Progress",
  paused: "Paused",
  boss_cleared: "Boss Cleared",
  completed: "Completed",
  dead_end: "Lost",
}
