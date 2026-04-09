"use client"

import { useIsSignedIn, useIsInitialized, useCreateEvmEoaAccount } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { useCharacter } from "../hooks/use-character"
import { useRealm } from "../hooks/use-realm"
import { useGameSession } from "../hooks/use-game-session"
import { useContent } from "../hooks/use-content"
import type { ClassTemplateSummary, RealmTemplateSummary } from "../hooks/use-content"
import { useProgression } from "../hooks/use-progression"
import type { ProgressionData } from "../hooks/use-progression"
import { AsciiMap } from "../components/ascii-map"
import { useEffect, useState, useMemo } from "react"
import type { CharacterClass, Action, Observation, ActiveEffect } from "@adventure-fun/schemas"

const STAT_KEYS = ["hp", "attack", "defense", "accuracy", "evasion", "speed"] as const
const STAT_LABELS: Record<string, string> = {
  hp: "HP", attack: "Attack", defense: "Defense",
  accuracy: "Accuracy", evasion: "Evasion", speed: "Speed",
}
const REALM_STATUS_LABELS: Record<string, string> = {
  generated: "Ready", active: "In Progress", paused: "Paused",
  boss_cleared: "Boss Cleared", completed: "Completed", dead_end: "Lost",
}

type PageStep = "loading" | "class-select" | "name-input" | "stat-reveal" | "hub" | "dungeon"

export default function PlayPage() {
  const { isInitialized } = useIsInitialized()
  const { isSignedIn } = useIsSignedIn()
  const {
    evmAddress,
    isAuthenticated,
    isConnecting,
    error: authError,
    connect,
    logout,
  } = useAdventureAuth()

  const {
    character,
    isLoading: charLoading,
    error: charError,
    fetchCharacter,
    rollCharacter,
    rerollStats,
  } = useCharacter()

  const {
    realms,
    isLoading: realmsLoading,
    error: realmsError,
    fetchRealms,
    generateRealm,
  } = useRealm()

  const gameSession = useGameSession()

  const {
    progression,
    fetchProgression,
    unlockSkill,
    error: progressionError,
  } = useProgression()

  const {
    realmTemplates,
    classTemplates,
    fetchRealmTemplates,
    fetchClassTemplates,
  } = useContent()

  const { createEvmEoaAccount } = useCreateEvmEoaAccount()

  // Build lookup maps from fetched content
  const classMap = useMemo(() => {
    const m: Record<string, ClassTemplateSummary> = {}
    for (const c of classTemplates) m[c.id] = c
    return m
  }, [classTemplates])

  const realmTemplateMap = useMemo(() => {
    const m: Record<string, RealmTemplateSummary> = {}
    for (const r of realmTemplates) m[r.id] = r
    return m
  }, [realmTemplates])

  // Creation flow state
  const [step, setStep] = useState<PageStep>("loading")
  const [selectedClass, setSelectedClass] = useState<CharacterClass | null>(null)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [rerollMessage, setRerollMessage] = useState<string | null>(null)
  const [rerollDisabled, setRerollDisabled] = useState(false)

  // Realm generation state
  const [generatingTemplate, setGeneratingTemplate] = useState<string | null>(null)
  const [realmError, setRealmError] = useState<string | null>(null)

  // Skill tree panel state
  const [showSkillTree, setShowSkillTree] = useState(false)

  // Fetch content on mount (public, no auth needed)
  useEffect(() => {
    fetchClassTemplates()
    fetchRealmTemplates()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Create EVM wallet if signed in but no wallet exists
  useEffect(() => {
    if (isSignedIn && !evmAddress) {
      createEvmEoaAccount().catch(() => {})
    }
  }, [isSignedIn, evmAddress, createEvmEoaAccount])

  // Auto-connect to backend once CDP sign-in gives us a wallet
  useEffect(() => {
    if (isSignedIn && evmAddress && !isAuthenticated && !isConnecting) {
      connect()
    }
  }, [isSignedIn, evmAddress, isAuthenticated, isConnecting, connect])

  // Check for existing character once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchCharacter().then((c) => {
        if (c) {
          fetchRealms()
          fetchProgression()
          setStep("hub")
        } else {
          setStep("class-select")
        }
      })
    }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Return to hub helper (after death/extraction)
  const returnToHub = () => {
    gameSession.disconnect()
    fetchCharacter().then((c) => {
      if (c) {
        fetchRealms()
        fetchProgression()
        setStep("hub")
      } else {
        setStep("class-select")
      }
    })
  }

  // SDK still loading
  if (!isInitialized) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
        <p className="text-gray-400">Loading CDP SDK...</p>
        <p className="text-xs text-gray-600">
          Project: {process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "NOT SET"}
        </p>
      </Shell>
    )
  }

  // Step 1: Not signed in to CDP
  if (!isSignedIn) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
        <p className="text-gray-400">Sign in to play</p>
        <div className="flex justify-center">
          <AuthButton />
        </div>
        <p className="text-xs text-gray-600">
          Creates a wallet automatically. No extension needed.
        </p>
      </Shell>
    )
  }

  // Step 2: Signed in to CDP, connecting to backend
  if (!isAuthenticated) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
        {isConnecting ? (
          <p className="text-gray-400">Connecting to adventure server...</p>
        ) : authError ? (
          <div className="space-y-4">
            <p className="text-red-400">{authError}</p>
            <button
              onClick={connect}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="text-gray-400">Preparing wallet...</p>
        )}
      </Shell>
    )
  }

  // Step 3: Authenticated — character flow

  // Loading state while checking for existing character
  if (step === "loading") {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
        <p className="text-gray-400">Checking for existing character...</p>
      </Shell>
    )
  }

  // Class selection
  if (step === "class-select") {
    return (
      <main className="min-h-screen flex flex-col items-center p-8">
        <div className="max-w-3xl w-full space-y-6">
          <h1 className="text-3xl font-bold text-amber-400 text-center">Choose Your Class</h1>
          <p className="text-gray-400 text-center text-sm">
            Select a class to begin your adventure. Each class has unique stat ranges and a resource type.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {classTemplates.map((cls) => (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls.id as CharacterClass)}
                className={`text-left p-4 rounded border transition-colors ${
                  selectedClass === cls.id
                    ? "border-amber-400 bg-gray-900"
                    : "border-gray-800 bg-gray-900/50 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold text-amber-400">{cls.name}</h2>
                  <span className="text-xs text-gray-500 uppercase tracking-wider">
                    {cls.resource_type}: {cls.resource_max}
                  </span>
                </div>
                <p className="text-gray-400 text-sm mb-3">{cls.description}</p>
                <div className="space-y-1">
                  {STAT_KEYS.map((stat) => {
                    const range = cls.stat_roll_ranges[stat]
                    if (!range) return null
                    return (
                      <StatRangeBar key={stat} label={STAT_LABELS[stat]!} min={range[0]} max={range[1]} />
                    )
                  })}
                </div>
              </button>
            ))}
          </div>

          <div className="flex justify-center">
            <button
              disabled={!selectedClass}
              onClick={() => {
                if (selectedClass) setStep("name-input")
              }}
              className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next — Choose Name
            </button>
          </div>
        </div>
      </main>
    )
  }

  // Name input + confirm
  if (step === "name-input" && selectedClass) {
    const trimmedName = name.trim()
    const isNameValid = trimmedName.length >= 2 && trimmedName.length <= 24

    const validateName = (value: string) => {
      const t = value.trim()
      if (t.length > 0 && t.length < 2) {
        setNameError("Name must be at least 2 characters")
      } else if (t.length > 24) {
        setNameError("Name must be at most 24 characters")
      } else {
        setNameError(null)
      }
    }

    const handleCreate = async () => {
      if (!isNameValid) return
      setCreateError(null)
      const result = await rollCharacter(trimmedName, selectedClass)
      if (result) {
        setStep("stat-reveal")
      } else {
        setCreateError(charError ?? "Failed to create character")
      }
    }

    return (
      <main className="min-h-screen flex flex-col items-center p-8">
        <div className="max-w-lg w-full text-center space-y-6">
          <h1 className="text-3xl font-bold text-amber-400">Name Your {classMap[selectedClass]?.name ?? selectedClass}</h1>

          <div className="bg-gray-900 border border-gray-800 rounded p-4 text-sm text-left w-full max-w-md mx-auto">
            <p>
              <span className="text-gray-500">Class:</span>{" "}
              <span className="text-gray-300">{classMap[selectedClass]?.name ?? selectedClass}</span>
            </p>
            <p>
              <span className="text-gray-500">Resource:</span>{" "}
              <span className="text-gray-300 capitalize">{classMap[selectedClass]?.resource_type ?? ""}</span>
            </p>
          </div>

          <div className="w-full max-w-md mx-auto space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                validateName(e.target.value)
              }}
              placeholder="Enter character name"
              maxLength={24}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-400 transition-colors"
            />
            {nameError && (
              <p className="text-red-400 text-xs">{nameError}</p>
            )}
            <p className="text-gray-600 text-xs">{trimmedName.length}/24 characters</p>
          </div>

          {createError && (
            <p className="text-red-400 text-sm">{createError}</p>
          )}

          {showConfirm ? (
            <div className="bg-gray-900 border border-amber-400/50 rounded p-4 text-sm space-y-3 w-full max-w-md mx-auto">
              <p className="text-gray-300">
                Create <span className="text-amber-400 font-bold">{trimmedName}</span> the{" "}
                <span className="text-amber-400 font-bold">{classMap[selectedClass]?.name ?? selectedClass}</span>?
              </p>
              <p className="text-gray-500 text-xs">
                This is irreversible. Your stats will be rolled randomly within your class ranges.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={charLoading}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors disabled:opacity-40"
                >
                  {charLoading ? "Creating..." : "Confirm"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setStep("class-select")
                  setName("")
                  setNameError(null)
                  setCreateError(null)
                }}
                className="px-6 py-2 border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors"
              >
                Back
              </button>
              <button
                disabled={!isNameValid}
                onClick={() => setShowConfirm(true)}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Character
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  // Stat reveal
  if (step === "stat-reveal" && character) {
    const cls = character.class
    const stats = character.stats

    const handleReroll = async () => {
      const result = await rerollStats()
      if (result.paymentRequired) {
        setRerollMessage("Payment integration coming soon")
        setRerollDisabled(true)
      } else if (result.message) {
        setRerollMessage(result.message)
        setRerollDisabled(true)
      }
    }

    return (
      <Shell wide>
        <h1 className="text-3xl font-bold text-amber-400">{character.name}</h1>
        <p className="text-gray-400 text-sm">
          Level {character.level} {classMap[cls]?.name ?? cls} — {character.gold} gold
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded p-4 w-full space-y-2">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Rolled Stats</h2>
          {STAT_KEYS.map((stat) => {
            const range = classMap[cls]?.stat_roll_ranges[stat]
            const value = stats[stat]
            if (!range) return null
            return (
              <StatValueBar
                key={stat}
                label={STAT_LABELS[stat]!}
                value={value}
                min={range[0]}
                max={range[1]}
              />
            )
          })}
        </div>

        <div className="space-y-2 text-center">
          <button
            onClick={handleReroll}
            disabled={charLoading || rerollDisabled}
            className="px-4 py-1 border border-gray-700 text-gray-400 text-sm rounded hover:border-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {charLoading ? "Re-rolling..." : "Re-roll Stats ($0.10)"}
          </button>
          {rerollMessage && (
            <p className="text-gray-500 text-xs">{rerollMessage}</p>
          )}
        </div>

        <button
          onClick={() => {
            fetchRealms()
            fetchProgression()
            setStep("hub")
          }}
          className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
        >
          Enter the Dungeon
        </button>
      </Shell>
    )
  }

  // ── Dungeon view ─────────────────────────────────────────────────────────────
  if (step === "dungeon") {
    // Death screen
    if (gameSession.isDead && gameSession.deathData) {
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-red-400">YOU HAVE FALLEN</h1>
          <div className="bg-gray-900 border border-red-900/50 rounded p-4 text-sm space-y-2 text-left">
            <p>
              <span className="text-gray-500">Cause:</span>{" "}
              <span className="text-gray-300">{gameSession.deathData.cause}</span>
            </p>
            <p>
              <span className="text-gray-500">Floor:</span>{" "}
              <span className="text-gray-300">{gameSession.deathData.floor}</span>
            </p>
            <p>
              <span className="text-gray-500">Room:</span>{" "}
              <span className="text-gray-300">{gameSession.deathData.room}</span>
            </p>
            <p>
              <span className="text-gray-500">Turn:</span>{" "}
              <span className="text-gray-300">{gameSession.deathData.turn}</span>
            </p>
          </div>
          <p className="text-gray-500 text-sm italic">Your legend has been written.</p>
          <button
            onClick={returnToHub}
            className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            Return to Hub
          </button>
        </Shell>
      )
    }

    // Extraction screen
    if (gameSession.isExtracted && gameSession.extractData) {
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-green-400">YOU ESCAPED ALIVE</h1>
          <div className="bg-gray-900 border border-green-900/50 rounded p-4 text-sm space-y-2 text-left">
            <p>
              <span className="text-gray-500">XP Gained:</span>{" "}
              <span className="text-gray-300">{gameSession.extractData.xp_gained}</span>
            </p>
            {gameSession.extractData.loot_summary.length > 0 && (
              <p>
                <span className="text-gray-500">Loot:</span>{" "}
                <span className="text-gray-300">{gameSession.extractData.loot_summary.length} items</span>
              </p>
            )}
          </div>
          <p className="text-gray-500 text-sm italic">You live to fight another day.</p>
          <button
            onClick={returnToHub}
            className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            Return to Hub
          </button>
        </Shell>
      )
    }

    // Disconnected (unexpected)
    if (!gameSession.isConnected && !gameSession.isConnecting && gameSession.error) {
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-amber-400">DISCONNECTED</h1>
          <p className="text-red-400 text-sm">{gameSession.error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={returnToHub}
              className="px-6 py-2 border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors"
            >
              Return to Hub
            </button>
            <button
              onClick={() => {
                // Find the active realm to reconnect
                const activeRealm = realms.find((r) => r.status === "active")
                if (activeRealm) gameSession.connect(activeRealm.id)
              }}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
            >
              Reconnect
            </button>
          </div>
        </Shell>
      )
    }

    // Connecting
    if (gameSession.isConnecting || !gameSession.observation) {
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
          <p className="text-gray-400">Entering realm...</p>
        </Shell>
      )
    }

    // Active dungeon
    return (
      <DungeonView
        observation={gameSession.observation}
        waitingForResponse={gameSession.waitingForResponse}
        onAction={gameSession.sendAction}
        onRetreat={() => {
          gameSession.sendAction({ type: "retreat" })
        }}
      />
    )
  }

  // ── Character hub ────────────────────────────────────────────────────────────
  if (step === "hub" && character) {
    const hubHpPct = character.hp_max > 0 ? (character.hp_current / character.hp_max) * 100 : 0
    const hubHpColor = hubHpPct > 50 ? "bg-green-500" : hubHpPct > 25 ? "bg-yellow-500" : "bg-red-500"
    const resourceLabel = classMap[character.class]?.resource_type ?? "resource"

    const handleGenerateRealm = async (templateId: string) => {
      setRealmError(null)
      setGeneratingTemplate(templateId)
      const result = await generateRealm(templateId)
      setGeneratingTemplate(null)
      if (result.paymentRequired) {
        setRealmError("Payment integration coming soon")
      } else if (result.error) {
        setRealmError(result.error)
      }
    }

    const handleEnterRealm = (realmId: string) => {
      gameSession.connect(realmId)
      setStep("dungeon")
    }

    return (
      <main className="min-h-screen flex flex-col items-center p-8">
        <div className="max-w-2xl w-full space-y-6">
          <h1 className="text-3xl font-bold text-amber-400 text-center">ADVENTURE.FUN</h1>

          {/* Character summary */}
          <div className="bg-gray-900 border border-gray-800 rounded p-4 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-amber-400 font-bold">{character.name}</h2>
              <span className="text-gray-500 text-xs">
                Level {character.level} {classMap[character.class]?.name ?? character.class}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <p>
                <span className="text-gray-500">Gold:</span>{" "}
                <span className="text-gray-300">{character.gold}</span>
              </p>
              <p>
                <span className="text-gray-500">XP:</span>{" "}
                <span className="text-gray-300">{character.xp}</span>
              </p>
            </div>

            {/* XP Progress Bar */}
            {progression && (
              <XpProgressBar
                xp={progression.xp}
                level={progression.level}
                xpToNext={progression.xp_to_next_level}
                xpForNext={progression.xp_for_next_level}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <StatusMeter
                label="HP"
                current={character.hp_current}
                max={character.hp_max}
                colorClass={hubHpColor}
              />
              <StatusMeter
                label={resourceLabel}
                current={character.resource_current}
                max={character.resource_max}
                colorClass="bg-blue-500"
              />
            </div>
            <p className="text-xs text-gray-600">
              ATK {character.stats.attack} | DEF {character.stats.defense} | ACC {character.stats.accuracy} | EVA {character.stats.evasion} | SPD {character.stats.speed}
            </p>

            {/* Skill Points Indicator */}
            {progression && progression.skill_points > 0 && (
              <button
                onClick={() => setShowSkillTree(true)}
                className="w-full text-xs text-center py-1.5 rounded border border-amber-700/50 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40 transition-colors"
              >
                {progression.skill_points} skill point{progression.skill_points !== 1 ? "s" : ""} available — View Skill Tree
              </button>
            )}
          </div>

          {/* Skill Tree Panel */}
          {showSkillTree && progression?.skill_tree_template && (
            <SkillTreePanel
              progression={progression}
              onUnlock={async (nodeId) => {
                await unlockSkill(nodeId)
                await fetchCharacter()
              }}
              onClose={() => setShowSkillTree(false)}
              error={progressionError}
            />
          )}

          {/* View Skill Tree (when no points available) */}
          {!showSkillTree && progression?.skill_tree_template && (
            <button
              onClick={() => setShowSkillTree(true)}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              View Skill Tree
            </button>
          )}

          {/* Realm section */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Realms</h2>

            {realmsLoading && <p className="text-gray-500 text-sm">Loading realms...</p>}
            {realmsError && <p className="text-red-400 text-sm">{realmsError}</p>}
            {realmError && <p className="text-red-400 text-sm">{realmError}</p>}

            {/* Existing realms */}
            {realms.map((realm) => {
              const template = realmTemplateMap[realm.template_id]
              const statusLabel = REALM_STATUS_LABELS[realm.status] ?? realm.status
              const canEnter = realm.status === "generated" || realm.status === "paused" || realm.status === "active"

              return (
                <div
                  key={realm.id}
                  className="bg-gray-900 border border-gray-800 rounded p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="text-gray-300 text-sm font-bold">
                      {template?.name ?? realm.template_id}
                    </p>
                    <p className="text-gray-600 text-xs">
                      {statusLabel} — Floor {realm.floor_reached}
                    </p>
                  </div>
                  <div>
                    {canEnter && (
                      <button
                        onClick={() => handleEnterRealm(realm.id)}
                        className="px-4 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded transition-colors"
                      >
                        {realm.status === "active" ? "Resume" : "Enter"}
                      </button>
                    )}
                    {realm.status === "completed" && (
                      <button
                        disabled
                        className="px-4 py-1 border border-gray-700 text-gray-500 text-sm rounded opacity-40 cursor-not-allowed"
                      >
                        Regenerate ($0.25)
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Generate new realm */}
            {realmTemplates.filter((t) => !t.is_tutorial).map((template) => {
              const existing = realms.find((r) => r.template_id === template.id)
              if (existing && existing.status !== "completed" && existing.status !== "dead_end") return null

              const isFree = !realms.some((r) => r.is_free)

              return (
                <div
                  key={template.id}
                  className="bg-gray-900/50 border border-dashed border-gray-700 rounded p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-gray-400 text-sm font-bold">{template.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded ${isFree ? "bg-green-900/50 text-green-400" : "text-gray-500"}`}>
                      {isFree ? "Free" : "$0.25"}
                    </span>
                  </div>
                  <p className="text-gray-600 text-xs mb-3">{template.description}</p>
                  <button
                    onClick={() => handleGenerateRealm(template.id)}
                    disabled={generatingTemplate !== null}
                    className="px-4 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generatingTemplate === template.id ? "Generating..." : "Generate Realm"}
                  </button>
                </div>
              )
            })}
          </div>

          <button
            onClick={logout}
            className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </main>
    )
  }

  // Fallback: loading / error
  return (
    <Shell>
      <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
      {charLoading ? (
        <p className="text-gray-400">Loading...</p>
      ) : charError ? (
        <div className="space-y-4">
          <p className="text-red-400">{charError}</p>
          <button
            onClick={() => fetchCharacter().then((c) => setStep(c ? "hub" : "class-select"))}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="text-gray-400">Preparing...</p>
      )}
      <button
        onClick={logout}
        className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
      >
        Disconnect
      </button>
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dungeon View
// ═══════════════════════════════════════════════════════════════════════════════

function DungeonView({
  observation,
  waitingForResponse,
  onAction,
  onRetreat,
}: {
  observation: Observation
  waitingForResponse: boolean
  onAction: (action: Action) => void
  onRetreat: () => void
}) {
  const {
    character,
    position,
    visible_tiles,
    visible_entities,
    recent_events,
    legal_actions,
    realm_info,
    room_text,
    inventory,
    equipment,
    gold,
  } = observation

  // Group legal actions by type
  const moveActions = legal_actions.filter((a): a is Action & { type: "move" } => a.type === "move")
  const attackActions = legal_actions.filter((a): a is Action & { type: "attack" } => a.type === "attack")
  const interactActions = legal_actions.filter((a): a is Action & { type: "interact" } => a.type === "interact")
  const useItemActions = legal_actions.filter((a): a is Action & { type: "use_item" } => a.type === "use_item")
  const canWait = legal_actions.some((a) => a.type === "wait")
  const canPortal = legal_actions.some((a) => a.type === "use_portal")
  const canRetreat = legal_actions.some((a) => a.type === "retreat")
  const canPickup = legal_actions.filter((a): a is Action & { type: "pickup" } => a.type === "pickup")
  const usableAbilityIds = new Set(attackActions.map((action) => action.ability_id ?? "basic-attack"))
  const abilityMap = new Map(character.abilities.map((ability) => [ability.id, ability]))
  const visibleEnemies = visible_entities
    .filter(
      (entity): entity is Observation["visible_entities"][number] & { type: "enemy" } =>
        entity.type === "enemy",
    )
    .sort((left, right) => {
      if ((left.is_boss ? 1 : 0) !== (right.is_boss ? 1 : 0)) {
        return (right.is_boss ? 1 : 0) - (left.is_boss ? 1 : 0)
      }
      const leftRatio = left.hp_max ? (left.hp_current ?? left.hp_max) / left.hp_max : 1
      const rightRatio = right.hp_max ? (right.hp_current ?? right.hp_max) / right.hp_max : 1
      return leftRatio - rightRatio
    })

  const hpPct = character.hp.max > 0 ? (character.hp.current / character.hp.max) * 100 : 0
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-yellow-500" : "bg-red-500"
  const resourceColor = getResourceBarColor(character.resource.type)
  const statRows = [
    { label: "ATK", base: character.base_stats.attack, effective: character.effective_stats.attack },
    { label: "DEF", base: character.base_stats.defense, effective: character.effective_stats.defense },
    { label: "ACC", base: character.base_stats.accuracy, effective: character.effective_stats.accuracy },
    { label: "EVA", base: character.base_stats.evasion, effective: character.effective_stats.evasion },
    { label: "SPD", base: character.base_stats.speed, effective: character.effective_stats.speed },
  ]

  // Arrow key → movement mapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (waitingForResponse) return
      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }
      const direction = dirMap[e.key]
      if (!direction) return
      const action = moveActions.find((a) => a.direction === direction)
      if (action) {
        e.preventDefault()
        onAction(action)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [moveActions, waitingForResponse, onAction])

  return (
    <main className="min-h-screen flex flex-col p-4">
      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="text-amber-400 font-bold">{realm_info.template_name}</span>
          <span>Floor {realm_info.current_floor} — Turn {observation.turn}</span>
        </div>

        {/* Main area: map + status */}
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          {/* Map */}
          <div className="md:w-2/3 border border-gray-800 rounded p-4 bg-gray-950 min-h-[200px]">
            <AsciiMap
              visibleTiles={visible_tiles}
              playerPosition={position.tile}
              entities={visible_entities}
            />
            {room_text && (
              <p className="text-gray-400 text-xs mt-3 italic border-t border-gray-800 pt-2">
                {room_text}
              </p>
            )}
          </div>

          {/* Status panel */}
          <div className="md:w-1/3 border border-gray-800 rounded p-4 space-y-4">
            {/* Character info */}
            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">
                Level {character.level} {character.class}
              </div>
              <div className="text-xs text-gray-500 mb-2">Gold: {gold}</div>
              <XpProgressBar
                xp={character.xp}
                level={character.level}
                xpToNext={character.xp_to_next_level}
                xpForNext={character.xp + character.xp_to_next_level}
                compact
              />
            </div>

            <StatusMeter
              label="HP"
              current={character.hp.current}
              max={character.hp.max}
              colorClass={hpColor}
            />

            <StatusMeter
              label={character.resource.type}
              current={character.resource.current}
              max={character.resource.max}
              colorClass={resourceColor}
            />

            {/* Stats */}
            <div className="text-xs text-gray-600 space-y-1">
              {statRows.map((stat) => (
                <div key={stat.label} className="flex justify-between gap-3">
                  <span>{stat.label}</span>
                  <span className="text-gray-300">
                    {stat.effective}
                    {stat.effective !== stat.base && (
                      <span className={stat.effective > stat.base ? "text-green-400" : "text-red-400"}>
                        {" "}
                        ({stat.effective > stat.base ? "+" : ""}
                        {stat.effective - stat.base})
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Buffs/Debuffs */}
            {(character.buffs.length > 0 || character.debuffs.length > 0) && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1">Effects</div>
                <div className="flex flex-wrap gap-2">
                  {character.buffs.map((buff, index) => (
                    <StatusEffectBadge key={`buff-${index}`} effect={buff} tone="buff" />
                  ))}
                  {character.debuffs.map((debuff, index) => (
                    <StatusEffectBadge key={`debuff-${index}`} effect={debuff} tone="debuff" />
                  ))}
                </div>
              </div>
            )}

            {visibleEnemies.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Enemies</div>
                <div className="space-y-3">
                  {visibleEnemies.map((enemy) => {
                    const enemyHpPct = enemy.hp_max ? ((enemy.hp_current ?? enemy.hp_max) / enemy.hp_max) * 100 : 0
                    const enemyEffects = enemy.effects ?? []
                    return (
                      <div
                        key={enemy.id}
                        className={`rounded border p-3 ${
                          enemy.is_boss
                            ? "border-amber-800/70 bg-amber-950/15"
                            : "border-gray-800 bg-gray-950"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-gray-200">{enemy.name}</div>
                          <EnemyBehaviorBadge behavior={enemy.behavior} isBoss={enemy.is_boss} />
                        </div>
                        <div className="mt-2">
                          <StatusMeter
                            label={enemy.is_boss ? "Boss HP" : "HP"}
                            current={enemy.hp_current ?? enemy.hp_max ?? 0}
                            max={enemy.hp_max ?? enemy.hp_current ?? 0}
                            colorClass={getHealthBarColor(enemyHpPct)}
                          />
                        </div>
                        {enemyEffects.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {enemyEffects.map((effect, index) => (
                              <StatusEffectBadge
                                key={`${enemy.id}-effect-${index}`}
                                effect={effect}
                                tone={effect.type.startsWith("buff-") ? "buff" : "debuff"}
                              />
                            ))}
                          </div>
                        )}
                        {!enemy.is_boss && enemy.behavior && (
                          <p className="mt-2 text-[11px] text-gray-500">
                            {getEnemyBehaviorHint(enemy.behavior)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">Abilities</div>
              <div className="space-y-2">
                {character.abilities.map((ability) => {
                  const usable = usableAbilityIds.has(ability.id)
                  const onCooldown = ability.current_cooldown > 0
                  const missingResource =
                    character.resource.current < ability.resource_cost && !onCooldown
                  const tone = onCooldown
                    ? "border-gray-800 bg-gray-950 text-gray-500"
                    : missingResource
                      ? "border-red-900/70 bg-red-950/30 text-red-300"
                      : usable
                        ? "border-emerald-800/70 bg-emerald-950/20 text-emerald-300"
                        : "border-gray-800 bg-gray-950 text-gray-400"

                  return (
                    <div key={ability.id} className={`rounded border p-2 text-xs ${tone}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{ability.name}</span>
                        <span className="text-[10px] uppercase tracking-wide">
                          {formatAbilityRange(ability.range)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                        <span>
                          Cost {ability.resource_cost} {character.resource.type}
                        </span>
                        <span>
                          {onCooldown
                            ? `${ability.current_cooldown}t cooldown`
                            : missingResource
                              ? "Need more resource"
                              : usable
                                ? "Ready"
                                : "No target"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">{ability.description}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Equipment */}
            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">Equipment</div>
              <div className="text-xs text-gray-600 space-y-0.5">
                {(["weapon", "armor", "accessory", "class-specific"] as const).map((slot) => (
                  <p key={slot}>
                    <span className="text-gray-500 capitalize">{slot.replace("-", " ")}:</span>{" "}
                    <span className={equipment[slot] ? "text-gray-300" : "text-gray-700"}>
                      {equipment[slot]?.name ?? "Empty"}
                    </span>
                  </p>
                ))}
              </div>
            </div>

            {/* Inventory */}
            {inventory.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-1">Inventory ({inventory.length})</div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  {inventory.map((item) => (
                    <p key={item.item_id}>{item.name} x{item.quantity}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent events */}
        {recent_events.length > 0 && (
          <div className="border border-gray-800 rounded p-3">
            <div className="text-xs text-gray-500 uppercase mb-1">Recent Events</div>
            {recent_events.slice(-8).map((e, i) => (
              <div
                key={i}
                className={`text-xs rounded border px-2 py-1 ${
                  getRecentEventPalette(e.type, i >= recent_events.length - 2)
                }`}
              >
                &gt; {e.detail}
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="border border-gray-800 rounded p-3 space-y-3">
          {waitingForResponse && (
            <p className="text-gray-500 text-xs text-center">Resolving...</p>
          )}

          {/* Movement */}
          {moveActions.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {(["up", "down", "left", "right"] as const).map((dir) => {
                const action = moveActions.find((a) => a.direction === dir)
                if (!action) return null
                const labels = { up: "Move N", down: "Move S", left: "Move W", right: "Move E" }
                return (
                  <button
                    key={dir}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {labels[dir]}
                  </button>
                )
              })}
            </div>
          )}

          {/* Attack */}
          {attackActions.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {attackActions.map((action, i) => {
                const entity = visible_entities.find((e) => e.id === action.target_id)
                const ability = abilityMap.get(action.ability_id ?? "basic-attack")
                const targetLabel = action.target_id === "self"
                  ? "Self"
                  : entity?.hp_current != null && entity.hp_max != null
                    ? `${entity.name} (${entity.hp_current}/${entity.hp_max} HP)`
                    : (entity?.name ?? action.target_id)
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className={`px-3 py-2 text-left text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      action.target_id === "self"
                        ? "bg-violet-900/50 hover:bg-violet-900 text-violet-200"
                        : "bg-red-900/50 hover:bg-red-900 text-red-200"
                    }`}
                  >
                    <div className="font-medium">{ability?.name ?? "Attack"}: {targetLabel}</div>
                    <div className="text-[11px] opacity-80">
                      {ability
                        ? `${ability.resource_cost} ${character.resource.type} • ${formatAbilityRange(ability.range)}`
                        : "Basic attack"}
                    </div>
                    {entity?.behavior && (
                      <div className="mt-1 text-[11px] opacity-70">
                        {entity.is_boss ? "Boss target" : `${entity.behavior} target`}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Interact */}
          {interactActions.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {interactActions.map((action, i) => {
                const entity = visible_entities.find((e) => e.id === action.target_id)
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Interact: {entity?.name ?? action.target_id}
                  </button>
                )
              })}
            </div>
          )}

          {/* Pickup */}
          {canPickup.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {canPickup.map((action, i) => {
                const entity = visible_entities.find((e) => e.id === action.item_id)
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Pick up {entity?.name ?? action.item_id}
                  </button>
                )
              })}
            </div>
          )}

          {/* Use Item */}
          {useItemActions.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {useItemActions.map((action, i) => {
                const item = inventory.find((it) => it.item_id === action.item_id)
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-blue-900/50 hover:bg-blue-900 text-blue-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Use {item?.name ?? action.item_id}
                  </button>
                )
              })}
            </div>
          )}

          {/* Utility: Wait, Portal, Retreat */}
          <div className="flex flex-wrap gap-2 justify-center">
            {canWait && (
              <button
                disabled={waitingForResponse}
                onClick={() => onAction({ type: "wait" })}
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Wait
              </button>
            )}
            {canPortal && (
              <button
                disabled={waitingForResponse}
                onClick={() => onAction({ type: "use_portal" })}
                className="px-3 py-1 text-xs bg-indigo-900/50 hover:bg-indigo-900 text-indigo-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use Portal
              </button>
            )}
            {canRetreat && (
              <button
                disabled={waitingForResponse}
                onClick={onRetreat}
                className="px-3 py-1 text-xs bg-indigo-900/50 hover:bg-indigo-900 text-indigo-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Retreat
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared layout wrapper
// ═══════════════════════════════════════════════════════════════════════════════

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className={`${wide ? "max-w-lg" : "max-w-md"} w-full text-center space-y-6`}>
        {children}
      </div>
    </main>
  )
}

function StatusMeter({
  label,
  current,
  max,
  colorClass,
}: {
  label: string
  current: number
  max: number
  colorClass: string
}) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500 capitalize">{label}</span>
        <span className="text-gray-400">{current}/{max}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded overflow-hidden">
        <div className={`h-full rounded ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StatusEffectBadge({
  effect,
  tone,
}: {
  effect: ActiveEffect
  tone: "buff" | "debuff"
}) {
  const palette =
    tone === "buff"
      ? "bg-emerald-950/40 border-emerald-900/60 text-emerald-300"
      : getDebuffPalette(effect.type)

  return (
    <span className={`rounded border px-2 py-1 text-[11px] ${palette}`}>
      {formatEffectLabel(effect)}
    </span>
  )
}

function getResourceBarColor(resourceType: Observation["character"]["resource"]["type"]) {
  switch (resourceType) {
    case "stamina":
      return "bg-amber-500"
    case "mana":
      return "bg-blue-500"
    case "energy":
      return "bg-emerald-500"
    case "focus":
      return "bg-violet-500"
  }
}

function getDebuffPalette(effectType: ActiveEffect["type"]) {
  switch (effectType) {
    case "poison":
      return "bg-green-950/40 border-green-900/60 text-green-300"
    case "stun":
      return "bg-yellow-950/40 border-yellow-900/60 text-yellow-300"
    case "slow":
      return "bg-blue-950/40 border-blue-900/60 text-blue-300"
    case "blind":
      return "bg-violet-950/40 border-violet-900/60 text-violet-300"
    case "buff-attack":
    case "buff-defense":
      return "bg-amber-950/40 border-amber-900/60 text-amber-300"
  }
}

function formatEffectLabel(effect: ActiveEffect) {
  const base = `${effect.type} ${effect.turns_remaining}t`
  if (effect.type === "poison") {
    return `${base} • ${effect.magnitude} dmg`
  }
  return `${base} • ${effect.magnitude}`
}

function getHealthBarColor(pct: number) {
  if (pct > 50) return "bg-green-500"
  if (pct > 25) return "bg-yellow-500"
  return "bg-red-500"
}

function getEnemyBehaviorHint(behavior: NonNullable<Observation["visible_entities"][number]["behavior"]>) {
  switch (behavior) {
    case "defensive":
      return "Defensive foes fall back and lean on self-buffs when weakened."
    case "patrol":
      return "Patrol foes stay on route until you enter their awareness range."
    case "ambush":
      return "Ambush foes hold position until you step into their kill zone."
    case "boss":
      return "Bosses change tactics as their health drops."
    case "aggressive":
      return "Aggressive foes push forward whenever they can."
  }
}

function EnemyBehaviorBadge({
  behavior,
  isBoss,
}: {
  behavior: Observation["visible_entities"][number]["behavior"] | undefined
  isBoss: boolean | undefined
}) {
  if (!behavior && !isBoss) return null

  const label = isBoss
    ? "Boss"
    : behavior === "defensive"
      ? "Defensive"
      : behavior === "patrol"
        ? "Patrol"
        : behavior === "ambush"
          ? "Ambush"
          : "Aggressive"
  const palette = isBoss
    ? "border-amber-700/70 bg-amber-950/30 text-amber-300"
    : behavior === "defensive"
      ? "border-blue-900/60 bg-blue-950/30 text-blue-300"
      : behavior === "patrol"
        ? "border-slate-800 bg-slate-950/40 text-slate-300"
        : behavior === "ambush"
          ? "border-violet-900/60 bg-violet-950/30 text-violet-300"
          : "border-red-900/60 bg-red-950/30 text-red-300"

  return (
    <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${palette}`}>
      {label}
    </span>
  )
}

function getRecentEventPalette(eventType: string, isRecent: boolean) {
  if (eventType === "boss_phase") {
    return "border-amber-800/70 bg-amber-950/20 text-amber-200"
  }
  if (eventType === "level_up") {
    return "border-yellow-700/70 bg-yellow-950/20 text-yellow-200"
  }
  return isRecent
    ? "border-gray-800 bg-gray-950 text-gray-300"
    : "border-gray-900 bg-black/20 text-gray-500"
}

function formatAbilityRange(range: number | "melee") {
  return range === "melee" ? "Melee" : `${range} tiles`
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stat range bar (class selection — shows min..max range)
// ═══════════════════════════════════════════════════════════════════════════════

function StatRangeBar({ label, min, max }: { label: string; min: number; max: number }) {
  const globalMax = 110
  const leftPct = (min / globalMax) * 100
  const widthPct = ((max - min) / globalMax) * 100

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        <div
          className="absolute h-full bg-amber-400/60 rounded-full"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
        />
      </div>
      <span className="w-14 text-gray-600 shrink-0">{min}-{max}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stat value bar (stat reveal — shows actual roll within min..max)
// ═══════════════════════════════════════════════════════════════════════════════

function StatValueBar({ label, value, min, max }: { label: string; value: number; min: number; max: number }) {
  const range = max - min
  const fillPct = range > 0 ? ((value - min) / range) * 100 : 100

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        <div
          className="absolute h-full bg-amber-400 rounded-full"
          style={{ width: `${Math.max(fillPct, 4)}%` }}
        />
      </div>
      <span className="w-20 text-gray-400 shrink-0">
        {value}{" "}
        <span className="text-gray-600">({min}-{max})</span>
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// XP Progress Bar
// ═══════════════════════════════════════════════════════════════════════════════

function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0
  const n = level - 1
  return 50 * n * n + 50 * n
}

function XpProgressBar({
  xp,
  level,
  xpToNext,
  compact,
}: {
  xp: number
  level: number
  xpToNext: number
  xpForNext?: number
  compact?: boolean
}) {
  const prevThreshold = xpThresholdForLevel(level)
  const nextThreshold = xpThresholdForLevel(level + 1)
  const gap = nextThreshold - prevThreshold
  const earned = xp - prevThreshold
  const pct = xpToNext === 0 ? 100 : gap > 0 ? Math.min((earned / gap) * 100, 100) : 0

  if (compact) {
    return (
      <div>
        <div className="flex justify-between text-[10px] mb-0.5">
          <span className="text-purple-400">LVL {level}</span>
          <span className="text-gray-500">{xpToNext > 0 ? `${xpToNext} XP to lvl ${level + 1}` : "MAX"}</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
          <div className="h-full rounded bg-purple-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-purple-400">Level {level}</span>
        <span className="text-gray-400">
          {xpToNext > 0 ? `${xp} / ${nextThreshold} XP` : `${xp} XP — MAX LEVEL`}
        </span>
      </div>
      <div className="h-2.5 bg-gray-800 rounded overflow-hidden">
        <div className="h-full rounded bg-purple-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {xpToNext > 0 && (
        <p className="text-[10px] text-gray-600 mt-0.5">
          {xpToNext} XP until level {level + 1}
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Tree Panel
// ═══════════════════════════════════════════════════════════════════════════════

function SkillTreePanel({
  progression,
  onUnlock,
  onClose,
  error,
}: {
  progression: ProgressionData
  onUnlock: (nodeId: string) => Promise<void>
  onClose: () => void
  error: string | null
}) {
  const tree = progression.skill_tree_template
  if (!tree) return null

  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Skill Tree</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-purple-400">
            {progression.skill_points} point{progression.skill_points !== 1 ? "s" : ""} available
          </span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs">
            Close
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="space-y-4">
        {tree.tiers.map((tier) => {
          const isLocked = progression.level < tier.unlock_level
          return (
            <div key={tier.tier} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500">Tier {tier.tier}</span>
                {isLocked ? (
                  <span className="text-[10px] text-red-400/70">Unlocks at level {tier.unlock_level}</span>
                ) : (
                  <span className="text-[10px] text-green-400/70">Unlocked</span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {tier.choices.map((node) => {
                  const isUnlocked = progression.skill_tree_unlocked[node.id] === true
                  const canAfford = progression.skill_points >= node.cost
                  const prereqsMet = node.prerequisites.every(
                    (p) => progression.skill_tree_unlocked[p] === true,
                  )
                  const canUnlock = !isUnlocked && !isLocked && canAfford && prereqsMet

                  return (
                    <div
                      key={node.id}
                      className={`rounded border p-3 text-xs ${
                        isUnlocked
                          ? "border-green-800/60 bg-green-950/20"
                          : canUnlock
                            ? "border-amber-800/50 bg-amber-950/10"
                            : "border-gray-800 bg-gray-950/50 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className={`font-bold ${isUnlocked ? "text-green-300" : "text-gray-300"}`}>
                          {node.name}
                        </span>
                        {isUnlocked && (
                          <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded">
                            Learned
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 mb-2">{node.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">
                          {node.effect.type === "grant-ability"
                            ? `Grants: ${node.effect.ability_id}`
                            : node.effect.type === "passive-stat"
                              ? `+${node.effect.value} ${node.effect.stat}`
                              : node.effect.type}
                        </span>
                        {canUnlock && (
                          <button
                            onClick={() => onUnlock(node.id)}
                            className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-[10px] rounded transition-colors"
                          >
                            Learn ({node.cost} pt)
                          </button>
                        )}
                        {!isUnlocked && !canUnlock && !isLocked && !prereqsMet && (
                          <span className="text-[10px] text-red-400/60">
                            Requires: {node.prerequisites.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
