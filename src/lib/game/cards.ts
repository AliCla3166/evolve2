/* La Mare & les cartes (Phase 6) — pur, données depuis mare_config.json.
   Pêche : paillette colorée = rareté (poids v1), tension à 3 taps → quality,
   quality = bonus de chance au tirage final. Les prises deviennent des cartes
   d'unités : doublons → niveaux, meilleure rareté → habillage, assignation en
   défense ou expédition (passerelle vers la couche militaire). */

import rawConfig from "@/data/mare_config.json";
import {
  bonusValue,
  crewMult,
  crewOf,
  crewSlots,
  TERRITOIRE_RECOLTE,
  type CrewMultOf,
} from "./territoire";
import type {
  CardAssignments,
  CardEntry,
  GameState,
  ResourceId,
  TerritoireState,
} from "./types";

/* ---------- Typage de la config ---------- */

export interface RarityConfig {
  id: string;
  name: string;
  weight: number;
  /** Multiplicateur de hauteur de la fenêtre de capture (1 = pleine taille, plus petit = plus dur). */
  bar_mult: number;
  /** Vitesse d'approche du poisson vers sa cible (fraction de piste / seconde). */
  fish_speed: number;
  /** Fréquence moyenne de changement de cap du poisson (Hz — plus haut = plus erratique). */
  fish_retarget_hz: number;
  /** Multiplicateur de la vitesse de vidage de la jauge de succès hors chevauchement. */
  drain_mult: number;
  color: string;
  power_mult: number;
}

export interface SpeciesConfig {
  id: string;
  name: string;
  /** Portrait PixelLab de la charte utilisé comme art de carte. */
  portrait: string;
  role: "defense" | "exploration" | "assaut";
  /** Ressource avec laquelle l'espèce travaille le mieux quand elle est POSTÉE dans
   *  un organe (cf. economy_config.json -> postes). Bonus multiplicatif, jamais une
   *  condition : aucune espèce n'est nulle au travail. */
  affinity: ResourceId;
  power_def: number;
  power_exp: number;
  power_atk: number;
  /** Points de vie de base (avant multiplicateur rareté × niveau, cf. cardHp). */
  hp: number;
}

/** Une ÉDITION : le deuxième axe de la carte, indépendant de la rareté.
 *  (cf. mare_config.json -> $comment_editions.) */
export interface EditionConfig {
  id: string;
  name: string;
  /** Poids de tirage, indépendant de celui de la rareté. */
  weight: number;
  /** Multiplicateur de puissance, appliqué en plus de rareté × niveau. */
  power_mult: number;
  /** Vraie pour la négative : la carte n'occupe aucune place, nulle part. */
  free_slot: boolean;
  color: string;
}

/** Mise en scène d'une révélation, pour une rareté donnée (piste 7). */
export interface RevealStepConfig {
  /** Durée TOTALE de la montée du halo avant l'apparition de la carte. */
  charge_ms: number;
  /** Nombre d'étincelles de la gerbe (0 = aucune). */
  sparks: number;
  /** Amplitude de la secousse d'écran, en pixels (0 = aucune). */
  shake: number;
  /** Motif navigator.vibrate (alternance vibration/pause, ms). */
  vibrate: number[];
}

export interface RevealConfig {
  by_rarity: RevealStepConfig[];
  tease: {
    /** Probabilité de teasing, par rareté réelle. */
    chance_by_rarity: number[];
    /** Nombre maximal de crans au-dessus de la rareté réelle. */
    max_overshoot: number;
    hold_ms: number;
    fallback_ms: number;
    vibrate: number[];
  };
}

export interface MareConfig {
  jetons: { cost_energie: number; max_stock: number };
  fragments_per_card: number;
  fragment_card_rarity_floor: number;
  rarities: RarityConfig[];
  /** Ordre du tableau = ordre de prestige (standard en 0, négative en dernier). */
  editions: EditionConfig[];
  reveal: RevealConfig;
  fishing: {
    bar_height: number;
    /** Plancher d'équité de la hauteur de fenêtre (cf. $comment du JSON). */
    bar_height_min: number;
    gravity: number;
    rise_accel: number;
    drag: number;
    max_velocity: number;
    fill_rate: number;
    drain_rate: number;
    start_progress: number;
    /** Bonus de chance de rareté selon le palier de qualité (0..3). */
    quality_luck: number[];
  };
  level_thresholds: number[];
  level_power_bonus: number;
  /** Niveau minimal pour avoir le DROIT de jouer une carte (cf. isCardPlayable). */
  playable_min_level: number;
  assign_slots: { defense: number; expedition: number };
  /** Poids de dérivation de la puissance de RÉCOLTE (étape B) : aucune donnée
   *  nouvelle par espèce, la stat se calcule sur les trois puissances existantes. */
  recolte: { stat_weights: { def: number; exp: number; atk: number } };
  species: SpeciesConfig[];
}

export const MARE = rawConfig as unknown as MareConfig;

export const SPECIES_IDS = MARE.species.map((s) => s.id);

/** Plafond de jetons de pêche en stock : la constante de config + le vestige « Nasse
 *  tressée » de La Dérive. Un stock plus profond ne fait pas pêcher plus vite (le coût
 *  en énergie ne bouge pas) : il permet de mettre de côté pendant une journée chargée
 *  et de pêcher d'affilée quand on a le temps — exactement le rythme visé. */
export function jetonMax(state: Pick<GameState, "territoire">): number {
  return MARE.jetons.max_stock + bonusValue(state.territoire, "jeton_max");
}

export function speciesConfig(id: string): SpeciesConfig | undefined {
  return MARE.species.find((s) => s.id === id);
}

export function rarityConfig(index: number): RarityConfig {
  return MARE.rarities[Math.min(MARE.rarities.length - 1, Math.max(0, index))];
}

/** Mise en scène de la révélation pour une rareté (durée de charge, gerbe, secousse, vibration). */
export function revealConfig(index: number): RevealStepConfig {
  const list = MARE.reveal.by_rarity;
  return list[Math.min(list.length - 1, Math.max(0, index))];
}

export function cardArt(speciesId: string): string {
  const sp = speciesConfig(speciesId);
  return `/assets/portraits/age01_cell_portrait_${sp?.portrait ?? speciesId}_v001.png`;
}

/* ---------- Niveaux (doublons) ---------- */

/** Niveau d'une carte selon son nombre de prises (level_thresholds). */
export function cardLevel(count: number): number {
  let level = 0;
  for (const t of MARE.level_thresholds) if (count >= t) level += 1;
  return Math.max(1, level);
}

export function maxCardLevel(): number {
  return MARE.level_thresholds.length;
}

/** Prises nécessaires pour le niveau suivant (null si niveau max). */
export function nextLevelAt(count: number): number | null {
  for (const t of MARE.level_thresholds) if (count < t) return t;
  return null;
}

/* ---------- Le verrou des doublons (26/07) ----------

   Une prise donne la CARTE, pas le droit de la jouer. Tant qu'on n'en tient pas
   un deuxième exemplaire, l'espèce est une pièce de collection : on la voit, on
   lit ses stats, mais on ne peut ni l'assigner (défense/expédition), ni la
   poster sur un gisement, ni la poster dans un organe. Le raisonnement et le
   coût mesuré sont dans mare_config.json -> $comment_verrou_doublons.

   Le verrou ne se referme jamais : `count` ne décroît nulle part dans le moteur
   (vérifié — la seule écriture est `prev.count + 1` dans addCatch), donc une
   carte jouable le reste. C'est pour ça que les fonctions de puissance
   ci-dessus n'ont pas à filtrer : les portes sont dans le store, à l'ajout. */

/** Cette carte a-t-elle le droit d'être mise au travail ? */
export function isCardPlayable(entry: CardEntry | undefined): boolean {
  return !!entry && cardLevel(entry.count) >= MARE.playable_min_level;
}

/** Prises encore nécessaires pour déverrouiller la carte (0 si déjà jouable).
 *  On affiche « encore 1 prise » plutôt qu'un bouton grisé sans explication. */
export function catchesToPlayable(entry: CardEntry | undefined): number {
  const need = MARE.level_thresholds[MARE.playable_min_level - 1] ?? 1;
  return Math.max(0, need - (entry?.count ?? 0));
}

/* ---------- Les éditions (26/07 au soir) ----------

   Deuxième axe, indépendant de la rareté : la rareté dit quelle bête est sortie de
   l'eau, l'édition dit dans quel état la carte est tombée. C'est la « deuxième
   route » vers une carte — celle de la chance, à côté de celle du travail (repêcher
   la même espèce pour la monter en niveau). Voir mare_config.json ->
   $comment_editions pour le modèle et les poids.

   Rien à migrer : `editions` est optionnel sur CardEntry, et son absence a un sens
   exact (« toutes les prises sont standard »), donc le défaut se CALCULE au lieu de
   se réécrire dans la sauvegarde. */

export const EDITIONS = MARE.editions;

export function editionConfig(index: number): EditionConfig {
  return MARE.editions[Math.min(MARE.editions.length - 1, Math.max(0, index))];
}

/** Répartition des prises d'une espèce par édition (index aligné sur MARE.editions). */
export function editionCounts(entry: CardEntry | undefined): number[] {
  const out = new Array<number>(MARE.editions.length).fill(0);
  if (!entry) return out;
  if (!entry.editions) {
    out[0] = entry.count; // carte d'avant les éditions : tout est standard
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] = entry.editions[i] ?? 0;
  return out;
}

/** Multiplicateur d'édition : la MEILLEURE jamais obtenue. Une espèce cumule le
 *  meilleur de chaque propriété — une prise ne peut jamais faire régresser une
 *  carte, exactement comme `bestRarity` ne redescend jamais. */
export function cardEditionMult(entry: CardEntry | undefined): number {
  const counts = editionCounts(entry);
  let best = 1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) best = Math.max(best, MARE.editions[i].power_mult);
  }
  return best;
}

/** L'espèce détient-elle une négative ? Alors elle n'occupe aucune place —
 *  ni en défense, ni en expédition, ni sur un gisement, ni dans un organe. */
export function isFreeSlotCard(entry: CardEntry | undefined): boolean {
  const counts = editionCounts(entry);
  return MARE.editions.some((e, i) => e.free_slot && counts[i] > 0);
}

/** Édition la plus prestigieuse détenue (index dans MARE.editions), pour l'habillage. */
export function bestEditionIndex(entry: CardEntry | undefined): number {
  const counts = editionCounts(entry);
  let best = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) best = i;
  return best;
}

/** Ce qu'une édition apporte, écrit à partir des NOMBRES et jamais à côté d'eux. */
export function editionEffect(index: number): string {
  const e = editionConfig(index);
  if (e.free_slot) return "n'occupe aucune place";
  const pct = Math.round((e.power_mult - 1) * 100);
  return pct > 0 ? `+${pct} % de puissance` : "aucun bonus";
}

/** Combien de places une carte consomme réellement : 0 si elle est négative. */
export function slotCost(entry: CardEntry | undefined): number {
  return isFreeSlotCard(entry) ? 0 : 1;
}

/** Places consommées par une liste de cartes (les négatives ne comptent pas). */
export function slotsUsed(
  ids: string[],
  collection: Record<string, CardEntry>,
): number {
  return ids.reduce((n, id) => n + slotCost(collection[id]), 0);
}

/** Les cartes d'une liste qui tiennent effectivement dans `slots` places.
 *  Une négative est toujours retenue : elle ne consomme rien, donc elle ne peut
 *  pas être celle qui déborde. */
export function fitInSlots(
  ids: string[],
  collection: Record<string, CardEntry>,
  slots: number,
): string[] {
  const out: string[] = [];
  let used = 0;
  for (const id of ids) {
    const cost = slotCost(collection[id]);
    if (cost > 0) {
      if (used + cost > slots) continue;
      used += cost;
    }
    out.push(id);
  }
  return out;
}

/* ---------- Puissance des cartes ---------- */

/** Multiplicateur d'une carte : rareté × niveau × édition. */
function cardMult(entry: CardEntry): number {
  return (
    rarityConfig(entry.bestRarity).power_mult *
    (1 + MARE.level_power_bonus * (cardLevel(entry.count) - 1)) *
    cardEditionMult(entry)
  );
}

export function cardPowerDef(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_def * cardMult(entry)) : 0;
}

export function cardPowerExp(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_exp * cardMult(entry)) : 0;
}

export function cardPowerAtk(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_atk * cardMult(entry)) : 0;
}

/** PV affichés sur la carte (même multiplicateur rareté × niveau que les 3 stats
 *  de puissance) — purement informatif/collection pour l'instant, ne modifie pas
 *  les formules de combat existantes (cf. journal 24/07). */
export function cardHp(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.hp * cardMult(entry)) : 0;
}

/** Puissance de RÉCOLTE d'une carte (étape B). Stat entièrement DÉRIVÉE des trois
 *  puissances déjà portées par les 62 espèces, pondérées par mare_config -> recolte :
 *  les exploratrices sont les meilleures récolteuses, mais aucune espèce n'est nulle
 *  au travail — une commune gardée longtemps finit par valoir un poste. Zéro donnée
 *  nouvelle par espèce, zéro nouvelle formule de puissance. */
export function cardPowerRec(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  if (!sp) return 0;
  const w = MARE.recolte.stat_weights;
  const raw = sp.power_def * w.def + sp.power_exp * w.exp + sp.power_atk * w.atk;
  return Math.round(raw * cardMult(entry));
}

/** Ressource d'affinité d'une espèce (mare_config.json -> species[].affinity).
 *  `null` pour un id inconnu : une sauvegarde peut contenir une espèce retirée du
 *  catalogue, et une affinité absente doit valoir « aucun bonus », jamais un crash. */
export function speciesAffinity(speciesId: string): ResourceId | null {
  return speciesConfig(speciesId)?.affinity ?? null;
}

/* ---------- L'équipage d'un gisement (étape B) ----------

   cards.ts est le SEUL module qui voit à la fois la collection (mare_config.json) et
   la carte (territoire.ts) — territoire.ts ne peut pas nous importer en retour sans
   créer un cycle. La jointure des deux vit donc ici, et territoire.ts la reçoit sous
   forme de callback, exactement comme il reçoit déjà `prodPerHour`. */

/** Apport d'UNE créature au rendement d'un gisement : une prime de présence, plus
 *  une part indexée sur sa puissance de récolte. Poster n'importe qui aide un peu ;
 *  poster la bonne carte, montée en niveau, aide beaucoup. */
export function creatureRecolteBonus(speciesId: string, entry: CardEntry): number {
  const r = TERRITOIRE_RECOLTE;
  return r.bonus_per_creature + r.bonus_per_power * cardPowerRec(speciesId, entry);
}

/** Bonus BRUT (non borné) de l'équipage d'un gisement, places excédentaires ignorées. */
export function crewBonus(
  state: Pick<GameState, "collection" | "territoire">,
  foyerId: string,
): number {
  /* `fitInSlots` plutôt que `.slice(0, n)` : le garde-fou compte les PLACES, donc
     une négative posée sur le gisement ne pousse plus une collègue hors du compte. */
  const ids = fitInSlots(
    crewOf(state.territoire, foyerId),
    state.collection,
    crewSlots(state.territoire, foyerId),
  );
  let sum = 0;
  for (const id of ids) {
    const entry = state.collection[id];
    if (entry) sum += creatureRecolteBonus(id, entry);
  }
  return sum;
}

/** Multiplicateur de rendement du gisement, borné par recolte.mult_max. */
export function foyerCrewMult(
  state: Pick<GameState, "collection" | "territoire">,
  foyerId: string,
): number {
  return crewMult(crewBonus(state, foyerId));
}

/** Le callback attendu par territoireIncomePerHour / territoireAccrual.
 *  Mémoïsé : le tick appelle ce callback une fois par gisement capturé et par seconde. */
export function crewMultOf(
  state: Pick<GameState, "collection" | "territoire">,
): CrewMultOf {
  const cache = new Map<string, number>();
  return (foyerId: string) => {
    const hit = cache.get(foyerId);
    if (hit !== undefined) return hit;
    const value = foyerCrewMult(state, foyerId);
    cache.set(foyerId, value);
    return value;
  };
}

/** Une espèce est-elle disponible pour être postée / assignée ailleurs ?
 *  (Sert à griser une carte déjà au travail dans les listes de choix.) */
export function crewSlotsFree(
  t: TerritoireState,
  foyerId: string,
): number {
  return Math.max(0, crewSlots(t, foyerId) - crewOf(t, foyerId).length);
}

/* ---------- Bonus d'assignation (passerelle vers le militaire) ---------- */

function assignedEntries(
  state: Pick<GameState, "collection" | "cardAssignments">,
  slot: keyof CardAssignments,
): [string, CardEntry][] {
  return state.cardAssignments[slot]
    .filter((id) => state.collection[id])
    .map((id) => [id, state.collection[id]]);
}

/** Puissance défensive ajoutée par les cartes assignées en défense. */
export function cardsDefenseBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "defense").reduce(
    (sum, [id, e]) => sum + cardPowerDef(id, e),
    0,
  );
}

/** Puissance d'exploration ajoutée par les cartes assignées en expédition. */
export function cardsExpeditionExpBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "expedition").reduce(
    (sum, [id, e]) => sum + cardPowerExp(id, e),
    0,
  );
}

/** Puissance d'assaut ajoutée par les cartes assignées en expédition. */
export function cardsExpeditionAtkBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "expedition").reduce(
    (sum, [id, e]) => sum + cardPowerAtk(id, e),
    0,
  );
}

/* ---------- Tirages (utilisent le PRNG seedé du moteur) ---------- */

/** Tirage de rareté : poids v1, remontés par la chance (quality de tension).
 *  `roll` est un tirage 0..1 déjà effectué par l'appelant (PRNG seedé). */
export function rollRarity(roll: number, luck: number, floor = 0): number {
  // La chance multiplie le poids des raretés hautes : w_i × (1 + luck × i).
  const weights = MARE.rarities.map((r, i) => r.weight * (1 + luck * i * 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll * total <= acc) return Math.max(floor, i);
  }
  return Math.max(floor, MARE.rarities.length - 1);
}

/** Tirage d'ÉDITION, indépendant de celui de la rareté (une commune peut être
 *  polychrome, une mythique peut être standard). La chance de tension y entre,
 *  mais deux fois moins fort que sur la rareté (`1 + luck × i` au lieu de
 *  `1 + luck × i × 2`) : l'édition doit rester un coup de chance — si bien pêcher
 *  la garantissait, elle cesserait d'être la route parallèle à celle du travail.
 *  Un tirage totalement sourd à la façon dont on pêche serait pourtant le seul du
 *  jeu à ignorer le joueur, d'où le demi-poids plutôt que zéro. */
export function rollEdition(roll: number, luck: number): number {
  const weights = MARE.editions.map((e, i) => e.weight * (1 + luck * i));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll * total <= acc) return i;
  }
  return 0;
}

/** Tirage d'espèce (uniforme sur les 12). */
export function rollSpecies(roll: number): string {
  return SPECIES_IDS[Math.min(SPECIES_IDS.length - 1, Math.floor(roll * SPECIES_IDS.length))];
}

/** Sommet du halo pendant la charge de révélation (piste 7).
 *
 *  Renvoie la rareté réelle dans le cas normal, et une rareté STRICTEMENT
 *  supérieure quand le teasing de quasi-réussite se déclenche : le halo monte
 *  au-dessus du résultat, s'y maintient, puis retombe sur la vraie rareté.
 *  Le tirage est fait par l'appelant avec le PRNG seedé du moteur, comme pour
 *  la rareté et l'espèce — la mise en scène est donc rejouable à l'identique.
 *
 *  `roll` sert deux fois (déclenchement puis amplitude) : c'est volontaire,
 *  ça économise un pas de PRNG et les deux usages sont décorrélés (un `roll`
 *  juste sous le seuil donne une amplitude quelconque, pas systématiquement +1). */
export function rollRevealTease(roll: number, rarity: number): number {
  const t = MARE.reveal.tease;
  const top = MARE.rarities.length - 1;
  const chance = t.chance_by_rarity[Math.min(top, Math.max(0, rarity))] ?? 0;
  if (chance <= 0 || roll >= chance || rarity >= top) return rarity;
  // Amplitude : 1..max_overshoot crans au-dessus, plafonnée par la rareté maximale.
  const span = Math.max(1, Math.round(t.max_overshoot));
  const step = 1 + Math.floor(((roll / chance) * span) % span);
  return Math.min(top, rarity + step);
}

/** Ajoute une prise à la collection (mute le draft) et décrit le résultat. */
export function addCatch(
  state: GameState,
  speciesId: string,
  rarity: number,
  /** Édition de CETTE prise (index dans MARE.editions, 0 = standard). */
  edition: number,
  now: number,
  source: "peche" | "fragments",
  /** Sommet du halo pendant la charge (cf. rollRevealTease). Défaut : la rareté réelle. */
  teaseTo?: number,
): void {
  const prev = state.collection[speciesId];
  const prevLevel = prev ? cardLevel(prev.count) : 0;
  // Le compte par édition part de l'état matérialisé de la carte : une carte
  // d'avant les éditions le voit calculé (tout en standard) plutôt que perdu.
  const editions = editionCounts(prev);
  const idx = Math.min(MARE.editions.length - 1, Math.max(0, edition));
  editions[idx] += 1;
  const entry: CardEntry = prev
    ? {
        count: prev.count + 1,
        bestRarity: Math.max(prev.bestRarity, rarity),
        firstCaughtAt: prev.firstCaughtAt,
        editions,
      }
    : { count: 1, bestRarity: rarity, firstCaughtAt: now, editions };
  state.collection = { ...state.collection, [speciesId]: entry };
  state.lastCatch = {
    speciesId,
    rarity,
    edition: idx,
    isNew: !prev,
    newBestRarity: !!prev && rarity > prev.bestRarity,
    newEdition: idx > 0 && editions[idx] === 1,
    level: cardLevel(entry.count),
    leveledUp: !!prev && cardLevel(entry.count) > prevLevel,
    source,
    teaseTo: Math.max(rarity, teaseTo ?? rarity),
  };
}
