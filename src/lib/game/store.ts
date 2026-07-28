/* Store Zustand du jeu — persistance localStorage (clé evolve2_save_v1).
   Le moteur (economy/tick/habits) reste pur ; le store ne fait qu'orchestrer. */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  acceptsPostes,
  boostQuote,
  buildTimeHours,
  canAfford,
  effectiveBuildTimeMs,
  findFreeSlot,
  freshGameState,
  isDesigned,
  levelCost,
  maxLevel,
  OFFLINE_REPORT,
  posteOf,
  posteSlots,
  resourceCap,
  SAVE_VERSION,
  stateStorageCap,
  totalProductionPerHour,
} from "./economy";
import { BASTION, effectiveReserveCap, freshBastionState, hasGarrison } from "./bastion/config";
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
  canEditDay,
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
  catchesToPlayable,
  isCardPlayable,
  jetonMax,
  MARE,
  rollEdition,
  rollRarity,
  rollRevealTease,
  rollSpecies,
  slotCost,
  slotsUsed,
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
import { dailyViews } from "./daily";
import { GATED_TABS } from "./progression";
import {
  bonusValue,
  crewOf,
  crewSlots,
  devCost,
  devLevel,
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
  type FoyerState,
  type GameState,
  type HabitDayEntry,
  type PosteAssignments,
  type ResourceId,
  type TerritoireState,
  type UnitId,
} from "./types";

export const SAVE_KEY = "evolve2_save_v1";
/* La constante est définie dans `economy.ts` (c'est `freshGameState` qui estampille une partie
   neuve, et economy.ts ne peut pas importer ce module). On la réexporte ici, où la chaîne de
   migrations la consomme, pour que rien ne change côté appelants. */
export { SAVE_VERSION } from "./economy";
export type { SaveSlot } from "./slot";

/** Champs éditables d'une saisie du jour (le reste est recalculé). */
export type HabitPatch = Partial<
  Pick<
    HabitDayEntry,
    | "caloriesEaten"
    | "caloriesBurned"
    | "caloriesDone"
    | "steps"
    | "mf"
    | "alilou"
    | "rituals"
    | "repas"
    | "devisDemande"
    | "devisSigne"
  >
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
  /** Encaisse un objectif du jour atteint (amélioration n°2). Même contrat que
   *  claimMilestone ; la liste des réclamés se réarme d'elle-même au changement
   *  de clé calendaire. */
  claimDailyObjective: (id: string) => boolean;
  /** Marque la carte d'explication d'un onglet comme vue (amélioration n°6) —
   *  éteint le badge « nouveau » et n'affichera plus la carte. */
  markTabIntroSeen: (id: string) => void;
  /** Édite la saisie d'habitudes d'une journée de la FENÊTRE DE SAISIE
   *  (aujourd'hui + les SAISIE_WINDOW_DAYS − 1 jours précédents). Toute clé
   *  future ou hors fenêtre est ignorée sans bruit — le garde-fou est ici, pas
   *  seulement dans l'UI. Une journée renseignée après son jour reçoit le
   *  marqueur `late` : elle paie son énergie en entier, mais ne tient pas la
   *  série (cf. habits_config.json → saisie). */
  updateHabitDay: (key: string, patch: HabitPatch) => void;
  /** Raccourci sur la journée en cours — le cas de très loin le plus fréquent. */
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
  /** Poste/retire une créature à l'équipage de récolte d'un gisement capturé.
   *  Exclusivité stricte : une créature ne tient qu'UN poste à la fois (défense,
   *  expédition, ou un seul gisement) — la poster la retire d'office d'ailleurs. */
  toggleCrew: (foyerId: string, speciesId: string) => boolean;
  /** Poste/retire une créature dans un organe de la base (rôle "producer").
   *  Gratuit et réversible à volonté : facturer l'expérimentation punirait exactement
   *  ce qu'on veut encourager — essayer des combinaisons.
   *  Même exclusivité stricte que `toggleCrew` : une créature ne fait qu'un métier. */
  togglePoste: (buildingId: BuildingId, speciesId: string) => boolean;
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

/** Retire une espèce de TOUS les équipages de récolte de la carte.
 *  Renvoie l'objet d'origine si elle n'était postée nulle part — pas de nouvel objet,
 *  donc pas de re-rendu inutile des sélecteurs qui lisent `territoire`. */
function stripFromCrews(t: TerritoireState, speciesId: string): TerritoireState {
  let touched = false;
  const foyers: Record<string, FoyerState> = {};
  for (const [id, st] of Object.entries(t.foyers)) {
    if (st.crew?.includes(speciesId)) {
      touched = true;
      foyers[id] = { ...st, crew: st.crew.filter((s) => s !== speciesId) };
    } else {
      foyers[id] = st;
    }
  }
  return touched ? { ...t, foyers } : t;
}

/** Retire une espèce de TOUS les postes de travail des organes.
 *  Même contrat que `stripFromCrews` : si elle ne travaillait nulle part, on rend
 *  l'objet d'origine tel quel. La production se lit à travers `postes` — lui donner
 *  une nouvelle identité pour rien réveillerait le HUD et la carte de La Dérive. */
function stripFromPostes(postes: PosteAssignments, speciesId: string): PosteAssignments {
  let touched = false;
  const out: PosteAssignments = {};
  for (const [id, crew] of Object.entries(postes)) {
    if (!crew) continue;
    if (crew.includes(speciesId)) {
      touched = true;
      out[id as BuildingId] = crew.filter((s) => s !== speciesId);
    } else {
      out[id as BuildingId] = crew;
    }
  }
  return touched ? out : postes;
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
    postes: s.postes,
    fauneXp: s.fauneXp,
    fauneLevel: s.fauneLevel,
    bastion: s.bastion,
    territoire: s.territoire,
    bilan: s.bilan,
    claimedMilestones: s.claimedMilestones,
    dailyClaimed: s.dailyClaimed,
    tabIntroSeen: s.tabIntroSeen,
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
        // On pêche jusqu'à ce que la carte soit JOUABLE, pas une seule fois : le
        // verrou des doublons s'applique aussi à la triche, sinon le test place des
        // cartes que le vrai jeu refuserait et ne teste plus rien.
        for (const id of ["crustace", "predateur"]) {
          do addCatch(s, id, 2, 0, now, "peche");
          while (!isCardPlayable(s.collection[id]));
        }
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
          // Le premier chantier d'une partie neuve est SCRIPTÉ à quelques minutes
          // (economy_config.json -> tutorial) : le nouveau joueur voit sa première
          // mue avant de fermer l'application. Toutes les autres durées sont celles
          // de la config — la lenteur savoureuse reste un pilier.
          endsAt: now + effectiveBuildTimeMs(s, id, target),
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

      claimDailyObjective: (id) => {
        const now = Date.now();
        // Tick d'abord, comme claimMilestone : l'objectif peut venir d'aboutir.
        const s = applyTick(gameSlice(get()), now);
        const view = dailyViews(s, now).find((v) => v.cfg.id === id);
        if (!view || !view.achieved || view.claimed) return false;

        const today = dayKey(now);
        const ids = s.dailyClaimed.day === today ? s.dailyClaimed.ids : [];
        const next: GameState = {
          ...s,
          resources: { ...s.resources },
          // Le changement de jour réarme la liste ici même : une liste d'hier est
          // simplement remplacée, jamais consultée.
          dailyClaimed: { day: today, ids: [...ids, id] },
        };
        // Les récompenses ont la même forme que celles des jalons : on réutilise
        // le même verseur (écrêté par le stockage, jamais de dépassement).
        applyMilestoneReward(next, view.cfg.reward);
        set(next);
        return true;
      },

      markTabIntroSeen: (id) => {
        const seen = get().tabIntroSeen;
        if (seen.includes(id)) return;
        set({ tabIntroSeen: [...seen, id] });
      },

      updateHabitDay: (key, patch) => {
        const todayKey = dayKey(Date.now());
        // Le futur ne se remplit pas, et le passé se referme au bord de la
        // fenêtre. Le refus vit ici : l'UI ne propose que des jours valides,
        // mais elle n'est pas le dernier rempart (import de sauvegarde, cloud,
        // horloge reculée…).
        if (!canEditDay(key, todayKey)) return;

        const state = get();
        const habits = state.habits;
        const prev = habits.days[key] ?? emptyDayEntry();

        const entry: HabitDayEntry = { ...prev };
        // Bilan calorique (28/07/2026) : deux saisies brutes séparées (mangé,
        // dépensé) remplacent l'ancien solde signé unique — cf. habits_config.json
        // -> bareme.$comment_2807. Chacune "valide" la journée calorique du jour
        // dès qu'elle est touchée, comme avant.
        if (patch.caloriesEaten !== undefined) {
          entry.caloriesEaten = clampHabitValue("calories", patch.caloriesEaten);
          entry.caloriesDone = true;
        }
        if (patch.caloriesBurned !== undefined) {
          entry.caloriesBurned = clampHabitValue("calories", patch.caloriesBurned);
          entry.caloriesDone = true;
        }
        if (patch.caloriesDone !== undefined) entry.caloriesDone = patch.caloriesDone;
        if (patch.steps !== undefined) entry.steps = clampHabitValue("steps", patch.steps);
        if (patch.mf !== undefined) entry.mf = clampHabitValue("mf", patch.mf);
        if (patch.alilou !== undefined) entry.alilou = clampHabitValue("alilou", patch.alilou);
        if (patch.rituals !== undefined) entry.rituals = clampHabitValue("rituals", patch.rituals);
        if (patch.repas !== undefined) entry.repas = clampHabitValue("repas", patch.repas);
        if (patch.devisDemande !== undefined) {
          entry.devisDemande = clampHabitValue("devisDemande", patch.devisDemande);
        }
        if (patch.devisSigne !== undefined) {
          entry.devisSigne = clampHabitValue("devisSigne", patch.devisSigne);
        }

        const { energy, validatedCount } = evaluateEntry(entry, habits.calorieGoal);
        entry.energy = energy;
        entry.validatedCount = validatedCount;

        // ----- NOTÉE APRÈS COUP. Une journée remplie hors de son jour paie son
        // énergie mais ne tiendra pas la série (cf. dayHoldsStreak). La garde
        // `dejaTenuALHeure` est le point délicat de toute la fonctionnalité :
        // sans elle, rectifier le nombre de pas d'hier ferait tomber une série
        // de trente jours pour une faute de frappe. Une journée déjà tenue à
        // l'heure ne peut donc JAMAIS devenir une journée notée après coup. -----
        const dejaTenuALHeure = prev.validatedCount > 0 && !prev.late;
        entry.late = key !== todayKey && !dejaTenuALHeure && validatedCount > 0;

        // Delta d'énergie dû à l'édition (une journée re-modifiée ne crédite que
        // la différence — jamais deux fois le total).
        let energyDelta = energy - prev.energy;

        // ----- Série (piste 6) : DÉRIVÉE de l'historique, plus de comptabilité
        // incrémentale. On réécrit la journée, puis on relit la chaîne. Toute la
        // logique délicate (aller-retour de validation le jour même, jours de
        // grâce, paliers retombés) tombe alors d'elle-même : il n'y a plus qu'un
        // seul chemin de calcul, celui que lisent aussi le badge du HUD et la
        // grille d'historique. -----
        const days = { ...habits.days, [key]: entry };
        // La chaîne se lit TOUJOURS depuis aujourd'hui, quelle que soit la
        // journée éditée : c'est la série en cours qu'on met à jour, pas celle
        // qui courait le jour qu'on est en train de remplir. Même raison pour
        // les paliers — leur date d'attribution (et donc la reprise possible)
        // se juge au jour courant.
        const streak = computeStreak(days, habits.graceDays, todayKey);
        const settled = settleStreakTiers(habits.streakAwards, streak, todayKey);
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
            streakDay: todayKey,
            bestStreak: Math.max(habits.bestStreak, streak),
            streakAwards: settled.awards,
          },
        });
      },

      updateHabitToday: (patch) => get().updateHabitDay(dayKey(Date.now()), patch),

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
        // L'édition est le SECOND axe, tiré à part de la rareté : c'est ce qui
        // permet à une commune de tomber polychrome (cf. mare_config -> $comment_editions).
        [roll, seed] = rand(seed);
        const edition = rollEdition(roll, luck);
        s.rngSeed = seed;
        addCatch(s, species, rarity, edition, now, "peche", teaseTo);
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
        // Fusion de fragments : même tirage d'édition qu'à la pêche, mais sans
        // chance de tension (on ne ferre pas un fragment), donc luck = 0.
        [roll, seed] = rand(seed);
        const edition = rollEdition(roll, 0);
        s.rngSeed = seed;
        addCatch(s, species, rarity, edition, now, "fragments", teaseTo);
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
          // Le verrou des doublons : une seule prise donne la carte, pas le droit de la
          // jouer. On ne referme jamais la porte derrière une carte déjà en poste — la
          // vérification est à l'AJOUT, jamais au retrait (cf. cards.isCardPlayable).
          if (!isCardPlayable(state.collection[speciesId])) return false;
          // "défense" alimente la réserve plaçable du Bastion-Défense jouable — son plafond est
          // désormais bastion.reserveCap (dynamique, achetable), pas la constante statique du JSON.
          const cap =
            slot === "defense" ? effectiveReserveCap(state) : MARE.assign_slots.expedition;
          // On compte les PLACES, pas les cartes : une négative n'en occupe aucune
          // (cf. cards.slotCost) et peut donc toujours entrer, même sur une liste pleine.
          const cost = slotCost(state.collection[speciesId]);
          if (slotsUsed(next[slot], state.collection) + cost > cap) return false; // slot plein
          next[slot] = [...next[slot], speciesId];
        }
        // Exclusivité : une créature en défense ou en expédition quitte son poste de
        // récolte ET son poste d'organe. Sans ça, la même carte compterait deux fois
        // (bonus militaire ET rendement) et se verrait travailler à la base tout en
        // étant censée garder le Bastion — incohérent à l'écran comme à l'équilibrage.
        const territoire = inSlot ? get().territoire : stripFromCrews(get().territoire, speciesId);
        const postes = inSlot ? get().postes : stripFromPostes(get().postes, speciesId);
        set({ cardAssignments: next, territoire, postes });
        return true;
      },

      toggleCrew: (foyerId, speciesId) => {
        const state = get();
        if (!state.collection[speciesId] || !SPECIES_IDS.includes(speciesId)) return false;
        const foyer = foyerDef(foyerId);
        // On ne poste que sur un gisement effectivement pris : c'est le lieu qui
        // porte l'équipage, il faut donc qu'il nous appartienne.
        if (!foyer || foyer.nature !== "gisement") return false;
        if (!isCaptured(state.territoire, foyerId)) return false;

        const current = crewOf(state.territoire, foyerId);
        if (current.includes(speciesId)) {
          const st = state.territoire.foyers[foyerId];
          set({
            territoire: {
              ...state.territoire,
              foyers: {
                ...state.territoire.foyers,
                [foyerId]: { ...st, crew: current.filter((id) => id !== speciesId) },
              },
            },
          });
          return true;
        }

        if (!isCardPlayable(state.collection[speciesId])) return false; // verrou des doublons
        // Places et non cartes : une négative ne consomme rien (cf. cards.slotCost).
        if (
          slotsUsed(current, state.collection) + slotCost(state.collection[speciesId]) >
          crewSlots(state.territoire, foyerId)
        )
          return false; // gisement plein
        // Exclusivité, dans l'autre sens : poster une créature la retire de la défense,
        // des expéditions, de tout autre gisement et de tout organe de la base.
        const base = stripFromCrews(state.territoire, speciesId);
        const st = base.foyers[foyerId];
        set({
          postes: stripFromPostes(state.postes, speciesId),
          cardAssignments: {
            defense: state.cardAssignments.defense.filter((id) => id !== speciesId),
            expedition: state.cardAssignments.expedition.filter((id) => id !== speciesId),
          },
          territoire: {
            ...base,
            foyers: {
              ...base.foyers,
              [foyerId]: { ...st, crew: [...(st.crew ?? []), speciesId] },
            },
          },
        });
        return true;
      },

      togglePoste: (buildingId, speciesId) => {
        const state = get();
        if (!state.collection[speciesId] || !SPECIES_IDS.includes(speciesId)) return false;
        // Seuls les organes qui produisent quelque chose ont des postes — la liste
        // n'est écrite nulle part, elle se déduit du rôle déclaré dans le config.
        if (!acceptsPostes(buildingId)) return false;
        const slots = posteSlots(buildingId, state.buildings[buildingId] ?? 0);
        if (slots <= 0) return false; // organe pas encore bâti

        const current = posteOf(state, buildingId);
        if (current.includes(speciesId)) {
          set({
            postes: { ...state.postes, [buildingId]: current.filter((id) => id !== speciesId) },
          });
          return true;
        }
        if (!isCardPlayable(state.collection[speciesId])) return false; // verrou des doublons
        // Places et non cartes : une négative ne consomme rien (cf. cards.slotCost).
        if (slotsUsed(current, state.collection) + slotCost(state.collection[speciesId]) > slots)
          return false; // toutes les places sont prises

        // Exclusivité : poster une créature la retire de la défense, des expéditions,
        // des équipages de gisement et de tout autre organe. Sans ça la même carte
        // compterait deux fois à l'équilibrage, et se verrait travailler à deux
        // endroits à la fois une fois la mise en scène branchée.
        const base = stripFromPostes(state.postes, speciesId);
        set({
          postes: { ...base, [buildingId]: [...(base[buildingId] ?? []), speciesId] },
          cardAssignments: {
            defense: state.cardAssignments.defense.filter((id) => id !== speciesId),
            expedition: state.cardAssignments.expedition.filter((id) => id !== speciesId),
          },
          territoire: stripFromCrews(state.territoire, speciesId),
        });
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
        // Étape D : aucun foyer ne se ferme jamais — un foyer pris se reprend à un
        // palier relevé. Seule l'ouverture du secteur garde encore la porte.
        if (foyer && !sectorUnlocked(sectorOfFoyer(foyer.id)!, s.waveCount)) return false;
        // Un antre ne s'ouvre qu'avec une Percée : c'est la récompense du Bilan du soir.
        if (foyer && natureDef(foyer.nature).requires_percee && !perceeOptionId) return false;
        if (perceeOptionId && !canSpendPercee(s, perceeOptionId)) return false;

        // Le garde-fou n°6 vit AUSSI ici, pas seulement dans l'UI : une sauvegarde
        // importée ou un rappel système ne doivent jamais lancer une bataille à vide.
        if (!hasGarrison(s.bastion)) return false;

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
          Math.min(maxPeril(s.bastion.bestPeril), Math.max(Math.round(peril), opt?.forced_peril ?? 0)),
        );
        s.bastion.sortiePreparatifs = [...preparatifIds];
        s.bastion.sortiePerceeId = opt ? perceeOptionId! : null;
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
        /* `stateStorageCap` et non `storageCap` : la fiche du foyer chiffre le coût
           avec ce calcul-là (vestiges `storage_mult` compris). Les deux divergeaient
           dès qu'un vestige de stockage était pris — l'écran annonçait un prix, le
           moteur en prélevait un autre. Le devis se calcule d'une seule façon, et
           c'est celle qui reflète la réserve réelle du joueur : un développement
           coûte une part de ce que sa base peut VRAIMENT contenir. */
        const cost = devCost(foyer, dev, stateStorageCap(s));
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
        // ----- Bilan calorique (28/07/2026, v20 -> v21) : DOIT s'exécuter avant
        // tout autre bloc, quel que soit `version`. Les blocs v16->17, v17->18 et
        // v19->20 ci-dessous appellent tous evaluateEntry() avec le code ACTUEL
        // de ce fichier — celui qui lit désormais caloriesEaten/caloriesBurned,
        // plus l'ancien champ signé `calories`. Une sauvegarde ancienne qui
        // traverse toute la chaîne en un seul appel de migrate() calculerait donc
        // NaN dans ces blocs si la conversion n'était pas faite en premier (cf.
        // JOURNAL.md, piège « un harnais qui lit une clé supprimée ne plante pas,
        // il mesure NaN »). Garde idempotente sur le CHAMP, pas sur `version` :
        // une sauvegarde déjà convertie ne perd rien à repasser ici. L'écart
        // mangé − dépensé reconstruit EXACTEMENT l'ancien solde signé — aucune
        // donnée n'est inventée, seule la répartition entre les deux côtés est
        // arbitraire (l'autre côté posé à 0).
        for (const entry of Object.values(state.habits?.days ?? {})) {
          if (entry.caloriesEaten === undefined) {
            const legacy = (entry as unknown as { calories?: number }).calories ?? 0;
            entry.caloriesEaten = legacy > 0 ? legacy : 0;
            entry.caloriesBurned = legacy < 0 ? -legacy : 0;
          }
        }
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
          state.bastion.sortiePerceeId = null;
        }
        // v12 -> v13 : le drapeau booléen `sortiePercee` devient l'ID de l'option de
        // Percée dépensée. Un simple booléen ne permettait pas de distinguer une Vague
        // de Percée (×3 de butin, fragments garantis) d'un Assaut d'Antre (qui ne fait
        // qu'ouvrir la porte) — la résolution accordait la première à l'une comme à
        // l'autre. Aucune donnée à convertir : aucune interface ne pouvait encore lancer
        // de sortie, le champ n'a donc jamais valu autre chose que `false`.
        if (version < 13 || state.bastion.sortiePerceeId === undefined) {
          state.bastion.sortiePerceeId = null;
        }
        // v13 -> v14 : l'équipage de récolte. Chaque foyer déjà pris reçoit un équipage
        // VIDE — et c'est exactement la bonne valeur : un équipage vide vaut un
        // multiplicateur de 1, donc le revenu d'un joueur existant ne bouge pas d'un
        // point tant qu'il n'a posté personne. Il découvre simplement, sur la fiche de
        // ses gisements, une place de travail qui l'attend.
        if (version < 14) {
          for (const st of Object.values(state.territoire?.foyers ?? {})) {
            if (st.crew === undefined) st.crew = [];
          }
        }
        // v14 -> v15 : les postes de travail. Les trois tables partent vides, et c'est
        // une valeur PROUVÉE neutre : aucun poste ⇒ posteBonus = 0 ⇒ posteMult = 1
        // exactement, donc stateProductionPerHour rend le même nombre qu'avant, au bit
        // près. Une sauvegarde existante ne gagne ni ne perd un point de production ;
        // elle découvre juste des places de travail vides dans ses organes.
        if (version < 15 || state.postes === undefined) {
          state.postes = {};
          state.fauneXp = {};
          state.fauneLevel = {};
        }
        // v15 -> v16 : l'échelle de Péril n'a plus de dernier barreau, et le Bastion
        // retient le plus haut cran remporté pour savoir lequel proposer ensuite.
        // 0 est la bonne valeur de départ pour une sauvegarde existante : les cinq crans
        // nommés restent tous ouverts (`maxPeril` ne descend jamais sous l'échelle
        // écrite), le joueur ne perd donc aucun accès — il gagne seulement la suite.
        if (version < 16 || state.bastion.bestPeril === undefined) {
          state.bastion.bestPeril = 0;
        }
        // v16 -> v17 : le barème quotidien monte (×1,84) et descend dans
        // habits_config.json. Une sauvegarde existante porte un historique payé à
        // l'ANCIEN tarif. On le RÉÉVALUE au nouveau et on verse la différence.
        //
        // C'est le choix honnête, et il n'est pas gratuit à écrire — mais laisser
        // le passé au vieux prix donnerait une grille à deux régimes, pâle avant
        // la mise à jour et vive après, pour un effort réel identique. Or cette
        // grille est la seule preuve que le jeu rend à Ali de ce qu'il a fait :
        // elle n'a pas le droit de dévaluer rétroactivement trois mois de travail.
        // Le recalcul repart des valeurs BRUTES de chaque saisie (pas, tâches,
        // rituels), qui n'ont pas bougé d'un iota — aucune donnée n'est inventée.
        // Le solde ne peut que monter : aucun taux n'a baissé (la pénalité de
        // surplus calorique, elle, est restée exactement où elle était).
        if (version < 17) {
          let delta = 0;
          for (const entry of Object.values(state.habits?.days ?? {})) {
            const { energy, validatedCount } = evaluateEntry(entry, state.habits.calorieGoal);
            delta += energy - entry.energy;
            entry.energy = energy;
            entry.validatedCount = validatedCount;
          }
          if (delta > 0) {
            state.resources.energie = Math.min(
              ENERGY_CAP,
              (state.resources.energie ?? 0) + delta,
            );
          }
        }
        // v17 -> v18 : les deux postes de travail se comptent en HEURES, plus en
        // tâches. Les champs `mf` et `alilou` d'une sauvegarde existante portent
        // donc des nombres qui ne veulent plus dire ce qu'ils disent, et les
        // relire tels quels reviendrait à décider qu'une tâche durait une heure —
        // une donnée inventée, et à la baisse.
        //
        // La conversion est choisie pour ne JAMAIS dévaluer une journée déjà
        // vécue, jamais l'inverse :
        //   Magic Focus : 5 ⚡ la tâche -> 5 ⚡ l'heure, donc 1 tâche = 1 h. La
        //     valeur est conservée à l'unité près, et l'ancien plafond de 10
        //     tient dans le nouveau de 12 : aucune journée n'est rabotée.
        //   Chantier    : 12 ⚡ la tâche -> 7 ⚡ l'heure, donc 1 tâche = 2 h
        //     (14 ⚡). L'arrondi va vers le HAUT à dessein : une tâche de chantier
        //     était un bloc lourd — il n'y en avait que 3 par jour au maximum —
        //     et arrondir à 1 h aurait fait fondre le samedi d'Ali de 36 à 21 ⚡.
        //     Le plafond de 3 tâches devient 6 h, sous le nouveau plafond de 8.
        // Le recalcul qui suit repart des valeurs converties ; le solde ne peut
        // que monter, comme en v17.
        if (version < 18) {
          let delta = 0;
          for (const entry of Object.values(state.habits?.days ?? {})) {
            entry.mf = clampHabitValue("mf", entry.mf ?? 0);
            entry.alilou = clampHabitValue("alilou", (entry.alilou ?? 0) * 2);
            const { energy, validatedCount } = evaluateEntry(entry, state.habits.calorieGoal);
            delta += energy - entry.energy;
            entry.energy = energy;
            entry.validatedCount = validatedCount;
          }
          if (delta > 0) {
            state.resources.energie = Math.min(
              ENERGY_CAP,
              (state.resources.energie ?? 0) + delta,
            );
          }
        }
        // v18 -> v19 : le verrou des doublons. Une espèce tenue à un seul
        // exemplaire n'a plus le droit d'être mise au travail (cf.
        // cards.isCardPlayable). Une sauvegarde existante contient forcément des
        // créatures de niveau 1 déjà assignées, postées sur un gisement ou dans
        // un organe : appliquer la règle telle quelle les mettrait toutes à la
        // porte d'un coup — une perte sèche de rendement, décidée par une règle
        // que le joueur n'a pas encore lue.
        //
        // On fait donc l'inverse du licenciement : toute créature DÉJÀ au travail
        // se voit créditer la prise qui lui manque. Elle a fait ses preuves, elle
        // est maîtrisée. Le verrou s'applique intégralement à tout le reste — et
        // c'est le gros de la collection, puisque les places au travail se
        // comptent sur les doigts d'une main tandis que les espèces sont 62.
        if (version < 19) {
          const employed = new Set<string>([
            ...(state.cardAssignments?.defense ?? []),
            ...(state.cardAssignments?.expedition ?? []),
            ...Object.values(state.territoire?.foyers ?? {}).flatMap((f) => f.crew ?? []),
            ...Object.values(state.postes ?? {}).flat(),
          ]);
          for (const speciesId of employed) {
            const entry = state.collection?.[speciesId];
            if (!entry) continue;
            const missing = catchesToPlayable(entry);
            if (missing > 0) entry.count += missing;
          }
        }
        // v19 -> v20 : le retour complet du 26/07 — cinq retouches d'état.
        //
        //  1. `repas` (n°10) : la seconde habitude du pilier Nutrition. Chaque
        //     journée de l'historique reçoit 0, puis TOUT l'historique est
        //     réévalué au nouveau barème calorique (la soustraction sur surplus
        //     devient une non-attribution) : comme en v17 et v18, le solde ne
        //     peut que monter, et on verse la différence — trois mois de
        //     journées à surplus retrouvent l'énergie qu'on leur avait reprise.
        //  2. `dailyClaimed` (n°2) : liste vide, datée d'aucun jour — les trois
        //     premiers objectifs du jour apparaissent dès la prochaine ouverture.
        //  3. `tabIntroSeen` (n°6) : une sauvegarde existante reçoit la liste
        //     COMPLÈTE — son joueur connaît déjà le jeu, lui rejouer les cartes
        //     d'explication (et les badges « nouveau ») serait du bruit. Les
        //     onglets eux-mêmes restent conditionnés par l'état réel, qui les
        //     remplit naturellement sur une partie avancée.
        //  4. `recruitsSinceMythic` (n°9, la pitié) : 0 — le compteur démarre.
        //  5. La tourelle de départ (n°6, garde-fou) : un Bastion STRICTEMENT
        //     vide (rien de posé, rien en réserve, aucune bataille jouée) reçoit
        //     la même unité qu'une partie neuve — sans elle, le garde-fou
        //     hasGarrison le verrouillerait sans issue, la Boutique se payant en
        //     monnaie de combat qu'on n'obtient qu'en se battant.
        if (version < 20) {
          let delta = 0;
          for (const entry of Object.values(state.habits?.days ?? {})) {
            if (entry.repas === undefined) entry.repas = 0;
            const { energy, validatedCount } = evaluateEntry(entry, state.habits.calorieGoal);
            delta += energy - entry.energy;
            entry.energy = energy;
            entry.validatedCount = validatedCount;
          }
          if (delta > 0) {
            state.resources.energie = Math.min(
              ENERGY_CAP,
              (state.resources.energie ?? 0) + delta,
            );
          }
          if (state.dailyClaimed === undefined) {
            state.dailyClaimed = { day: "", ids: [] };
          }
          if (state.tabIntroSeen === undefined) {
            state.tabIntroSeen = GATED_TABS.map((t) => t.id);
          }
          if (state.bastion.recruitsSinceMythic === undefined) {
            state.bastion.recruitsSinceMythic = 0;
          }
          const b = state.bastion;
          const emptyBastion =
            b.buildingReserve.length === 0 &&
            b.fieldStructures.length === 0 &&
            b.liveWaveCount === 0 &&
            !b.turretSlots.some((s) => s.occupant) &&
            !b.barracksSlots.some((s) => s.occupant) &&
            !b.mortarSlots.some((s) => s.occupant) &&
            !b.support.some((s) => s);
          if (emptyBastion) {
            b.buildingReserve = [{ uid: b.nextBuildingUid, defId: BASTION.starting.building }];
            b.nextBuildingUid += 1;
          }
        }
        // v20 -> v21 : le bilan calorique passe à deux saisies brutes (mangé,
        // dépensé) et gagne un troisième palier — un surplus qui dépasse
        // surplus_limit_kcal (2100) RETIRE désormais 25 ⚡ (28/07/2026, demande
        // d'Ali, mot pour mot : « si je depasse, je perds 25 points d'energie »).
        //
        // Les champs caloriesEaten/caloriesBurned ont DÉJÀ été backfillés en tout
        // début de migrate() (cf. plus haut) : ce bloc-ci ne fait que la
        // réévaluation officielle et le versement du delta, comme en v17/v18/v20.
        //
        // DIFFÉRENCE IMPORTANTE avec ces trois précédents : le delta n'est PAS
        // garanti positif ici. Une vieille journée dont l'écart reconstruit
        // dépasse 2100 kcal passe de 0 ⚡ (non-attribution du 26/07) à -25 ⚡ —
        // c'est la PREMIÈRE migration du jeu qui peut retirer de l'énergie déjà
        // gagnée. Ce n'est pas un accident : Ali a redonné le chiffre exact en
        // toutes lettres le 28/07, ça réouvre délibérément la décision verrouillée
        // du 26/07 (« l'énergie ne peut plus jamais reculer ») pour ce seul poste.
        // La doctrine du projet reste tenue par ailleurs : l'historique est
        // réévalué au tarif ACTUEL, jamais laissé au tarif d'avant — y compris
        // quand le tarif actuel est plus dur. Flooré à 0, jamais négatif.
        if (version < 21) {
          let delta = 0;
          for (const entry of Object.values(state.habits?.days ?? {})) {
            if (entry.devisDemande === undefined) entry.devisDemande = 0;
            if (entry.devisSigne === undefined) entry.devisSigne = 0;
            const { energy, validatedCount } = evaluateEntry(entry, state.habits.calorieGoal);
            delta += energy - entry.energy;
            entry.energy = energy;
            entry.validatedCount = validatedCount;
          }
          state.resources.energie = Math.min(
            ENERGY_CAP,
            Math.max(0, (state.resources.energie ?? 0) + delta),
          );
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
