import { create } from "zustand";

type DateRange = "week" | "month" | "3months" | "year" | "all";

interface UIStore {
  sidebarCollapsed: boolean;
  assistantOpen: boolean;
  activeDateRange: DateRange;
  pendingAssistantMessage: string | null;
  toggleSidebar: () => void;
  toggleAssistant: () => void;
  setDateRange: (range: DateRange) => void;
  setPendingAssistantMessage: (msg: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  assistantOpen: false,
  activeDateRange: "month",
  pendingAssistantMessage: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setDateRange: (range) => set({ activeDateRange: range }),
  setPendingAssistantMessage: (msg) => set({ pendingAssistantMessage: msg }),
}));
