"use client"

import { useIsSignedIn, useIsInitialized, useCreateEvmEoaAccount } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"
import { useAdventureAuth } from "../hooks/use-adventure-auth"
import { useCharacter } from "../hooks/use-character"
import { useRealm } from "../hooks/use-realm"
import { useGameSession } from "../hooks/use-game-session"
import { useContent } from "../hooks/use-content"
import type { ClassTemplateSummary, RealmTemplateSummary } from "../hooks/use-content"
import { AsciiMap } from "../components/ascii-map"
import { useEffect, useState, useMemo } from "react"
import type { CharacterClass, Action, Observation } from "@adventure-fun/schemas"

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
                    {cls.resource_type}
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
          <div className="bg-gray-900 border border-gray-800 rounded p-4 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-amber-400 font-bold">{character.name}</h2>
              <span className="text-gray-500 text-xs">
                Level {character.level} {classMap[character.class]?.name ?? character.class}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <p>
                <span className="text-gray-500">HP:</span>{" "}
                <span className="text-gray-300">{character.hp_current}/{character.hp_max}</span>
              </p>
              <p>
                <span className="text-gray-500">Gold:</span>{" "}
                <span className="text-gray-300">{character.gold}</span>
              </p>
              <p>
                <span className="text-gray-500 capitalize">{classMap[character.class]?.resource_type ?? "resource"}:</span>{" "}
                <span className="text-gray-300 capitalize">{character.resource_current}/{character.resource_max}</span>
              </p>
              <p>
                <span className="text-gray-500">XP:</span>{" "}
                <span className="text-gray-300">{character.xp}</span>
              </p>
            </div>
            <p className="text-xs text-gray-600">
              ATK {character.stats.attack} | DEF {character.stats.defense} | ACC {character.stats.accuracy} | EVA {character.stats.evasion} | SPD {character.stats.speed}
            </p>
          </div>

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
  const { character, position, visible_tiles, visible_entities, recent_events, legal_actions, realm_info, room_text, inventory, equipment, gold } = observation

  // Group legal actions by type
  const moveActions = legal_actions.filter((a): a is Action & { type: "move" } => a.type === "move")
  const attackActions = legal_actions.filter((a): a is Action & { type: "attack" } => a.type === "attack")
  const interactActions = legal_actions.filter((a): a is Action & { type: "interact" } => a.type === "interact")
  const useItemActions = legal_actions.filter((a): a is Action & { type: "use_item" } => a.type === "use_item")
  const canWait = legal_actions.some((a) => a.type === "wait")
  const canPortal = legal_actions.some((a) => a.type === "use_portal")
  const canRetreat = legal_actions.some((a) => a.type === "retreat")
  const canPickup = legal_actions.filter((a): a is Action & { type: "pickup" } => a.type === "pickup")

  const hpPct = character.hp.max > 0 ? (character.hp.current / character.hp.max) * 100 : 0
  const resPct = character.resource.max > 0 ? (character.resource.current / character.resource.max) * 100 : 0
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-yellow-500" : "bg-red-500"

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
              <div className="text-xs text-gray-500">XP: {character.xp} — Gold: {gold}</div>
            </div>

            {/* HP */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">HP</span>
                <span className="text-gray-400">{character.hp.current}/{character.hp.max}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded overflow-hidden">
                <div className={`h-full rounded ${hpColor}`} style={{ width: `${hpPct}%` }} />
              </div>
            </div>

            {/* Resource */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500 capitalize">{character.resource.type}</span>
                <span className="text-gray-400">{character.resource.current}/{character.resource.max}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded overflow-hidden">
                <div className="h-full bg-blue-500 rounded" style={{ width: `${resPct}%` }} />
              </div>
            </div>

            {/* Stats */}
            <div className="text-xs text-gray-600 space-y-0.5">
              <p>ATK {character.base_stats.attack} | DEF {character.base_stats.defense}</p>
              <p>ACC {character.base_stats.accuracy} | EVA {character.base_stats.evasion}</p>
              <p>SPD {character.base_stats.speed}</p>
            </div>

            {/* Buffs/Debuffs */}
            {(character.buffs.length > 0 || character.debuffs.length > 0) && (
              <div className="text-xs space-y-1">
                {character.buffs.map((b, i) => (
                  <span key={i} className="text-green-400 mr-2">{b.type} ({b.turns_remaining}t)</span>
                ))}
                {character.debuffs.map((d, i) => (
                  <span key={i} className="text-red-400 mr-2">{d.type} ({d.turns_remaining}t)</span>
                ))}
              </div>
            )}

            {/* Equipment */}
            <div>
              <div className="text-xs text-gray-500 uppercase mb-1">Equipment</div>
              <div className="text-xs text-gray-600 space-y-0.5">
                {(["weapon", "armor", "accessory", "class_specific"] as const).map((slot) => (
                  <p key={slot}>
                    <span className="text-gray-500 capitalize">{slot.replace("_", " ")}:</span>{" "}
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
                className={`text-xs ${i >= recent_events.length - 2 ? "text-gray-300" : "text-gray-500"}`}
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
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Attack {entity?.name ?? action.target_id}
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
