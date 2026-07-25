/* Store Zustand du jeu — persistance localStorage (clé evolve2_save_v1).
   Le moteur (economy/tick/habits) reste pur ; le store ne fait qu'orchestrer. */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  boostQuote,
  buildTimeHours,
  buildTimeMs,
  canAfford,
  findFreeSlot,
  freshGameState,
  isDesigned,
  levelCost,
  maxLevel,
  OFFLINE_REPORT,
  resourceCap,
  totalProductionPerHour,
} from "./economy";
import { effectiveReserveCap, freshBastionState } from "./bastion/config";
import {
  buyFoundations,
  buyInWaveRespawn,
  buyScouting,
  buyReserveCap,
  buySlotUnlock,
  buySpecCap,
  chooseTreeOption,
  draftWithBastion,
  moveFieldStructure,
  moveOrSwapBarracks,
  moveOrSwapMortar,
  moveOrSwapSupport,
  moveOrSwapTurret,
  placeBuildingFromReserve,
  placeSpeciesCard,
  recruitBuilding,
  recycleBuilding,
  removeFieldStructureToReserve,
  removeSpeciesFromSlot,
  removeSupportToReserve,
  removeTurretToReserve,
} from "./bastion/actions";
import type { FieldStructure, LiveWaveResult } from "./bastion/types";
import {
  clampHabitValue,
  CALORIE_GOAL_MAX,
  CALORIE_GOAL_MIN,
  computeStreak,
  dayKey,
  emptyDayEntry,
  ENERGY_CAP,
  evaluateEntry,
  monthKey,
  repairableDay,
  settleStreakTiers,
  STREAK_TIERS,
  bilanOptionDef,
} from "./habits";
import {
  addCatch,
  jetonMax,
  MARE,
  rollRarity,
  rollRevealTease,
  rollSpecies,
  SPECIES_IDS,
} from "./cards";
import {
  availableUnits,
  canRecruit,
  dailyOffers,
  expeditionDurationH,
  MILITARY,
  rand,
  recruitCost,
  resolveChoiceEvent,
  resolveLiveWave,
  resolveSortie,
} from "./military";
import { applyMilestoneReward, MILESTONES, milestoneView } from "./milestones";
import {
  bonusValue,
  devCost,
  devLevel,
  foyerAvailable,
  foyerDef,
  freshTerritoireState,
  isCaptured,
  natureDef,
  sectorOfFoyer,
  sectorUnlocked,
} from "./territoire";
import { consumeSortie, maxPeril, sortieAvailability } from "./bastion/sorties";
import { bilanStatus, canSpendPercee, spendPercee, validateBilan } from "./bilan";
import { applyTick, applyTickDetailed, totalGained } from "./tick";
import type { FinishedBuild, TickSummary } from "./tick";
import { getActiveSlot, setActiveSlot, slotHasSave, slotStorageKey, type SaveSlot } from "./slot";
import {
  TUTORIAL_DONE,
  type BuildingId,
  type BuildTask,
  type GameState,
  type HabitDayEntry,
  type ResourceId,
  type UnitId,
} from "./types";

export const SAVE_KEY = "evolve2_save_v1";
export const SAVE_VERSION = 12;
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
  /** Mode dev UNIQUEMENT : capture instantanément une créature de défense et une
   *  d'assaut (rareté Rare), assignées en défense — raccourci pour tester le pont
   *  La Mare -> Bastion sans dépendre du tirage de pêche. */
  devGrantBastionTestCards: () => void;
  /** Tick du moteur — appelé par un setInterval 1 s côté client,
   *  et une seule fois au chargement pour le gros tick de rattrapage offline. */
  collectTick: (now?: number) => void;
  /* ----- Compte rendu de session (pistes 1 & 5 du diagnostic UX) -----
     État TRANSITOIRE : jamais dans gameSlice, donc jamais persisté ni synchronisé.
     C'est de la mise en scène, pas de la donnée de partie. */
  /** Rapport du dernier gros rattrapage (absence ≥ offline_report.min_absence_minutes). */
  offlineSummary: TickSummary | null;
  dismissOfflineSummary: () => void;
  /** File des chantiers terminés SOUS LES YEUX du joueur (à célébrer un par un). */
  buildCelebrations: FinishedBuild[];
  dismissBuildCelebration: () => void;
  /** Lance l'amélioration d'un bâtiment sur le premier slot libre compatible (v8). */
  startUpgrade: (id: BuildingId) => boolean;
  /** Rachète un pas de temps sur un chantier en cours contre de l'énergie (v8).
   *  `slot` identifie le chantier ; renvoie false si le devis n'est pas payable
   *  ou si le quota de 25 % est épuisé. */
  boostBuild: (slot: number) => boolean;
  /** Encaisse un jalon atteint : verse sa récompense et l'inscrit dans
   *  `claimedMilestones` (piste 3). Renvoie false si le jalon est inconnu,
   *  déjà réclamé, ou pas encore atteint. */
  claimMilestone: (id: string) => boolean;
  /** Édite la saisie d'habitudes DU JOUR uniquement (anti-triche : la clé est
   *  toujours dayKey(Date.now()), l'historique passé est en lecture seule). */
  updateHabitToday: (patch: HabitPatch) => void;
  /** Consomme le « jour de grâce » du mois pour recoller une journée oubliée
   *  (piste 6). Renvoie false s'il n'y a rien de réparable ou si la grâce du
   *  mois est déjà partie. Le jour réparé ne rapporte AUCUNE énergie. */
  repairStreak: () => boolean;
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
  /** Marque les destinations du jour comme vues (badge de l'onglet NOYAU). */
  markNoyauSeen: () => void;
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
  /* ----- Bastion-Défense jouable (intégration profonde) ----- */
  /** Place une créature (pont La Mare -> Bastion, cardAssignments.defense) sur un
   *  slot barracks/mortier actif et vide, selon son rôle (defense/assaut). */
  placeBastionCreature: (
    speciesId: string,
    kind: "barracks" | "mortar",
    slotId: string,
  ) => boolean;
  /** Retire la créature d'un slot barracks/mortier — elle redevient disponible en réserve. */
  removeBastionCreature: (kind: "barracks" | "mortar", slotId: string) => void;
  /** Tirage pondéré payé en monnaie de combat : ajoute un bâtiment à la réserve. */
  recruitBastionBuilding: () => boolean;
  /** Recycle un bâtiment de la réserve contre la moitié de son coût en monnaie de combat. */
  recycleBastionBuilding: (uid: number) => boolean;
  /** Pose un bâtiment de la réserve sur un slot tourelle/support ou librement (mur/piège). */
  placeBastionBuilding: (
    uid: number,
    kind: "turret" | "support" | "wall" | "trap",
    target: { slotId?: string; supportIndex?: number; x?: number; y?: number },
  ) => boolean;
  /** Retire un bâtiment posé (tourelle/support/structure) vers la réserve. */
  removeBastionTurretToReserve: (slotId: string) => boolean;
  removeBastionSupportToReserve: (index: number) => boolean;
  removeBastionStructureToReserve: (structUid: number) => boolean;
  /** Déplace/échange deux slots tourelle/mortier/barracks (spécialisation attachée au slot). */
  moveBastionSlot: (
    kind: "turret" | "mortar" | "barracks",
    fromId: string,
    toId: string,
  ) => boolean;
  moveBastionSupport: (fromIndex: number, toIndex: number) => boolean;
  moveBastionStructure: (uid: number, x: number, y: number) => boolean;
  /** Achats Boutique Bastion (monnaie de combat, indépendante de l'économie principale). */
  buyBastionSlotUnlock: (kind: "turret" | "barracks" | "mortar") => boolean;
  buyBastionReserveCap: () => boolean;
  buyBastionSpecCap: () => boolean;
  buyBastionFoundations: () => boolean;
  buyBastionInWaveRespawn: () => boolean;
  /** Monte la "Vigie" d'un niveau (aperçu de la vague suivante). */
  buyBastionScouting: () => boolean;
  /** Choisit la branche a/b au palier suivant de l'arborescence d'une barracks. */
  chooseBastionTreeOption: (slotId: string, choice: "a" | "b") => boolean;
  /** À appeler QUAND le combat en direct démarre (avant BastionScene.startBattle) : pose
   *  le verrou bastion.liveBattleActive AVANT le tick de rattrapage, pour que la vague sur
   *  le point d'être jouée ne soit pas auto-résolue par-dessus si nextAttackAt est déjà
   *  échue au moment du tap (cf. JOURNAL.md, bug détecté en vérification). */
  beginBastionBattle: () => void;
  /** Pousse le résultat d'une bataille jouée en direct dans le Report/l'économie —
   *  avance nextAttackAt/waveCount exactement comme l'auto-résolution offline.
   *  `survivingStructures` (murs/pièges avec leurs PV mis à jour, ceux détruits en
   *  moins) remplace bastion.fieldStructures si fourni — les dégâts de bataille sont
   *  éphémères côté moteur (engine.ts) mais doivent être répercutés sur l'état persisté. */
  finishBastionBattle: (result: LiveWaveResult, survivingStructures?: FieldStructure[]) => void;

  /* ----- Les Sorties, La Dérive et le Bilan du soir (25/07) ----- */
  /** Lance une SORTIE : bataille à la demande contre le Bastion (`targetId: null`) ou contre
   *  un foyer de La Dérive. Débite l'énergie (sortie + préparatifs), consomme le quota du
   *  jour et pose le verrou de bataille. `false` si le quota, l'énergie ou une bataille déjà
   *  en cours l'interdisent. NE TOUCHE PAS au calendrier des vagues subies. */
  beginSortie: (
    targetId: string | null,
    peril: number,
    preparatifIds: string[],
    perceeOptionId?: string,
  ) => boolean;
  /** Résout la sortie en cours. Perdre ne coûte rien : ni ressource, ni garde, ni quota rendu. */
  finishSortie: (result: LiveWaveResult, survivingStructures?: FieldStructure[]) => void;
  /** Développe un gisement capturé d'un niveau (coût en ressource du gisement + combat). */
  developFoyer: (foyerId: string) => boolean;
  /** Mémorise le secteur consulté en dernier sur la carte (confort de navigation). */
  setTerritoireSector: (sectorId: string) => void;
  /** Valide le Bilan du soir : crédite les Percées et les sorties gratuites du lendemain. */
  validateBilanDuSoir: () => number;
  /** Dépense une Percée sur une option à effet immédiat (« Poussée de croissance »).
   *  Les options qui pilotent une bataille passent par `beginSortie`. */
  spendPerceeNow: (optionId: string) => boolean;
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
    noyauSeenDay: s.noyauSeenDay,
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
    bastion: s.bastion,
    territoire: s.territoire,
    bilan: s.bilan,
    claimedMilestones: s.claimedMilestones,
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
          jetons: Math.max(0, Math.min(jetonMax(s), s.jetons + (patch.jetons ?? 0))),
          fragments: Math.max(0, s.fragments + (patch.fragments ?? 0)),
        });
      },

      devGrantBastionTestCards: () => {
        if (get().activeSlot !== "dev") return; // garde-fou : jamais en perso
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        // Choix fixes (reproductibles) : une défense (barracks) et une assaut (mortier),
        // rareté Rare — aucune des deux ne double comme skin d'ennemi (cf. bastion_config.pathogens).
        addCatch(s, "crustace", 2, now, "peche");
        addCatch(s, "predateur", 2, now, "peche");
        const defense = [...new Set([...s.cardAssignments.defense, "crustace", "predateur"])].slice(
          0,
          effectiveReserveCap(s),
        );
        s.cardAssignments = { ...s.cardAssignments, defense };
        set(s);
      },

      offlineSummary: null,
      dismissOfflineSummary: () => set({ offlineSummary: null }),
      buildCelebrations: [],
      dismissBuildCelebration: () => set({ buildCelebrations: get().buildCelebrations.slice(1) }),

      collectTick: (now = Date.now()) => {
        const prev = get();
        const { state, summary } = applyTickDetailed(gameSlice(prev), now);
        // Une absence significative ET qui a produit quelque chose ⇒ rapport de retour.
        // En dessous du seuil, un chantier terminé se célèbre tout seul (le joueur
        // est devant l'écran : c'est une récompense, pas un bilan).
        const worthTelling =
          summary.finished.length > 0 ||
          summary.newReports.length > 0 ||
          totalGained(summary) > 0;
        const isReturn =
          summary.durationMs >= OFFLINE_REPORT.min_absence_minutes * 60_000 && worthTelling;
        if (isReturn) {
          set({ ...state, offlineSummary: summary, buildCelebrations: [] });
        } else if (summary.finished.length > 0) {
          set({
            ...state,
            buildCelebrations: [...prev.buildCelebrations, ...summary.finished],
          });
        } else {
          set(state);
        }
      },

      startUpgrade: (id) => {
        const now = Date.now();
        // On se met d'abord à jour (finalise un éventuel chantier échu, produit).
        const s = applyTick(gameSlice(get()), now);
        if (!isDesigned(id)) return false; // peche / defense / raid : "À venir"
        // Un même proto-organe ne peut pas être bâti deux fois en parallèle :
        // les niveaux sont séquentiels (le coût du Nv N+1 suppose le Nv N acquis).
        if (s.buildQueue.some((t) => t.buildingId === id)) return false;
        const current = s.buildings[id] ?? 0;
        const target = current + 1;
        if (target > maxLevel(id)) return false;
        // Slot compatible ? (les slots auxiliaires n'acceptent que les chantiers courts)
        const slot = findFreeSlot(s.buildings, s.buildQueue, buildTimeHours(id, target));
        if (slot < 0) return false;
        const cost = levelCost(id, target);
        if (!cost || !canAfford(s.resources, cost)) return false;

        const resources = { ...s.resources };
        for (const [res, amount] of Object.entries(cost)) {
          resources[res as keyof typeof resources] -= amount;
        }
        const task: BuildTask = {
          slot,
          buildingId: id,
          targetLevel: target,
          startedAt: now,
          endsAt: now + buildTimeMs(id, target),
          boostedMs: 0,
        };
        set({
          ...s,
          resources,
          buildQueue: [...s.buildQueue, task].sort((a, b) => a.slot - b.slot),
        });
        return true;
      },

      boostBuild: (slot) => {
        const now = Date.now();
        // Le tick d'abord : si le chantier vient d'échoir, il ne reste rien à
        // racheter et on ne doit surtout pas facturer l'énergie du joueur.
        const s = applyTick(gameSlice(get()), now);
        const task = s.buildQueue.find((t) => t.slot === slot);
        if (!task) return false;
        const quote = boostQuote(task, now);
        if (!quote) return false;
        if ((s.resources.energie ?? 0) < quote.cost) return false;

        // On rogne `endsAt` ET on mémorise le cumul racheté : sans `boostedMs`,
        // le quota se recalculerait sur une durée qui rétrécit — donc infini.
        const next: BuildTask = {
          ...task,
          endsAt: task.endsAt - quote.ms,
          boostedMs: task.boostedMs + quote.ms,
        };
        set({
          ...s,
          resources: { ...s.resources, energie: s.resources.energie - quote.cost },
          buildQueue: s.buildQueue.map((t) => (t.slot === slot ? next : t)),
        });
        return true;
      },

      claimMilestone: (id) => {
        const now = Date.now();
        // Tick d'abord : un jalon peut venir d'aboutir pendant que le joueur
        // regardait le bandeau (un chantier qui s'achève, une vague encaissée).
        const s = applyTick(gameSlice(get()), now);
        const cfg = MILESTONES.find((m) => m.id === id);
        if (!cfg) return false;
        const view = milestoneView(s, cfg);
        if (!view.achieved || view.claimed) return false;

        // On repart d'une copie : applyMilestoneReward mute un draft, jamais
        // l'objet vivant du store (règle d'immutabilité de Zustand).
        const next: GameState = {
          ...s,
          resources: { ...s.resources },
          claimedMilestones: [...s.claimedMilestones, id],
        };
        applyMilestoneReward(next, cfg.reward);
        set(next);
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

        // ----- Série (piste 6) : DÉRIVÉE de l'historique, plus de comptabilité
        // incrémentale. On réécrit la journée, puis on relit la chaîne. Toute la
        // logique délicate (aller-retour de validation le jour même, jours de
        // grâce, paliers retombés) tombe alors d'elle-même : il n'y a plus qu'un
        // seul chemin de calcul, celui que lisent aussi le badge du HUD et la
        // grille d'historique. -----
        const days = { ...habits.days, [key]: entry };
        const streak = computeStreak(days, habits.graceDays, key);
        const settled = settleStreakTiers(habits.streakAwards, streak, key);
        energyDelta += settled.energyDelta;

        const energie = Math.min(
          ENERGY_CAP,
          Math.max(0, state.resources.energie + energyDelta),
        );

        set({
          resources: { ...state.resources, energie },
          habits: {
            ...habits,
            days,
            streak,
            streakDay: key,
            bestStreak: Math.max(habits.bestStreak, streak),
            streakAwards: settled.awards,
          },
        });
      },

      repairStreak: () => {
        const now = Date.now();
        const key = dayKey(now);
        const state = get();
        const habits = state.habits;

        const day = repairableDay(habits, key);
        if (!day) return false;

        // Le jour réparé rejoint la chaîne mais ne rapporte rien par lui-même :
        // la grâce répare, elle ne paie pas. En revanche, si recoller la chaîne
        // fait franchir un palier, ce palier est légitimement dû — la série est
        // réellement intacte, ce serait punir deux fois que de le retenir.
        const graceDays = [...habits.graceDays, day];
        const streak = computeStreak(habits.days, graceDays, key);
        const settled = settleStreakTiers(habits.streakAwards, streak, key);
        const energie = Math.min(
          ENERGY_CAP,
          Math.max(0, state.resources.energie + settled.energyDelta),
        );

        set({
          resources: { ...state.resources, energie },
          habits: {
            ...habits,
            graceDays,
            graceUsedMonth: monthKey(key),
            streak,
            streakDay: key,
            bestStreak: Math.max(habits.bestStreak, streak),
            streakAwards: settled.awards,
          },
        });
        return true;
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
              endsAt: now + expeditionDurationH(s, offer.durationH) * 3_600_000,
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

      markNoyauSeen: () => {
        set({ noyauSeenDay: dayKey(Date.now()) });
      },

      buyJeton: () => {
        const now = Date.now();
        const s = applyTick(gameSlice(get()), now);
        const cost = MARE.jetons.cost_energie;
        if (s.jetons >= jetonMax(s) || s.resources.energie < cost) return false;
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
        // Ferrage précis (peu de temps hors chevauchement) : chance d'améliorer la rareté d'un cran (quality_luck).
        const luck =
          MARE.fishing.quality_luck[
            Math.min(MARE.fishing.quality_luck.length - 1, Math.max(0, quality))
          ] ?? 0;
        let [roll, seed] = rand(s.rngSeed);
        if (roll < luck) rarity = Math.min(MARE.rarities.length - 1, rarity + 1);
        [roll, seed] = rand(seed);
        const species = rollSpecies(roll);
        // Un pas de PRNG de plus pour la mise en scène (halo qui monte trop haut
        // puis retombe) : elle est ainsi rejouable, comme la rareté et l'espèce.
        [roll, seed] = rand(seed);
        const teaseTo = rollRevealTease(roll, rarity);
        s.rngSeed = seed;
        addCatch(s, species, rarity, now, "peche", teaseTo);
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
        [roll, seed] = rand(seed);
        const teaseTo = rollRevealTease(roll, rarity);
        s.rngSeed = seed;
        addCatch(s, species, rarity, now, "fragments", teaseTo);
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
          // "défense" alimente la réserve plaçable du Bastion-Défense jouable — son plafond est
          // désormais bastion.reserveCap (dynamique, achetable), pas la constante statique du JSON.
          const cap =
            slot === "defense" ? effectiveReserveCap(state) : MARE.assign_slots.expedition;
          if (next[slot].length >= cap) return false; // slot plein
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

      /* ----- Bastion-Défense jouable (intégration profonde) ----- */

      placeBastionCreature: (speciesId, kind, slotId) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!placeSpeciesCard(s, speciesId, kind, slotId)) return false;
        set(s);
        return true;
      },

      removeBastionCreature: (kind, slotId) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        removeSpeciesFromSlot(s, kind, slotId);
        set(s);
      },

      recruitBastionBuilding: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!recruitBuilding(s)) return false;
        set(s);
        return true;
      },

      recycleBastionBuilding: (uid) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!recycleBuilding(s, uid)) return false;
        set(s);
        return true;
      },

      placeBastionBuilding: (uid, kind, target) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!placeBuildingFromReserve(s, uid, kind, target)) return false;
        set(s);
        return true;
      },

      removeBastionTurretToReserve: (slotId) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!removeTurretToReserve(s, slotId)) return false;
        set(s);
        return true;
      },

      removeBastionSupportToReserve: (index) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!removeSupportToReserve(s, index)) return false;
        set(s);
        return true;
      },

      removeBastionStructureToReserve: (structUid) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!removeFieldStructureToReserve(s, structUid)) return false;
        set(s);
        return true;
      },

      moveBastionSlot: (kind, fromId, toId) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        const fn =
          kind === "turret" ? moveOrSwapTurret : kind === "mortar" ? moveOrSwapMortar : moveOrSwapBarracks;
        if (!fn(s, fromId, toId)) return false;
        set(s);
        return true;
      },

      moveBastionSupport: (fromIndex, toIndex) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!moveOrSwapSupport(s, fromIndex, toIndex)) return false;
        set(s);
        return true;
      },

      moveBastionStructure: (uid, x, y) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!moveFieldStructure(s, uid, x, y)) return false;
        set(s);
        return true;
      },

      buyBastionSlotUnlock: (kind) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buySlotUnlock(s, kind)) return false;
        set(s);
        return true;
      },

      buyBastionReserveCap: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buyReserveCap(s)) return false;
        set(s);
        return true;
      },

      buyBastionSpecCap: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buySpecCap(s)) return false;
        set(s);
        return true;
      },

      buyBastionFoundations: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buyFoundations(s)) return false;
        set(s);
        return true;
      },

      buyBastionInWaveRespawn: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buyInWaveRespawn(s)) return false;
        set(s);
        return true;
      },

      buyBastionScouting: () => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!buyScouting(s)) return false;
        set(s);
        return true;
      },

      chooseBastionTreeOption: (slotId, choice) => {
        const s = draftWithBastion(applyTick(gameSlice(get()), Date.now()));
        if (!chooseTreeOption(s, slotId, choice)) return false;
        set(s);
        return true;
      },

      beginBastionBattle: () => {
        const now = Date.now();
        // Le verrou est posé AVANT le tick de rattrapage (et non après) : si nextAttackAt
        // est déjà échue au moment du tap, on ne veut PAS que ce même tick auto-résolve la
        // vague que le joueur s'apprête justement à jouer en direct.
        const pre = draftWithBastion(gameSlice(get()));
        pre.bastion.liveBattleActive = true;
        pre.bastion.liveBattleStartedAt = now;
        const s = applyTick(pre, now);
        set(s);
      },

      finishBastionBattle: (result, survivingStructures) => {
        const now = Date.now();
        const s = draftWithBastion(applyTick(gameSlice(get()), now));
        if (survivingStructures) s.bastion.fieldStructures = survivingStructures;
        resolveLiveWave(s, result, now);
        set(s);
      },

      /* ----- Les Sorties, La Dérive et le Bilan du soir (25/07) ----- */

      beginSortie: (targetId, peril, preparatifIds, perceeOptionId) => {
        const now = Date.now();
        // Contrairement à beginBastionBattle, on tique AVANT : une sortie ne joue pas la
        // vague planifiée, donc rien à protéger d'une auto-résolution — et on veut au
        // contraire l'énergie la plus à jour possible pour vérifier le coût.
        const s = draftWithBastion(applyTick(gameSlice(get()), now));

        const foyer = targetId ? foyerDef(targetId) : null;
        if (targetId && !foyer) return false;
        if (foyer && !foyerAvailable(s.territoire, foyer)) return false;
        if (foyer && !sectorUnlocked(sectorOfFoyer(foyer.id)!, s.waveCount)) return false;
        // Un antre ne s'ouvre qu'avec une Percée : c'est la récompense du Bilan du soir.
        if (foyer && natureDef(foyer.nature).requires_percee && !perceeOptionId) return false;
        if (perceeOptionId && !canSpendPercee(s, perceeOptionId)) return false;

        const vestigeFree = bonusValue(s.territoire, "free_sortie");
        const avail = sortieAvailability(
          s.bastion,
          s.resources.energie,
          now,
          preparatifIds,
          vestigeFree,
        );
        if (!avail.ok) return false;

        const opt = perceeOptionId ? spendPercee(s, perceeOptionId) : null;
        if (perceeOptionId && !opt) return false;

        s.resources.energie = Math.max(0, s.resources.energie - avail.cost);
        consumeSortie(s.bastion, now);
        s.bastion.sortieTargetId = targetId;
        s.bastion.sortiePeril = Math.max(
          0,
          Math.min(maxPeril(), Math.max(Math.round(peril), opt?.forced_peril ?? 0)),
        );
        s.bastion.sortiePreparatifs = [...preparatifIds];
        s.bastion.sortiePercee = Boolean(opt);
        s.bastion.liveBattleActive = true;
        s.bastion.liveBattleStartedAt = now;
        set(s);
        return true;
      },

      finishSortie: (result, survivingStructures) => {
        const now = Date.now();
        const s = draftWithBastion(applyTick(gameSlice(get()), now));
        if (survivingStructures) s.bastion.fieldStructures = survivingStructures;
        resolveSortie(s, result, now);
        set(s);
      },

      developFoyer: (foyerId) => {
        const now = Date.now();
        const s = draftWithBastion(applyTick(gameSlice(get()), now));
        const foyer = foyerDef(foyerId);
        if (!foyer || !isCaptured(s.territoire, foyerId)) return false;
        const dev = devLevel(s.territoire, foyerId);
        const cost = devCost(foyer, dev, totalProductionPerHour(s.buildings));
        if (!cost) return false;
        if (s.resources[cost.resource] < cost.amount) return false;
        if (s.resources.combat < cost.combat) return false;
        s.resources[cost.resource] -= cost.amount;
        s.resources.combat -= cost.combat;
        const entry = s.territoire.foyers[foyerId];
        s.territoire.foyers[foyerId] = { ...entry, dev: dev + 1 };
        set(s);
        return true;
      },

      setTerritoireSector: (sectorId) => {
        const s = gameSlice(get());
        if (s.territoire.lastSectorId === sectorId) return;
        set({ territoire: { ...s.territoire, lastSectorId: sectorId } });
      },

      validateBilanDuSoir: () => {
        const now = Date.now();
        const s = draftWithBastion(applyTick(gameSlice(get()), now));
        if (!bilanStatus(s, now).ok) return 0;
        const gained = validateBilan(s, now);
        set(s);
        return gained;
      },

      spendPerceeNow: (optionId) => {
        const now = Date.now();
        const s = draftWithBastion(applyTick(gameSlice(get()), now));
        const opt = bilanOptionDef(optionId);
        // Seules les options à effet immédiat passent ici ; les autres pilotent une sortie.
        if (!opt?.production_hours) return false;
        if (!canSpendPercee(s, optionId)) return false;
        if (!spendPercee(s, optionId)) return false;
        const prod = totalProductionPerHour(s.buildings);
        for (const [res, perHour] of Object.entries(prod)) {
          const id = res as ResourceId;
          const gain = (perHour ?? 0) * opt.production_hours;
          if (gain <= 0) continue;
          s.resources[id] = Math.min(
            resourceCap(id, s.buildings),
            s.resources[id] + gain,
          );
        }
        set(s);
        return true;
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
        // v4 -> v5 : intégration profonde du mini-jeu jouable Bastion-Défense — nouvelle
        // ressource `combat` (absente des vieilles sauvegardes) + tout l'état de partie du Bastion.
        if (version < 5 || state.bastion === undefined) {
          if (state.resources && state.resources.combat === undefined) {
            state.resources.combat = 0;
          }
          state.bastion = freshBastionState();
        }
        // v5 -> v6 : verrou liveBattleActive/liveBattleStartedAt (anti double-résolution
        // entre un combat en direct et l'auto-résolution offline, cf. JOURNAL.md).
        if (version < 6 || state.bastion.liveBattleActive === undefined) {
          state.bastion.liveBattleActive = false;
          state.bastion.liveBattleStartedAt = 0;
        }
        // v6 -> v7 : "Vigie" (aperçu de la vague suivante, achetable en Boutique).
        if (version < 7 || state.bastion.scoutLevel === undefined) {
          state.bastion.scoutLevel = 0;
        }
        // v7 -> v8 : file de construction multi-slots. L'ancien `buildQueue` était
        // un objet unique ou null ; il devient un tableau (slot 0 = chantier principal).
        if (version < 8 || !Array.isArray(state.buildQueue)) {
          const legacy = state.buildQueue as unknown as
            | (Omit<BuildTask, "slot" | "boostedMs"> & Partial<BuildTask>)
            | null
            | undefined;
          state.buildQueue = legacy ? [{ ...legacy, slot: 0, boostedMs: 0 }] : [];
        }
        // v8 -> v9 : jalons & Points d'Âge. On repart d'une liste VIDE même pour
        // une partie déjà avancée : les jalons déjà atteints deviennent donc
        // immédiatement réclamables. C'est volontaire — un joueur de longue date
        // ouvre le bandeau sur une pile de récompenses à encaisser plutôt que sur
        // un tableau de cases grisées qu'il n'a pas vu se cocher.
        if (version < 9 || !Array.isArray(state.claimedMilestones)) {
          state.claimedMilestones = [];
        }
        // v9 -> v10 : série hebdomadaire + jour de grâce (piste 6). Trois choses :
        //  - `milestoneAwards` (7/30/90) devient `streakAwards` ; on ne garde que
        //    les clés qui correspondent encore à un palier, pour ne PAS re-payer
        //    le palier 7 j à quelqu'un qui l'a déjà touché. Les paliers
        //    intermédiaires nouvellement créés (14, 21, 28…) sont dus à un joueur
        //    dont la série les dépasse déjà : le prochain tick les lui verse.
        //  - `lastStreakDate` disparaît : la série est désormais dérivée de
        //    l'historique. `streakDay: null` force ce recalcul au premier tick,
        //    ce qui répare au passage les séries devenues fausses.
        //  - le filet de sécurité démarre neuf (aucune grâce consommée).
        if (version < 10 || state.habits.streakAwards === undefined) {
          const legacy = state.habits as unknown as {
            milestoneAwards?: Record<string, string>;
            lastStreakDate?: string | null;
          };
          const known = new Set(STREAK_TIERS.map((t) => String(t.days)));
          const kept: Record<string, string> = {};
          for (const [k, v] of Object.entries(legacy.milestoneAwards ?? {})) {
            if (known.has(k)) kept[k] = v;
          }
          delete legacy.milestoneAwards;
          delete legacy.lastStreakDate;
          state.habits.streakAwards = kept;
          state.habits.streakDay = null;
          state.habits.graceDays = [];
          state.habits.graceUsedMonth = null;
        }
        // v10 -> v11 : badge « nouvelles destinations » sur l'onglet NOYAU.
        // On part de `null` (= jamais ouvert aujourd'hui) plutôt que du jour
        // courant : à sa prochaine ouverture, un joueur existant voit le badge
        // une fois et découvre ainsi que ses 4 destinations tournent chaque jour
        // — c'est précisément l'information qui manquait.
        if (version < 11 || state.noyauSeenDay === undefined) {
          state.noyauSeenDay = null;
        }
        // v11 -> v12 : La Dérive (carte de foyers) + Les Sorties + le Bilan du soir.
        // Tout part de zéro, et c'est le bon choix : aucun foyer capturé (la carte
        // se découvre), aucun compteur de sortie entamé (le quota gratuit du jour
        // est donc plein dès la première ouverture), aucune Percée en stock. Un
        // joueur existant ne perd rien et ne saute aucune étape de découverte.
        if (version < 12 || state.territoire === undefined) {
          state.territoire = freshTerritoireState(state.lastTick || state.createdAt || 0);
        }
        if (version < 12 || state.bilan === undefined) {
          state.bilan = { lastDay: null, percees: 0, perceesTotal: 0, perceesSpent: 0 };
        }
        // Les compteurs de sortie vivent dans BastionState : une vieille sauvegarde
        // n'en a pas. `sortieDay: null` suffit — `sortiesUsedToday` renvoie alors 0.
        if (version < 12 || state.bastion.sortieDay === undefined) {
          state.bastion.sortieDay = null;
          state.bastion.sortieCount = 0;
          state.bastion.bonusSortieDay = null;
          state.bastion.bonusSorties = 0;
          state.bastion.sortieTargetId = null;
          state.bastion.sortiePeril = 0;
          state.bastion.sortiePreparatifs = [];
          state.bastion.sortiePercee = false;
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
