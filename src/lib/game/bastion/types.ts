/* Types du mini-jeu jouable Bastion-Défense (intégration profonde).
   Les CRÉATURES placées (barracks/mortiers) ne sont pas typées ici : ce sont des
   espèces de La Mare (speciesId), référencées par cardAssignments.defense — voir
   docs/JOURNAL.md (entrée du jour) pour le pont pêche → défense.
   Seuls les BÂTIMENTS (tourelles/murs/pièges/support) ont un catalogue dédié,
   cf. bastion_config.json. */

import type { CardEntry } from "../types";

/** Emplacement de tourelle — 4 de base (T0-T3) + 2 avant-postes (V0-V1),
 *  un seul compteur de déblocage partagé (turretSlotsUnlocked). */
export interface TurretSlot {
  id: string;
  x: number;
  y: number;
  /** id d'une carte "building" catégorie turret (bastion_config.json), ou null si vide. */
  occupant: string | null;
}

/** Emplacement de barracks — reçoit une créature de rôle "defense" (mare_config.json). */
export interface BarracksSlot {
  id: string;
  x: number;
  y: number;
  /** speciesId (mare_config.json) de rôle "defense", ou null si vide. */
  occupant: string | null;
  /** Niveau d'arborescence atteint (0..maxTreeLevel). */
  treeLevel: number;
  /** Choix "a"/"b" faits à chaque palier (longueur = treeLevel). */
  treePath: ("a" | "b")[];
}

/** Emplacement de mortier — fixe, reçoit une créature de rôle "assaut" (tir à distance/siège). */
export interface MortarSlot {
  id: string;
  x: number;
  y: number;
  /** speciesId (mare_config.json) de rôle "assaut", ou null si vide. */
  occupant: string | null;
}

/** Mur ou piège posé librement sur le champ (pas de grille de cases). */
export interface FieldStructure {
  uid: number;
  x: number;
  y: number;
  /** id d'une carte "building" catégorie wall/trap (bastion_config.json). */
  occupant: string;
  hp: number;
  hpMax: number;
}

/** Emplacement de support (3) — bonus passif ou pouvoir actif à charger en éliminations. */
export interface SupportSlotState {
  /** id d'une carte "building" catégorie support (bastion_config.json). */
  occupant: string;
  /** Éliminations accumulées depuis la dernière activation (pouvoirs actifs uniquement). */
  charge: number;
  ready: boolean;
}

/** Réserve de bâtiments recrutés en Boutique (tourelles/murs/pièges/support), en attente de
 *  placement. Les créatures ne transitent PAS par cette réserve — cf. cardAssignments.defense. */
export interface BuildingCardInstance {
  uid: number;
  defId: string;
}

export interface BastionState {
  turretSlots: TurretSlot[];
  turretSlotsUnlocked: number;
  barracksSlots: BarracksSlot[];
  barracksSlotsUnlocked: number;
  mortarSlots: MortarSlot[];
  mortarSlotsUnlocked: number;
  fieldStructures: FieldStructure[];
  nextStructureUid: number;
  support: (SupportSlotState | null)[];
  /** Réserve de BÂTIMENTS uniquement (les créatures viennent de cardAssignments.defense). */
  buildingReserve: BuildingCardInstance[];
  nextBuildingUid: number;
  /** Plafond d'assignation de créatures en défense (remplace la constante statique
   *  mare_config.json.assign_slots.defense — cf. store.toggleCardAssign). */
  reserveCap: number;
  /** Plafond de l'arborescence de spécialisation des barracks (2 par défaut, jusqu'à 5). */
  maxTreeLevel: number;
  /** "Fondations renforcées" — bonus passif global dégâts/PV, jusqu'à 3 niveaux. */
  slotBonusLevel: number;
  inWaveRespawnUnlocked: boolean;
  /** "Vigie" — niveau de dévoilement de la vague suivante (0 = aveugle, cf.
   *  bastion_config.json.scouting et engine.previewWave). */
  scoutLevel: number;
  /** Nombre de vagues jouées EN DIRECT (indépendant de waveCount du militaire, qui compte
   *  aussi les vagues auto-résolues hors-ligne). Sert à calibrer la difficulté affichée. */
  liveWaveCount: number;
  /** Une bataille en direct est en cours pour la vague actuellement planifiée
   *  (nextAttackAt) — empêche applyMilitary de l'auto-résoudre PAR-DESSUS pendant que le
   *  joueur la joue (cf. JOURNAL.md, bug détecté en vérification : double résolution).
   *  Verrou à durée de vie bornée (LIVE_BATTLE_GRACE_MS, military.ts) : s'il reste bloqué
   *  à true (onglet fermé/crash en plein combat), l'auto-résolution reprend la main après
   *  le délai de grâce plutôt que de rester gelée indéfiniment — jamais de mur frustrant. */
  liveBattleActive: boolean;
  /** Horodatage de début de la bataille en direct en cours (0 si aucune) — sert à borner
   *  liveBattleActive ci-dessus. */
  liveBattleStartedAt: number;

  /* ----- Les Sorties (25/07/2026) : batailles lancées À LA DEMANDE ----- */
  /** Jour calendaire (clé `dayKey`) du compteur ci-dessous — `null` = jamais sorti. */
  sortieDay: string | null;
  /** Sorties déjà lancées ce jour-là (gratuites comprises). */
  sortieCount: number;
  /** Jour pour lequel des sorties gratuites bonus ont été accordées par le Bilan de la veille. */
  bonusSortieDay: string | null;
  /** Sorties gratuites supplémentaires offertes pour `bonusSortieDay`. */
  bonusSorties: number;
  /** Cible de la sortie en cours : `null` = défense du Bastion, sinon l'id d'un foyer
   *  de La Dérive (cf. territoire_config.json). Éphémère au sens du jeu mais persisté
   *  pour que la résolution survive à un rechargement en plein combat. */
  sortieTargetId: string | null;
  /** Péril choisi pour la sortie en cours (index dans sorties.peril.levels). */
  sortiePeril: number;
  /** Ids des préparatifs achetés pour la sortie en cours. */
  sortiePreparatifs: string[];
  /** Option de Percée dépensée pour lancer la sortie en cours (`vague_percee`,
   *  `assaut_antre`…), `null` si aucune. On garde l'ID et non un simple booléen : les
   *  options n'ont pas du tout les mêmes effets (la Vague de Percée triple le butin et
   *  garantit des fragments, l'Assaut d'Antre ne fait qu'ouvrir la porte), et la
   *  résolution doit pouvoir les distinguer. */
  sortiePerceeId: string | null;
}

/* ---------- Entités de combat éphémères (NON persistées, recréées à chaque bataille) ---------- */

export type EnemyId = string;

export interface BattleEnemy {
  uid: number;
  typeId: EnemyId;
  isBoss: boolean;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  dmg: number;
  speed: number;
  ranged: boolean;
  atkRange: number;
  atkCd: number;
  slowUntil: number;
  slowPct: number;
  dying: boolean;
  deathTimer: number;
  hitFlash: number;
}

export type TroopKind = "barracks" | "mortar";

export interface BattleTroop {
  uid: number;
  speciesId: string;
  sourceSlotId: string;
  kind: TroopKind;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hp: number;
  hpMax: number;
  dmg: number;
  rate: number;
  range: number;
  acc: number;
  atkCd: number;
  dying: boolean;
  deathTimer: number;
  hitFlash: number;
}

export interface BattleProjectile {
  uid: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  targetUid: number;
  dmg: number;
  speed: number;
  acc: number;
  arc: boolean;
  splashRadius: number;
  chainCount: number;
  chainRadius: number;
  vfx: string;
  t: number;
  travelTime: number;
}

export interface PendingRespawn {
  sourceSlotId: string;
  kind: TroopKind;
  speciesId: string;
  at: number;
}

/** Ce qu'une SORTIE change à la bataille elle-même : le Péril durcit la vague, les
 *  Préparatifs adoucissent le combat. Objet inerte, construit par `sortieModifier()`
 *  (bastion/sorties.ts) — aucune valeur d'équilibrage ne vit dans le moteur.
 *
 *  Il complète `sortieLootMult()`, qui gère l'autre moitié du marché (le butin) : le
 *  Péril ne serait qu'un bonus gratuit si seul le butin en tenait compte. */
export interface SortieModifier {
  /** Multiplicateur de PV de tous les ennemis de la vague. */
  hpMult: number;
  /** Multiplicateur de dégâts de tous les ennemis de la vague. */
  dmgMult: number;
  /** Boss ajoutés à la vague, en plus de celui des paliers multiples de `boss_every`. */
  extraBosses: number;
  /** Vagues de réapparition offertes : chaque troupe déployée peut revenir autant de fois,
   *  même sans le déblocage permanent « renforts en combat ». */
  respawnWaves: number;
  /** Frappe d'ouverture : part des PV max retirée à tous les ennemis présents au premier
   *  contact (0 si la Salve enzymatique n'a pas été achetée). */
  openingDamageRatio: number;
}

export interface BattleState {
  active: boolean;
  waveN: number;
  bastionHp: number;
  bastionHpMax: number;
  elapsed: number;
  /** Multiplicateurs appliqués aux ennemis à leur apparition (palier + Péril de la sortie).
   *  Figés à l'init : la vague ne doit pas changer de dureté en cours de route. */
  hpMult: number;
  dmgMult: number;
  /** Réapparitions de troupe encore offertes par les Préparatifs (hors déblocage permanent). */
  respawnCredits: number;
  /** Frappe d'ouverture en attente (part des PV max) — remise à 0 dès qu'elle a claqué. */
  openingStrike: number;
  spawnQueue: { typeId: EnemyId; t: number; isBoss?: boolean }[];
  enemies: BattleEnemy[];
  troops: BattleTroop[];
  projectiles: BattleProjectile[];
  pendingRespawns: PendingRespawn[];
  /** Cooldowns de tir des tourelles (statiques, pas des troupes) — clé = TurretSlot.id. */
  turretCooldowns: Record<string, number>;
  /** Slots de piège déjà déclenchés cette bataille — clé = FieldStructure.uid. */
  trapsTriggered: Record<number, boolean>;
  kills: number;
  won: boolean | null;
  nextUid: number;
}

/** Résultat final d'une bataille jouée en direct, transmis à resolveLiveWave(). */
export interface LiveWaveResult {
  won: boolean;
  waveN: number;
  kills: number;
  bastionHpFrac: number;
}

/** Contexte statique (dérivé de BastionState + collection) passé à initBattle/stepBattle —
 *  vit ici (pas dans engine.ts) pour que bastion/config.ts puisse aussi le construire
 *  (buildStaticDefs) sans créer de cycle d'imports config.ts <-> engine.ts. */
export interface StaticDefs {
  turretSlots: TurretSlot[]; // déjà filtrés aux slots actifs par l'appelant
  barracksSlots: BarracksSlot[];
  mortarSlots: MortarSlot[];
  fieldStructures: FieldStructure[];
  collection: Record<string, CardEntry>;
  slotBonusLevel: number;
  inWaveRespawnUnlocked: boolean;
  /** Bonus agrégés des supports passifs (Boutique + posés), déjà résolus par l'appelant. */
  mods: { dmgMult: number; rangeMult: number; accBonus: number };
}

/* ---------- Interaction UI (locale au composant, jamais persistée) ---------- */

/** Cible d'un tap sur la scène Canvas — la décision (placer/ouvrir un inspecteur/
 *  ignorer) revient à BastionPanel, qui possède l'état d'interaction (armé/déplacement). */
export type BastionSlotTarget =
  | { kind: "turret"; slotId: string }
  | { kind: "barracks"; slotId: string }
  | { kind: "mortar"; slotId: string }
  | { kind: "structure"; uid: number }
  | { kind: "field"; x: number; y: number };
