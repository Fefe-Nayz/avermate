import { create } from 'zustand'

export const useActiveYearStore = create<{
    activeId: string;
    setActiveId: (id: string) => void;
}>((set) => ({
    activeId: "none",
    setActiveId: (id) => set({ activeId: id }),
}))