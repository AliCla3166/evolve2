/* Store Zustand du jeu — persistance localStorage (clé evolve2_save_v1).
   Le moteur (economy/tick/habits) reste pur ; le store ne fait qu'orchestrer. */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  buildTimeMs,
  canAfford,
  freshGameState,
  isDesigned,
  levelCost,
  maxLevel,
} from "./economy";
import {
  addDaysToKey,
  clampHabitValue,
  CALORIE_GOAL_MAX,
  CALORIE_GOAL_MIN,
  dayKey,
  emptyDayEntry,
  ENERGY_CAP,
  evaluateEntry,
  STREAK_MILESTONES,
} from "./habits";
import { applyTick } from "./tick";
import type { BuildingId, GameState, HabitDayEntry } from "./types";

export const SAVE_KEY = "evolve2_save_v1";
export const SAVE_VERSION = 1;

/** Champs éditables d'une saisie du jour (le reste est recalculé). */
export type HabitPatch = Partial<
  Pick<HabitDayEntry, "calories" | "caloriesDone" | "steps" | "mf" | "alilou" | "rituals">
>;

interface GameActions {
  /** true une fois la sauvegarde localStorage rechargée (évite les mismatches SSR). */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  /** Tick du moteur — appelé par un setInterval 1 s côté client,
   *  et une seule fois au chargement pour le gros tick de rattrapage offline. */
  collectTick: (now?: number) => void;
  /** Lance l'amélioration d'un bâtiment (1 seul slot de file — règle stricte). */
  startUpgrade: (id: BuildingId) => boolean;
  /** Édite la saisie d'habitudes DU JOUR uniquement (anti-triche : la clé est
   *  toujours dayKey(Date.now()), l'historique passé est en lecture seule). */
  updateHabitToday: (patch: HabitPatch) => void;
  setCalorieGoal: (goal: number) => void;
  createProfile: (portraitId: string, nomOrganisme: string) => void;
}

export type GameStore = GameState & GameActions;

/** Extrait la partie GameState pure du store (sans les actions). */
function gameSlice(s: GameStore): GameState {
  return {
    saveVersion: s.saveVersion,
    resources: s.resources,
    buildings: s.buildings,
    buildQueue: s.buildQueue,
    habits: s.habits,
    lastTick: s.lastTick,
    createdAt: s.createdAt,
    profile: s.profile,
  };
}

export const useGame = create<GameStore>()(
  persist<GameStore, [], [], GameState>(
    (set, get) => ({
      ...freshGameState(Date.now()),

      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),

      collectTick: (now = Date.now()) => {
        set(applyTick(gameSlice(get()), now));
      },

      startUpgrade: (id) => {
        const now = Date.now();
        // On se met d'abord à jour (finalise un éventuel chantier échu, produit).
        const s = applyTick(gameSlice(get()), now);
        if (s.buildQueue !== null) return false; // file pleine : 1 seul slot, strict
        if (!isDesigned(id)) return false; // peche / defense / raid : "À venir"
        const current = s.buildings[id] ?? 0;
        const target = current + 1;
        if (target > maxLevel(id)) return false;
        const cost = levelCost(id, target);
        if (!cost || !canAfford(s.resources, cost)) return false;

        const resources = { ...s.resources };
        for (const [res, amount] of Object.entries(cost)) {
          resources[res as keyof typeof resources] -= amount;
        }
        set({
          ...s,
          resources,
          buildQueue: {
            buildingId: id,
            targetLevel: target,
            startedAt: now,
            endsAt: now + buildTimeMs(id, target),
          },
        });
        return true;
      },

      updateHabitToday: (patch) => {
        const now = Date.now();
        const key = dayKey(now); // saisie du jour calendaire local uniquement
        const state = get();
        const habits = state.habits;
        const prev = habits.days[key] ?? emptyDayEntry();

        const entry: HabitDayEntry = { ...prev };
        if (patch.calories !== undefined) entry.calories = clampHabitValue("calories", patch.calories);
        if (patch.caloriesDone !== undefined) entry.caloriesDone = patch.caloriesDone;
        if (patch.steps !== undefined) entry.steps = clampHabitValue("steps", patch.steps);
        if (patch.mf !== undefined) entry.mf = clampHabitValue("mf", patch.mf);
        if (patch.alilou !== undefined) entry.alilou = clampHabitValue("alilou", patch.alilou);
        if (patch.rituals !== undefined) entry.rituals = clampHabitValue("rituals", patch.rituals);

        const { energy, validatedCount } = evaluateEntry(entry, habits.calorieGoal);
        entry.energy = energy;
        entry.validatedCount = validatedCount;

        // Delta d'énergie dû à l'édition (une journée re-modifiée le jour même
        // ne crédite que la différence — jamais deux fois le total).
        let energyDelta = energy - prev.energy;

        // ----- Streak : jours consécutifs avec au moins une habitude validée -----
        let { streak, lastStreakDate, bestStreak } = habits;
        const milestoneAwards = { ...habits.milestoneAwards };
        const wasValidated = prev.validatedCount > 0;
        const isValidated = validatedCount > 0;

        if (!wasValidated && isValidated && lastStreakDate !== key) {
          // La journée devient validée : elle prolonge la série (veille) ou en démarre une.
          streak = lastStreakDate === addDaysToKey(key, -1) ? streak + 1 : 1;
          lastStreakDate = key;
          bestStreak = Math.max(bestStreak, streak);
          // Jalons 7/30/90 : bonus d'énergie encaissé au moment où la série atteint le palier.
          for (const m of STREAK_MILESTONES) {
            if (streak === m.days && milestoneAwards[String(m.days)] !== key) {
              energyDelta += m.energy;
              milestoneAwards[String(m.days)] = key;
            }
          }
        } else if (wasValidated && !isValidated && lastStreakDate === key) {
          // La journée est entièrement dévalidée : on la retire de la série,
          // et on reprend un éventuel bonus de jalon encaissé aujourd'hui
          // (aller-retour neutre : re-valider le jour même re-créditera).
          streak = Math.max(0, streak - 1);
          lastStreakDate = streak > 0 ? addDaysToKey(key, -1) : null;
          for (const m of STREAK_MILESTONES) {
            if (milestoneAwards[String(m.days)] === key) {
              energyDelta -= m.energy;
              delete milestoneAwards[String(m.days)];
            }
          }
        }

        const energie = Math.min(
          ENERGY_CAP,
          Math.max(0, state.resources.energie + energyDelta),
        );

        set({
          resources: { ...state.resources, energie },
          habits: {
            ...habits,
            days: { ...habits.days, [key]: entry },
            streak,
            lastStreakDate,
            bestStreak,
            milestoneAwards,
          },
        });
      },

      setCalorieGoal: (goal) => {
        const clamped = Math.min(CALORIE_GOAL_MAX, Math.max(CALORIE_GOAL_MIN, Math.round(goal)));
        const state = get();
        set({ habits: { ...state.habits, calorieGoal: clamped } });
        // L'objectif change => l'énergie du jour peut changer : on réévalue la saisie du jour.
        const key = dayKey(Date.now());
        if (state.habits.days[key]) get().updateHabitToday({});
      },

      createProfile: (portraitId, nomOrganisme) => {
        const name = nomOrganisme.trim().slice(0, 24);
        if (!portraitId || !name) return;
        set({ profile: { portraitId, nomOrganisme: name, createdAt: Date.now() } });
      },
    }),
    {
      name: SAVE_KEY,
      version: SAVE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Next.js App Router : on réhydrate manuellement côté client (useGame.persist.rehydrate()).
      skipHydration: true,
      // Migration no-op v1 (les futures versions transformeront la sauvegarde ici).
      migrate: (persisted) => persisted as GameState,
      partialize: gameSlice,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
