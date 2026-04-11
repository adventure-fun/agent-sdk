import { create } from "zustand"
import type { CharacterClass } from "@adventure-fun/schemas"
import type { PageStep, PendingPayment } from "./types"

interface PlayState {
  // Flow
  step: PageStep
  selectedClass: CharacterClass | null
  name: string
  nameError: string | null
  showConfirm: boolean
  createError: string | null
  rerollMessage: string | null
  rerollDisabled: boolean

  // Realm generation
  generatingTemplate: string | null
  realmError: string | null

  // Hub UI
  showSkillTree: boolean
  hubTab: "realms" | "shop"
  shopMessage: string | null
  innMessage: string | null
  viewingLoreId: string | null

  // Payment
  pendingPayment: PendingPayment
  isProcessingPayment: boolean
  paymentError: string | null
  paymentSuccess: string | null
  paymentToast: string | null

  // Actions
  setStep: (step: PageStep) => void
  setSelectedClass: (cls: CharacterClass | null) => void
  setName: (name: string) => void
  setNameError: (error: string | null) => void
  setShowConfirm: (show: boolean) => void
  setCreateError: (error: string | null) => void
  setRerollMessage: (message: string | null) => void
  setRerollDisabled: (disabled: boolean) => void
  setGeneratingTemplate: (id: string | null) => void
  setRealmError: (error: string | null) => void
  setShowSkillTree: (show: boolean) => void
  setHubTab: (tab: "realms" | "shop") => void
  setShopMessage: (message: string | null) => void
  setInnMessage: (message: string | null) => void
  setViewingLoreId: (id: string | null) => void
  setPendingPayment: (payment: PendingPayment) => void
  setIsProcessingPayment: (processing: boolean) => void
  setPaymentError: (error: string | null) => void
  setPaymentSuccess: (message: string | null) => void
  setPaymentToast: (message: string | null) => void
  closePaymentModal: () => void
  resetCreationFlow: () => void
}

export const usePlayStore = create<PlayState>((set, get) => ({
  // Flow
  step: "loading",
  selectedClass: null,
  name: "",
  nameError: null,
  showConfirm: false,
  createError: null,
  rerollMessage: null,
  rerollDisabled: false,

  // Realm generation
  generatingTemplate: null,
  realmError: null,

  // Hub UI
  showSkillTree: false,
  hubTab: "realms",
  shopMessage: null,
  innMessage: null,
  viewingLoreId: null,

  // Payment
  pendingPayment: null,
  isProcessingPayment: false,
  paymentError: null,
  paymentSuccess: null,
  paymentToast: null,

  // Actions
  setStep: (step) => set({ step }),
  setSelectedClass: (selectedClass) => set({ selectedClass }),
  setName: (name) => set({ name }),
  setNameError: (nameError) => set({ nameError }),
  setShowConfirm: (showConfirm) => set({ showConfirm }),
  setCreateError: (createError) => set({ createError }),
  setRerollMessage: (rerollMessage) => set({ rerollMessage }),
  setRerollDisabled: (rerollDisabled) => set({ rerollDisabled }),
  setGeneratingTemplate: (generatingTemplate) => set({ generatingTemplate }),
  setRealmError: (realmError) => set({ realmError }),
  setShowSkillTree: (showSkillTree) => set({ showSkillTree }),
  setHubTab: (hubTab) => set({ hubTab }),
  setShopMessage: (shopMessage) => set({ shopMessage }),
  setInnMessage: (innMessage) => set({ innMessage }),
  setViewingLoreId: (viewingLoreId) => set({ viewingLoreId }),
  setPendingPayment: (pendingPayment) => set({ pendingPayment }),
  setIsProcessingPayment: (isProcessingPayment) => set({ isProcessingPayment }),
  setPaymentError: (paymentError) => set({ paymentError }),
  setPaymentSuccess: (paymentSuccess) => set({ paymentSuccess }),
  setPaymentToast: (paymentToast) => set({ paymentToast }),
  closePaymentModal: () => {
    if (get().isProcessingPayment) return
    set({ pendingPayment: null, paymentError: null, paymentSuccess: null })
  },
  resetCreationFlow: () =>
    set({
      selectedClass: null,
      name: "",
      nameError: null,
      showConfirm: false,
      createError: null,
      rerollMessage: null,
      rerollDisabled: false,
    }),
}))
