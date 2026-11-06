import { create } from 'zustand';

/**
 * Shared state for the chat drawer. Screens (such as a post's Rewrite button) use `openWith`
 * to open the drawer with a starting message for the person to finish.
 */
interface AssistantState {
  open: boolean;
  /** Starting text for the input. The panel takes it once, so closing and reopening does not refill it. */
  draft: string | null;
  setOpen(open: boolean): void;
  openWith(draft: string): void;
  takeDraft(): string | null;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  draft: null,
  setOpen: (open) => set({ open }),
  openWith: (draft) => set({ open: true, draft }),
  takeDraft: () => {
    const draft = get().draft;
    if (draft !== null) set({ draft: null });
    return draft;
  },
}));
