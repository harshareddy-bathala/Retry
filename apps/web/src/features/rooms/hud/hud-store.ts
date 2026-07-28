import { useSyncExternalStore } from 'react';

// What the HUD is showing. One source, read by the rail (which icon is lit),
// the sidebar (which panel to mount) and the grid frame (whether the sidebar
// column has width). Those three used to derive it from one component's local
// state, which is why the rail and the layout could disagree.

export type PanelKind = 'chat' | 'kanban' | 'whiteboard' | 'presence';

export type HudState = {
  /** The open sidebar panel, or null. `whiteboard` opens as a modal instead. */
  sidebar: PanelKind | null;
  minimapOpen: boolean;
};

const MINIMAP_KEY = 'retry.rooms.minimap';

function initialMinimap(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(MINIMAP_KEY) !== 'closed';
}

let state: HudState = { sidebar: null, minimapOpen: initialMinimap() };
const listeners = new Set<() => void>();

function set(next: Partial<HudState>): void {
  const merged = { ...state, ...next };
  if (merged.sidebar === state.sidebar && merged.minimapOpen === state.minimapOpen) return;
  state = merged;
  listeners.forEach((fn) => fn());
}

export const hudStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot(): HudState {
    return state;
  },
  openPanel(kind: PanelKind): void {
    set({ sidebar: kind });
  },
  togglePanel(kind: PanelKind): void {
    set({ sidebar: state.sidebar === kind ? null : kind });
  },
  closePanel(): void {
    set({ sidebar: null });
  },
  toggleMinimap(): void {
    const open = !state.minimapOpen;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MINIMAP_KEY, open ? 'open' : 'closed');
    }
    set({ minimapOpen: open });
  },
  /** Leaving a room drops every panel — state never leaks between rooms. */
  reset(): void {
    set({ sidebar: null });
  },
};

export function useHud(): HudState {
  return useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot);
}
