/* LA DÉRIVE — la carte du monde (25/07/2026).
   Module PUR : aucune valeur d'équilibrage ici, tout vient de src/data/territoire_config.json.

   Règle d'architecture volontaire : ce module n'importe NI economy.ts NI military.ts.
   Il ne calcule que des débits et des montants, à partir d'une production horaire qu'on lui
   passe en argument (`prodPerHour`). C'est ce qui permet à economy.ts d'importer
   `freshTerritoireState()` sans créer de cycle d'imports — exactement le contrat que
   bastion/config.ts respecte déjà vis-à-vis d'economy.ts. L'application des montants
   (addResource, plafonds de stockage) reste chez l'appelant (tick.ts / store.ts).

   Le principe économique tient en une phrase : le territoire AMPLIFIE la base, il ne la
   remplace jamais. Le revenu d'un gisement est un pourcentage de la production ACTUELLE de
   sa ressource — un gisement pris au jour 5 reste pertinent au jour 80 sans table de paliers,
   et un gisement d'une ressource qu'on ne produit pas encore ne rapporte rien. */

import rawConfig from "@/data/territoire_config.json";
import type { ResourceId, TerritoireState } from "./types";

/* ---------- Typage du JSON ---------- */

export type FoyerNature =
  | "gisement"
  | "expedition"
  | "vestige"
  | "cache"
  | "antre"
  | "abime";

export type TerritoireBonusId =
  | "production_mult"
  | "storage_mult"
  | "bastion_dmg_mult"
  | "bastion_hp_mult"
  | "combat_mult"
  | "expedition_speed"
  | "free_sortie"
  | "reserve_cap"
  | "jeton_max";

export interface FoyerDef {
  id: string;
  name: string;
  nature: FoyerNature;
  /** Palier (= numéro de vague) joué quand on assaille ce foyer. */
  palier: number;
  /** Position en pourcentage (0..100) dans le repère du secteur. */
  x: number;
  y: number;
  /** gisement : la ressource produite. */
  resource?: ResourceId;
  /** cache : les ressources du butin. */
  resources?: ResourceId[];
  /** expedition : l'id de destination de military_config.json. */
  dest_id?: string;
  /** vestige / antre : le bonus global accordé. */
  bonus?: TerritoireBonusId;
  value?: number;
  /** antre : nom du boss affiché. */
  boss_name?: string;
}

export interface SectorDef {
  id: string;
  name: string;
  desc: string;
  unlock_palier: number;
  tint: string;
  foyers: FoyerDef[];
}

export interface NatureDef {
  name: string;
  desc: string;
  assault: boolean;
  repeatable: boolean;
  requires_percee?: boolean;
  /** Glyphe et couleur d'accent du noeud sur la carte (cf. territoire_config.json). */
  icon: string;
  color: string;
}

interface VestigeDef {
  name: string;
  desc: string;
  kind: "ratio" | "flat";
}

interface TerritoireConfig {
  map: {
    coord_space: number;
    node_radius_pct: number;
    /** Les relais de dérive : les 4 destinations d'expédition du jour, posées sur la
     *  carte au-dessus des foyers. Elles n'appartiennent à aucun secteur (cf. le
     *  $comment_relais de la config) — d'où des coordonnées communes à tous. */
    relais: {
      radius_pct: number;
      color: string;
      icon: string;
      port: { x: number; y: number };
      slots: { x: number; y: number }[];
    };
  };
  natures: Record<string, NatureDef>;
  income: {
    base_ratio: number;
    mult_per_level: number;
    max_level: number;
    total_income_cap_ratio: number;
    offline_cap_h: number;
  };
  development: {
    cost_hours_base: number;
    cost_hours_growth: number;
    cost_combat_base: number;
    cost_combat_growth: number;
    deep_cost_combat_growth: number;
  };
  reconquete: {
    palier_offset: number;
    palier_step: number;
    combat_base: number;
    combat_per_palier: number;
    hours_base: number;
    hours_per_palier: number;
    fragments_every_runs: number;
    deep_loot_gain: number;
  };
  recolte: {
    slots_base: number;
    slots_per_dev: number;
    slots_max: number;
    bonus_per_creature: number;
    bonus_per_power: number;
    mult_max: number;
  };
  vestiges: Record<string, VestigeDef>;
  cache_loot: {
    hours_base: number;
    hours_per_palier: number;
    combat_base: number;
    combat_per_palier: number;
  };
  antres: {
    hp_mult: number;
    dmg_mult: number;
    loot_mult: number;
    fragments: number;
  };
  abime: {
    palier_offset: number;
    combat_base: number;
    combat_per_palier: number;
    fragments_every_paliers: number;
  };
  sectors: SectorDef[];
}

export const TERRITOIRE = rawConfig as unknown as TerritoireConfig;

export const SECTORS: ReadonlyArray<SectorDef> = TERRITOIRE.sectors;
export const TERRITOIRE_MAP = TERRITOIRE.map;
export const TERRITOIRE_INCOME = TERRITOIRE.income;
export const TERRITOIRE_ANTRES = TERRITOIRE.antres;
export const TERRITOIRE_ABIME = TERRITOIRE.abime;
export const TERRITOIRE_RECOLTE = TERRITOIRE.recolte;
export const TERRITOIRE_RECONQUETE = TERRITOIRE.reconquete;

const FOYER_INDEX: Record<string, { foyer: FoyerDef; sector: SectorDef }> = {};
for (const sector of SECTORS) {
  for (const foyer of sector.foyers) FOYER_INDEX[foyer.id] = { foyer, sector };
}

/** Tous les foyers de la carte, dans l'ordre des secteurs puis des paliers. */
export const ALL_FOYERS: ReadonlyArray<FoyerDef> = SECTORS.flatMap((s) => s.foyers);

export function foyerDef(id: string): FoyerDef | null {
  return FOYER_INDEX[id]?.foyer ?? null;
}

export function sectorOfFoyer(id: string): SectorDef | null {
  return FOYER_INDEX[id]?.sector ?? null;
}

export function natureDef(nature: FoyerNature): NatureDef {
  return TERRITOIRE.natures[nature];
}

export function vestigeDef(bonus: TerritoireBonusId): VestigeDef | undefined {
  return TERRITOIRE.vestiges[bonus];
}

/* ---------- État frais ---------- */

export function freshTerritoireState(now: number): TerritoireState {
  return {
    foyers: {},
    lastIncomeAt: now,
    lastSectorId: SECTORS[0]?.id ?? "",
  };
}

/* ---------- Lecture d'état ---------- */

export function isCaptured(t: TerritoireState, foyerId: string): boolean {
  return (t.foyers[foyerId]?.capturedAt ?? 0) > 0;
}

export function devLevel(t: TerritoireState, foyerId: string): number {
  return t.foyers[foyerId]?.dev ?? 0;
}

export function runCount(t: TerritoireState, foyerId: string): number {
  return t.foyers[foyerId]?.runs ?? 0;
}

/* ---------- L'équipage de récolte (étape B) ----------

   Le circuit qu'on ferme ici : on pêche une créature → on la POSTE sur un gisement
   capturé → elle y travaille en boucle à l'écran → le gisement rend davantage.

   Ce module ne sait PAS ce qu'une créature vaut : la puissance de récolte se dérive
   des stats de mare_config.json, que seul cards.ts peut lire (cards.ts importe déjà
   territoire.ts, l'inverse créerait un cycle). D'où la même mécanique que
   `prodPerHour` : le multiplicateur d'équipage arrive en ARGUMENT, via un callback
   `CrewMultOf` que cards.ts fabrique. territoire.ts reste pur et sans dépendance. */

/** Multiplicateur de rendement apporté par l'équipage d'un gisement (1 = personne). */
export type CrewMultOf = (foyerId: string) => number;

/** Les espèces postées à un gisement. [] sur les sauvegardes antérieures à v14. */
export function crewOf(t: TerritoireState, foyerId: string): string[] {
  return t.foyers[foyerId]?.crew ?? [];
}

/** Places de travail d'un gisement : 1 à la prise, +1 par niveau de développement.
 *  Développer ne fait donc plus que monter le rendement — ça ouvre aussi de la place
 *  pour la collection, et les deux progressions se nourrissent l'une l'autre. */
export function crewSlots(t: TerritoireState, foyerId: string): number {
  const r = TERRITOIRE_RECOLTE;
  // Le développement n'a plus de plafond (étape D), les places d'équipage si :
  // au-delà de six portraits en orbite, le nœud devient illisible sur un téléphone.
  return Math.min(r.slots_max, r.slots_base + r.slots_per_dev * devLevel(t, foyerId));
}

/** Borne le multiplicateur d'un équipage : jamais < 1, jamais > mult_max. */
export function crewMult(bonus: number): number {
  return Math.min(TERRITOIRE_RECOLTE.mult_max, 1 + Math.max(0, bonus));
}

/** Le gisement où une espèce travaille actuellement, null si elle est libre.
 *  Une créature ne peut occuper qu'UN poste : le store s'en sert pour appliquer
 *  l'exclusivité (défense / expédition / un seul gisement). */
export function foyerOfCrewSpecies(t: TerritoireState, speciesId: string): string | null {
  for (const [foyerId, st] of Object.entries(t.foyers)) {
    if (st.crew?.includes(speciesId)) return foyerId;
  }
  return null;
}

/** Toutes les espèces actuellement postées, tous gisements confondus. */
export function crewedSpecies(t: TerritoireState): Set<string> {
  const out = new Set<string>();
  for (const st of Object.values(t.foyers)) for (const id of st.crew ?? []) out.add(id);
  return out;
}

/** Lecture sûre d'un CrewMultOf éventuellement absent (sauvegarde sans équipage). */
function safeCrewMult(foyerId: string, crewMultOf?: CrewMultOf): number {
  if (!crewMultOf) return 1;
  const raw = crewMultOf(foyerId);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(TERRITOIRE_RECOLTE.mult_max, Math.max(1, raw));
}

/** Un secteur s'ouvre au palier (= waveCount) indiqué. */
export function sectorUnlocked(sector: SectorDef, palier: number): boolean {
  return palier >= sector.unlock_palier;
}

export function unlockedSectors(palier: number): SectorDef[] {
  return SECTORS.filter((s) => sectorUnlocked(s, palier));
}

/** Prochain secteur à ouvrir (pour l'affichage d'un objectif) — null si tout est ouvert. */
export function nextSectorUnlock(palier: number): SectorDef | null {
  return SECTORS.find((s) => !sectorUnlocked(s, palier)) ?? null;
}

/* ---------- LA RECONQUÊTE : aucun foyer ne se termine (étape D) ----------

   Jusqu'ici la carte avait un fond : vingt-neuf foyers, vingt-neuf prises, et
   après ? Un joueur qui a tout pris voyait « 29/29 » — un écran de fin déguisé.

   Désormais ce que seul l'Abîme faisait devient la règle : un foyer pris se
   re-défie indéfiniment, à un palier qui remonte AU-DESSUS du joueur ET qui
   grimpe en plus de `palier_step` par reconquête déjà menée — les deux effets
   s'additionnent, sinon le plancher avalerait la montée. Aucune de ces
   reconquêtes ne re-verse de bonus de vestige (`territoireBonus` compte une
   capture, pas des passages) : elles paient en monnaie de combat, en fragments
   et en ressources — les deux économies que le calibrage 90 jours ne touche
   pas. Le revenu horaire, lui, reste borné par `total_income_cap_ratio`. */

/** Nombre de reconquêtes déjà menées sur un foyer. `runs` compte TOUTES les
 *  victoires, la prise comprise : la première victoire n'est pas une reconquête. */
export function reconquestCount(t: TerritoireState, foyerId: string): number {
  if (!isCaptured(t, foyerId)) return 0;
  return Math.max(0, runCount(t, foyerId) - 1);
}

/** Palier réellement joué quand on assaille ce foyer.
 *  Trois régimes : l'abîme suit toujours le joueur ; un foyer déjà pris se
 *  re-défie au-dessus du joueur, de plus en plus haut ; un foyer vierge garde
 *  le palier écrit dans la config, pour que la première prise reste lisible. */
export function assaultPalier(
  foyer: FoyerDef,
  playerPalier: number,
  t?: TerritoireState,
): number {
  if (foyer.nature === "abime") {
    return Math.max(foyer.palier, playerPalier + TERRITOIRE_ABIME.palier_offset);
  }
  if (t && isCaptured(t, foyer.id)) {
    /* Deux effets qui s'ADDITIONNENT, et non deux candidats dont on garderait le
       plus grand. Un `Math.max` laissait le plancher « au-dessus du joueur » avaler
       entièrement la montée par reconquête : à palier joueur constant, reprendre le
       même foyer dix fois rejouait dix fois le même palier, et la dixième reprise
       était une formalité — exactement ce que cette étape supprime. Le foyer part
       donc du plus haut des deux repères (son palier de config, ou le joueur plus
       l'écart), PUIS grimpe d'un cran par reconquête déjà menée. La progression n'a
       pas de terminus : elle s'arrête le jour où le joueur perd, pas le jour où le
       jeu décrète que c'est fini. */
    const r = TERRITOIRE_RECONQUETE;
    const socle = Math.max(foyer.palier, playerPalier + r.palier_offset);
    return socle + r.palier_step * reconquestCount(t, foyer.id);
  }
  return foyer.palier;
}

/* `foyerAvailable` a disparu ici (étape D). Elle répondait « ce foyer est-il encore
   assaillable ? » et la réponse est désormais oui, sans condition : un foyer pris se
   reprend à un palier plus haut, indéfiniment. Garder une fonction qui retourne
   toujours `true` aurait laissé croire à une règle là où il n'y en a plus. La seule
   porte qui reste est l'ouverture du SECTEUR — `sectorUnlocked` — et les écrans
   l'interrogent maintenant directement. */

/** Ce foyer est-il en régime de RECONQUÊTE (déjà pris, non répétable) ?
 *  Les foyers naturellement répétables — l'abîme — n'ont jamais été « finis »,
 *  ils gardent leur propre libellé. */
export function isReconquest(t: TerritoireState, foyer: FoyerDef): boolean {
  return isCaptured(t, foyer.id) && !natureDef(foyer.nature).repeatable;
}

/* ---------- Bonus globaux ---------- */

/** Somme des bonus des vestiges (et des antres, qui en gardent un) déjà pris.
 *  Les clés absentes valent 0 : `territoireBonus(t).production_mult ?? 0`. */
export function territoireBonus(t: TerritoireState): Partial<Record<TerritoireBonusId, number>> {
  const out: Partial<Record<TerritoireBonusId, number>> = {};
  for (const foyer of ALL_FOYERS) {
    if (!foyer.bonus || !foyer.value) continue;
    if (!isCaptured(t, foyer.id)) continue;
    out[foyer.bonus] = (out[foyer.bonus] ?? 0) + foyer.value;
  }
  return out;
}

/** Raccourci typé : la valeur d'un bonus, 0 si aucun vestige correspondant n'est pris. */
export function bonusValue(t: TerritoireState, id: TerritoireBonusId): number {
  return territoireBonus(t)[id] ?? 0;
}

/* ---------- Revenu des gisements ---------- */

/** Multiplicateur de rendement d'un gisement à un niveau de développement donné. */
export function gisementRatio(dev: number): number {
  const inc = TERRITOIRE_INCOME;
  return inc.base_ratio * Math.pow(inc.mult_per_level, Math.max(0, Math.min(inc.max_level, dev)));
}

/** Revenu horaire du territoire, ressource par ressource, DÉJÀ plafonné.
 *  `prodPerHour` = production horaire de la base (economy.totalProductionPerHour).
 *  `crewMultOf` = multiplicateur d'équipage par gisement (cf. cards.ts -> crewMultOf).
 *
 *  Double borne, comme avant : le ratio de chaque gisement, puis total_income_cap_ratio
 *  sur la somme. Nouveauté de l'étape B : ce plafond SUIT l'équipage — il est multiplié
 *  par la moyenne des multiplicateurs d'équipage des gisements de la ressource, pondérée
 *  par leur rendement. Deux conséquences volontaires :
 *   - sans équipage, tous les multiplicateurs valent 1 : le résultat est identique au bit
 *     près à ce que renvoyait cette fonction avant l'étape B (aucune régression possible) ;
 *   - avec un équipage parfait (mult_max = 2), le plafond passe de 40 % à 80 % de la
 *     production de base. La promesse d'origine tient : la carte n'égale jamais la base. */
export function territoireIncomePerHour(
  t: TerritoireState,
  prodPerHour: Partial<Record<ResourceId, number>>,
  crewMultOf?: CrewMultOf,
): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  /* Pour le plafond : Σ ratio et Σ ratio×équipage, par ressource. */
  const sumRatio: Partial<Record<ResourceId, number>> = {};
  const sumWeighted: Partial<Record<ResourceId, number>> = {};
  for (const foyer of ALL_FOYERS) {
    if (foyer.nature !== "gisement" || !foyer.resource) continue;
    if (!isCaptured(t, foyer.id)) continue;
    const base = prodPerHour[foyer.resource] ?? 0;
    if (base <= 0) continue;
    const ratio = gisementRatio(devLevel(t, foyer.id));
    const mult = safeCrewMult(foyer.id, crewMultOf);
    out[foyer.resource] = (out[foyer.resource] ?? 0) + base * ratio * mult;
    sumRatio[foyer.resource] = (sumRatio[foyer.resource] ?? 0) + ratio;
    sumWeighted[foyer.resource] = (sumWeighted[foyer.resource] ?? 0) + ratio * mult;
  }
  const cap = TERRITOIRE_INCOME.total_income_cap_ratio;
  for (const res of Object.keys(out) as ResourceId[]) {
    const denom = sumRatio[res] ?? 0;
    const avgCrew = denom > 0 ? (sumWeighted[res] ?? 0) / denom : 1;
    out[res] = Math.min(out[res] ?? 0, (prodPerHour[res] ?? 0) * cap * avgCrew);
  }
  return out;
}

/** Revenu horaire d'UN gisement capturé, avant le plafond global `total_income_cap_ratio`
 *  (celui-ci s'applique ressource par ressource sur la somme, cf. territoireIncomePerHour).
 *  Sert à la fiche d'un foyer : le joueur doit voir ce que CE gisement lui rapporte,
 *  et le panneau affiche à part le total réellement encaissé. */
export function foyerIncomePerHour(
  t: TerritoireState,
  foyer: FoyerDef,
  prodPerHour: Partial<Record<ResourceId, number>>,
  crewMultOf?: CrewMultOf,
): number {
  if (foyer.nature !== "gisement" || !foyer.resource) return 0;
  if (!isCaptured(t, foyer.id)) return 0;
  return (
    (prodPerHour[foyer.resource] ?? 0) *
    gisementRatio(devLevel(t, foyer.id)) *
    safeCrewMult(foyer.id, crewMultOf)
  );
}

/** Durée d'accumulation retenue au prochain encaissement, bornée par offline_cap_h.
 *  Retourne 0 si le territoire ne rapporte rien ou si aucune durée ne s'est écoulée. */
export function accrualWindowMs(t: TerritoireState, now: number): number {
  const from = t.lastIncomeAt > 0 ? t.lastIncomeAt : now;
  const elapsed = Math.max(0, now - from);
  return Math.min(elapsed, TERRITOIRE_INCOME.offline_cap_h * 3_600_000);
}

/** Montants à créditer depuis le dernier encaissement (l'appelant applique addResource). */
export function territoireAccrual(
  t: TerritoireState,
  prodPerHour: Partial<Record<ResourceId, number>>,
  now: number,
  crewMultOf?: CrewMultOf,
): Partial<Record<ResourceId, number>> {
  const ms = accrualWindowMs(t, now);
  if (ms <= 0) return {};
  const hours = ms / 3_600_000;
  const rates = territoireIncomePerHour(t, prodPerHour, crewMultOf);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [res, perHour] of Object.entries(rates)) {
    const amount = (perHour ?? 0) * hours;
    if (amount > 0) out[res as ResourceId] = amount;
  }
  return out;
}

/* ---------- Développement d'un gisement ---------- */

export interface DevCost {
  /** Ressource du gisement et quantité demandée (indexée sur la production du moment). */
  resource: ResourceId;
  amount: number;
  /** Monnaie de combat : la carte se développe avec ce qu'on gagne en se battant. */
  combat: number;
}

/** Dernier niveau qui augmente encore le RENDEMENT horaire. Au-delà, le
 *  développement continue sans fin mais paie en butin de reconquête. */
export function devSoftCap(): number {
  return TERRITOIRE_INCOME.max_level;
}

/** Un gisement a-t-il dépassé le dernier palier de rendement ? */
export function isDeepDev(dev: number): boolean {
  return dev > devSoftCap();
}

/** Multiplicateur de butin apporté par les niveaux PROFONDS de ce gisement.
 *  C'est ce qui donne une valeur réelle — et non bornée — aux niveaux au-delà
 *  du plafond de rendement, dans la seule économie que rien ne calibre. */
export function devLootMult(dev: number): number {
  const extra = Math.max(0, dev - devSoftCap());
  return 1 + TERRITOIRE_RECONQUETE.deep_loot_gain * extra;
}

/** Coût du passage de `dev` à `dev + 1`. Ne renvoie jamais null pour un gisement :
 *  il n'y a plus de dernier niveau (étape D).
 *
 *  Au-delà du plafond de rendement, la part en RESSOURCE cesse de croître — le
 *  stockage de la base est fini, une exigence qui grimperait indéfiniment
 *  finirait par dépasser la réserve maximale et recréerait le mur qu'on
 *  supprime ici. Toute la croissance passe dans la monnaie de combat, que rien
 *  ne plafonne et qu'on gagne précisément en re-conquérant des foyers. */
export function devCost(
  foyer: FoyerDef,
  dev: number,
  prodPerHour: Partial<Record<ResourceId, number>>,
): DevCost | null {
  if (foyer.nature !== "gisement" || !foyer.resource) return null;
  const d = TERRITOIRE.development;
  const soft = devSoftCap();
  const paid = Math.min(dev, soft); // les paliers calibrés, une seule fois
  const deep = Math.max(0, dev - soft);
  const hours = d.cost_hours_base * Math.pow(d.cost_hours_growth, paid);
  const base = prodPerHour[foyer.resource] ?? 0;
  return {
    resource: foyer.resource,
    amount: Math.ceil(hours * base),
    combat: Math.ceil(
      d.cost_combat_base *
        Math.pow(d.cost_combat_growth, paid) *
        Math.pow(d.deep_cost_combat_growth, deep),
    ),
  };
}

/* ---------- Butins ---------- */

export interface FoyerLoot {
  resources: Partial<Record<ResourceId, number>>;
  combat: number;
  fragments: number;
}

const EMPTY_LOOT: FoyerLoot = { resources: {}, combat: 0, fragments: 0 };

/** Butin d'une cache : N heures de production de chacune des ressources listées.
 *  Auto-indexé comme le revenu des gisements : une cache tardive vaut plus qu'une cache précoce. */
export function cacheLoot(
  foyer: FoyerDef,
  prodPerHour: Partial<Record<ResourceId, number>>,
): FoyerLoot {
  if (foyer.nature !== "cache") return EMPTY_LOOT;
  const c = TERRITOIRE.cache_loot;
  const hours = c.hours_base + c.hours_per_palier * foyer.palier;
  const resources: Partial<Record<ResourceId, number>> = {};
  for (const res of foyer.resources ?? []) {
    const amount = Math.round((prodPerHour[res] ?? 0) * hours);
    if (amount > 0) resources[res] = amount;
  }
  return {
    resources,
    combat: Math.round(c.combat_base + c.combat_per_palier * foyer.palier),
    fragments: 0,
  };
}

/** Butin d'un antre : la monnaie de combat de la vague est multipliée ailleurs (loot_mult),
 *  ici on ne renvoie que la prime fixe en fragments. */
export function antreLoot(): FoyerLoot {
  return { resources: {}, combat: 0, fragments: TERRITOIRE_ANTRES.fragments };
}

/** Butin d'un passage dans l'abîme, calé sur le palier réellement joué. */
export function abimeLoot(palier: number): FoyerLoot {
  const a = TERRITOIRE_ABIME;
  const frags = a.fragments_every_paliers > 0 ? Math.floor(palier / a.fragments_every_paliers) : 0;
  return {
    resources: {},
    combat: Math.round(a.combat_base + a.combat_per_palier * palier),
    fragments: Math.max(0, Math.min(3, frags)),
  };
}

/** Butin d'une RECONQUÊTE — la récompense d'un foyer qu'on reprend au lieu de le
 *  regarder comme un trophée. Indexé sur le palier réellement joué (qui monte à
 *  chaque passage) et amplifié par les niveaux profonds du foyer, donc sans
 *  plafond. `runs` = numéro de la reconquête (1 pour la première reprise). */
export function reconquestLoot(
  foyer: FoyerDef,
  palier: number,
  dev: number,
  reconquests: number,
  prodPerHour: Partial<Record<ResourceId, number>>,
): FoyerLoot {
  const r = TERRITOIRE_RECONQUETE;
  const mult = devLootMult(dev);
  const hours = (r.hours_base + r.hours_per_palier * palier) * mult;
  const resources: Partial<Record<ResourceId, number>> = {};
  // Un gisement rend la sienne, une cache les siennes, les autres ne rendent
  // que de la monnaie et des fragments : la nature du lieu dit ce qu'on y trouve.
  const list = foyer.resource ? [foyer.resource] : (foyer.resources ?? []);
  for (const res of list) {
    const amount = Math.round((prodPerHour[res] ?? 0) * hours);
    if (amount > 0) resources[res] = amount;
  }
  const every = r.fragments_every_runs;
  return {
    resources,
    combat: Math.round((r.combat_base + r.combat_per_palier * palier) * mult),
    fragments: every > 0 && reconquests > 0 && reconquests % every === 0 ? 1 : 0,
  };
}

/* ---------- Passerelle vers les expéditions ---------- */

/** Destinations garanties : prendre un site d'expédition ne crée AUCUN slot supplémentaire
 *  (ce serait toucher au calibrage : cf. military_config.json -> expeditions.daily_slots),
 *  il garantit simplement la présence de cette destination dans les offres du jour.
 *  On gagne de l'agentivité, pas du débit. */
export function guaranteedDestIds(t: TerritoireState): string[] {
  const out: string[] = [];
  for (const foyer of ALL_FOYERS) {
    if (foyer.nature !== "expedition" || !foyer.dest_id) continue;
    if (isCaptured(t, foyer.id)) out.push(foyer.dest_id);
  }
  return out;
}

/* ---------- Progression (affichage) ---------- */

export interface TerritoireProgress {
  captured: number;
  total: number;
  /** Foyers pris dans les secteurs actuellement ouverts. */
  capturedUnlocked: number;
  totalUnlocked: number;
  /** Reconquêtes menées, tous foyers confondus. Ce compteur-là ne plafonne
   *  jamais : c'est lui qui remplace le « 29/29 » comme mesure de maîtrise. */
  reconquests: number;
}

export function territoireProgress(t: TerritoireState, palier: number): TerritoireProgress {
  let captured = 0;
  let capturedUnlocked = 0;
  let totalUnlocked = 0;
  let reconquests = 0;
  for (const sector of SECTORS) {
    const open = sectorUnlocked(sector, palier);
    for (const foyer of sector.foyers) {
      const taken = isCaptured(t, foyer.id);
      if (taken) {
        captured++;
        if (!natureDef(foyer.nature).repeatable) reconquests += reconquestCount(t, foyer.id);
      }
      if (open) {
        totalUnlocked++;
        if (taken) capturedUnlocked++;
      }
    }
  }
  return { captured, total: ALL_FOYERS.length, capturedUnlocked, totalUnlocked, reconquests };
}
