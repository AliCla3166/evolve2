/* Store Zustand du mode Walachie — persistance localStorage sous la clé
   `evolve2_walachie_v1`, VOLONTAIREMENT séparée de la sauvegarde du jeu
   principal : les deux modes ne peuvent pas se casser l'un l'autre, et le
   SAVE_VERSION du jeu principal ne bouge pas d'un cran.

   Le pont avec les habitudes est en lecture seule : on lit useGame.getState()
   au moment du tick / de la pulsation, jamais l'inverse (aucun cycle d'import :
   store.ts du jeu principal n'importe rien d'ici). */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useGame } from "@/lib/game/store";
import type { GameState } from "@/lib/game/types";
import {
  buyMeta,
  buyNode,
  claimShiny,
  freshWalachieState,
  habitBridge,
  pulse,
  renaissance,
  unlockNextEra,
  WALACHIE_SAVE_VERSION,
  walachieTick,
  type WalachieTickSummary,
} from "./engine";
import type { WalachieState } from "./types";

const STORAGE_KEY = "evolve2_walachie_v1";

interface WalachieStore extends WalachieState {
  /** true une fois la sauvegarde rechargée (l'UI attend ce signal). */
  hasHydrated: boolean;
  /** Résumé du dernier retour (production hors ligne, cadeau) — transitoire. */
  lastReturn: WalachieTickSummary | null;

  tick: (now: number) => void;
  doPulse: (now: number) => number;
  doBuyNode: (id: string, n: number) => void;
  doUnlockEra: () => void;
  doBuyMeta: (id: string) => void;
  doRenaissance: (now: number) => void;
  doClaimShiny: (id: string) => number;
  clearReturn: () => void;
}

/** L'état du jeu principal, s'il est chargé (pont habitudes, lecture seule). */
function mainGame(): GameState | null {
  const g = useGame.getState();
  return g.hasHydrated ? (g as unknown as GameState) : null;
}

function walachieSlice(s: WalachieStore): WalachieState {
  return {
    version: s.version,
    seve: s.seve,
    seveCycle: s.seveCycle,
    seveAllTime: s.seveAllTime,
    pulsations: s.pulsations,
    nodes: s.nodes,
    erasUnlocked: s.erasUnlocked,
    eclats: s.eclats,
    cycles: s.cycles,
    meta: s.meta,
    shinyClaimed: s.shinyClaimed,
    lastTick: s.lastTick,
    rngSeed: s.rngSeed,
    nextEventAt: s.nextEventAt,
    activeEvent: s.activeEvent,
    eventLog: s.eventLog,
  };
}

export const useWalachie = create<WalachieStore>()(
  persist(
    (set, get) => ({
      ...freshWalachieState(0),
      hasHydrated: false,
      lastReturn: null,

      tick: (now) => {
        const state = walachieSlice(get());
        if (state.lastTick <= 0) state.lastTick = now; // première ouverture
        const bridge = habitBridge(mainGame(), now);
        const summary = walachieTick(state, bridge, now);
        // Un vrai retour (plus de 5 min d'absence) se raconte dans un panneau.
        const wasAway = summary.gained > 0 && now - (get().lastTick || now) > 5 * 60 * 1000;
        set({ ...state, lastReturn: wasAway ? summary : get().lastReturn });
      },

      doPulse: (now) => {
        const state = walachieSlice(get());
        const bridge = habitBridge(mainGame(), now);
        const gained = pulse(state, bridge, now);
        set(state);
        return gained;
      },

      doBuyNode: (id, n) => {
        const state = walachieSlice(get());
        if (buyNode(state, id, n) > 0) set(state);
      },

      doUnlockEra: () => {
        const state = walachieSlice(get());
        if (unlockNextEra(state)) set(state);
      },

      doBuyMeta: (id) => {
        const state = walachieSlice(get());
        if (buyMeta(state, id)) set(state);
      },

      doClaimShiny: (id) => {
        const state = walachieSlice(get());
        const gain = claimShiny(state, id);
        if (gain > 0) set(state);
        return gain;
      },

      doRenaissance: (now) => {
        const state = walachieSlice(get());
        const next = renaissance(state, now);
        if (next !== state) set({ ...next, lastReturn: null });
      },

      clearReturn: () => set({ lastReturn: null }),
    }),
    {
      name: STORAGE_KEY,
      version: WALACHIE_SAVE_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: walachieSlice,
      migrate: (persisted) => persisted as WalachieStore,
    },
  ),
);

let hydrateStarted = false;

/** Réhydratation manuelle (App Router : jamais pendant le rendu serveur).
 *  Même piège que le store principal : ne JAMAIS écrire dans le store avant
 *  que rehydrate() soit résolu, sous peine d'écraser la vraie sauvegarde. */
export function hydrateWalachie(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void Promise.resolve(useWalachie.persist.rehydrate()).then(() => {
    useWalachie.setState((s) => ({
      hasHydrated: true,
      // Sauvegarde neuve (lastTick 0) : on démarre le monde maintenant.
      ...(s.lastTick <= 0 ? freshWalachieState(Date.now()) : null),
    }));
  });
}
