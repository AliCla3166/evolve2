/* LES OBJECTIFS DU JOUR (26/07/2026, amélioration n°2 du retour complet).
   Module PUR sur le modèle exact de milestones.ts : tout le contenu vient de
   src/data/daily_config.json, chaque avancement est une fonction pure de l'état
   pour LA JOURNÉE COURANTE, et la récompense se réclame d'un tap.

   Ce que ça règle, mesuré : zéro des jalons ne se réarme — le jeu n'avait
   littéralement aucun objectif du jour, alors que trois rendez-vous quotidiens
   structurels existaient déjà dans le moteur (saisie des habitudes, Bilan du
   soir, sorties gratuites). On ne fabrique rien : on formule.

   Deux choses seulement se persistent : rien pour la SÉLECTION (tirage
   déterministe semé par createdAt + clé calendaire, la recette de dailyOffers)
   et la liste des objectifs déjà réclamés aujourd'hui (GameState.dailyClaimed,
   caduque dès que la clé change — un objectif raté disparaît à minuit, sans
   pénalité, c'est la règle n°3 du fichier de config). */

import rawConfig from "@/data/daily_config.json";
import { dayKey, emptyDayEntry, validatedPiliers } from "./habits";
import { rand, totalUnits } from "./military";
import { sortiesUsedToday } from "./bastion/sorties";
import type { GameState } from "./types";

/* ---------- Typage du JSON ---------- */

export interface DailyObjectiveConfig {
  id: string;
  icon: string;
  label: string;
  hint: string;
  metric: string;
  target: number;
  reward: Record<string, number>;
  /** Condition de disponibilité (règle n°1 : toujours faisable le jour même).
   *  Absente = toujours dans le tirage. */
  available?: string;
}

interface DailyConfig {
  count_per_day: number;
  pool: DailyObjectiveConfig[];
}

export const DAILY_CFG = rawConfig as unknown as DailyConfig;

/* ---------- Disponibilité (règle n°1 : jamais un objectif infaisable) ---------- */

/** Un objectif n'entre dans le tirage du jour que si son système est réellement
 *  accessible AUJOURD'HUI. Les conditions vivent ici, pas dans le JSON : ce sont
 *  des lectures d'état, pas du tuning. */
function isAvailable(cfg: DailyObjectiveConfig, state: GameState): boolean {
  switch (cfg.available) {
    case "sorties":
      // Le Bastion s'ouvre à la première vague vécue (cf. progression.ts) : avant,
      // « lance une sortie » serait un objectif verrouillé — pire que rien.
      return state.waveCount >= 1;
    case "chantier":
      // Toujours vrai en pratique ; ne s'éteint qu'en toute fin d'Âge, quand plus
      // aucun chantier n'est lançable (tout au niveau max et file vide).
      return true;
    case "expedition":
      // Il faut déjà savoir ce qu'est une expédition : en avoir envoyé une, ou
      // posséder au moins une unité. Le premier jour n'est pas le moment.
      return state.nextExpeditionId > 1 || totalUnits(state.units) > 0;
    default:
      return true;
  }
}

/* ---------- Avancement : fonctions pures de la journée courante ---------- */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Avancement d'un objectif pour la journée de `now`. Pur, jamais de compteur
 *  dédié — même doctrine que milestoneProgress. Les métriques `chantier` et
 *  `expedition` comptent les lancements du jour (file en cours) PLUS les
 *  aboutissements du jour (rapports) : la règle est généreuse, jamais punitive. */
export function dailyProgress(state: GameState, cfg: DailyObjectiveConfig, now: number): number {
  const today = dayKey(now);
  const entry = state.habits.days[today] ?? emptyDayEntry();
  switch (cfg.metric) {
    case "piliers":
      return validatedPiliers(entry, state.habits.calorieGoal);
    case "steps":
      return entry.steps;
    case "travail":
      return (entry.mf ?? 0) + (entry.alilou ?? 0);
    case "rituels":
      return entry.rituals;
    case "repas":
      return entry.repas ?? 0;
    case "bilan":
      return state.bilan.lastDay === today ? 1 : 0;
    case "sorties":
      return sortiesUsedToday(state.bastion, now);
    case "chantier":
      return (
        state.buildQueue.filter((t) => dayKey(t.startedAt) === today).length +
        state.reports.filter((r) => r.type === "chantier" && dayKey(r.ts) === today).length
      );
    case "expedition":
      return (
        state.expeditions.filter((e) => dayKey(e.startedAt) === today).length +
        state.reports.filter((r) => r.type === "expedition" && dayKey(r.ts) === today).length
      );
    default:
      return 0;
  }
}

/* ---------- Le tirage du jour ---------- */

/** Les objectifs du jour : déterministes pour (sauvegarde, jour calendaire local),
 *  jamais stockés — exactement la recette des offres d'expédition (dailyOffers).
 *  Seuls les objectifs DISPONIBLES entrent dans le mélange. */
export function dailyObjectives(state: GameState, now: number): DailyObjectiveConfig[] {
  const pool = DAILY_CFG.pool.filter((cfg) => isAvailable(cfg, state));
  let seed = hashString(`daily:${state.createdAt}:${dayKey(now)}`);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const [v, next] = rand(seed);
    seed = next;
    const j = Math.floor(v * (i + 1)) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, DAILY_CFG.count_per_day);
}

/* ---------- Vues prêtes à afficher ---------- */

export interface DailyObjectiveView {
  cfg: DailyObjectiveConfig;
  current: number;
  target: number;
  /** 0..1, borné. */
  ratio: number;
  achieved: boolean;
  claimed: boolean;
}

/** Objectifs déjà réclamés AUJOURD'HUI — une liste d'hier ne compte pas. */
export function claimedDailyIds(state: GameState, now: number): string[] {
  return state.dailyClaimed.day === dayKey(now) ? state.dailyClaimed.ids : [];
}

export function dailyViews(state: GameState, now: number): DailyObjectiveView[] {
  const claimed = new Set(claimedDailyIds(state, now));
  return dailyObjectives(state, now).map((cfg) => {
    const current = dailyProgress(state, cfg, now);
    return {
      cfg,
      current,
      target: cfg.target,
      ratio: Math.max(0, Math.min(1, current / Math.max(1, cfg.target))),
      achieved: current >= cfg.target,
      claimed: claimed.has(cfg.id),
    };
  });
}

/** Quel objectif du jour montrer dans le bandeau ? Même esprit que focusMilestone :
 *  un objectif À ENCAISSER d'abord, sinon le plus avancé, sinon le premier. */
export function focusDaily(state: GameState, now: number): DailyObjectiveView | null {
  const views = dailyViews(state, now);
  const open = views.filter((v) => !v.claimed);
  if (open.length === 0) return null;
  const ready = open.filter((v) => v.achieved);
  if (ready.length > 0) return ready[0];
  return open.reduce((a, b) => (a.ratio >= b.ratio ? a : b));
}

/** Compteur « aujourd'hui : X/3 » du bandeau. */
export function dailyClaimedCount(state: GameState, now: number): number {
  return claimedDailyIds(state, now).length;
}
