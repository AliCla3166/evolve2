/* Moteur de tick à timestamps réels (Date.now) — pur et testable.
   - Accumule la production depuis state.lastTick, plafonnée aux caps de stockage.
   - Termine les constructions échues (file multi-slots depuis la v8).
   - Le rattrapage offline est le même code : au chargement on appelle applyTick
     une seule fois avec `now` courant => un seul gros tick (la production étant
     plafonnée par le stockage, le gain offline est naturellement borné).
   - Depuis la v8 le tick est INSTRUMENTÉ (applyTickDetailed) : il rend compte de
     ce qu'il a produit, de ce qu'il a PERDU au plafond, et de ce qu'il a terminé.
     C'est la matière première du rapport de retour (« pendant ton absence… ») —
     sans ça, le joueur revenait devant un état muet et ne voyait jamais le coût
     réel d'un stockage saturé. */

import {
  buildingProductionPerHour,
  getBuildingConfig,
  resourceCap,
  resourceName,
  totalProductionPerHour,
} from "./economy";
import { computeStreak, dayKey, ENERGY_CAP, settleStreakTiers } from "./habits";
import { applyMilitary, pushReport } from "./military";
import type { BuildingId, BuildTask, GameState, Report, ResourceId } from "./types";

/* ---------- Compte rendu de tick ---------- */

export interface FinishedBuild {
  buildingId: BuildingId;
  targetLevel: number;
  /** Timestamp réel de fin (ms). */
  at: number;
}

/** Ce que le tick a fait, pour le raconter au joueur.
 *  Toujours produit (même pour un tick d'une seconde) ; c'est l'appelant qui
 *  décide s'il vaut la peine d'être affiché (cf. offline_report.min_absence_minutes). */
export interface TickSummary {
  fromMs: number;
  toMs: number;
  /** Durée réellement couverte par ce tick (ms, ≥ 0). */
  durationMs: number;
  /** Production effectivement créditée, par ressource. */
  gains: Partial<Record<ResourceId, number>>;
  /** Production perdue faute de place (stockage plein), par ressource. */
  wasted: Partial<Record<ResourceId, number>>;
  /** Chantiers terminés pendant ce tick. */
  finished: FinishedBuild[];
  /** Rapports générés pendant ce tick (expéditions, vagues, événements). */
  newReports: Report[];
}

function emptySummary(from: number, to: number): TickSummary {
  return {
    fromMs: from,
    toMs: to,
    durationMs: Math.max(0, to - from),
    gains: {},
    wasted: {},
    finished: [],
    newReports: [],
  };
}

/** Total perdu au plafond, toutes ressources confondues. */
export function totalWasted(s: TickSummary): number {
  return Object.values(s.wasted).reduce((a, b) => a + b, 0);
}

/** Total produit, toutes ressources confondues. */
export function totalGained(s: TickSummary): number {
  return Object.values(s.gains).reduce((a, b) => a + b, 0);
}

/* ---------- Production ---------- */

/** Ajoute la production entre deux timestamps (ms) aux stocks, plafonnée aux caps.
 *  Un stock déjà au-dessus de son cap n'est jamais réduit (il cesse juste de croître).
 *  `out` reçoit le détail gagné/perdu — c'est ce qui alimente le rapport de retour. */
function produce(state: GameState, fromMs: number, toMs: number, out: TickSummary): void {
  const dtHours = (toMs - fromMs) / 3_600_000;
  if (dtHours <= 0) return;
  const perHour = totalProductionPerHour(state.buildings);
  for (const [res, rate] of Object.entries(perHour)) {
    const id = res as ResourceId;
    const produced = rate * dtHours;
    if (produced <= 0) continue;
    const current = state.resources[id] ?? 0;
    const cap = resourceCap(id, state.buildings);
    const room = Math.max(0, cap - current);
    const kept = Math.min(produced, room);
    const lost = produced - kept;
    if (kept > 0) {
      state.resources[id] = current + kept;
      out.gains[id] = (out.gains[id] ?? 0) + kept;
    }
    if (lost > 0) out.wasted[id] = (out.wasted[id] ?? 0) + lost;
  }
}

/** Finalise un chantier : le bâtiment prend son niveau cible (jamais de régression).
 *  Pousse aussi un rapport au journal — c'est le filet du joueur absent : même s'il
 *  rate la modale de célébration, la trace reste (et le badge de non-lus le prévient). */
function completeTask(state: GameState, task: BuildTask, out: TickSummary): void {
  const current = state.buildings[task.buildingId] ?? 0;
  const level = Math.max(current, task.targetLevel);
  state.buildings[task.buildingId] = level;
  out.finished.push({
    buildingId: task.buildingId,
    targetLevel: task.targetLevel,
    at: task.endsAt,
  });

  // Lignes de rapport : le débit avant → après, ressource par ressource.
  const before = buildingProductionPerHour(task.buildingId, task.targetLevel - 1);
  const after = buildingProductionPerHour(task.buildingId, task.targetLevel);
  const lines: string[] = [];
  for (const [res, rate] of Object.entries(after)) {
    const prev = before[res as ResourceId] ?? 0;
    if (rate <= prev) continue;
    const fmt = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    lines.push(`${resourceName(res as ResourceId)} ${fmt(prev)}/h → ${fmt(rate)}/h`);
  }
  if (lines.length === 0) lines.push("Structure renforcée.");
  pushReport(
    state,
    "chantier",
    `🔨 ${getBuildingConfig(task.buildingId).name} → Nv ${task.targetLevel}`,
    lines,
    task.endsAt,
    true,
  );
}

/* ---------- Série d'habitudes ---------- */

/** Recale la série au passage de minuit (piste 6).
 *
 *  La série est DÉRIVÉE de l'historique (cf. computeStreak) ; `habits.streak`
 *  n'en est qu'un cache, et `habits.streakDay` dit pour quel jour il a été
 *  calculé. Sans ce recalage, un joueur qui saute deux jours revenait sur un
 *  « 🔥 12 j » périmé jusqu'à sa première saisie — le badge mentait, et le
 *  mensonge était dans le sens le plus démotivant possible (il découvrait la
 *  casse au moment où il faisait l'effort de revenir).
 *
 *  Le delta d'énergie est nul en régime normal (la série ne grandit qu'en
 *  validant une habitude, ce qui passe par updateHabitToday). Il n'est positif
 *  qu'une fois, juste après la migration v9 → v10 : les paliers hebdomadaires
 *  nouvellement créés sont alors dus à un joueur dont la série les dépasse
 *  déjà, et c'est ici qu'ils lui sont versés. */
function refreshStreak(state: GameState, now: number): void {
  const habits = state.habits;
  const key = dayKey(now);
  if (habits.streakDay === key) return;

  const streak = computeStreak(habits.days, habits.graceDays, key);
  const { awards, energyDelta } = settleStreakTiers(habits.streakAwards, streak, key);
  state.habits = {
    ...habits,
    streak,
    streakDay: key,
    bestStreak: Math.max(habits.bestStreak, streak),
    streakAwards: awards,
  };
  if (energyDelta !== 0) {
    state.resources.energie = Math.min(
      ENERGY_CAP,
      Math.max(0, state.resources.energie + energyDelta),
    );
  }
}

/* ---------- Tick ---------- */

/** Applique tout ce qui s'est passé entre state.lastTick et `now`, et rend compte.
 *  Pur : retourne un nouvel état, ne mute pas l'entrée.
 *  Chaque fin de chantier découpe la production en segments (avant/après), pour que
 *  le rattrapage offline soit exact même quand plusieurs slots se terminent en série. */
export function applyTickDetailed(
  state: GameState,
  now: number,
): { state: GameState; summary: TickSummary } {
  const next: GameState = {
    ...state,
    resources: { ...state.resources },
    buildings: { ...state.buildings },
    buildQueue: state.buildQueue.map((t) => ({ ...t })),
    units: { ...state.units },
    expeditions: [...state.expeditions],
    reports: state.reports, // pushReport remplace le tableau (jamais de mutation en place)
    pendingEvent: state.pendingEvent ? { ...state.pendingEvent } : null,
  };

  const from = next.lastTick > 0 ? next.lastTick : now;
  const summary = emptySummary(from, now);
  const reportsBefore = next.reports;

  // Série d'habitudes : recalée avant tout le reste, y compris sur le chemin
  // « horloge revenue en arrière » — le badge doit toujours dire la vérité.
  refreshStreak(next, now);

  // Horloge revenue en arrière (changement d'heure système, triche…) :
  // on se resynchronise sans produire ni annuler quoi que ce soit.
  if (now <= from) {
    next.lastTick = Math.min(from, now);
    // Les chantiers échus restent finalisables même à temps figé.
    for (const task of next.buildQueue) {
      if (task.endsAt <= now) completeTask(next, task, summary);
    }
    next.buildQueue = next.buildQueue.filter((t) => t.endsAt > now);
    return { state: next, summary };
  }

  // Chantiers échus, du plus ancien au plus récent : chacun est une frontière de
  // production (les niveaux changent, donc les débits horaires changent).
  const due = next.buildQueue.filter((t) => t.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt);
  let cursor = from;
  for (const task of due) {
    const completionAt = Math.max(cursor, task.endsAt);
    produce(next, cursor, completionAt, summary);
    completeTask(next, task, summary);
    cursor = completionAt;
  }
  next.buildQueue = next.buildQueue.filter((t) => t.endsAt > now);
  produce(next, cursor, now, summary);

  // Couche militaire : expéditions échues, vagues de pathogènes, événements.
  applyMilitary(next, now);

  // Les rapports poussés pendant ce tick (pushReport remplace le tableau, donc
  // une comparaison d'identité suffit à savoir s'il y a du nouveau).
  if (next.reports !== reportsBefore) {
    const known = new Set(reportsBefore.map((r) => r.id));
    summary.newReports = next.reports.filter((r) => !known.has(r.id));
  }

  next.lastTick = now;
  return { state: next, summary };
}

/** Version courte : le nouvel état seulement (la grande majorité des appels). */
export function applyTick(state: GameState, now: number): GameState {
  return applyTickDetailed(state, now).state;
}
