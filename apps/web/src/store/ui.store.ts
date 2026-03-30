import { create } from "zustand";

type DateRange = "week" | "month" | "3months" | "year" | "all";

interface UIStore {
  sidebarCollapsed: boolean;
  assistantOpen: boolean;
  activeDateRange: DateRange;
  toggleSidebar: () => void;
  toggleAssistant: () => void;
  setDateRange: (range: DateRange) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  assistantOpen: false,
  activeDateRange: "month",
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setDateRange: (range) => set({ activeDateRange: range }),
}));
