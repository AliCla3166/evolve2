/* Moteur pur du mode Walachie — fonctions (state, ...) => valeur, aucun DOM,
   aucun accès au store. Toutes les constantes viennent de walachie_config.json.

   Doctrine héritée du jeu principal :
   - le hasard AJOUTE, jamais ne retire (les événements sont tous des bonus) ;
   - aucune progression ne se termine (méta sans dernier niveau, Renaissances
     infinies, la Divinité se rachète — chaque exemplaire compte) ;
   - le pont avec les habitudes réelles est en LECTURE SEULE : des habitudes
     manquantes n'enlèvent rien, des habitudes tenues donnent des bonus. */

import type { GameState } from "@/lib/game/types";
import { dayKey } from "@/lib/game/habits";
import {
  eraAt,
  eraIndex,
  eventDef,
  metaDef,
  nodeDef,
  WCFG,
  WEVENTS,
  WMETA,
} from "./config";
import type { WalachieState } from "./types";

export const WALACHIE_SAVE_VERSION = 1;

/* ---------- PRNG déterministe (mulberry32, un pas par tirage) ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un tirage, et la graine avance d'un pas (à répercuter dans l'état). */
function roll(state: WalachieState): number {
  const r = mulberry32(state.rngSeed)();
  state.rngSeed = (state.rngSeed + 0x6d2b79f5) >>> 0;
  return r;
}

/* ---------- État neuf ---------- */

export function freshWalachieState(now: number, keep?: Pick<WalachieState, "eclats" | "cycles" | "meta" | "seveAllTime">): WalachieState {
  const startLevel = keep?.meta?.meta_depart ?? 0;
  const startDef = metaDef("meta_depart");
  const startSeve = startDef && startLevel > 0 ? startDef.valeur * Math.pow(10, startLevel) : 0;
  return {
    version: WALACHIE_SAVE_VERSION,
    seve: startSeve,
    seveCycle: 0,
    seveAllTime: keep?.seveAllTime ?? 0,
    pulsations: 0,
    nodes: {},
    erasUnlocked: 1,
    eclats: keep?.eclats ?? 0,
    cycles: keep?.cycles ?? 0,
    meta: keep?.meta ?? {},
    shinyClaimed: {},
    lastTick: now,
    rngSeed: (now ^ 0x9e3779b9) >>> 0,
    nextEventAt: now + scheduleDelayMs({ meta: keep?.meta ?? {} } as WalachieState, mulberry32(now >>> 0)()),
    activeEvent: null,
    eventLog: [],
  };
}

/* ---------- Le pont avec les habitudes du jeu principal (lecture seule) ---------- */

export interface HabitBridge {
  /** ×prod si le Bilan du soir d'aujourd'hui est validé dans EVOLVE. */
  bilanMult: number;
  /** ×prod issu de la série d'habitudes (plafonné par la config). */
  streakMult: number;
  /** ×pulsation si la journée d'aujourd'hui tient la série. */
  clickMult: number;
  /** Longueur de série affichable. */
  streak: number;
  /** true si le Bilan d'aujourd'hui est validé. */
  bilanDone: boolean;
}

export function habitBridge(game: GameState | null, now: number): HabitBridge {
  const hb = WCFG.habit_bonus;
  if (!game) {
    return { bilanMult: 1, streakMult: 1, clickMult: 1, streak: 0, bilanDone: false };
  }
  const today = dayKey(now);
  const bilanDone = game.bilan?.lastDay === today;
  const streak = game.habits?.streak ?? 0;
  const streakBonus = Math.min(hb.streak_prod_cap, streak * hb.streak_prod_per_day);
  const entry = game.habits?.days?.[today];
  const dayHolds = !!entry && entry.validatedCount > 0 && !entry.late;
  return {
    bilanMult: bilanDone ? hb.bilan_prod_mult : 1,
    streakMult: 1 + streakBonus,
    clickMult: dayHolds ? hb.perfect_click_mult : 1,
    streak,
    bilanDone,
  };
}

/* ---------- Multiplicateurs & production ---------- */

export function metaLevel(state: WalachieState, id: string): number {
  return state.meta[id] ?? 0;
}

export function metaCost(state: WalachieState, id: string): number {
  const def = metaDef(id);
  if (!def) return Infinity;
  return def.cost_base * Math.pow(def.cost_ratio, metaLevel(state, id));
}

function metaMult(state: WalachieState, effet: "prod_mult" | "click_mult"): number {
  let m = 1;
  for (const def of WMETA) {
    if (def.effet === effet) m *= 1 + def.valeur * metaLevel(state, def.id);
  }
  return m;
}

export function offlineCapMs(state: WalachieState): number {
  let hours = WCFG.offline.cap_hours;
  for (const def of WMETA) {
    if (def.effet === "offline_h") hours += def.valeur * metaLevel(state, def.id);
  }
  return hours * 3_600_000;
}

function eventProdMult(state: WalachieState, now: number): number {
  const ev = state.activeEvent && now < state.activeEvent.endsAt ? eventDef(state.activeEvent.id) : undefined;
  return ev && ev.effet === "prod_mult" ? ev.valeur : 1;
}

function eventClickMult(state: WalachieState, now: number): number {
  const ev = state.activeEvent && now < state.activeEvent.endsAt ? eventDef(state.activeEvent.id) : undefined;
  return ev && ev.effet === "click_mult" ? ev.valeur : 1;
}

/** Production brute des nœuds, sans multiplicateurs. */
export function baseProdPerSec(state: WalachieState): number {
  let p = 0;
  for (const [id, count] of Object.entries(state.nodes)) {
    const def = nodeDef(id);
    if (def && count > 0) p += def.base_prod * count;
  }
  return p;
}

/** Production effective /s (méta × cycles × habitudes × événement). */
export function prodPerSec(state: WalachieState, bridge: HabitBridge, now: number): number {
  return (
    baseProdPerSec(state) *
    metaMult(state, "prod_mult") *
    (1 + WCFG.prestige.cycle_prod_bonus * state.cycles) *
    bridge.bilanMult *
    bridge.streakMult *
    eventProdMult(state, now)
  );
}

/** Valeur d'une pulsation (tap sur le monde). */
export function clickValue(state: WalachieState, bridge: HabitBridge, now: number): number {
  const base = WCFG.click.base + WCFG.click.prod_share * prodPerSec(state, bridge, now);
  return base * metaMult(state, "click_mult") * bridge.clickMult * eventClickMult(state, now);
}

/* ---------- Coûts & achats ---------- */

export function nodeCost(state: WalachieState, id: string): number {
  const def = nodeDef(id);
  if (!def) return Infinity;
  return def.base_cost * Math.pow(def.cost_ratio, state.nodes[id] ?? 0);
}

/** Coût cumulé des `n` prochains exemplaires (série géométrique). */
export function nodeCostN(state: WalachieState, id: string, n: number): number {
  const def = nodeDef(id);
  if (!def || n <= 0) return Infinity;
  const c0 = nodeCost(state, id);
  const r = def.cost_ratio;
  return c0 * (Math.pow(r, n) - 1) / (r - 1);
}

/** Combien d'exemplaires sont payables avec la sève en stock. */
export function nodeMaxBuyable(state: WalachieState, id: string): number {
  const def = nodeDef(id);
  if (!def) return 0;
  const c0 = nodeCost(state, id);
  if (state.seve < c0) return 0;
  const r = def.cost_ratio;
  const n = Math.floor(Math.log((state.seve * (r - 1)) / c0 + 1) / Math.log(r));
  return Math.max(1, n);
}

export function nodeAvailable(state: WalachieState, id: string): boolean {
  const def = nodeDef(id);
  return !!def && eraIndex(def.ere) < state.erasUnlocked;
}

/** Achète jusqu'à `n` exemplaires. Mutation en place, renvoie le nombre acheté. */
export function buyNode(state: WalachieState, id: string, n: number): number {
  if (!nodeAvailable(state, id)) return 0;
  let bought = 0;
  while (bought < n) {
    const c = nodeCost(state, id);
    if (state.seve < c) break;
    state.seve -= c;
    state.nodes[id] = (state.nodes[id] ?? 0) + 1;
    bought += 1;
  }
  return bought;
}

/** L'ère suivante à percer — toujours définie : la queue est infinie
 *  (Divinité/Ascension n'est qu'une marche, pas une fin). */
export function nextEraDef(state: WalachieState) {
  return eraAt(state.erasUnlocked);
}

/** L'ère la plus avancée déjà percée (pour le décor de la scène). */
export function currentEraDef(state: WalachieState) {
  return eraAt(Math.max(0, state.erasUnlocked - 1));
}

/** Perce l'ère suivante si la sève suffit. Mutation en place. */
export function unlockNextEra(state: WalachieState): boolean {
  const next = nextEraDef(state);
  if (!next || state.seve < next.unlock_cost) return false;
  state.seve -= next.unlock_cost;
  state.erasUnlocked += 1;
  return true;
}

export function buyMeta(state: WalachieState, id: string): boolean {
  const cost = metaCost(state, id);
  if (state.eclats < cost) return false;
  state.eclats -= cost;
  state.meta[id] = metaLevel(state, id) + 1;
  return true;
}

/* ---------- Créature brillante (paillettes, ×multiplicateur ponctuel) ---------- */
/* Distincte des améliorations meta : ceci n'est PAS une amélioration qui se valide
   une fois, mais un bonus qui revient à chaque palier de `shiny.seuil` exemplaires
   d'un même nœud possédé — un gros coup de pouce à déclencher quand ça compte,
   jamais automatique (le joueur doit taper la créature dans l'écosystème). */

export function shinyChargesAvailable(state: WalachieState, id: string): number {
  const owned = state.nodes[id] ?? 0;
  const claimed = state.shinyClaimed?.[id] ?? 0;
  return Math.max(0, Math.floor(owned / WCFG.shiny.seuil) - claimed);
}

/** Tous les ids de nœuds possédant au moins une charge de créature brillante. */
export function shinyAvailableIds(state: WalachieState): string[] {
  return Object.keys(state.nodes).filter((id) => shinyChargesAvailable(state, id) > 0);
}

/** Réclame une charge : double (×multiplicateur) la sève en stock. Mutation en place,
 *  renvoie le gain (0 si aucune charge disponible pour ce nœud). */
export function claimShiny(state: WalachieState, id: string): number {
  if (shinyChargesAvailable(state, id) <= 0) return 0;
  state.shinyClaimed = { ...state.shinyClaimed, [id]: (state.shinyClaimed?.[id] ?? 0) + 1 };
  const gain = state.seve * (WCFG.shiny.multiplicateur - 1);
  state.seve += gain;
  state.seveCycle += gain;
  state.seveAllTime += gain;
  return gain;
}

/* ---------- Renaissance ---------- */

export function renaissanceReady(state: WalachieState): boolean {
  return (state.nodes["divinite"] ?? 0) > 0;
}

export function renaissanceEclats(state: WalachieState): number {
  if (!renaissanceReady(state)) return 0;
  const p = WCFG.prestige;
  return Math.max(p.min_eclats, Math.floor(Math.pow(state.seveCycle / p.eclat_div, p.eclat_pow)));
}

/** Renaît : conserve Éclats (+gain), cycles+1, méta et vitrine. Renvoie le nouvel état. */
export function renaissance(state: WalachieState, now: number): WalachieState {
  const gain = renaissanceEclats(state);
  if (gain <= 0) return state;
  return freshWalachieState(now, {
    eclats: state.eclats + gain,
    cycles: state.cycles + 1,
    meta: state.meta,
    seveAllTime: state.seveAllTime,
  });
}

/* ---------- Événements spontanés ---------- */

function scheduleDelayMs(state: Pick<WalachieState, "meta">, r: number): number {
  const ev = WCFG.events;
  let speed = 1;
  const def = metaDef("meta_events");
  if (def) speed = Math.max(0.5, 1 - def.valeur * ((state.meta ?? {})["meta_events"] ?? 0));
  const span = ev.interval_max_s - ev.interval_min_s;
  return (ev.interval_min_s + span * r) * 1000 * speed;
}

function pickEvent(r: number) {
  const total = WEVENTS.reduce((s, e) => s + e.poids, 0);
  let acc = r * total;
  for (const e of WEVENTS) {
    acc -= e.poids;
    if (acc <= 0) return e;
  }
  return WEVENTS[WEVENTS.length - 1];
}

const EVENT_LOG_MAX = 12;

function pushLog(state: WalachieState, id: string, at: number, seve: number): void {
  state.eventLog = [{ id, at, seve }, ...state.eventLog].slice(0, EVENT_LOG_MAX);
}

/* ---------- Le tick (rattrapage hors ligne compris) ---------- */

export interface WalachieTickSummary {
  /** Sève produite pendant ce tick (hors pulsations). */
  gained: number;
  /** ms de production hors ligne perdues au plafond (0 si rien). */
  cappedMs: number;
  /** Événement déclenché pendant ce tick, s'il y en a un. */
  eventFired: string | null;
  /** Sève du cadeau de retour (événement manqué hors ligne). */
  retourGift: number;
}

/** Fait avancer le monde jusqu'à `now`. Mutation en place.
 *  Le rattrapage hors ligne est le même code qu'un tick d'une seconde :
 *  seule la durée change, plafonnée par offlineCapMs. */
export function walachieTick(state: WalachieState, bridge: HabitBridge, now: number): WalachieTickSummary {
  const summary: WalachieTickSummary = { gained: 0, cappedMs: 0, eventFired: null, retourGift: 0 };
  const rawDt = Math.max(0, now - state.lastTick);
  const cap = offlineCapMs(state);
  const dt = Math.min(rawDt, cap);
  summary.cappedMs = rawDt - dt;

  // Production sur la durée effective. Les multiplicateurs d'événement ne
  // s'appliquent que sur la fenêtre encore active de l'effet.
  const p = prodPerSec(state, bridge, state.lastTick);
  const gained = p * (dt / 1000);
  state.seve += gained;
  state.seveCycle += gained;
  state.seveAllTime += gained;
  summary.gained = gained;

  // L'effet temporaire expire ?
  if (state.activeEvent && now >= state.activeEvent.endsAt) state.activeEvent = null;

  // Moment spontané. Une longue absence ne déclenche pas dix événements en
  // rafale : un seul « cadeau de retour » (instantané), puis on replanifie.
  if (now >= state.nextEventAt) {
    const missedLong = rawDt > 15 * 60 * 1000;
    if (missedLong) {
      const gift = prodPerSec(state, bridge, now) * WCFG.events.retour_gift_min * 60;
      state.seve += gift;
      state.seveCycle += gift;
      state.seveAllTime += gift;
      summary.retourGift = gift;
      pushLog(state, "retour", now, gift);
    } else {
      const def = pickEvent(roll(state));
      summary.eventFired = def.id;
      if (def.effet === "instant_min") {
        const gift = prodPerSec(state, bridge, now) * def.valeur * 60;
        state.seve += gift;
        state.seveCycle += gift;
        state.seveAllTime += gift;
        pushLog(state, def.id, now, gift);
      } else {
        state.activeEvent = { id: def.id, endsAt: now + def.duree_s * 1000 };
        pushLog(state, def.id, now, 0);
      }
    }
    state.nextEventAt = now + scheduleDelayMs(state, roll(state));
  }

  state.lastTick = now;
  return summary;
}

/** Une pulsation (tap). Mutation en place, renvoie la sève gagnée. */
export function pulse(state: WalachieState, bridge: HabitBridge, now: number): number {
  const v = clickValue(state, bridge, now);
  state.seve += v;
  state.seveCycle += v;
  state.seveAllTime += v;
  state.pulsations += 1;
  return v;
}

/* ---------- Formatage des grands nombres (rendu uniquement) ---------- */

const SUFFIXES = ["", "k", "M", "Md", "Bn", "Bd", "Tn", "Td", "Qa", "Qd"];

/** "12,4 Md" — échelle courte française ; au-delà des suffixes, notation e. */
export function fmtSeve(n: number): string {
  if (!isFinite(n)) return "∞";
  if (n < 1000) return n < 100 ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : Math.floor(n).toLocaleString("fr-FR");
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace(".", ",");
  const v = n / Math.pow(10, tier * 3);
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 100 ? 1 : 0 })} ${SUFFIXES[tier]}`;
}
