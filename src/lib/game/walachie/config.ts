/* Lecture typée de walachie_config.json — la config est la source de vérité
   unique du mode (générée par tools/walachie/gen_config.py, ne pas éditer le
   JSON à la main). Ce module ne fait que LIRE et indexer. */

import rawConfig from "@/data/walachie_config.json";

export interface WalachieEraDef {
  id: string;
  nom: string;
  icone: string;
  desc: string;
  /** Fond plein cadre de WalachieScene (asset walachieSprite(decor)) — un seul
   *  tableau par groupe d'eres, aucun quadrillage de tuiles. */
  decor: string;
  unlock_cost: number;
}

export type WalachieComportement = "predateur" | "proie" | "erre" | "orne";

export interface WalachieNodeDef {
  id: string;
  ere: string;
  nom: string;
  sprite: string | null;
  desc: string;
  /** predateur (chasse la proie la plus proche) / proie (fuit) / erre (libre) / orne (immobile). */
  comportement: WalachieComportement;
  base_cost: number;
  cost_ratio: number;
  base_prod: number;
}

export interface WalachieEventDef {
  id: string;
  nom: string;
  desc: string;
  effet: "prod_mult" | "click_mult" | "instant_min";
  valeur: number;
  duree_s: number;
  poids: number;
}

export interface WalachieMetaDef {
  id: string;
  nom: string;
  desc: string;
  effet: "prod_mult" | "click_mult" | "offline_h" | "event_speed" | "start_seve";
  valeur: number;
  cost_base: number;
  cost_ratio: number;
}

interface WalachieConfig {
  click: { base: number; prod_share: number };
  offline: { cap_hours: number };
  prestige: {
    eclat_div: number;
    eclat_pow: number;
    cycle_prod_bonus: number;
    min_eclats: number;
  };
  events: {
    interval_min_s: number;
    interval_max_s: number;
    retour_gift_min: number;
    pool: WalachieEventDef[];
  };
  habit_bonus: {
    bilan_prod_mult: number;
    streak_prod_per_day: number;
    streak_prod_cap: number;
    perfect_click_mult: number;
  };
  meta: WalachieMetaDef[];
  scene: { world_w: number; world_h: number; max_sprites_par_noeud: number };
  /** Queue procedurale infinie au-dela de la derniere ere reelle (eras[eras.length-1]).
   *  Jamais de liste ecrite : eraAt()/nodeDef() la genere a la volee. */
  tail: { growth: number; decor: string; icone: string; sprite: string | null; cost_ratio: number; nom_pattern: string };
  /** Creature brillante : tous les `seuil` exemplaires d'un meme noeud, une charge
   *  apparait dans l'ecosysteme ; cliquee, elle multiplie la seve en stock. */
  shiny: { seuil: number; multiplicateur: number };
  eras: WalachieEraDef[];
  nodes: WalachieNodeDef[];
}

export const WCFG = rawConfig as unknown as WalachieConfig;

export const WERAS: ReadonlyArray<WalachieEraDef> = WCFG.eras;
export const WNODES: ReadonlyArray<WalachieNodeDef> = WCFG.nodes;
export const WEVENTS: ReadonlyArray<WalachieEventDef> = WCFG.events.pool;
export const WMETA: ReadonlyArray<WalachieMetaDef> = WCFG.meta;

const eraIndexById = new Map(WERAS.map((e, i) => [e.id, i] as const));
const nodeById = new Map(WNODES.map((n) => [n.id, n] as const));
const eventById = new Map(WEVENTS.map((e) => [e.id, e] as const));
const metaById = new Map(WMETA.map((m) => [m.id, m] as const));

const REAL_ERA_COUNT = WERAS.length;
const LAST_REAL_ERA = WERAS[REAL_ERA_COUNT - 1];
const LAST_REAL_NODE = WNODES[WNODES.length - 1];
const TAIL = WCFG.tail;
const TAIL_ERA_RE = /^amas_(\d+)$/;
const TAIL_NODE_RE = /^essaim_(\d+)$/;

/** L'ère à l'index donné — au-delà de la dernière ère réelle (Toile Galactique),
 *  génère un « Amas » virtuel à la volée (croissance identique aux ères réelles).
 *  Aucune fin n'est jamais écrite : c'est la queue infinie du mode. */
export function eraAt(index: number): WalachieEraDef {
  if (index < REAL_ERA_COUNT) return WERAS[index];
  const k = index - REAL_ERA_COUNT + 1;
  return {
    id: `amas_${k}`,
    nom: TAIL.nom_pattern.replace("{k}", String(k)),
    icone: TAIL.icone,
    desc: "Walachie essaime encore plus loin dans la galaxie — il n'y a pas de dernier amas.",
    decor: TAIL.decor,
    unlock_cost: LAST_REAL_ERA.unlock_cost * Math.pow(TAIL.growth, k),
  };
}

export function eraIndex(id: string): number {
  const real = eraIndexById.get(id);
  if (real !== undefined) return real;
  const m = TAIL_ERA_RE.exec(id);
  return m ? REAL_ERA_COUNT - 1 + Number(m[1]) : 0;
}

/** Le nœud unique d'un amas virtuel (id `essaim_k`), synthétisé depuis le
 *  gabarit du dernier nœud réel — même croissance, jamais de dernier niveau. */
export function nodeDef(id: string): WalachieNodeDef | undefined {
  const real = nodeById.get(id);
  if (real) return real;
  const m = TAIL_NODE_RE.exec(id);
  if (!m) return undefined;
  const k = Number(m[1]);
  const g = Math.pow(TAIL.growth, k);
  return {
    id,
    ere: `amas_${k}`,
    nom: `Essaim de l'amas ${k}`,
    sprite: TAIL.sprite,
    desc: "Un essaim de vie walachienne colonise un monde de plus, sans jamais s'arrêter.",
    comportement: "erre",
    base_cost: LAST_REAL_NODE.base_cost * g,
    cost_ratio: TAIL.cost_ratio,
    base_prod: LAST_REAL_NODE.base_prod * g,
  };
}
export function eventDef(id: string): WalachieEventDef | undefined {
  return eventById.get(id);
}
export function metaDef(id: string): WalachieMetaDef | undefined {
  return metaById.get(id);
}
export function nodesOfEra(eraId: string): WalachieNodeDef[] {
  const real = WNODES.filter((n) => n.ere === eraId);
  if (real.length) return real;
  const m = TAIL_ERA_RE.exec(eraId);
  if (!m) return [];
  const def = nodeDef(`essaim_${m[1]}`);
  return def ? [def] : [];
}

/** Chemin d'un sprite Walachie (assets générés via PixelLab, tools/gen_walachie.py). */
export function walachieSprite(name: string): string {
  return `/assets/walachie/${name}.png`;
}
