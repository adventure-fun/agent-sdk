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
import { useShop } from "../hooks/use-shop"
import { useInn } from "../hooks/use-inn"
import { PaymentModal } from "../components/payment-modal"
import { UiToast } from "../components/ui-toast"
import { useUsdcBalance } from "../hooks/use-usdc-balance"
import { useEffect, useMemo } from "react"
import {
  type CharacterClass,
  type EquipSlot,
  type ItemTemplate,
} from "@adventure-fun/schemas"

import { usePlayStore } from "./store"
import { STAT_KEYS, STAT_LABELS, CLASS_ROLE_LABELS, REALM_STATUS_LABELS, REALM_REGEN_USDC_PRICE, TUTORIAL_TEMPLATE_ID, EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS } from "./constants"
import { delay, friendlyPaymentError, formatLoreLabel, getCompletionBonusText } from "./utils"

import { Shell } from "./components/shell"
import { StatRangeBar, StatValueBar } from "./components/stat-bars"
import { CharacterPanel } from "./components/character-panel"
import { GearManagementPanel } from "./components/gear-management-panel"
import { ShopPanel } from "./components/shop-panel"
import { SkillTreePanel } from "./components/skill-tree-panel"
import { DungeonView } from "./components/dungeon-view"

// Re-export for tests
export { DungeonEquipmentPanel } from "./components/dungeon-equipment-panel"
export { GearManagementPanel } from "./components/gear-management-panel"

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
    discardItem,
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
    loreEntries,
    fetchRealmTemplates,
    fetchClassTemplates,
    fetchItemTemplates,
    fetchLoreEntries,
  } = useContent()

  const { createEvmEoaAccount } = useCreateEvmEoaAccount()
  const {
    balanceLabel,
    refetch: refetchUsdcBalance,
    isTestnet: isX402Testnet,
  } = useUsdcBalance()

  // Zustand store
  const step = usePlayStore((s) => s.step)
  const selectedClass = usePlayStore((s) => s.selectedClass)
  const name = usePlayStore((s) => s.name)
  const nameError = usePlayStore((s) => s.nameError)
  const showConfirm = usePlayStore((s) => s.showConfirm)
  const createError = usePlayStore((s) => s.createError)
  const rerollMessage = usePlayStore((s) => s.rerollMessage)
  const rerollDisabled = usePlayStore((s) => s.rerollDisabled)
  const generatingTemplate = usePlayStore((s) => s.generatingTemplate)
  const realmError = usePlayStore((s) => s.realmError)
  const showSkillTree = usePlayStore((s) => s.showSkillTree)
  const hubTab = usePlayStore((s) => s.hubTab)
  const pendingPayment = usePlayStore((s) => s.pendingPayment)
  const isProcessingPayment = usePlayStore((s) => s.isProcessingPayment)
  const paymentError = usePlayStore((s) => s.paymentError)
  const paymentSuccess = usePlayStore((s) => s.paymentSuccess)
  const paymentToast = usePlayStore((s) => s.paymentToast)
  const shopMessage = usePlayStore((s) => s.shopMessage)
  const innMessage = usePlayStore((s) => s.innMessage)
  const viewingLoreId = usePlayStore((s) => s.viewingLoreId)

  const store = usePlayStore

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

  const itemTemplateMap = useMemo(
    () =>
      Object.fromEntries(itemTemplates.map((item) => [item.id, item])) as Record<string, ItemTemplate>,
    [itemTemplates],
  )
  const loreMap = useMemo(
    () => Object.fromEntries(loreEntries.map((l) => [l.id, l])) as Record<string, { id: string; name: string; text: string }>,
    [loreEntries],
  )
  const tutorialTemplate = realmTemplateMap[TUTORIAL_TEMPLATE_ID]

  // Fetch content on mount (public, no auth needed)
  useEffect(() => {
    fetchClassTemplates()
    fetchRealmTemplates()
    fetchItemTemplates()
    fetchLoreEntries()
    fetchShopCatalog()
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
          fetchInventory()
          store.getState().setStep("hub")
        } else {
          store.getState().setStep("class-select")
        }
      })
    }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!paymentToast) return
    const timer = window.setTimeout(() => store.getState().setPaymentToast(null), 2600)
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
        store.getState().setStep("hub")
      } else {
        store.getState().setStep("class-select")
      }
    })
  }

  const enterHubAfterCreation = async () => {
    store.getState().setCreateError(null)
    store.getState().setRealmError(null)

    const [loadedRealms] = await Promise.all([
      fetchRealms(),
      fetchProgression(),
      fetchInventory(),
    ])

    const hasTutorialRealm = loadedRealms.some((realm) => realm.template_id === TUTORIAL_TEMPLATE_ID)
    if (!hasTutorialRealm) {
      store.getState().setGeneratingTemplate(TUTORIAL_TEMPLATE_ID)
      const result = await generateRealm(TUTORIAL_TEMPLATE_ID)
      store.getState().setGeneratingTemplate(null)
      if (result.error) {
        store.getState().setCreateError(result.error)
        return
      }
    }

    store.getState().setStep("hub")
  }

  const confirmPendingPayment = async () => {
    const payment = store.getState().pendingPayment
    if (!payment) return
    store.getState().setIsProcessingPayment(true)
    store.getState().setPaymentError(null)
    store.getState().setPaymentSuccess(null)
    store.getState().setPaymentToast(null)

    try {
      let successMessage = "Payment settled."
      if (payment.kind === "reroll") {
        const result = await rerollStats()
        if (result.message) {
          store.getState().setRerollMessage(result.message)
          store.getState().setRerollDisabled(true)
          if (!result.character) {
            store.getState().setPaymentError(friendlyPaymentError(result.message))
            return
          }
        } else {
          store.getState().setRerollMessage("Payment settled and stats re-rolled.")
          store.getState().setRerollDisabled(true)
        }
        successMessage = "Payment settled. Your hero's stats have been re-rolled."
      } else if (payment.kind === "generate") {
        store.getState().setGeneratingTemplate(payment.templateId)
        const result = await generateRealm(payment.templateId)
        if (result.error) {
          store.getState().setRealmError(result.error)
          store.getState().setPaymentError(friendlyPaymentError(result.error))
          return
        }
        successMessage = `${payment.templateName} is now woven into the world.`
      } else if (payment.kind === "regenerate") {
        store.getState().setGeneratingTemplate(payment.realmId)
        const result = await regenerateRealm(payment.realmId)
        if (result.error) {
          store.getState().setRealmError(result.error)
          store.getState().setPaymentError(friendlyPaymentError(result.error))
          return
        }
        await Promise.all([fetchCharacter(), fetchRealms()])
        successMessage = `${payment.realmName} has been regenerated with a fresh layout, enemies, and loot.`
      } else if (payment.kind === "inn-rest") {
        const result = await restAtInn()
        if (!result.ok) {
          store.getState().setPaymentError(friendlyPaymentError(result.error))
          return
        }
        store.getState().setInnMessage(result.data.message)
        await fetchCharacter()
        successMessage = "Payment settled. The inn restores you to fighting form."
      }

      if (payment.kind === "generate") {
        await fetchRealms()
      }
      store.getState().setPaymentSuccess(successMessage)
      await refetchUsdcBalance()
      await fetchInventory()
      await delay(950)
      store.getState().setPendingPayment(null)
      store.getState().setPaymentToast(successMessage)
    } catch (err) {
      const message = friendlyPaymentError(err instanceof Error ? err.message : "Payment failed")
      store.getState().setPaymentError(message)
      const p = store.getState().pendingPayment
      if (p?.kind === "generate" || p?.kind === "regenerate") {
        store.getState().setRealmError(message)
      } else if (p?.kind === "reroll") {
        store.getState().setRerollMessage(message)
      } else {
        store.getState().setInnMessage(message)
      }
    } finally {
      store.getState().setGeneratingTemplate(null)
      store.getState().setIsProcessingPayment(false)
      store.getState().setPaymentSuccess(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // SDK still loading
  if (!isInitialized) {
    return (
      <Shell>
        <UiToast open={!!paymentToast} tone="success" title="Payment Complete" message={paymentToast ?? ""} onClose={() => store.getState().setPaymentToast(null)} />
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
        <UiToast open={!!paymentToast} tone="success" title="Payment Complete" message={paymentToast ?? ""} onClose={() => store.getState().setPaymentToast(null)} />
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
                onClick={() => store.getState().setSelectedClass(cls.id as CharacterClass)}
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
                if (selectedClass) store.getState().setStep("name-input")
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
        store.getState().setNameError("Name must be at least 2 characters")
      } else if (t.length > 24) {
        store.getState().setNameError("Name must be at most 24 characters")
      } else {
        store.getState().setNameError(null)
      }
    }

    const handleCreate = async () => {
      if (!isNameValid) return
      store.getState().setCreateError(null)
      const result = await rollCharacter(trimmedName, selectedClass)
      if (result) {
        store.getState().setStep("stat-reveal")
      } else {
        store.getState().setCreateError(charError ?? "Failed to create character")
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
                store.getState().setName(e.target.value)
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
                  onClick={() => store.getState().setShowConfirm(false)}
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
                  store.getState().setStep("class-select")
                  store.getState().setName("")
                  store.getState().setNameError(null)
                  store.getState().setCreateError(null)
                }}
                className="px-6 py-2 border border-gray-700 text-gray-400 rounded hover:border-gray-500 transition-colors"
              >
                Back
              </button>
              <button
                disabled={!isNameValid}
                onClick={() => store.getState().setShowConfirm(true)}
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
        store.getState().setRerollMessage("Stats already rerolled. Once per character.")
        store.getState().setRerollDisabled(true)
        return
      }
      store.getState().setPaymentError(null)
      store.getState().setPendingPayment({ kind: "reroll" })
    }

    return (
      <>
        <UiToast
          open={!!paymentToast}
          tone="success"
          title="Payment Complete"
          message={paymentToast ?? ""}
          onClose={() => store.getState().setPaymentToast(null)}
        />
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
                store.getState().setCreateError(err instanceof Error ? err.message : "Failed to prepare the tutorial realm")
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
          onCancel={store.getState().closePaymentModal}
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
    const visibleRealmEntries = (tutorialCompleted
      ? realms
      : realms.filter((realm) => realm.template_id === TUTORIAL_TEMPLATE_ID)
    ).slice().sort((a, b) => {
      const aOrder = realmTemplateMap[a.template_id]?.orderIndex ?? 99
      const bOrder = realmTemplateMap[b.template_id]?.orderIndex ?? 99
      return aOrder - bOrder
    })
    const realmGenerationTemplates = tutorialCompleted
      ? realmTemplates.filter((template) => !template.is_tutorial)
      : realmTemplates.filter((template) => template.is_tutorial)
    const lockedRealmTemplates = tutorialCompleted
      ? []
      : realmTemplates.filter((template) => !template.is_tutorial)

    const handleGenerateRealm = async (templateId: string) => {
      store.getState().setRealmError(null)
      const templateName = realmTemplateMap[templateId]?.name ?? "Realm"
      const isTutorialTemplate = realmTemplateMap[templateId]?.is_tutorial === true
      const shouldCharge = !isTutorialTemplate && (realms.length > 0 || account?.free_realm_used)

      if (shouldCharge) {
        store.getState().setPaymentError(null)
        store.getState().setPendingPayment({ kind: "generate", templateId, templateName })
        return
      }

      store.getState().setGeneratingTemplate(templateId)
      const result = await generateRealm(templateId)
      store.getState().setGeneratingTemplate(null)
      if (result.error) {
        store.getState().setRealmError(result.error)
      }
    }

    const handleRegenerateRealm = (realmId: string, realmName: string) => {
      store.getState().setRealmError(null)
      store.getState().setPaymentError(null)
      store.getState().setPendingPayment({ kind: "regenerate", realmId, realmName })
    }

    const handleEnterRealm = (realmId: string) => {
      gameSession.connect(realmId)
      store.getState().setStep("dungeon")
    }

    const handleBuyItem = async (itemId: string, quantity: number) => {
      const result = await buyItem(itemId, quantity)
      if (result.ok) {
        store.getState().setShopMessage(result.message)
        await fetchCharacter()
      } else {
        store.getState().setShopMessage(result.error)
      }
    }

    const handleSellItem = async (itemId: string, quantity: number) => {
      const result = await sellItem(itemId, quantity)
      if (result.ok) {
        store.getState().setShopMessage(result.message)
        await fetchCharacter()
      } else {
        store.getState().setShopMessage(result.error)
      }
    }

    const handleDiscardItem = async (itemId: string) => {
      const result = await discardItem(itemId)
      if (result.ok) {
        store.getState().setShopMessage(result.message)
        await fetchCharacter()
      } else {
        store.getState().setShopMessage(result.error)
      }
    }

    const handleEquipLobbyItem = async (itemId: string) => {
      const result = await equipItem(itemId)
      if (result.ok) {
        store.getState().setShopMessage(result.message)
        await fetchCharacter()
      } else {
        store.getState().setShopMessage(result.error)
      }
    }

    const handleUnequipLobbySlot = async (slot: EquipSlot) => {
      const result = await unequipItem(slot)
      if (result.ok) {
        store.getState().setShopMessage(result.message)
        await fetchCharacter()
      } else {
        store.getState().setShopMessage(result.error)
      }
    }

    return (
      <>
        <UiToast
          open={!!paymentToast}
          tone="success"
          title="Payment Complete"
          message={paymentToast ?? ""}
          onClose={() => store.getState().setPaymentToast(null)}
        />
        <main className="min-h-screen flex flex-col items-center p-8">
          <div className="max-w-5xl w-full space-y-6">

          <div className="grid gap-6 xl:grid-cols-[1.9fr_1fr]">
            {/* Left column — Inn */}
            <div className="space-y-4">
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
                    store.getState().setPaymentError(null)
                    store.getState().setInnMessage(null)
                    store.getState().setPendingPayment({ kind: "inn-rest" })
                  }}
                  className="w-full rounded bg-amber-500 px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {canRestAtInn ? "Rest at the Inn" : "Already Fully Rested"}
                </button>
              </div>

              {(character.lore_discovered?.length ?? 0) > 0 && (
                <div className="rounded border border-amber-900/40 bg-amber-950/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-300/70">Lore Journal</p>
                    <span className="text-[11px] text-amber-200/70">
                      {character.lore_discovered?.length} discovered
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    {[...(character.lore_discovered ?? [])]
                      .sort((left, right) => right.discovered_at_turn - left.discovered_at_turn)
                      .slice(0, 6)
                      .map((entry) => {
                        const lore = loreMap[entry.lore_entry_id]
                        return (
                          <button
                            key={entry.lore_entry_id}
                            type="button"
                            onClick={() => store.getState().setViewingLoreId(entry.lore_entry_id)}
                            className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-gray-300 transition-colors hover:bg-amber-950/30 hover:text-amber-200"
                          >
                            <span>{lore?.name ?? formatLoreLabel(entry.lore_entry_id)}</span>
                            <span className="text-[11px] text-gray-500 shrink-0">Turn {entry.discovered_at_turn}</span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Right column — Player info */}
            <CharacterPanel
              classLabel={classMap[character.class]?.name ?? character.class}
              level={character.level}
              gold={displayedGold}
              xp={progression?.xp ?? character.xp}
              xpLevel={progression?.level ?? character.level}
              xpToNext={progression?.xp_to_next_level ?? 0}
              xpForNext={progression?.xp_for_next_level ?? 0}
              hpCurrent={character.hp_current}
              hpMax={character.hp_max}
              hpColor={hubHpColor}
              resourceLabel={resourceLabel}
              resourceCurrent={character.resource_current}
              resourceMax={character.resource_max}
              resourceColor="bg-blue-500"
              statRows={(() => {
                const base = character.stats
                const bonus = { attack: 0, defense: 0, accuracy: 0, evasion: 0, speed: 0, hp: 0 }
                for (const item of shopInventory) {
                  if (!item.slot) continue
                  const tmpl = itemTemplateMap[item.template_id]
                  if (!tmpl?.stats) continue
                  for (const [stat, val] of Object.entries(tmpl.stats)) {
                    if (stat in bonus && typeof val === "number") {
                      bonus[stat as keyof typeof bonus] += val
                    }
                  }
                }
                return [
                  { label: "ATK", base: base.attack, effective: base.attack + bonus.attack },
                  { label: "DEF", base: base.defense, effective: base.defense + bonus.defense },
                  { label: "ACC", base: base.accuracy, effective: base.accuracy + bonus.accuracy },
                  { label: "EVA", base: base.evasion, effective: base.evasion + bonus.evasion },
                  { label: "SPD", base: base.speed, effective: base.speed + bonus.speed },
                ]
              })()}
            >
              <GearManagementPanel
                inventory={shopInventory}
                itemTemplateMap={itemTemplateMap}
                characterClass={character.class}
                isLoading={shopLoading}
                onEquip={handleEquipLobbyItem}
                onUnequip={handleUnequipLobbySlot}
              />

              {progression && progression.skill_points > 0 && (
                <button
                  onClick={() => store.getState().setShowSkillTree(true)}
                  className="w-full text-xs text-center py-1.5 rounded border border-amber-700/50 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40 transition-colors"
                >
                  {progression.skill_points} skill point{progression.skill_points !== 1 ? "s" : ""} available — View Skill Tree
                </button>
              )}
            </CharacterPanel>

            {viewingLoreId && (() => {
              const lore = loreMap[viewingLoreId]
              if (!lore) return null
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => store.getState().setViewingLoreId(null)}>
                  <div className="w-full max-w-lg rounded border border-amber-800/50 bg-gray-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-amber-300">{lore.name}</h3>
                      <button
                        type="button"
                        onClick={() => store.getState().setViewingLoreId(null)}
                        className="text-gray-500 hover:text-gray-300 text-lg leading-none"
                      >
                        x
                      </button>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{lore.text}</p>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Skill Tree Panel */}
          {showSkillTree && progression?.skill_tree_template && (
            <SkillTreePanel
              progression={progression}
              onUnlock={async (nodeId) => {
                await unlockSkill(nodeId)
                await fetchCharacter()
              }}
              onClose={() => store.getState().setShowSkillTree(false)}
              error={progressionError}
            />
          )}

          {/* View Skill Tree (when no points available) */}
          {!showSkillTree && progression?.skill_tree_template && (
            <button
              onClick={() => store.getState().setShowSkillTree(true)}
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
                    onClick={() => store.getState().setHubTab(tab.id as "realms" | "shop")}
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
                    Tutorial complete. New realms are now open.
                  </div>
                )}

                {visibleRealmEntries.map((realm) => {
                  const template = realmTemplateMap[realm.template_id]
                  const realmName = template?.name ?? realm.template_id
                  const statusLabel = REALM_STATUS_LABELS[realm.status] ?? realm.status
                  const canEnter = realm.status === "generated" || realm.status === "paused" || realm.status === "active"
                  const isPaused = realm.status === "paused" || realm.status === "active"
                  const canRegenerate = realm.status === "completed" && !template?.is_tutorial
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
                          {realm.completions > 0
                            ? ` — Cleared ${realm.completions} time${realm.completions === 1 ? "" : "s"}`
                            : ""}
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
                          <div className="mt-1.5 text-xs text-gray-500">
                            Fully resets the realm with a new seed, enemies, and loot.
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
                            disabled={isProcessingPayment || !!generatingTemplate}
                            title="Reset this completed realm with a new seed."
                            className="px-4 py-1 border border-cyan-700/70 bg-cyan-950/20 text-cyan-200 text-sm font-bold rounded transition-colors hover:bg-cyan-900/30 disabled:border-gray-700 disabled:bg-transparent disabled:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isRegenerating
                              ? "Regenerating..."
                              : `Regenerate ($${REALM_REGEN_USDC_PRICE})`}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {realmGenerationTemplates.map((template) => {
                  const existing = realms.find((r) => r.template_id === template.id)
                  if (existing) return null

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
                onDiscard={handleDiscardItem}
              />
            )}
          </div>

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
                ? `Approve a ${REALM_REGEN_USDC_PRICE} USDC x402 payment to fully reset ${pendingPayment.realmName}. This creates a fresh layout with new enemies and loot for a new run.`
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
          onCancel={store.getState().closePaymentModal}
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
            onClick={() => fetchCharacter().then((c) => store.getState().setStep(c ? "hub" : "class-select"))}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="text-gray-400">Preparing...</p>
      )}
    </Shell>
  )
}
