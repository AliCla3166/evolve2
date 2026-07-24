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
import {
  addCatch,
  MARE,
  rollRarity,
  rollSpecies,
  SPECIES_IDS,
} from "./cards";
import {
  availableUnits,
  canRecruit,
  dailyOffers,
  MILITARY,
  rand,
  recruitCost,
  resolveChoiceEvent,
} from "./military";
import { applyTick } from "./tick";
import { getActiveSlot, setActiveSlot, slotHasSave, slotStorageKey, type SaveSlot } from "./slot";
import {
  TUTORIAL_DONE,
  type BuildingId,
  type GameState,
  type HabitDayEntry,
  type ResourceId,
  type UnitId,
} from "./types";

export const SAVE_KEY = "evolve2_save_v1";
export const SAVE_VERSION = 4;
export type { SaveSlot } from "./slot";

/** Champs éditables d'une saisie du jour (le reste est recalculé). */
export type HabitPatch = Partial<
  Pick<HabitDayEntry, "calories" | "caloriesDone" | "steps" | "mf" | "alilou" | "rituals">
>;

interface GameActions {
  /** true une fois la sauvegarde localStorage rechargée (évite les mismatches SSR). */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  /** Slot de sauvegarde actif ("perso" réel ou "dev" isolé pour tester).
   *  Préférence d'appareil, jamais incluse dans la sauvegarde elle-même. */
  activeSlot: SaveSlot;
  /** Bascule vers l'autre slot : recharge sa sauvegarde si elle existe,
   *  sinon repart d'un état neuf (jamais un mélange avec le slot précédent). */
  switchSlot: (slot: SaveSlot) => void;
  /** Mode dev UNIQUEMENT (no-op silencieux en perso, garde-fou anti-triche) :
   *  s'octroie librement ressources/jetons/fragments pour tester le jeu. */
  devGrant: (patch: {
    resources?: Partial<Record<ResourceId, number>>;
    jetons?: number;
    fragments?: number;
  }) => void;
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
  /** Avance le micro-tutoriel (monotone : jamais de retour en arrière). */
  advanceTutorial: (step: number) => void;
  /* ----- Couche militaire (Phase 5) ----- */
  /** Recrute une unité au Noyau (coût + cap d'effectif tirés de la config). */
  recruit: (id: UnitId) => boolean;
  /** Envoie une escouade sur l'offre du jour d'index donné. */
  sendExpedition: (offerIndex: number, squad: Record<UnitId, number>) => boolean;
  /** Tranche l'événement à choix en attente. */
  chooseEventOption: (optionIndex: number) => void;
  /** Marque les rapports comme lus (badge). */
  markReportsSeen: () => void;
  /* ----- La Mare & les cartes (Phase 6) ----- */
  /** Achète 1 jeton de pêche contre de l'énergie. */
  buyJeton: () => boolean;
  /** Consomme 1 jeton au ferrage d'une paillette (avant la tension). */
  spendJeton: () => boolean;
  /** Capture réussie : tire l'espèce (PRNG seedé), quality = chance d'amélioration de rareté. */
  landCatch: (rarityIndex: number, quality: number) => void;
  /** Fusionne fragments_per_card fragments en une carte (rareté plancher Rare). */
  fuseFragments: () => boolean;
  /** Assigne/retire une carte d'un slot défense/expédition. */
  toggleCardAssign: (speciesId: string, slot: "defense" | "expedition") => boolean;
  /** Ferme la modal de révélation. */
  clearLastCatch: () => void;
  /** Adopte une sauvegarde (sync cloud) — remplace l'état local entier. */
  adoptSave: (incoming: GameState) => void;
}

export type GameStore = GameState & GameActions;

/** Export de la sauvegarde courante (sync cloud). */
export function exportSave(): GameState {
  return gameSlice(useGame.getState());
}

/** À appeler une fois par montage de page (titre, /play) : réhydrate le store
 *  depuis le slot actif puis synchronise le champ réactif `activeSlot`
 *  (remplace l'ancien appel direct à `persist.rehydrate()`).
 *
 *  ATTENTION À L'ORDRE : `useGame.setState(...)` écrit IMMÉDIATEMENT l'état
 *  courant sur le disque (le middleware persist de zustand persiste sur
 *  CHAQUE set(), avant même la première hydratation). Si on l'appelait avant
 *  que `rehydrate()` ait fini de charger la vraie sauvegarde, on écraserait
 *  cette dernière avec l'état par défaut encore en mémoire. On attend donc
 *  la fin de l'hydratation avant de toucher au store. */
export function hydrateActiveSlot(): void {
  const slot = getActiveSlot();
  void Promise.resolve(useGame.persist.rehydrate()).then(() => {
    useGame.setState({ activeSlot: slot });
  });
}

/** Extrait la partie GameState pure du store (sans les actions). */
function gameSlice(s: GameStore): GameState {
  return {
    saveVersion: s.saveVersion,
    tutorialStep: s.tutorialStep,
    resources: s.resources,
    buildings: s.buildings,
    buildQueue: s.buildQueue,
    habits: s.habits,
    lastTick: s.lastTick,
    createdAt: s.createdAt,
    profile: s.profile,
    units: s.units,
    expeditions: s.expeditions,
    nextExpeditionId: s.nextExpeditionId,
    reports: s.reports,
    nextReportId: s.nextReportId,
    reportsSeenAt: s.reportsSeenAt,
    nextAttackAt: s.nextAttackAt,
    waveCount: s.waveCount,
    nextEventAt: s.nextEventAt,
    pendingEvent: s.pendingEvent,
    fragments: s.fragments,
    rngSeed: s.rngSeed,
    jetons: s.jetons,
    collection: s.collection,
    cardAssignments: s.cardAssignments,
    lastCatch: s.lastCatch,
  };
}

export const useGame = create<GameStore>()(
  persist<GameStore, [], [], GameState>(
    (set, get) => ({
      ...freshGameState(Date.now()),

      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),

      activeSlot: getActiveSlot(),
      switchSlot: (slot) => {
        setActiveSlot(slot);
        if (!slotHasSave(slot)) {
          // Rien encore dans ce slot : on repart d'un état neuf plutôt que de
          // garder en mémoire les données du slot qu'on vient de quitter.
          set({ ...freshGameState(Date.now()), activeSlot: slot, hasHydrated: true });
        } else {
          // NE PAS faire `set({ activeSlot: slot })` avant rehydrate() : ce
          // set() persisterait tout de suite l'état encore en mémoire (celui
          // du slot qu'on quitte) par-dessus la sauvegarde du nouveau slot.
          // On attend que rehydrate() ait chargé la vraie donnée du nouveau
          // slot avant de toucher au store (même piège que hydrateActiveSlot).
          void Promise.resolve(useGame.persist.rehydrate()).then(() => {
            useGame.setState({ activeSlot: slot });
          });
        }
      },
      devGrant: (patch) => {
        if (get().activeSlot !== "dev") return; // garde-fou : jamais en perso
        const s = get();
        const resources = { ...s.resources };
        for (const [res, amount] of Object.entries(patch.resources ?? {})) {
          resources[res as ResourceId] = Math.max(0, resources[res as ResourceId] + (amount ?? 0));
        }
        set({
          resources,
          jetons: Math.max(0, Math.min(MARE.jetons.max_stock, s.jetons + (patch.jetons ?? 0))),
          fragments: Math.max(0, s.fragments + (patch.fragments ?? 0)),
        });
      },

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
        if (patch.calories !== undefined) {
          entry.calories = clampHabitValue("calories", patch.calories);
          // Saisir une valeur suffit désormais à "valider" la journée calorique
          // du jour (plus de bouton dédié) — cf. redesign HabitsPanel.
          entry.caloriesDone = true;
        }
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

      advanceTutorial: (step) => {
        const clamped = Math.min(TUTORIAL_DONE, Math.max(0, Math.round(step)));
        if (clamped > get().tutorialStep) set({ tutorialStep: clamped });
      },

      recruit: (id) => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        if (!canRecruit(s, id)) return false;
        const resources = { ...s.resources };
        for (const [res, amount] of Object.entries(recruitCost(id))) {
          resources[res as keyof typeof resources] -= amount;
        }
        set({
          ...s,
          resources,
          units: { ...s.units, [id]: (s.units[id] ?? 0) + 1 },
        });
        return true;
      },

      sendExpedition: (offerIndex, squad) => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        if (s.expeditions.length >= MILITARY.expeditions.max_concurrent) return false;
        const offer = dailyOffers(s, now)[offerIndex];
        if (!offer) return false;
        // Escouade non vide et couverte par les unités disponibles.
        const avail = availableUnits(s);
        const size = (["garde", "sonde", "phage"] as UnitId[]).reduce(
          (sum, u) => sum + (squad[u] ?? 0),
          0,
        );
        if (size <= 0) return false;
        for (const u of ["garde", "sonde", "phage"] as UnitId[]) {
          if ((squad[u] ?? 0) < 0 || (squad[u] ?? 0) > avail[u]) return false;
        }
        set({
          ...s,
          expeditions: [
            ...s.expeditions,
            {
              id: s.nextExpeditionId,
              destId: offer.destId,
              destName: offer.destName,
              tier: offer.tier,
              risk: offer.risk,
              difficulty: offer.difficulty,
              rewards: offer.rewards,
              boostChance: offer.boostChance,
              squad: { garde: squad.garde ?? 0, sonde: squad.sonde ?? 0, phage: squad.phage ?? 0 },
              startedAt: now,
              endsAt: now + offer.durationH * 3_600_000,
            },
          ],
          nextExpeditionId: s.nextExpeditionId + 1,
        });
        return true;
      },

      chooseEventOption: (optionIndex) => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        resolveChoiceEvent(s, optionIndex, now); // mute le draft s (pur vis-à-vis du store)
        set(s);
      },

      markReportsSeen: () => {
        set({ reportsSeenAt: Date.now() });
      },

      buyJeton: () => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        const cost = MARE.jetons.cost_energie;
        if (s.jetons >= MARE.jetons.max_stock || s.resources.energie < cost) return false;
        set({
          ...s,
          resources: { ...s.resources, energie: s.resources.energie - cost },
          jetons: s.jetons + 1,
        });
        return true;
      },

      spendJeton: () => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        if (s.jetons <= 0) return false;
        set({ ...s, jetons: s.jetons - 1 });
        return true;
      },

      landCatch: (rarityIndex, quality) => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        let rarity = Math.min(MARE.rarities.length - 1, Math.max(0, Math.round(rarityIndex)));
        // Tension parfaite : chance d'améliorer la rareté d'un cran (quality_luck).
        const luck =
          MARE.tension.quality_luck[
            Math.min(MARE.tension.quality_luck.length - 1, Math.max(0, quality))
          ] ?? 0;
        let [roll, seed] = rand(s.rngSeed);
        if (roll < luck) rarity = Math.min(MARE.rarities.length - 1, rarity + 1);
        [roll, seed] = rand(seed);
        const species = rollSpecies(roll);
        s.rngSeed = seed;
        addCatch(s, species, rarity, now, "peche");
        set(s);
      },

      fuseFragments: () => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        if (s.fragments < MARE.fragments_per_card) return false;
        s.fragments -= MARE.fragments_per_card;
        let [roll, seed] = rand(s.rngSeed);
        const rarity = rollRarity(roll, 0, MARE.fragment_card_rarity_floor);
        [roll, seed] = rand(seed);
        const species = rollSpecies(roll);
        s.rngSeed = seed;
        addCatch(s, species, rarity, now, "fragments");
        set(s);
        return true;
      },

      toggleCardAssign: (speciesId, slot) => {
        const state = get();
        if (!state.collection[speciesId] || !SPECIES_IDS.includes(speciesId)) return false;
        const inSlot = state.cardAssignments[slot].includes(speciesId);
        // On retire la carte des deux listes, puis on la replace si c'était un ajout.
        const next = {
          defense: state.cardAssignments.defense.filter((id) => id !== speciesId),
          expedition: state.cardAssignments.expedition.filter((id) => id !== speciesId),
        };
        if (!inSlot) {
          if (next[slot].length >= MARE.assign_slots[slot]) return false; // slot plein
          next[slot] = [...next[slot], speciesId];
        }
        set({ cardAssignments: next });
        return true;
      },

      clearLastCatch: () => {
        set({ lastCatch: null });
      },

      adoptSave: (incoming) => {
        // Défense en profondeur : les champs absents (vieille sauvegarde cloud)
        // prennent les défauts du schéma courant.
        set({ ...freshGameState(Date.now()), ...incoming, lastCatch: null });
      },
    }),
    {
      name: SAVE_KEY,
      version: SAVE_VERSION,
      // Stockage conscient du slot actif : perso/dev vivent sous des clés
      // localStorage séparées (cf. slot.ts) ; on résout la clé à chaque accès
      // (jamais figée à la création du store) pour que switchSlot() fonctionne
      // sur cette unique instance de store, sans la recréer.
      storage: createJSONStorage(() => ({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature StateStorage imposée
        getItem: (name) => {
          try {
            return localStorage.getItem(slotStorageKey(getActiveSlot()));
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(slotStorageKey(getActiveSlot()), value);
          } catch {
            /* quota / navigation privée : silencieux, comme avant */
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature StateStorage imposée
        removeItem: (name) => {
          try {
            localStorage.removeItem(slotStorageKey(getActiveSlot()));
          } catch {
            /* ignore */
          }
        },
      })),
      // Next.js App Router : on réhydrate manuellement côté client (useGame.persist.rehydrate()).
      skipHydration: true,
      // v1 -> v2 : les sauvegardes d'avant la Phase 4 n'ont pas de tutorialStep —
      // leurs joueurs connaissent déjà le jeu, le tutoriel est marqué terminé.
      // v2 -> v3 : ajout de la couche militaire (Phase 5), tout part de zéro ;
      // vagues/événements se planifient d'eux-mêmes au premier tick (champs à 0).
      migrate: (persisted, version) => {
        const state = persisted as GameState;
        if (version < 2 || state.tutorialStep === undefined) {
          state.tutorialStep = TUTORIAL_DONE;
        }
        if (version < 4 || state.jetons === undefined) {
          state.jetons = 0;
          state.collection = {};
          state.cardAssignments = { defense: [], expedition: [] };
          state.lastCatch = null;
        }
        if (version < 3 || state.units === undefined) {
          state.units = { garde: 0, sonde: 0, phage: 0 };
          state.expeditions = [];
          state.nextExpeditionId = 1;
          state.reports = [];
          state.nextReportId = 1;
          state.reportsSeenAt = state.lastTick || state.createdAt;
          state.nextAttackAt = 0;
          state.waveCount = 0;
          state.nextEventAt = 0;
          state.pendingEvent = null;
          state.fragments = 0;
          state.rngSeed = ((state.createdAt || 1) % 2147483647) | 1;
        }
        state.saveVersion = SAVE_VERSION;
        return state;
      },
      partialize: gameSlice,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
