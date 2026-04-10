"use client"

import Link from "next/link"
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
import { useShop } from "../hooks/use-shop"
import { useInn } from "../hooks/use-inn"
import { AsciiMap } from "../components/ascii-map"
import { PaymentModal } from "../components/payment-modal"
import { UiToast } from "../components/ui-toast"
import { useUsdcBalance } from "../hooks/use-usdc-balance"
import { useEffect, useState, useMemo, useRef } from "react"
import {
  getInventoryCapacity,
  type CharacterClass,
  type EquipSlot,
  type Action,
  type Observation,
  type ActiveEffect,
  type InventoryItem,
  type ItemTemplate,
  type Tile,
} from "@adventure-fun/schemas"

const STAT_KEYS = ["hp", "attack", "defense", "accuracy", "evasion", "speed"] as const
const STAT_LABELS: Record<string, string> = {
  hp: "HP", attack: "Attack", defense: "Defense",
  accuracy: "Accuracy", evasion: "Evasion", speed: "Speed",
}
const CLASS_ROLE_LABELS: Record<CharacterClass, string> = {
  knight: "Tank",
  mage: "Glass Cannon",
  rogue: "Burst DPS",
  archer: "Marksman",
}
const REALM_STATUS_LABELS: Record<string, string> = {
  generated: "Ready", active: "In Progress", paused: "Paused",
  boss_cleared: "Boss Cleared", realm_cleared: "Cleared", completed: "Completed", dead_end: "Lost",
}
function formatItemQuantity(name: string, quantity: number, templateId?: string): string {
  if (templateId?.startsWith("ammo-")) return `${name} (${quantity})`
  return `${name} x${quantity}`
}
const REALM_REGEN_GOLD_COST = 100
const REALM_REGEN_USDC_PRICE = "0.25"
const TUTORIAL_TEMPLATE_ID = "tutorial-cellar"
const EQUIP_SLOT_ORDER: EquipSlot[] = ["weapon", "armor", "accessory", "class-specific"]
const EQUIP_SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "Weapon",
  armor: "Armor",
  accessory: "Accessory",
  "class-specific": "Class Slot",
}

type PageStep = "loading" | "class-select" | "name-input" | "stat-reveal" | "hub" | "dungeon"
type PendingPayment =
  | { kind: "reroll" }
  | { kind: "generate"; templateId: string; templateName: string }
  | { kind: "regenerate"; realmId: string; realmName: string }
  | { kind: "inn-rest" }
  | null

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function friendlyPaymentError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes("rejected") || normalized.includes("cancelled")) {
    return "Payment was cancelled before settlement completed."
  }
  if (normalized.includes("insufficient")) {
    return "There is not enough USDC available to settle this payment yet."
  }
  if (normalized.includes("network") || normalized.includes("timeout")) {
    return "The payment network is taking too long to respond. Please try again in a moment."
  }
  return message
}

type RealmCompletionStatus = Observation["realm_info"]["status"] | undefined

function isRealmComplete(status: RealmCompletionStatus): status is "boss_cleared" | "realm_cleared" {
  return status === "boss_cleared" || status === "realm_cleared"
}

function getExtractionHint(
  status: RealmCompletionStatus,
  canPortal: boolean,
  canRetreat: boolean,
  hasPortalScroll: boolean,
) {
  if (!isRealmComplete(status)) {
    return null
  }

  const completionLead = status === "realm_cleared" ? "Realm cleared." : "Boss defeated."
  if (canPortal) {
    return hasPortalScroll
      ? `${completionLead} Use your portal scroll to escape, return to the first room to exit back to town, or keep delving for more loot.`
      : `${completionLead} Your portal is ready.`
  }

  if (canRetreat) {
    return `${completionLead} You can retreat safely from the entrance.`
  }

  return `${completionLead} Find a portal scroll or return to the first-floor entrance to escape.`
}

function getCompletionBonusText(status: RealmCompletionStatus) {
  return status === "boss_cleared"
    ? "for clearing the realm boss."
    : "for completing the realm."
}

export default function PlayPage() {
  const { isInitialized } = useIsInitialized()
  const { isSignedIn } = useIsSignedIn()
  const {
    account,
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
    regenerateRealm,
  } = useRealm()

  const gameSession = useGameSession()

  const {
    progression,
    fetchProgression,
    unlockSkill,
    error: progressionError,
  } = useProgression()

  const {
    sections: shopSections,
    featured: featuredShopItems,
    inventory: shopInventory,
    gold: shopGold,
    isLoading: shopLoading,
    error: shopError,
    fetchShopCatalog,
    fetchInventory,
    buyItem,
    sellItem,
    equipItem,
    unequipItem,
  } = useShop()

  const {
    isLoading: innLoading,
    error: innError,
    restAtInn,
  } = useInn()

  const {
    realmTemplates,
    classTemplates,
    itemTemplates,
    fetchRealmTemplates,
    fetchClassTemplates,
    fetchItemTemplates,
  } = useContent()

  const { createEvmEoaAccount } = useCreateEvmEoaAccount()
  const {
    balanceLabel,
    refetch: refetchUsdcBalance,
    isTestnet: isX402Testnet,
  } = useUsdcBalance()

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
  const [hubTab, setHubTab] = useState<"realms" | "shop">("realms")
  const [pendingPayment, setPendingPayment] = useState<PendingPayment>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null)
  const [paymentToast, setPaymentToast] = useState<string | null>(null)
  const [shopMessage, setShopMessage] = useState<string | null>(null)
  const [innMessage, setInnMessage] = useState<string | null>(null)

  // Fetch content on mount (public, no auth needed)
  useEffect(() => {
    fetchClassTemplates()
    fetchRealmTemplates()
    fetchItemTemplates()
    fetchShopCatalog()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const itemTemplateMap = useMemo(
    () =>
      Object.fromEntries(itemTemplates.map((item) => [item.id, item])) as Record<string, ItemTemplate>,
    [itemTemplates],
  )
  const tutorialTemplate = realmTemplateMap[TUTORIAL_TEMPLATE_ID]

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
          fetchInventory()
          setStep("hub")
        } else {
          setStep("class-select")
        }
      })
    }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!paymentToast) return
    const timer = window.setTimeout(() => setPaymentToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [paymentToast])

  // Return to hub helper (after death/extraction)
  const returnToHub = () => {
    gameSession.disconnect()
    fetchCharacter().then((c) => {
      if (c) {
        fetchRealms()
        fetchProgression()
        fetchInventory()
        setStep("hub")
      } else {
        setStep("class-select")
      }
    })
  }

  const enterHubAfterCreation = async () => {
    setCreateError(null)
    setRealmError(null)

    const [loadedRealms] = await Promise.all([
      fetchRealms(),
      fetchProgression(),
      fetchInventory(),
    ])

    const hasTutorialRealm = loadedRealms.some((realm) => realm.template_id === TUTORIAL_TEMPLATE_ID)
    if (!hasTutorialRealm) {
      setGeneratingTemplate(TUTORIAL_TEMPLATE_ID)
      const result = await generateRealm(TUTORIAL_TEMPLATE_ID)
      setGeneratingTemplate(null)
      if (result.error) {
        setCreateError(result.error)
        return
      }
    }

    setStep("hub")
  }

  const closePaymentModal = () => {
    if (isProcessingPayment) return
    setPendingPayment(null)
    setPaymentError(null)
    setPaymentSuccess(null)
  }

  const confirmPendingPayment = async () => {
    if (!pendingPayment) return
    setIsProcessingPayment(true)
    setPaymentError(null)
    setPaymentSuccess(null)
    setPaymentToast(null)

    try {
      let successMessage = "Payment settled."
      if (pendingPayment.kind === "reroll") {
        const result = await rerollStats()
        if (result.message) {
          setRerollMessage(result.message)
          setRerollDisabled(true)
          if (!result.character) {
            setPaymentError(friendlyPaymentError(result.message))
            return
          }
        } else {
          setRerollMessage("Payment settled and stats re-rolled.")
          setRerollDisabled(true)
        }
        successMessage = "Payment settled. Your hero's stats have been re-rolled."
      } else if (pendingPayment.kind === "generate") {
        setGeneratingTemplate(pendingPayment.templateId)
        const result = await generateRealm(pendingPayment.templateId)
        if (result.error) {
          setRealmError(result.error)
          setPaymentError(friendlyPaymentError(result.error))
          return
        }
        successMessage = `${pendingPayment.templateName} is now woven into the world.`
      } else if (pendingPayment.kind === "regenerate") {
        setGeneratingTemplate(pendingPayment.realmId)
        const result = await regenerateRealm(pendingPayment.realmId)
        if (result.error) {
          setRealmError(result.error)
          setPaymentError(friendlyPaymentError(result.error))
          return
        }
        await Promise.all([fetchCharacter(), fetchRealms()])
        successMessage = `${pendingPayment.realmName} has been regenerated with a fresh layout, enemies, and loot.`
      } else if (pendingPayment.kind === "inn-rest") {
        const result = await restAtInn()
        if (!result.ok) {
          setPaymentError(friendlyPaymentError(result.error))
          return
        }
        setInnMessage(result.data.message)
        await fetchCharacter()
        successMessage = "Payment settled. The inn restores you to fighting form."
      }

      if (pendingPayment.kind === "generate") {
        await fetchRealms()
      }
      setPaymentSuccess(successMessage)
      await refetchUsdcBalance()
      await fetchInventory()
      await delay(950)
      setPendingPayment(null)
      setPaymentToast(successMessage)
    } catch (err) {
      const message = friendlyPaymentError(err instanceof Error ? err.message : "Payment failed")
      setPaymentError(message)
      if (pendingPayment.kind === "generate" || pendingPayment.kind === "regenerate") {
        setRealmError(message)
      } else if (pendingPayment.kind === "reroll") {
        setRerollMessage(message)
      } else {
        setInnMessage(message)
      }
    } finally {
      setGeneratingTemplate(null)
      setIsProcessingPayment(false)
      setPaymentSuccess(null)
    }
  }

  // SDK still loading
  if (!isInitialized) {
    return (
      <Shell>
        <UiToast open={!!paymentToast} tone="success" title="Payment Complete" message={paymentToast ?? ""} onClose={() => setPaymentToast(null)} />
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
        <UiToast open={!!paymentToast} tone="success" title="Payment Complete" message={paymentToast ?? ""} onClose={() => setPaymentToast(null)} />
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
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-amber-400">{cls.name}</h2>
                    <span className="rounded-full border border-sky-700/70 bg-sky-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">
                      {CLASS_ROLE_LABELS[cls.id as CharacterClass]}
                    </span>
                  </div>
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
                      <StatRangeBar
                        key={stat}
                        stat={stat}
                        label={STAT_LABELS[stat]!}
                        min={range[0]}
                        max={range[1]}
                      />
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
      if (rerollDisabled) return
      if (character.stat_rerolled) {
        setRerollMessage("Stats already rerolled. Once per character.")
        setRerollDisabled(true)
        return
      }
      setPaymentError(null)
      setPendingPayment({ kind: "reroll" })
    }

    return (
      <>
        <UiToast
          open={!!paymentToast}
          tone="success"
          title="Payment Complete"
          message={paymentToast ?? ""}
          onClose={() => setPaymentToast(null)}
        />
        <Shell wide>
          <AccountPanel
            walletAddress={evmAddress}
            handle={account?.handle}
            balanceLabel={balanceLabel}
            isTestnet={isX402Testnet}
            onLogout={logout}
          />
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
                  stat={stat}
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
              enterHubAfterCreation().catch((err) => {
                setCreateError(err instanceof Error ? err.message : "Failed to prepare the tutorial realm")
              })
            }}
            disabled={charLoading || generatingTemplate === TUTORIAL_TEMPLATE_ID}
            className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            {generatingTemplate === TUTORIAL_TEMPLATE_ID ? "Preparing Tutorial..." : "Enter the Dungeon"}
          </button>
        </Shell>
        <PaymentModal
          open={pendingPayment?.kind === "reroll"}
          title="Confirm Stat Re-roll"
          description="Approve a 0.10 USDC x402 payment to re-roll this character's starting stats."
          priceUsd="0.10"
          balanceLabel={balanceLabel}
          isProcessing={isProcessingPayment}
          successMessage={paymentSuccess}
          error={paymentError}
          onCancel={closePaymentModal}
          onConfirm={confirmPendingPayment}
        />
      </>
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            {gameSession.observation?.character.id ? (
              <Link
                href={`/legends/${gameSession.observation.character.id}`}
                className="rounded border border-amber-500/50 px-6 py-2 text-sm font-semibold text-amber-200 transition-colors hover:border-amber-400 hover:bg-amber-500/10"
              >
                View your legend
              </Link>
            ) : null}
            <button
              onClick={returnToHub}
              className="px-8 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
            >
              Return to Hub
            </button>
          </div>
        </Shell>
      )
    }

    // Extraction screen
    if (gameSession.isExtracted && gameSession.extractData) {
      const {
        realm_completed,
        completion_bonus,
        xp_gained,
        gold_gained,
        loot_summary,
      } = gameSession.extractData
      const completionStatus = gameSession.observation?.realm_info.status
      const title = realm_completed ? "REALM COMPLETED" : "YOU ESCAPED ALIVE"
      const titleColor = realm_completed ? "text-amber-300" : "text-green-400"
      const borderColor = realm_completed ? "border-amber-900/50" : "border-green-900/50"
      const panelTone = realm_completed ? "bg-amber-950/20" : "bg-gray-900"
      const flavorText = realm_completed
        ? "The realm yields its bounty as you return in triumph."
        : "You live to fight another day."
      return (
        <Shell>
          <h1 className={`text-3xl font-bold ${titleColor}`}>{title}</h1>
          <div className={`${panelTone} border ${borderColor} rounded p-4 text-sm space-y-3 text-left`}>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-gray-800 bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">XP Reward</div>
                <div className="mt-1 text-lg font-semibold text-gray-200">{xp_gained}</div>
              </div>
              <div className="rounded border border-gray-800 bg-black/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Gold Reward</div>
                <div className="mt-1 text-lg font-semibold text-gray-200">{gold_gained}</div>
              </div>
            </div>
            {completion_bonus && (
              <div className="rounded border border-amber-900/60 bg-amber-950/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-amber-400">Completion Bonus</div>
                <div className="mt-1 text-gray-200">
                  +{completion_bonus.xp} XP and +{completion_bonus.gold} gold {getCompletionBonusText(completionStatus)}
                </div>
              </div>
            )}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Recovered Loot</div>
              {loot_summary.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {loot_summary.map((item) => (
                    <div
                      key={item.item_id}
                      className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-black/20 px-3 py-2"
                    >
                      <span className="text-gray-200">{item.name}</span>
                      <span className="text-xs text-gray-500">{item.template_id?.startsWith("ammo-") ? `(${item.quantity})` : `x${item.quantity}`}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-gray-500">No items were carried out this run.</p>
              )}
            </div>
          </div>
          <p className="text-gray-500 text-sm italic">{flavorText}</p>
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
      const activeRealm = realms.find((r) => r.status === "active" || r.status === "paused")
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-amber-400">CONNECTION LOST</h1>
          <p className="text-red-400 text-sm">{gameSession.error}</p>
          <div className="bg-gray-900 border border-gray-800 rounded p-3 text-sm text-gray-400 max-w-sm mx-auto">
            <p>Your progress has been saved. Enemy positions, combat state, and all items are preserved.</p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={returnToHub}
              className="px-6 py-2 border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors"
            >
              Return to Hub
            </button>
            {activeRealm && (
              <button
                onClick={() => gameSession.connect(activeRealm.id)}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
              >
                Reconnect
              </button>
            )}
          </div>
        </Shell>
      )
    }

    // Connecting
    if (gameSession.isConnecting || !gameSession.observation) {
      return (
        <Shell>
          <h1 className="text-3xl font-bold text-amber-400">ADVENTURE.FUN</h1>
          <p className="text-gray-400">
            {realms.some((r) => r.status === "paused")
              ? "Restoring session..."
              : "Entering realm..."}
          </p>
          <div className="w-16 h-1 bg-gray-800 rounded overflow-hidden mx-auto">
            <div className="h-full bg-amber-500 animate-pulse rounded" style={{ width: "60%" }} />
          </div>
        </Shell>
      )
    }

    // Active dungeon
    return (
      <DungeonView
        observation={gameSession.observation}
        itemTemplateMap={itemTemplateMap}
        waitingForResponse={gameSession.waitingForResponse}
        actionError={gameSession.actionError}
        walletAddress={evmAddress}
        accountHandle={account?.handle}
        balanceLabel={balanceLabel}
        isTestnet={isX402Testnet}
        onLogout={logout}
        onAction={gameSession.sendAction}
        onRetreat={() => {
          gameSession.sendAction({ type: "retreat" })
        }}
        onDismissError={gameSession.clearActionError}
      />
    )
  }

  // ── Character hub ────────────────────────────────────────────────────────────
  if (step === "hub" && character) {
    const hubHpPct = character.hp_max > 0 ? (character.hp_current / character.hp_max) * 100 : 0
    const hubHpColor = hubHpPct > 50 ? "bg-green-500" : hubHpPct > 25 ? "bg-yellow-500" : "bg-red-500"
    const resourceLabel = classMap[character.class]?.resource_type ?? "resource"
    const canRestAtInn =
      character.hp_current < character.hp_max || character.resource_current < character.resource_max
    const displayedGold = shopGold ?? character.gold
    const tutorialCompleted = realms.some(
      (realm) => realm.template_id === TUTORIAL_TEMPLATE_ID && realm.status === "completed",
    )
    const tutorialRealm = realms.find((realm) => realm.template_id === TUTORIAL_TEMPLATE_ID) ?? null
    const realmStatusOrder: Record<string, number> = {
      active: 0, paused: 0, generated: 1, completed: 2, dead_end: 3,
    }
    const visibleRealmEntries = (tutorialCompleted
      ? realms
      : realms.filter((realm) => realm.template_id === TUTORIAL_TEMPLATE_ID)
    ).slice().sort((a, b) => {
      // Tutorial realms always last
      const aTut = a.template_id === TUTORIAL_TEMPLATE_ID ? 1 : 0
      const bTut = b.template_id === TUTORIAL_TEMPLATE_ID ? 1 : 0
      if (aTut !== bTut) return aTut - bTut
      // Then by status: active/paused first, then ready, then completed/dead
      return (realmStatusOrder[a.status] ?? 9) - (realmStatusOrder[b.status] ?? 9)
    })
    const realmGenerationTemplates = tutorialCompleted
      ? realmTemplates.filter((template) => !template.is_tutorial)
      : realmTemplates.filter((template) => template.is_tutorial)
    const lockedRealmTemplates = tutorialCompleted
      ? []
      : realmTemplates.filter((template) => !template.is_tutorial)

    const handleGenerateRealm = async (templateId: string) => {
      setRealmError(null)
      const templateName = realmTemplateMap[templateId]?.name ?? "Realm"
      const isTutorialTemplate = realmTemplateMap[templateId]?.is_tutorial === true
      const shouldCharge = !isTutorialTemplate && (realms.length > 0 || account?.free_realm_used)

      if (shouldCharge) {
        setPaymentError(null)
        setPendingPayment({ kind: "generate", templateId, templateName })
        return
      }

      setGeneratingTemplate(templateId)
      const result = await generateRealm(templateId)
      setGeneratingTemplate(null)
      if (result.error) {
        setRealmError(result.error)
      }
    }

    const handleRegenerateRealm = (realmId: string, realmName: string) => {
      setRealmError(null)
      if (displayedGold < REALM_REGEN_GOLD_COST) {
        setRealmError(`Requires ${REALM_REGEN_GOLD_COST} gold to regenerate this realm.`)
        return
      }

      setPaymentError(null)
      setPendingPayment({ kind: "regenerate", realmId, realmName })
    }

    const handleEnterRealm = (realmId: string) => {
      gameSession.connect(realmId)
      setStep("dungeon")
    }

    const handleBuyItem = async (itemId: string, quantity: number) => {
      const result = await buyItem(itemId, quantity)
      if (result.ok) {
        setShopMessage(result.message)
        await fetchCharacter()
      } else {
        setShopMessage(result.error)
      }
    }

    const handleSellItem = async (itemId: string, quantity: number) => {
      const result = await sellItem(itemId, quantity)
      if (result.ok) {
        setShopMessage(result.message)
        await fetchCharacter()
      } else {
        setShopMessage(result.error)
      }
    }

    const handleEquipLobbyItem = async (itemId: string) => {
      const result = await equipItem(itemId)
      if (result.ok) {
        setShopMessage(result.message)
        await fetchCharacter()
      } else {
        setShopMessage(result.error)
      }
    }

    const handleUnequipLobbySlot = async (slot: EquipSlot) => {
      const result = await unequipItem(slot)
      if (result.ok) {
        setShopMessage(result.message)
        await fetchCharacter()
      } else {
        setShopMessage(result.error)
      }
    }

    return (
      <>
        <UiToast
          open={!!paymentToast}
          tone="success"
          title="Payment Complete"
          message={paymentToast ?? ""}
          onClose={() => setPaymentToast(null)}
        />
        <main className="min-h-screen flex flex-col items-center p-8">
          <div className="max-w-5xl w-full space-y-6">
            <AccountPanel
              walletAddress={evmAddress}
              handle={account?.handle}
              balanceLabel={balanceLabel}
              isTestnet={isX402Testnet}
              onLogout={logout}
            />
          <h1 className="text-3xl font-bold text-amber-400 text-center">ADVENTURE.FUN</h1>

          <div className="grid gap-6 xl:grid-cols-[1.9fr_1fr]">
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
                  <span className="text-amber-300 font-semibold transition-colors">{displayedGold}</span>
                </p>
                <p>
                  <span className="text-gray-500">XP:</span>{" "}
                  <span className="text-gray-300">{character.xp}</span>
                </p>
              </div>

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

              <GearManagementPanel
                inventory={shopInventory}
                itemTemplateMap={itemTemplateMap}
                characterClass={character.class}
                isLoading={shopLoading}
                onEquip={handleEquipLobbyItem}
                onUnequip={handleUnequipLobbySlot}
              />

              {(character.lore_discovered?.length ?? 0) > 0 && (
                <div className="rounded border border-amber-900/40 bg-amber-950/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-300/70">Lore Journal</p>
                    <span className="text-[11px] text-amber-200/70">
                      {character.lore_discovered?.length} discovered
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-gray-300">
                    {[...(character.lore_discovered ?? [])]
                      .sort((left, right) => right.discovered_at_turn - left.discovered_at_turn)
                      .slice(0, 6)
                      .map((entry) => (
                        <div key={entry.lore_entry_id} className="flex items-center justify-between gap-3">
                          <span>{formatLoreLabel(entry.lore_entry_id)}</span>
                          <span className="text-[11px] text-gray-500">Turn {entry.discovered_at_turn}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {progression && progression.skill_points > 0 && (
                <button
                  onClick={() => setShowSkillTree(true)}
                  className="w-full text-xs text-center py-1.5 rounded border border-amber-700/50 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40 transition-colors"
                >
                  {progression.skill_points} skill point{progression.skill_points !== 1 ? "s" : ""} available — View Skill Tree
                </button>
              )}
            </div>

            <div className="rounded border border-amber-900/40 bg-gradient-to-br from-amber-950/30 via-gray-900 to-gray-950 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-amber-300/60">Inn</p>
                  <h3 className="text-lg font-bold text-amber-200">Hearth & Rest</h3>
                </div>
                <span className="rounded-full border border-amber-600/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                  $0.05
                </span>
              </div>
              <p className="text-sm text-gray-400">
                Recover fully before the next dive. The innkeeper patches wounds, restores {resourceLabel}, and sends you back out ready.
              </p>
              {innMessage ? (
                <p className={`text-xs ${canRestAtInn ? "text-green-300" : "text-gray-500"}`}>{innMessage}</p>
              ) : null}
              {innError ? <p className="text-xs text-red-400">{innError}</p> : null}
              <button
                type="button"
                disabled={!canRestAtInn || innLoading}
                onClick={() => {
                  setPaymentError(null)
                  setInnMessage(null)
                  setPendingPayment({ kind: "inn-rest" })
                }}
                className="w-full rounded bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {canRestAtInn ? "Rest at the Inn" : "Already Fully Rested"}
              </button>
            </div>
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

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {[
                  { id: "realms", label: "Realms" },
                  { id: "shop", label: "Shop" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setHubTab(tab.id as "realms" | "shop")}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      hubTab === tab.id
                        ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
                        : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {shopMessage ? <p className="text-xs text-gray-400">{shopMessage}</p> : null}
            </div>

            {hubTab === "realms" ? (
              <div className="space-y-3">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Realms</h2>

                {realmsLoading && <p className="text-gray-500 text-sm">Loading realms...</p>}
                {realmsError && <p className="text-red-400 text-sm">{realmsError}</p>}
                {realmError && <p className="text-red-400 text-sm">{realmError}</p>}
                {!tutorialCompleted && (
                  <div className="rounded border border-amber-900/40 bg-amber-950/10 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-amber-200">Tutorial First</p>
                        <p className="mt-1 text-gray-400">
                          New adventurers begin in {tutorialTemplate?.name ?? "the tutorial realm"}.
                          Finish it to unlock the full realm roster.
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-700/50 bg-emerald-950/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                        Always Free
                      </span>
                    </div>
                  </div>
                )}
                {tutorialCompleted && tutorialRealm && (
                  <div className="rounded border border-emerald-900/40 bg-emerald-950/10 p-4 text-sm text-emerald-200">
                    Tutorial complete. New realms are now open, and {tutorialTemplate?.name ?? "The Cellar"} can be replayed from its completed card whenever you want a refresher run.
                  </div>
                )}

                {visibleRealmEntries.map((realm) => {
                  const template = realmTemplateMap[realm.template_id]
                  const realmName = template?.name ?? realm.template_id
                  const statusLabel = REALM_STATUS_LABELS[realm.status] ?? realm.status
                  const canEnter = realm.status === "generated" || realm.status === "paused" || realm.status === "active"
                  const isPaused = realm.status === "paused" || realm.status === "active"
                  const canRegenerate = realm.status === "completed" && !template?.is_tutorial
                  const canAffordRegeneration = displayedGold >= REALM_REGEN_GOLD_COST
                  const isRegenerating = generatingTemplate === realm.id
                  const statusColor = realm.status === "completed"
                    ? "text-green-500"
                    : realm.status === "dead_end"
                      ? "text-red-500"
                      : isPaused
                        ? "text-amber-400"
                        : "text-gray-600"

                  return (
                    <div
                      key={realm.id}
                      className={`bg-gray-900 border rounded p-4 flex items-center justify-between ${
                        isPaused ? "border-amber-900/40" : "border-gray-800"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-gray-300 text-sm font-bold">{realmName}</p>
                          {template?.is_tutorial && (
                            <span className="rounded-full border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                              Tutorial
                            </span>
                          )}
                        </div>
                        <p className={`text-xs ${statusColor}`}>
                          {statusLabel} — Floor {realm.floor_reached}
                        </p>
                        {template?.is_tutorial && !tutorialCompleted && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            Clear this introductory run to unlock deeper realms and paid expeditions.
                          </p>
                        )}
                        {isPaused && (
                          <p className="text-gray-600 text-xs mt-0.5">
                            Session saved — pick up where you left off
                          </p>
                        )}
                        {canRegenerate && (
                          <div className="mt-1.5 space-y-1 text-xs">
                            <p className="text-amber-200/80">
                              Replay cost: {REALM_REGEN_GOLD_COST} gold + ${REALM_REGEN_USDC_PRICE} USDC
                            </p>
                            <p className="text-gray-500">
                              Fully resets the realm with a new seed, enemies, and loot. Current gold: {displayedGold}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {canEnter && (
                          <button
                            onClick={() => handleEnterRealm(realm.id)}
                            className={`px-4 py-1 font-bold text-sm rounded transition-colors ${
                              isPaused
                                ? "bg-amber-500 hover:bg-amber-400 text-black"
                                : "bg-green-600 hover:bg-green-500 text-white"
                            }`}
                          >
                            {isPaused ? "Resume" : "Enter"}
                          </button>
                        )}
                        {canRegenerate && (
                          <button
                            type="button"
                            onClick={() => handleRegenerateRealm(realm.id, realmName)}
                            disabled={!canAffordRegeneration || isProcessingPayment || !!generatingTemplate}
                            title={
                              canAffordRegeneration
                                ? "Reset this completed realm with a new seed."
                                : `Requires ${REALM_REGEN_GOLD_COST} gold`
                            }
                            className="px-4 py-1 border border-cyan-700/70 bg-cyan-950/20 text-cyan-200 text-sm font-bold rounded transition-colors hover:bg-cyan-900/30 disabled:border-gray-700 disabled:bg-transparent disabled:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isRegenerating
                              ? "Regenerating..."
                              : `Regenerate (${REALM_REGEN_GOLD_COST}g + $${REALM_REGEN_USDC_PRICE})`}
                          </button>
                        )}
                        {canRegenerate && !canAffordRegeneration && (
                          <p className="text-[11px] text-red-400">
                            Requires {REALM_REGEN_GOLD_COST} gold
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}

                {realmGenerationTemplates.map((template) => {
                  const existing = realms.find((r) => r.template_id === template.id)
                  if (existing && existing.status !== "completed" && existing.status !== "dead_end") return null

                  const isFree = template.is_tutorial || !realms.some((r) => r.is_free)

                  return (
                    <div
                      key={template.id}
                      className="bg-gray-900/50 border border-dashed border-gray-700 rounded p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <p className="text-gray-400 text-sm font-bold">{template.name}</p>
                          {template.is_tutorial && (
                            <span className="rounded-full border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                              Tutorial
                            </span>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${isFree ? "bg-green-900/50 text-green-400" : "text-gray-500"}`}>
                          {template.is_tutorial ? "Always Free" : isFree ? "Free" : "$0.25"}
                        </span>
                      </div>
                      <p className="text-gray-600 text-xs mb-3">{template.description}</p>
                      {!tutorialCompleted && template.is_tutorial && (
                        <p className="mb-3 text-xs text-amber-200/80">
                          Start here to learn movement, extraction, and your first gear pickup.
                        </p>
                      )}
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

                {!tutorialCompleted && lockedRealmTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="bg-gray-900/30 border border-dashed border-gray-800 rounded p-4 opacity-80"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-gray-500 text-sm font-bold">{template.name}</p>
                      <span className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-500">
                        Locked
                      </span>
                    </div>
                    <p className="text-gray-600 text-xs mb-3">{template.description}</p>
                    <p className="text-xs text-gray-500">
                      Complete {tutorialTemplate?.name ?? "the tutorial"} to unlock this realm.
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <ShopPanel
                sections={shopSections}
                featured={featuredShopItems}
                inventory={shopInventory}
                gold={displayedGold}
                isLoading={shopLoading}
                error={shopError}
                onBuy={handleBuyItem}
                onSell={handleSellItem}
              />
            )}
          </div>

          <button
            onClick={logout}
            className="text-sm text-gray-600 hover:text-gray-400 transition-colors"
          >
            Disconnect
          </button>
          </div>
        </main>
        <PaymentModal
          open={
            pendingPayment?.kind === "generate" ||
            pendingPayment?.kind === "regenerate" ||
            pendingPayment?.kind === "inn-rest"
          }
          title={
            pendingPayment?.kind === "inn-rest"
              ? "Confirm Inn Rest"
              : pendingPayment?.kind === "regenerate"
                ? "Confirm Realm Regeneration"
                : "Confirm Realm Purchase"
          }
          description={
            pendingPayment?.kind === "inn-rest"
              ? `Approve a 0.05 USDC x402 payment to rest at the inn and restore your HP and ${resourceLabel} to full.`
              : pendingPayment?.kind === "regenerate"
                ? `Approve a ${REALM_REGEN_USDC_PRICE} USDC x402 payment and spend ${REALM_REGEN_GOLD_COST} gold to fully reset ${pendingPayment.realmName}. This creates a fresh layout with new enemies and loot for a new run.`
                : `Approve a 0.25 USDC x402 payment to generate ${pendingPayment?.kind === "generate" ? pendingPayment.templateName : "this realm"}. The tutorial remains free, while advanced realms use your normal realm payment flow.`
          }
          priceUsd={
            pendingPayment?.kind === "inn-rest"
              ? "0.05"
              : pendingPayment?.kind === "regenerate"
                ? REALM_REGEN_USDC_PRICE
                : "0.25"
          }
          balanceLabel={balanceLabel}
          isProcessing={isProcessingPayment || !!generatingTemplate || innLoading}
          successMessage={paymentSuccess}
          error={paymentError}
          onCancel={closePaymentModal}
          onConfirm={confirmPendingPayment}
        />
      </>
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
  itemTemplateMap,
  waitingForResponse,
  actionError,
  walletAddress,
  accountHandle,
  balanceLabel,
  isTestnet,
  onLogout,
  onAction,
  onRetreat,
  onDismissError,
}: {
  observation: Observation
  itemTemplateMap: Record<string, ItemTemplate>
  waitingForResponse: boolean
  actionError: string | null
  walletAddress: string | null | undefined
  accountHandle: string | undefined
  balanceLabel: string
  isTestnet: boolean
  onLogout: () => void
  onAction: (action: Action) => void
  onRetreat: () => void
  onDismissError: () => void
}) {
  const observationWithNewItems = observation as Observation & { new_item_ids?: string[] }
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
    inventory_slots_used,
    inventory_capacity,
    equipment,
    gold,
  } = observation

  // Group legal actions by type
  const moveActions = legal_actions.filter((a): a is Action & { type: "move" } => a.type === "move")
  const attackActions = legal_actions.filter((a): a is Action & { type: "attack" } => a.type === "attack")
  const disarmTrapActions = legal_actions.filter(
    (a) => (a as { type: string }).type === "disarm_trap",
  ) as unknown as Array<{ type: "disarm_trap"; item_id: string }>
  const interactActions = legal_actions.filter((a): a is Action & { type: "interact" } => a.type === "interact")
  const useItemActions = legal_actions.filter((a): a is Action & { type: "use_item" } => a.type === "use_item")
  const equipActions = legal_actions.filter((a): a is Action & { type: "equip" } => a.type === "equip")
  const unequipActions = legal_actions.filter((a): a is Action & { type: "unequip" } => a.type === "unequip")
  const canWait = legal_actions.some((a) => a.type === "wait")
  const canPortal = legal_actions.some((a) => a.type === "use_portal")
  const canRetreat = legal_actions.some((a) => a.type === "retreat")
  const canPickup = legal_actions.filter((a): a is Action & { type: "pickup" } => a.type === "pickup")
  const portalScroll = inventory.find((item) => item.template_id === "portal-scroll")
  const portalLabel = portalScroll
    ? `Use Portal Scroll${portalScroll.quantity > 1 ? ` (${portalScroll.quantity})` : ""}`
    : "Step Through Portal"
  const extractionHint = getExtractionHint(realm_info.status, canPortal, canRetreat, portalScroll != null)
  const usableAbilityIds = new Set(attackActions.map((action) => action.ability_id ?? "basic-attack"))
  const abilityMap = new Map(character.abilities.map((ability) => [ability.id, ability]))
  const disarmAbility = abilityMap.get("rogue-disarm-trap")
  const disarmableItemIds = new Set(disarmTrapActions.map((action) => action.item_id))
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
  const nearbyItems = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "item" } =>
      entity.type === "item",
  )
  const visibleTrapMarkers = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "trap_visible" } =>
      entity.type === "trap_visible",
  )
  const visibleInteractables = visible_entities.filter(
    (entity): entity is Observation["visible_entities"][number] & { type: "interactable" } =>
      entity.type === "interactable",
  )
  const dungeonXpToNext =
    "xp_to_next_level" in character && typeof character.xp_to_next_level === "number"
      ? character.xp_to_next_level
      : 0

  const hpPct = character.hp.max > 0 ? (character.hp.current / character.hp.max) * 100 : 0
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-yellow-500" : "bg-red-500"
  const resourceColor = getResourceBarColor(character.resource.type)
  const inventoryNearlyFull = inventory_slots_used >= Math.max(1, inventory_capacity - 2)
  const floorCanAscend = realm_info.current_floor > 1
  const floorCanDescend = realm_info.current_floor < realm_info.floor_count
  const adjacentStairHint = useMemo(() => {
    const adjacentStair = visible_tiles.find((tile) => {
      const distance = Math.abs(tile.x - position.tile.x) + Math.abs(tile.y - position.tile.y)
      return distance === 1 && (tile.type === "stairs" || tile.type === "stairs_up")
    })
    if (!adjacentStair) return null

    if (adjacentStair.type === "stairs_up") {
      return {
        label: `Stairs up lead back to floor ${Math.max(1, realm_info.current_floor - 1)}.`,
        tone: "border-sky-800/70 bg-sky-950/20 text-sky-200",
      }
    }

    return {
      label: `Stairs down lead to floor ${Math.min(realm_info.floor_count, realm_info.current_floor + 1)}.`,
      tone: "border-cyan-800/70 bg-cyan-950/20 text-cyan-200",
    }
  }, [position.tile, realm_info.current_floor, realm_info.floor_count, visible_tiles])
  const newItemIds = useMemo(
    () => new Set(observationWithNewItems.new_item_ids ?? []),
    [observationWithNewItems.new_item_ids],
  )
  const equipActionByItemId = useMemo(
    () => new Map(equipActions.map((action) => [action.item_id, action])),
    [equipActions],
  )
  const unequipActionBySlot = useMemo(
    () => new Map(unequipActions.map((action) => [action.slot, action])),
    [unequipActions],
  )
  const statRows = [
    { label: "ATK", base: character.base_stats.attack, effective: character.effective_stats.attack },
    { label: "DEF", base: character.base_stats.defense, effective: character.effective_stats.defense },
    { label: "ACC", base: character.base_stats.accuracy, effective: character.effective_stats.accuracy },
    { label: "EVA", base: character.base_stats.evasion, effective: character.effective_stats.evasion },
    { label: "SPD", base: character.base_stats.speed, effective: character.effective_stats.speed },
  ]

  // Fog-of-war: accumulate visible tiles so previously-seen areas stay on the map (dimmed)
  const tileAccumRef = useRef<Map<string, Tile>>(new Map())
  const lastRoomRef = useRef<string>("")

  const currentRoomId = position.room_id
  if (currentRoomId !== lastRoomRef.current) {
    tileAccumRef.current = new Map()
    lastRoomRef.current = currentRoomId
  }
  const visibleKeySet = new Set<string>()
  for (const tile of visible_tiles) {
    const key = `${tile.x},${tile.y}`
    visibleKeySet.add(key)
    tileAccumRef.current.set(key, tile)
  }
  const knownTiles = useMemo(() => {
    const result: Tile[] = []
    for (const [key, tile] of tileAccumRef.current) {
      if (!visibleKeySet.has(key)) result.push(tile)
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible_tiles])

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
        <AccountPanel
          walletAddress={walletAddress}
          handle={accountHandle}
          balanceLabel={balanceLabel}
          isTestnet={isTestnet}
          onLogout={onLogout}
        />
        {/* Header */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="text-amber-400 font-bold">{realm_info.template_name}</span>
          <span className="flex items-center gap-2">
            <span>
              Floor {realm_info.current_floor} / {realm_info.floor_count}
            </span>
            <span className="text-gray-600">
              {floorCanAscend ? "↑" : "·"}
              {floorCanDescend ? "↓" : "·"}
            </span>
            <span>Turn {observation.turn}</span>
          </span>
        </div>
        {extractionHint && (
          <div className="rounded border border-amber-800/70 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            <div className="font-semibold uppercase tracking-wide text-[11px] text-amber-400">
              Extraction Ready
            </div>
            <p className="mt-1">{extractionHint}</p>
          </div>
        )}
        {adjacentStairHint && (
          <div className={`rounded border px-4 py-3 text-sm ${adjacentStairHint.tone}`}>
            <div className="font-semibold uppercase tracking-wide text-[11px]">Stairway Nearby</div>
            <p className="mt-1">{adjacentStairHint.label}</p>
          </div>
        )}

        {/* Main area: map + status */}
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          {/* Map */}
          <div className="md:w-2/3 border border-gray-800 rounded p-4 bg-gray-950 min-h-[200px]">
            <AsciiMap
              visibleTiles={visible_tiles}
              knownTiles={knownTiles}
              playerPosition={position.tile}
              entities={visible_entities}
            />
            {visibleInteractables.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-2">
                {visibleInteractables.map((entity) => (
                  <span
                    key={entity.id}
                    className="rounded-full border border-amber-800/60 bg-amber-950/20 px-3 py-1 text-[11px] text-amber-200"
                    title="Room-wide interactable"
                  >
                    ! {entity.name}
                  </span>
                ))}
              </div>
            )}
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
                xpToNext={dungeonXpToNext}
                xpForNext={character.xp + dungeonXpToNext}
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

            {(nearbyItems.length > 0 || visibleTrapMarkers.length > 0) && (
              <div>
                <div className="text-xs text-gray-500 uppercase mb-2">Nearby Objects</div>
                <div className="space-y-2">
                  {nearbyItems.map((item) => (
                    <div key={item.id} className="rounded border border-gray-800 bg-gray-950 p-2 text-xs">
                      {(() => {
                        const isTrapped = (item as { trapped?: boolean }).trapped === true
                        return (
                          <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-200">{item.name}</span>
                        {isTrapped && (
                          <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
                            Trap detected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {isTrapped
                          ? "A Rogue can disarm this before looting it."
                          : "Safe to pick up from an adjacent tile."}
                      </p>
                          </>
                        )
                      })()}
                    </div>
                  ))}
                  {visibleTrapMarkers.map((trap) => (
                    <div
                      key={trap.id}
                      className="rounded border border-red-900/70 bg-red-950/20 p-2 text-xs text-red-200"
                    >
                      <div className="font-medium">{trap.name}</div>
                      <p className="mt-1 text-[11px] text-red-300/80">
                        The trap’s location is now marked on the floor.
                      </p>
                    </div>
                  ))}
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

            <DungeonEquipmentPanel
              inventory={inventory}
              equipment={equipment}
              itemTemplateMap={itemTemplateMap}
              inventorySlotsUsed={inventory_slots_used}
              inventoryCapacity={inventory_capacity}
              newItemIds={newItemIds}
              equipActionByItemId={equipActionByItemId}
              unequipActionBySlot={unequipActionBySlot}
              waitingForResponse={waitingForResponse}
              onAction={onAction}
            />
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
                  getRecentEventPalette(e, i >= recent_events.length - 2)
                }`}
              >
                {getRecentEventLead(e)} {e.detail}
              </div>
            ))}
          </div>
        )}

        {/* Action error toast */}
        {actionError && (
          <button
            onClick={onDismissError}
            className="w-full rounded border border-red-800/70 bg-red-950/30 px-4 py-2 text-sm text-red-200 text-left transition-opacity hover:bg-red-950/50"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{actionError}</span>
              <span className="text-red-400 text-xs shrink-0">dismiss</span>
            </div>
          </button>
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

          {/* Trap utility */}
          {disarmTrapActions.length > 0 && (
            <div className="space-y-2">
              <div className="text-center text-[11px] uppercase tracking-wide text-teal-400">
                Trap Utility
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {disarmTrapActions.map((action, i) => {
                  const entity = visible_entities.find((e) => e.id === action.item_id)
                  return (
                    <button
                      key={i}
                      disabled={waitingForResponse}
                      onClick={() => onAction(action as unknown as Action)}
                      className="px-3 py-2 text-left text-xs bg-teal-950/50 hover:bg-teal-900/60 text-teal-200 rounded border border-teal-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="font-medium">Disarm Trap: {entity?.name ?? action.item_id}</div>
                      <div className="text-[11px] opacity-80">
                        Costs {disarmAbility?.resource_cost ?? 1} {character.resource.type}
                      </div>
                    </button>
                  )
                })}
              </div>
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
                const itemRarity =
                  entity?.type === "item" && "rarity" in entity && typeof entity.rarity === "string"
                    ? entity.rarity
                    : null
                return (
                  <button
                    key={i}
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="px-3 py-1 text-xs bg-amber-900/50 hover:bg-amber-900 text-amber-300 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2">
                      <span>Pick up {entity?.name ?? action.item_id}</span>
                      {itemRarity && (
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${getItemRarityBadgePalette(itemRarity)}`}
                        >
                          {itemRarity}
                        </span>
                      )}
                      {disarmableItemIds.has(action.item_id) && (
                        <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200">
                          Trapped
                        </span>
                      )}
                    </div>
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
                className="px-3 py-2 text-left text-xs bg-indigo-900/60 hover:bg-indigo-900 text-indigo-200 rounded border border-indigo-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="font-medium">{portalLabel}</div>
                <div className="text-[11px] opacity-80">
                  {portalScroll ? "Consumes 1 scroll and ends the run safely." : "Escape through the active portal."}
                </div>
              </button>
            )}
            {canRetreat && (
              <button
                disabled={waitingForResponse}
                onClick={onRetreat}
                className="px-3 py-2 text-left text-xs bg-slate-900/70 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="font-medium">Retreat to Town</div>
                <div className="text-[11px] opacity-80">Available only from the first-floor entrance.</div>
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-gray-600">
            Portal escape requires a portal scroll. Retreat works only from the first-floor entrance.
          </p>
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

function AccountPanel({
  walletAddress,
  handle,
  balanceLabel,
  isTestnet,
  onLogout,
}: {
  walletAddress: string | null | undefined
  handle: string | undefined
  balanceLabel: string
  isTestnet: boolean
  onLogout: () => void
}) {
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "Wallet unavailable"
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded border border-gray-800 bg-gray-900/80 p-3 text-left text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-amber-400">{handle || "Adventurer"}</span>
            {isTestnet ? (
              <span className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-300">
                Testnet
              </span>
            ) : null}
          </div>
          <div className="text-gray-400">
            Wallet:{" "}
            {walletAddress ? (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(walletAddress).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }).catch(() => {})
                }}
                className="cursor-pointer text-gray-400 underline decoration-dotted underline-offset-2 hover:text-amber-300"
                title="Click to copy full address"
              >
                {copied ? "Copied!" : shortWallet}
              </button>
            ) : (
              shortWallet
            )}
          </div>
          <div className="text-gray-400">USDC: {balanceLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(walletAddress).catch(() => {})}
              className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition-colors hover:border-gray-500"
            >
              Copy Address
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-gray-700 px-2 py-1 text-gray-300 transition-colors hover:border-gray-500"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
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

export function DungeonEquipmentPanel({
  inventory,
  equipment,
  itemTemplateMap,
  inventorySlotsUsed,
  inventoryCapacity,
  newItemIds,
  equipActionByItemId,
  unequipActionBySlot,
  waitingForResponse,
  onAction,
}: {
  inventory: Observation["inventory"]
  equipment: Observation["equipment"]
  itemTemplateMap: Record<string, ItemTemplate>
  inventorySlotsUsed: number
  inventoryCapacity: number
  newItemIds: Set<string>
  equipActionByItemId: Map<string, Extract<Action, { type: "equip" }>>
  unequipActionBySlot: Map<EquipSlot, Extract<Action, { type: "unequip" }>>
  waitingForResponse: boolean
  onAction: (action: Action) => void
}) {
  const inventoryNearlyFull = inventorySlotsUsed >= Math.max(1, inventoryCapacity - 2)

  return (
    <>
      <div>
        <div className="text-xs text-gray-500 uppercase mb-1">Equipment</div>
        <div className="space-y-2 text-xs">
          {EQUIP_SLOT_ORDER.map((slot) => {
            const item = equipment[slot]
            const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
            const action = unequipActionBySlot.get(slot)
            return (
              <div
                key={slot}
                className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-950/50 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-gray-500">{EQUIP_SLOT_LABELS[slot]}</p>
                  <p className={item ? "truncate text-gray-300" : "text-gray-700"}>
                    {item?.name ?? "Empty"}
                  </p>
                  {template?.stats ? (
                    <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                  ) : null}
                </div>
                {item && action ? (
                  <button
                    type="button"
                    disabled={waitingForResponse}
                    onClick={() => onAction(action)}
                    className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Unequip
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="text-xs text-gray-500 uppercase">
            Inventory ({inventorySlotsUsed}/{inventoryCapacity})
          </div>
          {inventorySlotsUsed >= inventoryCapacity && (
            <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
              Full
            </span>
          )}
          {inventorySlotsUsed < inventoryCapacity && inventoryNearlyFull && (
            <span className="rounded border border-amber-800/70 bg-amber-950/20 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">
              Nearly full
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 space-y-2">
          {inventory.length > 0 ? (
            inventory.map((item) => {
              const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
              const equipAction = equipActionByItemId.get(item.item_id)
              const equippedInSlot =
                template?.type === "equipment" && template.equip_slot
                  ? equipment[template.equip_slot]
                  : null

              return (
                <div
                  key={item.item_id}
                  className="flex items-start justify-between gap-3 rounded border border-gray-800 bg-gray-950/50 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate">
                        {formatItemQuantity(item.name, item.quantity, item.template_id)}
                      </p>
                      {template?.type === "equipment" && template.equip_slot ? (
                        <span className="rounded border border-blue-800/60 bg-blue-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">
                          {EQUIP_SLOT_LABELS[template.equip_slot]}
                        </span>
                      ) : null}
                      {newItemIds.has(item.item_id) && (
                        <span className="rounded border border-emerald-800/70 bg-emerald-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                          New
                        </span>
                      )}
                    </div>
                    {template?.stats ? (
                      <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                    ) : null}
                  </div>
                  {equipAction ? (
                    <button
                      type="button"
                      disabled={waitingForResponse}
                      onClick={() => onAction(equipAction)}
                      title={template ? getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap) : undefined}
                      className="rounded border border-cyan-700/70 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Equip
                    </button>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="text-gray-600">Pack is empty.</p>
          )}
        </div>
      </div>
    </>
  )
}

export function GearManagementPanel({
  inventory,
  itemTemplateMap,
  characterClass,
  isLoading,
  onEquip,
  onUnequip,
}: {
  inventory: InventoryItem[]
  itemTemplateMap: Record<string, ItemTemplate>
  characterClass: CharacterClass
  isLoading: boolean
  onEquip: (itemId: string) => Promise<void>
  onUnequip: (slot: EquipSlot) => Promise<void>
}) {
  const equippedItems = Object.fromEntries(
    EQUIP_SLOT_ORDER.map((slot) => [slot, inventory.find((item) => item.slot === slot) ?? null]),
  ) as Record<EquipSlot, InventoryItem | null>
  const bagItems = inventory.filter((item) => !item.slot)
  const bagCapacity = getInventoryCapacity()
  const bagFull = bagItems.length >= bagCapacity

  return (
    <div className="rounded border border-gray-800 bg-gray-950/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Equipment and Inventory</p>
          <p className="text-[11px] text-gray-600">{bagItems.length}/{bagCapacity} bag slots used</p>
        </div>
        {bagFull ? (
          <span className="rounded border border-red-800/70 bg-red-950/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-200">
            Bag full
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        {EQUIP_SLOT_ORDER.map((slot) => {
          const item = equippedItems[slot]
          const template = item ? safeGetItemTemplate(item.template_id, itemTemplateMap) : null
          return (
            <div
              key={slot}
              className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="text-gray-500">{EQUIP_SLOT_LABELS[slot]}</p>
                <p className={item ? "truncate text-gray-200" : "text-gray-600"}>{item?.name ?? "Empty"}</p>
                {template?.stats ? (
                  <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                ) : null}
              </div>
              {item ? (
                <button
                  type="button"
                  disabled={isLoading || bagFull}
                  onClick={() => void onUnequip(slot)}
                  title={bagFull ? "Free a bag slot before unequipping." : `Unequip ${item.name}`}
                  className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Unequip
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Bag Gear</p>
          <span className="text-[11px] text-gray-600">Unequip here, then sell in the shop</span>
        </div>
        {bagItems.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 p-3 text-center text-xs text-gray-500">
            Your pack is empty.
          </div>
        ) : (
          <div className="space-y-2">
            {bagItems.map((item) => {
              const template = safeGetItemTemplate(item.template_id, itemTemplateMap)
              const canEquip = template?.type === "equipment" && !!template.equip_slot
              const classLocked =
                canEquip && template.class_restriction && template.class_restriction !== characterClass
              const equippedInSlot =
                canEquip && template.equip_slot ? equippedItems[template.equip_slot] : null

              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-200">{item.name}</p>
                      {canEquip && template.equip_slot ? (
                        <span className="rounded border border-blue-800/60 bg-blue-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">
                          {EQUIP_SLOT_LABELS[template.equip_slot]}
                        </span>
                      ) : null}
                      {classLocked ? (
                        <span className="rounded border border-violet-800/60 bg-violet-950/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-200">
                          {template.class_restriction} only
                        </span>
                      ) : null}
                    </div>
                    <p className="text-gray-500">{item.template_id?.startsWith("ammo-") ? `(${item.quantity})` : `x${item.quantity}`}</p>
                    {template?.stats ? (
                      <p className="text-[11px] text-gray-500">{formatItemStats(template.stats)}</p>
                    ) : null}
                  </div>
                  {canEquip ? (
                    <button
                      type="button"
                      disabled={isLoading || Boolean(classLocked)}
                      onClick={() => void onEquip(item.id)}
                      title={getEquipComparisonTitle(template, equippedInSlot, itemTemplateMap)}
                      className="rounded border border-cyan-700/70 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Equip
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ShopPanel({
  sections,
  featured,
  inventory,
  gold,
  isLoading,
  error,
  onBuy,
  onSell,
}: {
  sections: Array<{ id: "consumable" | "equipment"; label: string; items: ItemTemplate[] }>
  featured: ItemTemplate[]
  inventory: InventoryItem[]
  gold: number
  isLoading: boolean
  error: string | null
  onBuy: (itemId: string, quantity: number) => Promise<void>
  onSell: (itemId: string, quantity: number) => Promise<void>
}) {
  const [category, setCategory] = useState<"all" | "consumable" | "equipment">("all")
  const [buyQuantities, setBuyQuantities] = useState<Record<string, number>>({})
  const [sellQuantities, setSellQuantities] = useState<Record<string, number>>({})

  const visibleSections = category === "all"
    ? sections
    : sections.filter((section) => section.id === category)

  const bagSlotsUsed = inventory.filter((item) => !item.slot).length
  const bagCapacity = getInventoryCapacity()

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Lobby Shop</h2>
              <p className="text-xs text-gray-600">Buy supplies before the next descent.</p>
            </div>
            <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200">
              Gold: {gold}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All" },
              { id: "consumable", label: "Consumables" },
              { id: "equipment", label: "Equipment" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id as "all" | "consumable" | "equipment")}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  category === tab.id
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
                    : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {isLoading ? <p className="text-sm text-gray-500">Loading shop inventory...</p> : null}

          {featured.length > 0 ? (
            <div className="rounded border border-amber-900/30 bg-amber-950/10 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-300/70">Featured Gear</p>
              <div className="flex flex-wrap gap-2">
                {featured.slice(0, 4).map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-300"
                  >
                    {item.name} · {item.buy_price}g
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {visibleSections.map((section) => (
              <div key={section.id} className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{section.label}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {section.items.map((item) => {
                    const quantity = buyQuantities[item.id] ?? 1
                    const canStack = inventory.some(
                      (inventoryItem) =>
                        !inventoryItem.slot
                        && inventoryItem.template_id === item.id
                        && inventoryItem.quantity < item.stack_limit,
                    )
                    const inventoryFull = bagSlotsUsed >= bagCapacity && !canStack
                    const tooExpensive = gold < item.buy_price * quantity
                    const disabled = tooExpensive || inventoryFull

                    return (
                      <div
                        key={item.id}
                        className="rounded border border-gray-800 bg-gray-950/60 p-3 text-xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-gray-100">{item.name}</p>
                            <p className="mt-1 text-gray-500">{item.description}</p>
                          </div>
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                            {item.buy_price}g
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 text-[10px]">
                          <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                            {item.rarity}
                          </span>
                          <span className="rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                            stack {item.stack_limit}
                          </span>
                          {item.class_restriction ? (
                            <span className="rounded-full border border-purple-700/40 bg-purple-950/30 px-2 py-1 text-purple-300">
                              {item.class_restriction} only
                            </span>
                          ) : null}
                        </div>

                        {item.stats && Object.keys(item.stats).length > 0 ? (
                          <div className="text-[11px] text-gray-400">
                            {Object.entries(item.stats)
                              .map(([stat, value]) => `${stat.toUpperCase()} ${value}`)
                              .join(" · ")}
                          </div>
                        ) : null}

                        <div className="flex items-center justify-between gap-3">
                          <select
                            value={quantity}
                            onChange={(event) =>
                              setBuyQuantities((current) => ({
                                ...current,
                                [item.id]: Number(event.target.value),
                              }))}
                            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
                          >
                            {Array.from({ length: Math.min(item.stack_limit, 5) }, (_, index) => index + 1).map((value) => (
                              <option key={value} value={value}>
                                Qty {value}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={disabled || isLoading}
                            onClick={() => onBuy(item.id, quantity)}
                            className="rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              inventoryFull
                                ? "Inventory full"
                                : tooExpensive
                                  ? "Not enough gold"
                                  : undefined
                            }
                          >
                            Buy
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Sell Inventory</h3>
              <p className="text-xs text-gray-600">{bagSlotsUsed}/{bagCapacity} bag slots used</p>
            </div>
            <span className="text-xs text-gray-500">Equipped items stay protected</span>
          </div>

          <div className="space-y-3">
            {inventory.length === 0 ? (
              <div className="rounded border border-dashed border-gray-700 p-4 text-center text-sm text-gray-500">
                Your pack is empty.
              </div>
            ) : (
              inventory.map((item) => {
                const quantity = Math.min(sellQuantities[item.id] ?? 1, item.quantity)
                const isEquipped = Boolean(item.slot)

                return (
                  <div key={item.id} className="rounded border border-gray-800 bg-gray-950/70 p-3 text-xs space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-gray-100">{item.name}</p>
                        <p className="text-gray-500">{item.quantity} in bag</p>
                      </div>
                      {isEquipped ? (
                        <span className="rounded-full border border-blue-700/40 bg-blue-950/30 px-2 py-1 text-[10px] text-blue-200">
                          Equipped
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <select
                        value={quantity}
                        disabled={isEquipped}
                        onChange={(event) =>
                          setSellQuantities((current) => ({
                            ...current,
                            [item.id]: Number(event.target.value),
                          }))}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 disabled:opacity-40"
                      >
                        {Array.from({ length: item.quantity }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>
                            Sell {value}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isEquipped || isLoading}
                        onClick={() => {
                          if (window.confirm(`Sell ${quantity} ${item.name}${quantity === 1 ? "" : "s"}?`)) {
                            void onSell(item.id, quantity)
                          }
                        }}
                        className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Sell
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
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

function getRecentEventPalette(
  event: Observation["recent_events"][number],
  isRecent: boolean,
) {
  if (event.type === "floor_change") {
    return event.detail.startsWith("Ascended")
      ? "border-sky-800/70 bg-sky-950/20 text-sky-200"
      : "border-cyan-800/70 bg-cyan-950/20 text-cyan-200"
  }
  if (event.type === "boss_phase") {
    return "border-amber-800/70 bg-amber-950/20 text-amber-200"
  }
  if (event.type === "realm_clear") {
    return "border-emerald-800/70 bg-emerald-950/20 text-emerald-200"
  }
  if (event.type === "level_up") {
    return "border-yellow-700/70 bg-yellow-950/20 text-yellow-200"
  }
  if (event.type === "trap_triggered") {
    return "border-red-800/70 bg-red-950/20 text-red-200"
  }
  if (event.type === "trap_disarmed") {
    return "border-teal-800/70 bg-teal-950/20 text-teal-200"
  }
  if (event.type === "pickup") {
    return "border-amber-700/70 bg-amber-950/20 text-amber-200"
  }
  if (event.type === "pickup_blocked") {
    return "border-red-900/70 bg-red-950/30 text-red-200"
  }
  if (event.type === "interact" && event.data?.category === "lore") {
    return "border-amber-800/70 bg-amber-950/20 text-amber-200"
  }
  if (event.type === "use_item" && event.detail.includes("layout of this entire floor")) {
    return "border-indigo-800/70 bg-indigo-950/20 text-indigo-200"
  }
  return isRecent
    ? "border-gray-800 bg-gray-950 text-gray-300"
    : "border-gray-900 bg-black/20 text-gray-500"
}

function getRecentEventLead(event: Observation["recent_events"][number]) {
  if (event.type === "floor_change") {
    return event.detail.startsWith("Ascended") ? "↑" : "↓"
  }
  return ">"
}

function formatAbilityRange(range: number | "melee") {
  return range === "melee" ? "Melee" : `${range} tiles`
}

function getItemRarityBadgePalette(rarity: string) {
  switch (rarity) {
    case "common":
      return "border-gray-700/70 bg-gray-950/30 text-gray-300"
    case "uncommon":
      return "border-emerald-800/70 bg-emerald-950/20 text-emerald-200"
    case "rare":
      return "border-blue-800/70 bg-blue-950/20 text-blue-200"
    case "epic":
      return "border-violet-800/70 bg-violet-950/20 text-violet-200"
  }
}

function safeGetItemTemplate(
  templateId: string,
  itemTemplateMap: Record<string, ItemTemplate>,
): ItemTemplate | null {
  return itemTemplateMap[templateId] ?? null
}

function formatItemStats(stats: ItemTemplate["stats"] | undefined) {
  if (!stats) return null
  const entries = Object.entries(stats).filter(([, value]) => typeof value === "number" && value !== 0)
  if (entries.length === 0) return null
  return entries
    .map(([stat, value]) => `${value > 0 ? "+" : ""}${value} ${STAT_LABELS[stat] ?? stat.toUpperCase()}`)
    .join(" · ")
}

function getEquipComparisonTitle(
  template: ItemTemplate,
  equippedItem: { template_id: string; name: string } | null | undefined,
  itemTemplateMap: Record<string, ItemTemplate>,
) {
  const slotLabel = template.equip_slot ? EQUIP_SLOT_LABELS[template.equip_slot] : "Slot"
  const incomingStats = formatItemStats(template.stats) ?? "no stat bonuses"
  if (!equippedItem) {
    return `${slotLabel}: empty -> ${template.name} (${incomingStats})`
  }

  const equippedTemplate = safeGetItemTemplate(equippedItem.template_id, itemTemplateMap)
  const equippedStats = formatItemStats(equippedTemplate?.stats) ?? "no stat bonuses"
  return `${slotLabel}: ${template.name} (${incomingStats}) replaces ${equippedItem.name} (${equippedStats})`
}

function formatLoreLabel(loreId: string) {
  return loreId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stat range bar (class selection — shows min..max range)
// ═══════════════════════════════════════════════════════════════════════════════

function getStatDisplayMax(stat: typeof STAT_KEYS[number]) {
  return stat === "hp" ? 50 : 25
}

function getRollQualityTone(fillPct: number) {
  if (fillPct >= 67) return "bg-emerald-400"
  if (fillPct >= 34) return "bg-amber-400"
  return "bg-rose-400"
}

function StatRangeBar({
  stat,
  label,
  min,
  max,
}: {
  stat: typeof STAT_KEYS[number]
  label: string
  min: number
  max: number
}) {
  const globalMax = getStatDisplayMax(stat)
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

function StatValueBar({
  stat,
  label,
  value,
  min,
  max,
}: {
  stat: typeof STAT_KEYS[number]
  label: string
  value: number
  min: number
  max: number
}) {
  const range = max - min
  const fillPct = range > 0 ? ((value - min) / range) * 100 : 100
  const trackMax = getStatDisplayMax(stat)
  const leftPct = (min / trackMax) * 100
  const widthPct = ((max - min) / trackMax) * 100
  const qualityWidthPct = Math.max((widthPct * fillPct) / 100, 4)
  const qualityTone = getRollQualityTone(fillPct)

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full relative overflow-hidden">
        <div
          className="absolute h-full rounded-full bg-gray-700/70"
          style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%` }}
        />
        <div
          className={`absolute h-full rounded-full ${qualityTone}`}
          style={{ left: `${leftPct}%`, width: `${qualityWidthPct}%` }}
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
  const nextLockedTier = tree.tiers.find((tier) => progression.level < tier.unlock_level)
  const bankedPointsMessage =
    progression.skill_points > 0 && nextLockedTier
      ? `You have ${progression.skill_points} point${progression.skill_points !== 1 ? "s" : ""} banked. Tier ${nextLockedTier.tier} unlocks at level ${nextLockedTier.unlock_level}.`
      : null

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
      {bankedPointsMessage && (
        <p className="rounded border border-violet-800/60 bg-violet-950/20 px-3 py-2 text-xs text-violet-200">
          {bankedPointsMessage}
        </p>
      )}

      <div className="space-y-4">
        {tree.tiers.map((tier) => {
          const isLocked = progression.level < tier.unlock_level
          const chosenNode = tier.choices.find((node) => progression.skill_tree_unlocked[node.id] === true) ?? null
          return (
            <div key={tier.tier} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500">Tier {tier.tier}</span>
                {isLocked ? (
                  <span className="text-[10px] text-red-400/70">Unlocks at level {tier.unlock_level}</span>
                ) : (
                  <span className="text-[10px] text-green-400/70">Unlocked</span>
                )}
                {chosenNode ? (
                  <span className="text-[10px] text-blue-300/80">Choice made: {chosenNode.name}</span>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {tier.choices.map((node) => {
                  const isUnlocked = progression.skill_tree_unlocked[node.id] === true
                  const blockedByTierChoice = Boolean(chosenNode && chosenNode.id !== node.id)
                  const canAfford = progression.skill_points >= node.cost
                  const prereqsMet = node.prerequisites.every(
                    (p) => progression.skill_tree_unlocked[p] === true,
                  )
                  const canUnlock = !isUnlocked && !isLocked && !blockedByTierChoice && canAfford && prereqsMet

                  return (
                    <div
                      key={node.id}
                      className={`rounded border p-3 text-xs ${
                        isUnlocked
                          ? "border-green-800/60 bg-green-950/20"
                          : blockedByTierChoice
                            ? "border-slate-800 bg-slate-950/40 opacity-50"
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
                        {!isUnlocked && blockedByTierChoice && (
                          <span className="text-[10px] text-slate-400">
                            Another choice was made in this tier.
                          </span>
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
