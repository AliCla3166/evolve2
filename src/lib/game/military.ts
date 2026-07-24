/* Couche militaire (Phase 5) — pur, données depuis military_config.json.
   Recrutement au Noyau, expéditions à retour différé, vagues de pathogènes
   annoncées, événements aléatoires. Tous les tirages passent par un PRNG
   déterministe seedé dans la sauvegarde (rngSeed) : le moteur reste pur et
   rejouable. Les offres de destinations du jour sont DÉRIVÉES (createdAt +
   jour calendaire), jamais stockées. */

import rawConfig from "@/data/military_config.json";
import {
  cardsDefenseBonus,
  cardsExpeditionAtkBonus,
  cardsExpeditionExpBonus,
} from "./cards";
import { resourceCap, totalProductionPerHour } from "./economy";
import { dayKey, ENERGY_CAP } from "./habits";
import { liveWaveCombatReward } from "./bastion/config";
import type { LiveWaveResult } from "./bastion/types";
import type {
  Expedition,
  GameState,
  Report,
  ResourceId,
  UnitId,
} from "./types";

/* ---------- Typage de la config ---------- */

export interface UnitConfig {
  name: string;
  role: string;
  desc: string;
  icon: string;
  accent: string;
  power_def: number;
  power_exp: number;
  power_atk: number;
  cost: Record<string, number>;
}

interface DestinationTemplate {
  id: string;
  name: string;
  tier: number;
  duration_h: [number, number];
  risk: [number, number];
  difficulty: [number, number];
  rewards: string[];
  fragments: [number, number];
  boost_chance: number;
}

interface EventDef {
  id: string;
  weight: number;
  kind: "auto" | "choice";
  name: string;
  icon: string;
  production_hours?: [number, number];
  build_time_reduction?: [number, number];
  fallback_energie?: number;
  biomasse_hours?: [number, number];
  reveal_only?: boolean;
  prompt?: string;
  options?: {
    label: string;
    success_chance?: number;
    success?: Record<string, [number, number]>;
    failure?: Record<string, number>;
    effect?: string;
  }[];
}

export interface MilitaryConfig {
  units: Record<UnitId, UnitConfig>;
  unit_cap: { base: number; per_noyau_level: number };
  expeditions: {
    daily_slots: number;
    max_concurrent: number;
    success: { base: number; ratio_weight: number; risk_weight: number; min: number; max: number };
    failure_reward_ratio: number;
    failure_loss_chance_per_risk: number;
    max_losses_per_expedition: number;
    boost_reduction_range: [number, number];
    destinations: DestinationTemplate[];
    reward_hours_by_tier: Record<string, [number, number]>;
  };
  pathogens: {
    first_attack_delay_h: number;
    interval_h: [number, number];
    wave_power_base: number;
    wave_power_growth_per_day: number;
    wave_power_growth_cap: number;
    wave_variance: number;
    defense_membrane_bonus_per_level: number;
    defense_noyau_bonus_per_level: number;
    defeat_resource_loss_ratio: number;
    defeat_unit_loss: number;
    victory_reward: Record<string, number>;
  };
  events: {
    interval_h: [number, number];
    max_offline_catchup: number;
    choice_expiry_h: number;
    pool: EventDef[];
  };
  reports_cap: number;
}

export const MILITARY = rawConfig as unknown as MilitaryConfig;

export const UNIT_IDS: UnitId[] = ["garde", "sonde", "phage"];

/** Durée de vie max du verrou bastion.liveBattleActive (cf. applyMilitary) — largement
 *  au-dessus de la durée réelle d'un combat (quelques dizaines de secondes, cf. engine.ts),
 *  purement un filet de sécurité contre un onglet fermé/un crash en plein combat. */
const LIVE_BATTLE_GRACE_MS = 20 * 60_000;

/* ---------- PRNG déterministe (mulberry32, un pas par tirage) ---------- */

/** Un pas de PRNG : retourne [valeur 0..1, graine suivante]. */
export function rand(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [v, (seed + 0x6d2b79f5) | 0];
}

/** Tirage dans un intervalle [a, b] en avançant la graine du DRAFT d'état. */
function draw(state: GameState, range: [number, number]): number {
  const [v, next] = rand(state.rngSeed);
  state.rngSeed = next;
  return range[0] + v * (range[1] - range[0]);
}

function drawUnit(state: GameState): number {
  const [v, next] = rand(state.rngSeed);
  state.rngSeed = next;
  return v;
}

/* ---------- Unités ---------- */

export function unitConfig(id: UnitId): UnitConfig {
  return MILITARY.units[id];
}

/** Effectif maximal total, tiré par le niveau du Noyau. */
export function unitCap(buildings: GameState["buildings"]): number {
  return (
    MILITARY.unit_cap.base +
    MILITARY.unit_cap.per_noyau_level * Math.max(1, buildings.noyau ?? 1)
  );
}

export function totalUnits(units: Record<UnitId, number>): number {
  return UNIT_IDS.reduce((sum, id) => sum + (units[id] ?? 0), 0);
}

/** Unités actuellement déployées en expédition. */
export function deployedUnits(state: GameState): Record<UnitId, number> {
  const out: Record<UnitId, number> = { garde: 0, sonde: 0, phage: 0 };
  for (const exp of state.expeditions) {
    for (const id of UNIT_IDS) out[id] += exp.squad[id] ?? 0;
  }
  return out;
}

/** Unités disponibles (possédées − déployées). */
export function availableUnits(state: GameState): Record<UnitId, number> {
  const deployed = deployedUnits(state);
  const out: Record<UnitId, number> = { garde: 0, sonde: 0, phage: 0 };
  for (const id of UNIT_IDS) out[id] = Math.max(0, (state.units[id] ?? 0) - deployed[id]);
  return out;
}

export function recruitCost(id: UnitId): Record<string, number> {
  return unitConfig(id).cost;
}

/** Recrutement possible ? (effectif sous le cap ET coût couvert). */
export function canRecruit(state: GameState, id: UnitId): boolean {
  if (totalUnits(state.units) >= unitCap(state.buildings)) return false;
  return Object.entries(recruitCost(id)).every(
    ([res, amount]) => (state.resources[res as ResourceId] ?? 0) >= amount,
  );
}

/** Puissance d'exploration d'une escouade (power_exp de chaque unité). */
export function squadExpPower(squad: Record<UnitId, number>): number {
  return UNIT_IDS.reduce((s, id) => s + (squad[id] ?? 0) * unitConfig(id).power_exp, 0);
}

/** Puissance d'assaut d'une escouade (mitige le risque des destinations). */
export function squadAtkPower(squad: Record<UnitId, number>): number {
  return UNIT_IDS.reduce((s, id) => s + (squad[id] ?? 0) * unitConfig(id).power_atk, 0);
}

/** Puissance défensive de la cellule : gardes DISPONIBLES + bonus Membrane/Noyau
 *  + cartes assignées en défense (Phase 6). */
export function defensePower(state: GameState): number {
  const avail = availableUnits(state);
  return (
    avail.garde * unitConfig("garde").power_def +
    (state.buildings.membrane ?? 0) * MILITARY.pathogens.defense_membrane_bonus_per_level +
    Math.max(1, state.buildings.noyau ?? 1) * MILITARY.pathogens.defense_noyau_bonus_per_level +
    cardsDefenseBonus(state)
  );
}

/** Puissance estimée de la prochaine vague (hors variance, pour l'affichage). */
export function estimatedWavePower(state: GameState, now: number): number {
  const p = MILITARY.pathogens;
  const days = Math.max(0, (now - state.createdAt) / 86_400_000);
  const growth = Math.min(p.wave_power_growth_cap, p.wave_power_growth_per_day * days);
  return Math.round(p.wave_power_base * (1 + growth));
}

/* ---------- Offres de destinations du jour (dérivées, jamais stockées) ---------- */

export interface DestinationOffer {
  destId: string;
  destName: string;
  tier: number;
  durationH: number;
  risk: number;
  difficulty: number;
  rewards: string[];
  boostChance: number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Les offres du jour : déterministes pour (sauvegarde, jour calendaire local).
 *  Changent chaque jour à minuit — pas besoin de les persister. */
export function dailyOffers(state: GameState, now: number): DestinationOffer[] {
  const cfg = MILITARY.expeditions;
  let seed = hashString(`${state.createdAt}:${dayKey(now)}`);
  const local = (range: [number, number]) => {
    const [v, next] = rand(seed);
    seed = next;
    return range[0] + v * (range[1] - range[0]);
  };
  // Mélange déterministe des templates puis sélection des N premiers.
  const pool = [...cfg.destinations];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(local([0, i + 1])) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, cfg.daily_slots).map((t) => ({
    destId: t.id,
    destName: t.name,
    tier: t.tier,
    durationH: Math.round(local(t.duration_h) * 10) / 10,
    risk: Math.round(local(t.risk) * 100) / 100,
    difficulty: Math.round(local(t.difficulty)),
    rewards: t.rewards,
    boostChance: t.boost_chance,
  }));
}

/** Chance de succès affichée/utilisée pour une escouade sur une offre.
 *  `bonus` = apport des cartes assignées en expédition (Phase 6). */
export function successChance(
  offer: { risk: number; difficulty: number },
  squad: Record<UnitId, number>,
  bonus?: { exp?: number; atk?: number },
): number {
  const s = MILITARY.expeditions.success;
  const expPower = squadExpPower(squad) + (bonus?.exp ?? 0);
  const atkPower = squadAtkPower(squad) + (bonus?.atk ?? 0);
  const riskEff =
    offer.risk * (1 - Math.min(0.5, atkPower / Math.max(1, offer.difficulty)));
  const p =
    s.base +
    s.ratio_weight * Math.min(1, expPower / Math.max(1, offer.difficulty)) -
    s.risk_weight * riskEff;
  return Math.min(s.max, Math.max(s.min, p));
}

/** Bonus des cartes assignées en expédition, prêt à passer à successChance. */
export function cardExpeditionBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): { exp: number; atk: number } {
  return {
    exp: cardsExpeditionExpBonus(state),
    atk: cardsExpeditionAtkBonus(state),
  };
}

/* ---------- Helpers d'état (mutent le DRAFT de applyTick uniquement) ---------- */

function addResource(state: GameState, res: string, amount: number): void {
  const id = res as ResourceId;
  if (state.resources[id] === undefined || amount <= 0) return;
  const cap = res === "energie" ? ENERGY_CAP : resourceCap(id, state.buildings);
  state.resources[id] = Math.min(cap, state.resources[id] + amount);
}

export function pushReport(
  state: GameState,
  type: Report["type"],
  title: string,
  lines: string[],
  ts: number,
  success?: boolean,
): void {
  state.reports = [
    { id: state.nextReportId, ts, type, title, lines, success },
    ...state.reports,
  ].slice(0, MILITARY.reports_cap);
  state.nextReportId += 1;
}

const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");

/* ---------- Résolutions (appelées par applyTick sur son draft) ---------- */

function resolveExpedition(state: GameState, exp: Expedition): void {
  const cfg = MILITARY.expeditions;
  const p = successChance(exp, exp.squad, cardExpeditionBonus(state));
  const success = drawUnit(state) < p;
  const lines: string[] = [
    `Escouade : ${UNIT_IDS.filter((u) => exp.squad[u] > 0)
      .map((u) => `${exp.squad[u]}× ${unitConfig(u).name}`)
      .join(", ")}`,
  ];

  // Récompenses en ressources ≈ N heures de production totale, réparties.
  const hoursRange = cfg.reward_hours_by_tier[String(exp.tier)] ?? [2, 4];
  const hours = draw(state, hoursRange);
  const perHour = totalProductionPerHour(state.buildings);
  const totalPerHour = Object.values(perHour).reduce((a, b) => a + b, 0);
  const budget = Math.max(40, hours * totalPerHour) * (success ? 1 : cfg.failure_reward_ratio);
  const share = budget / Math.max(1, exp.rewards.length);
  for (const res of exp.rewards) {
    addResource(state, res, share);
    lines.push(`+${fmt(share)} ${res}`);
  }

  if (success) {
    // Fragments de carte (préparent la Phase 6).
    const tpl = cfg.destinations.find((d) => d.id === exp.destId);
    const frags = Math.round(draw(state, tpl?.fragments ?? [0, 1]));
    if (frags > 0) {
      state.fragments += frags;
      lines.push(`+${frags} fragment${frags > 1 ? "s" : ""} de carte`);
    }
    // Boost : accélération du chantier en cours.
    if (state.buildQueue && drawUnit(state) < exp.boostChance) {
      const ratio = draw(state, cfg.boost_reduction_range);
      const remaining = Math.max(0, state.buildQueue.endsAt - exp.endsAt);
      state.buildQueue = {
        ...state.buildQueue,
        endsAt: state.buildQueue.endsAt - remaining * ratio,
      };
      lines.push(`⚡ Chantier accéléré de ${Math.round(ratio * 100)} %`);
    }
  } else {
    // Pertes légères, plafonnées.
    let losses = 0;
    for (const id of UNIT_IDS) {
      if (losses >= cfg.max_losses_per_expedition) break;
      if ((exp.squad[id] ?? 0) > 0 && drawUnit(state) < exp.risk * cfg.failure_loss_chance_per_risk) {
        state.units = { ...state.units, [id]: Math.max(0, state.units[id] - 1) };
        lines.push(`− 1 ${unitConfig(id).name} perdue`);
        losses += 1;
      }
    }
    if (losses === 0) lines.push("Aucune perte — repli réussi.");
  }

  pushReport(
    state,
    "expedition",
    `${success ? "✅" : "⚠️"} ${exp.destName} — ${success ? "succès" : "échec partiel"}`,
    lines,
    exp.endsAt,
    success,
  );
}

/** Récompense/pénalité communes à une vague repoussée ou perdue — partagées par la
 *  résolution auto (comparaison de puissance) et la résolution en direct (bataille
 *  jouée dans le Bastion-Défense), pour que les deux chemins restent équivalents. */
function applyWaveOutcome(state: GameState, success: boolean, lines: string[]): void {
  const p = MILITARY.pathogens;
  if (success) {
    for (const [res, amount] of Object.entries(p.victory_reward)) {
      addResource(state, res, amount);
      lines.push(`+${fmt(amount)} ${res} (dépouilles)`);
    }
  } else {
    for (const res of Object.keys(state.resources) as ResourceId[]) {
      if (res === "energie" || res === "vitalite" || res === "combat") continue;
      const loss = state.resources[res] * p.defeat_resource_loss_ratio;
      if (loss > 0.5) {
        state.resources[res] -= loss;
        lines.push(`−${fmt(loss)} ${res} dévorés`);
      }
    }
    const avail = availableUnits(state);
    if (avail.garde > 0 && p.defeat_unit_loss > 0) {
      state.units = { ...state.units, garde: state.units.garde - p.defeat_unit_loss };
      lines.push(`− ${p.defeat_unit_loss} Garde membranaire tombée`);
    }
    lines.push("Renforce ta garnison au Noyau avant la prochaine vague.");
  }
}

function resolvePathogenWave(state: GameState, at: number): void {
  const p = MILITARY.pathogens;
  const estimated = estimatedWavePower(state, at);
  const wavePower = estimated * (1 + draw(state, [-p.wave_variance, p.wave_variance]));
  const def = defensePower(state);
  const wave = state.waveCount + 1;
  const success = def >= wavePower;
  const lines = [
    `Puissance de la vague : ${fmt(wavePower)}`,
    `Défense de la cellule : ${fmt(def)}`,
  ];

  applyWaveOutcome(state, success, lines);

  state.waveCount = wave;
  pushReport(
    state,
    "pathogene",
    success ? `🛡️ Vague ${wave} repoussée !` : `🦠 Vague ${wave} — la membrane a cédé`,
    lines,
    at,
    success,
  );
}

/** Résout EN DIRECT la vague actuellement planifiée (`state.nextAttackAt`), à partir du
 *  résultat de la bataille jouée dans le Bastion-Défense (cf. bastion/engine.ts). Avance
 *  `waveCount`/`nextAttackAt` exactement comme `resolvePathogenWave`, pour que ce chemin
 *  manuel et le chemin auto (offline) restent parfaitement interchangeables — si le joueur
 *  ignore l'alerte ou est hors ligne, l'auto-résolution reprend la main sans rien casser. */
export function resolveLiveWave(state: GameState, result: LiveWaveResult, now: number): void {
  const p = MILITARY.pathogens;
  // La vague EN COURS de planification est celle qu'on vient de jouer — même si elle
  // n'était pas encore échue (fenêtre d'alerte de 12h, cf. WaveWarning).
  const at = state.nextAttackAt > 0 ? state.nextAttackAt : now;
  const wave = state.waveCount + 1;
  const success = result.won;
  const lines = [
    `Combat mené en direct — ${result.kills} élimination${result.kills > 1 ? "s" : ""}, ` +
      `bastion à ${Math.round(result.bastionHpFrac * 100)} % PV.`,
  ];

  applyWaveOutcome(state, success, lines);

  const combatGain = liveWaveCombatReward(result);
  addResource(state, "combat", combatGain);
  lines.push(`+${fmt(combatGain)} monnaie de combat`);

  state.waveCount = wave;
  state.bastion.liveWaveCount += 1;
  state.bastion.liveBattleActive = false;
  state.bastion.liveBattleStartedAt = 0;
  state.nextAttackAt = at + draw(state, p.interval_h) * 3_600_000;

  pushReport(
    state,
    "pathogene",
    success ? `⚔️ Vague ${wave} repoussée en direct !` : `⚔️ Vague ${wave} — défaite en direct`,
    lines,
    now,
    success,
  );
}

function applyAutoEvent(state: GameState, ev: EventDef, at: number): void {
  const lines: string[] = [];
  if (ev.id === "courant_nutritif" && ev.production_hours) {
    const hours = draw(state, ev.production_hours);
    const perHour = totalProductionPerHour(state.buildings);
    for (const [res, rate] of Object.entries(perHour)) {
      const gain = rate * hours;
      addResource(state, res, gain);
      lines.push(`+${fmt(gain)} ${res}`);
    }
    if (lines.length === 0) lines.push("Le courant est passé sans rien déposer.");
  } else if (ev.id === "mutation_spontanee") {
    if (state.buildQueue && ev.build_time_reduction) {
      const ratio = draw(state, ev.build_time_reduction);
      const remaining = Math.max(0, state.buildQueue.endsAt - at);
      state.buildQueue = {
        ...state.buildQueue,
        endsAt: state.buildQueue.endsAt - remaining * ratio,
      };
      lines.push(`Chantier en cours accéléré de ${Math.round(ratio * 100)} %`);
    } else {
      addResource(state, "energie", ev.fallback_energie ?? 10);
      lines.push(`+${ev.fallback_energie ?? 10} energie`);
    }
  } else if (ev.id === "banc_plancton" && ev.biomasse_hours) {
    const hours = draw(state, ev.biomasse_hours);
    const rate = totalProductionPerHour(state.buildings).biomasse ?? 12;
    const gain = Math.max(30, rate * hours);
    addResource(state, "biomasse", gain);
    lines.push(`+${fmt(gain)} biomasse`);
  } else if (ev.id === "alerte_pathogene") {
    const inH = Math.max(0, (state.nextAttackAt - at) / 3_600_000);
    lines.push(
      `Prochaine vague estimée dans ${fmt(inH)} h — puissance ≈ ${fmt(estimatedWavePower(state, at))}.`,
      `Ta défense actuelle : ${fmt(defensePower(state))}.`,
    );
  }
  pushReport(state, "evenement", `${ev.icon} ${ev.name}`, lines, at);
}

function drawEvent(state: GameState): EventDef {
  const pool = MILITARY.events.pool;
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let roll = drawUnit(state) * total;
  for (const ev of pool) {
    roll -= ev.weight;
    if (roll <= 0) return ev;
  }
  return pool[0];
}

/** Résout l'option choisie d'un événement à choix (appelé par le store). */
export function resolveChoiceEvent(
  state: GameState,
  optionIndex: number,
  now: number,
): void {
  const pending = state.pendingEvent;
  if (!pending) return;
  const ev = MILITARY.events.pool.find((e) => e.id === pending.eventId);
  state.pendingEvent = null;
  if (!ev?.options) return;
  const opt = ev.options[optionIndex];
  if (!opt || opt.effect === "none") {
    pushReport(state, "evenement", `${ev.icon} ${ev.name} — ignorée`, [
      "La spore s'éloigne dans le courant.",
    ], now);
    return;
  }
  const lines: string[] = [];
  const ok = drawUnit(state) < (opt.success_chance ?? 1);
  if (ok && opt.success) {
    const perHour = totalProductionPerHour(state.buildings);
    for (const [key, range] of Object.entries(opt.success)) {
      const res = key.replace(/_hours$/, "");
      const hours = draw(state, range as [number, number]);
      const gain = Math.max(25, (perHour[res as ResourceId] ?? 10) * hours);
      addResource(state, res, gain);
      lines.push(`+${fmt(gain)} ${res}`);
    }
  } else if (!ok && opt.failure) {
    for (const [key, ratio] of Object.entries(opt.failure)) {
      const res = key.replace(/_loss_ratio$/, "") as ResourceId;
      const loss = (state.resources[res] ?? 0) * (ratio as number);
      state.resources[res] = Math.max(0, (state.resources[res] ?? 0) - loss);
      lines.push(`−${fmt(loss)} ${res} — l'absorption a mal tourné`);
    }
  }
  pushReport(state, "evenement", `${ev.icon} ${ev.name} — ${ok ? "bénéfique" : "hostile"}`, lines, now, ok);
}

/* ---------- Intégration au tick ---------- */

/** Fait vivre la couche militaire entre lastTick et `now` (mute le draft).
 *  Appelé par applyTick APRÈS la production/fin de chantier. */
export function applyMilitary(state: GameState, now: number): void {
  const p = MILITARY.pathogens;
  const e = MILITARY.events;

  // Première planification (sauvegarde neuve ou migrée).
  if (state.nextAttackAt <= 0) {
    state.nextAttackAt = now + p.first_attack_delay_h * 3_600_000;
  }
  if (state.nextEventAt <= 0) {
    state.nextEventAt = now + draw(state, e.interval_h) * 3_600_000;
  }

  // Expéditions échues (dans l'ordre de retour).
  const due = state.expeditions
    .filter((x) => x.endsAt <= now)
    .sort((a, b) => a.endsAt - b.endsAt);
  if (due.length > 0) {
    state.expeditions = state.expeditions.filter((x) => x.endsAt > now);
    for (const exp of due) resolveExpedition(state, exp);
  }

  // Vagues de pathogènes (rattrapage offline : toutes les vagues passées) — SAUF si une
  // bataille en direct est en cours pour cette même vague (cf. Bastion-Défense) : on ne
  // veut pas auto-résoudre PAR-DESSUS un combat que le joueur est en train de jouer.
  // Verrou borné dans le temps (LIVE_BATTLE_GRACE_MS) : un onglet fermé/crash en plein
  // combat ne doit jamais geler l'auto-résolution pour de bon.
  const battleLockActive =
    state.bastion.liveBattleActive && now - state.bastion.liveBattleStartedAt <= LIVE_BATTLE_GRACE_MS;
  if (battleLockActive) {
    // rien à faire : resolveLiveWave (appelée par le store à la fin du combat) s'en charge.
  } else {
    if (state.bastion.liveBattleActive) state.bastion.liveBattleActive = false; // verrou abandonné : on le libère
    while (state.nextAttackAt <= now) {
      const at = state.nextAttackAt;
      resolvePathogenWave(state, at);
      state.nextAttackAt = at + draw(state, p.interval_h) * 3_600_000;
    }
  }

  // Événements aléatoires (rattrapage plafonné — pas de spam après une longue absence).
  let fired = 0;
  while (state.nextEventAt <= now) {
    const at = state.nextEventAt;
    if (fired < e.max_offline_catchup) {
      const ev = drawEvent(state);
      if (ev.kind === "choice") {
        if (!state.pendingEvent) {
          state.pendingEvent = { eventId: ev.id, expiresAt: at + e.choice_expiry_h * 3_600_000 };
        }
      } else {
        applyAutoEvent(state, ev, at);
      }
      fired += 1;
    }
    state.nextEventAt = at + draw(state, e.interval_h) * 3_600_000;
  }

  // Expiration d'un choix ignoré : la spore s'en va d'elle-même.
  if (state.pendingEvent && state.pendingEvent.expiresAt <= now) {
    const ev = MILITARY.events.pool.find((x) => x.id === state.pendingEvent?.eventId);
    pushReport(state, "evenement", `${ev?.icon ?? "🦠"} ${ev?.name ?? "Événement"} — expirée`, [
      "Sans réponse de ta part, elle a dérivé au loin.",
    ], state.pendingEvent.expiresAt);
    state.pendingEvent = null;
  }
}
