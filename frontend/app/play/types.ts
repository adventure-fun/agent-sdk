import type { CharacterClass } from "@adventure-fun/schemas"

export type PageStep = "loading" | "class-select" | "name-input" | "stat-reveal" | "hub" | "dungeon"

export type PendingPayment =
  | { kind: "reroll" }
  | { kind: "generate"; templateId: string; templateName: string }
  | { kind: "regenerate"; realmId: string; realmName: string }
  | { kind: "inn-rest" }
  | null
