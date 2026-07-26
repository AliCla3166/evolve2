/* Habitudes réelles -> Points d'énergie.

   LE BARÈME N'EST PLUS ICI. Il vit dans src/data/habits_config.json -> bareme,
   sous la même règle que tout le reste de l'équilibrage : un nombre qui pèse sur
   les 90 jours d'ascension vit en JSON, avec la mesure qui le justifie. Ce
   fichier n'en garde que la LECTURE et les règles de saisie (bornes de champ,
   fenêtre rétroactive, série). L'argument d'origine — « ce sont des règles de
   gameplay, pas du tuning » — ne tenait pas : l'énergie se reconvertit en heures
   de chantier via economy_config.json -> energy_boost.

   JOURNÉE PARFAITE = LES 4 PILIERS, PAS LES 5 HABITUDES (26/07/2026).
   Nutrition · Mouvement · Travail · Soin de soi. Le pilier « Travail » accepte
   indifféremment une heure de Magic Focus OU une heure de chantier ALILOU —
   l'une suffit. Avant, la journée parfaite exigeait les deux, donc elle était
   impossible le samedi et le dimanche, Magic Focus étant un outil de bureau.
   Le barème, lui, ne change pas : faire les deux postes rapporte toujours plus
   (196 ⚡ contre 136). Le pilier ne décide que de ce qui compte comme une
   journée complète, pas de ce qu'elle rapporte.

   LES DEUX POSTES DE TRAVAIL SE COMPTENT EN HEURES (26/07/2026 au soir). Une
   « tâche » n'a pas de taille : poser une étagère et refaire une pièce comptaient
   pareil, et le plafond de 3 tâches punissait la seule journée qui mérite d'être
   récompensée — le samedi entier passé sur le chantier. Une heure a toujours la
   même taille. Le taux dit la pénibilité, pas le prestige : 7 ⚡ l'heure de
   chantier contre 5 ⚡ l'heure d'écran.

   Saisie : une entrée par jour calendaire (clé YYYY-MM-DD en timezone locale),
   éditable pendant une FENÊTRE GLISSANTE de SAISIE_WINDOW_DAYS jours, aujourd'hui
   compris — parce qu'une journée réellement tenue mais notée après minuit ne doit
   pas être perdue. Le futur reste fermé et le passé se referme au bord de la
   fenêtre : le garde-fou vit dans le store, pas seulement dans l'UI.
   Une journée renseignée APRÈS son jour porte le marqueur `late` : elle paie son
   énergie en entier, mais ne tient pas la série (cf. habits_config.json → saisie). */

import rawHabitsConfig from "@/data/habits_config.json";
import type { HabitDayEntry, HabitId, HabitsState } from "./types";

/* ---------- Définition des 5 habitudes (lue du JSON) ---------- */

/** Identifiant d'un pilier de la journée parfaite. Deux habitudes peuvent
 *  partager le même — c'est tout le mécanisme : `mf` et `alilou` portent
 *  toutes deux « travail », donc l'une OU l'autre valide le pilier. */
export type PilierId = string;

export interface HabitDef {
  id: HabitId;
  icon: string;
  name: string;
  desc: string;
  pilier: PilierId;
  type: "calorie" | "rate" | "count";
  /** calorie : énergie du jour si validée. */
  energyPerDay?: number;
  /** rate : taille de tranche, énergie par tranche, plafond d'énergie. */
  per?: number;
  energyPer?: number;
  capEnergy?: number;
  step?: number;
  max?: number;
  /** count : nb max d'items par jour. */
  capItems?: number;
  unit?: string;
  /** Unité affichée à côté du compteur (« h », « rituels »). Vide = rien à dire.
   *  Sans elle, « 6 / 12 » ne dit pas si on compte des heures ou des tâches —
   *  or c'est exactement ce qui a changé le 26/07. */
  unitShort?: string;
}

export interface PilierDef {
  id: PilierId;
  name: string;
  icon: string;
}

/** Remplit les accolades d'un libellé avec les PROPRES champs de l'objet décrit.
 *  Régler `energy_per` à 12 dans le JSON réécrit la phrase tout seul : aucun
 *  composant n'a à recomposer « +12 ⚡ par tâche » de son côté, et le texte ne
 *  peut donc pas mentir sur le barème. Une accolade sans champ correspondant est
 *  laissée telle quelle — bruyante à l'écran, donc repérée à la première
 *  ouverture du panneau plutôt que silencieusement effacée. */
function fillTemplate(tpl: string, fields: Record<string, unknown>): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = fields[key];
    return v === undefined ? whole : String(v);
  });
}

/* ---------- Série : paliers hebdomadaires, grâce, historique ----------
   Tout le tuning vit dans src/data/habits_config.json — c'est la MÊME table que
   lit le simulateur d'équilibrage (tools/economy/simulate_full.py), donc le TS
   et le Python ne peuvent pas diverger. */

interface StreakTier {
  days: number;
  energy: number;
}

/** Une option achetable avec une Percée au Bilan du soir. Les champs optionnels
 *  ne concernent que certaines options (cf. habits_config.json -> bilan.options). */
export interface BilanOptionDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  cost: number;
  /** « Vague de Percée » : paliers ajoutés à la vague jouée. */
  palier_bonus?: number;
  /** « Vague de Percée » : cran de Péril imposé. */
  forced_peril?: number;
  /** « Vague de Percée » : multiplicateur de butin supplémentaire. */
  loot_mult?: number;
  /** « Vague de Percée » : fragments de carte garantis. */
  fragments?: number;
  /** « Poussée de croissance » : heures de production offertes d'un coup. */
  production_hours?: number;
}

/** Une habitude telle qu'elle est écrite dans le JSON : snake_case, et les
 *  libellés portent encore leurs accolades. `habitDefs()` en fait des `HabitDef`. */
interface RawHabit {
  id: HabitId;
  icon: string;
  name: string;
  desc: string;
  pilier: PilierId;
  type: "calorie" | "rate" | "count";
  energy_per_day?: number;
  per?: number;
  energy_per?: number;
  cap_energy?: number;
  step?: number;
  max?: number;
  cap_items?: number;
  unit?: string;
  unit_short?: string;
}

interface HabitsConfig {
  saisie: { window_days: number };
  bareme: { habitudes: RawHabit[]; piliers: PilierDef[] };
  streak: {
    tiers: StreakTier[];
    grace: { per_month: number; max_age_days: number };
    history_days: number;
  };
  bilan: {
    min_hour: number;
    catchup_until_hour: number;
    threshold_energy: number;
    max_stock: number;
    bonus_sorties_next_day: number;
    percee_per_streak_tier: number;
    options: BilanOptionDef[];
  };
}

export const HABITS_CFG = rawHabitsConfig as unknown as HabitsConfig;

/** Les 5 habitudes, dérivées du JSON. Le libellé est composé ici une fois pour
 *  toutes à partir des chiffres du barème : changer `energy_per` suffit à
 *  corriger la phrase affichée dans le panneau. */
export const HABITS: HabitDef[] = HABITS_CFG.bareme.habitudes.map((h) => ({
  id: h.id,
  icon: h.icon,
  name: h.name,
  desc: fillTemplate(h.desc, h as unknown as Record<string, unknown>),
  pilier: h.pilier,
  type: h.type,
  energyPerDay: h.energy_per_day,
  per: h.per,
  energyPer: h.energy_per,
  capEnergy: h.cap_energy,
  step: h.step,
  max: h.max,
  capItems: h.cap_items,
  unit: h.unit,
  unitShort: h.unit_short,
}));

/** Les piliers de la journée parfaite, dans l'ordre d'affichage. */
export const PILIERS: ReadonlyArray<PilierDef> = HABITS_CFG.bareme.piliers;

/** Énergie maximale théorique d'une journée : toutes les habitudes à fond.
 *  Dérivée du barème, jamais codée en dur — l'ancienne constante `95` figée
 *  dans HabitsPanel était FAUSSE (le maximum réel était 90), si bien que le
 *  compteur « journées parfaites » de la grille affichait toujours zéro et que
 *  la case dorée ne pouvait pas s'allumer. */
export const MAX_DAY_ENERGY = HABITS.reduce((sum, def) => {
  if (def.type === "calorie") return sum + (def.energyPerDay ?? 0);
  if (def.type === "rate") return sum + (def.capEnergy ?? 0);
  return sum + (def.capItems ?? 0) * (def.energyPer ?? 0);
}, 0);

/** Énergie d'une journée parfaite MINIMALE : les 4 piliers validés, en ne
 *  gardant à chaque fois que l'habitude la MOINS chère du pilier, à fond.
 *  C'est le week-end d'Ali : parfait sans une seule tâche Magic Focus. Sert de
 *  repère d'affichage — le seuil doré, lui, se lit sur les piliers, pas ici. */
export const PERFECT_DAY_ENERGY = PILIERS.reduce((sum, p) => {
  const defs = HABITS.filter((h) => h.pilier === p.id);
  const maxima = defs.map((def) =>
    def.type === "calorie"
      ? (def.energyPerDay ?? 0)
      : def.type === "rate"
        ? (def.capEnergy ?? 0)
        : (def.capItems ?? 0) * (def.energyPer ?? 0),
  );
  return sum + (maxima.length ? Math.min(...maxima) : 0);
}, 0);

/** Cap élevé de la ressource énergie : plusieurs mois de journées pleines.
 *  L'énergie n'est pas soumise au stockage cellulaire du JSON (kind externe_habitude). */
export const ENERGY_CAP = 9999;

/** Paliers de série (jours consécutifs avec ≥1 habitude validée) → bonus d'énergie.
 *  Un palier par semaine : la régularité doit accuser réception chaque semaine,
 *  pas trois fois en trois mois. */
export const STREAK_TIERS: ReadonlyArray<StreakTier> = HABITS_CFG.streak.tiers;

/** Un jour de grâce par mois calendaire, sur un oubli de moins de N jours. */
export const STREAK_GRACE = HABITS_CFG.streak.grace;

/** Fenêtre de saisie rétroactive : nombre de jours calendaires éditables,
 *  AUJOURD'HUI COMPRIS (7 = aujourd'hui + les 6 précédents). Le plancher à 1
 *  garantit qu'un réglage aberrant retombe sur l'ancien comportement — la
 *  journée en cours — au lieu de fermer toute saisie. */
export const SAISIE_WINDOW_DAYS = Math.max(1, Math.floor(HABITS_CFG.saisie.window_days));

/** Nombre de cases de la grille d'historique (= durée de l'Âge 1). */
export const HISTORY_DAYS = HABITS_CFG.streak.history_days;

/** Réglages du Bilan du soir (le rendez-vous quotidien qui délivre les Percées). */
export const BILAN = HABITS_CFG.bilan;

/** Les trois emplois possibles d'une Percée. */
export const BILAN_OPTIONS: ReadonlyArray<BilanOptionDef> = HABITS_CFG.bilan.options;

export function bilanOptionDef(id: string): BilanOptionDef | undefined {
  return BILAN_OPTIONS.find((o) => o.id === id);
}

/** Description d'une option, accolades remplies par ses PROPRES champs.
 *  Le texte vit en config et les nombres aussi : régler `loot_mult` à 4 réécrit la phrase
 *  tout seul, sans qu'aucun composant n'ait à recomposer la formulation de son côté.
 *  Une accolade sans champ correspondant est laissée telle quelle — bruyante à l'écran,
 *  donc repérée à la première ouverture du panneau plutôt que silencieusement effacée. */
export function bilanOptionDesc(opt: BilanOptionDef): string {
  return fillTemplate(opt.desc, opt as unknown as Record<string, unknown>);
}

/** Énergie totale que vaut une série parfaite de 90 jours (affiché dans l'UI). */
export const TOTAL_STREAK_ENERGY = STREAK_TIERS.reduce((sum, t) => sum + t.energy, 0);

/** Prochain palier à viser (null quand tout est atteint). */
export function nextStreakTier(streak: number): StreakTier | null {
  return STREAK_TIERS.find((t) => t.days > streak) ?? null;
}

/** Palier le plus haut déjà franchi (null avant le premier). */
export function currentStreakTier(streak: number): StreakTier | null {
  let best: StreakTier | null = null;
  for (const t of STREAK_TIERS) if (streak >= t.days) best = t;
  return best;
}

/** Bornes de saisie (mêmes ordres de grandeur que le prototype v1). */
export const CALORIE_INPUT_MAX = 6000;
export const CALORIE_GOAL_MIN = 800;
export const CALORIE_GOAL_MAX = 6000;

/** Bilan calorique (retouche lisibilité) : une seule valeur signée en kcal,
 *  saisie au clavier ou par crans — négatif = déficit, positif = surplus. */
export const CALORIE_DELTA_MIN = -3000;
export const CALORIE_DELTA_MAX = 3000;
export const CALORIE_STEP = 100;

/* ---------- Clés de jour calendaire (timezone locale) ---------- */

/** Clé YYYY-MM-DD du jour local pour un timestamp donné. */
export function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Décale une clé YYYY-MM-DD de n jours (calendrier local). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** Mois calendaire d'une clé de jour (« 2026-07-24 » → « 2026-07 »). */
export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** Indice du jour de la semaine, lundi = 0 (pour aligner la grille d'historique). */
export function weekdayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/* ---------- Fenêtre de saisie ----------
   Les clés YYYY-MM-DD à largeur fixe se comparent comme des chaînes : l'ordre
   lexicographique EST l'ordre chronologique. On n'y construit donc aucune Date,
   et surtout on n'y appelle jamais Date.now() — l'appelant fournit le jour
   courant (state.lastTick côté rendu, Date.now() côté store). */

/** La journée `key` est-elle éditable au jour `todayKey` ? Bornes incluses :
 *  le futur est fermé, le passé l'est au-delà de la fenêtre. */
export function canEditDay(key: string, todayKey: string): boolean {
  if (key > todayKey) return false;
  return key >= addDaysToKey(todayKey, -(SAISIE_WINDOW_DAYS - 1));
}

/** Les jours éditables, du plus ancien à aujourd'hui — l'ordre de la bande de
 *  sélection, qui se lit de gauche à droite comme un calendrier. */
export function editableDayKeys(todayKey: string): string[] {
  const keys: string[] = [];
  for (let i = SAISIE_WINDOW_DAYS - 1; i >= 0; i--) keys.push(addDaysToKey(todayKey, -i));
  return keys;
}

/* ---------- Série : moteur pur, DÉRIVÉ de l'historique ----------
   Avant la piste 6, la série était tenue en comptabilité incrémentale
   (« si hier était le dernier jour compté, alors +1 »). Ça marchait, mais ça
   rendait impossible tout ce que le diagnostic demandait : un jour de grâce
   rétroactif et une grille de 90 cases exigent de pouvoir RELIRE le passé, pas
   seulement un compteur. On recalcule donc la série à partir des jours saisis —
   la seule source de vérité — et le compteur stocké n'est plus qu'un cache. */

/** Ce jour-là compte-t-il dans la série ?
 *
 *  Trois cas, et l'ordre compte. Un jour RÉPARÉ par la grâce tient toujours :
 *  c'est la seule chose que la grâce sache faire, et elle doit pouvoir raccrocher
 *  n'importe quel trou — y compris une journée notée après coup. Un jour saisi à
 *  l'heure tient dès la première habitude validée. Une journée NOTÉE APRÈS COUP
 *  (`late`) ne tient pas : elle a payé son énergie, mais la série mesure le
 *  rendez-vous quotidien, pas le travail (cf. habits_config.json → saisie). */
export function dayHoldsStreak(
  days: Record<string, HabitDayEntry>,
  graceDays: ReadonlySet<string>,
  key: string,
): boolean {
  if (graceDays.has(key)) return true;
  const d = days[key];
  return !!d && d.validatedCount > 0 && !d.late;
}

/** Garde-fou : on ne remonte jamais plus loin que 10 ans d'historique. */
const MAX_STREAK_SCAN = 3660;

/** Longueur de la série au jour `todayKey`, remontée depuis l'historique.
 *
 *  Subtilité qui compte : si la journée en cours n'est pas encore validée, on
 *  part de la VEILLE. Une série ne se casse pas à 00 h 01 — le joueur a jusqu'à
 *  minuit pour saisir, donc tant que la journée court, elle ne peut pas
 *  compter comme un échec. */
export function computeStreak(
  days: Record<string, HabitDayEntry>,
  graceDays: readonly string[],
  todayKey: string,
): number {
  const grace = new Set(graceDays);
  let cursor = dayHoldsStreak(days, grace, todayKey) ? todayKey : addDaysToKey(todayKey, -1);
  let n = 0;
  while (n < MAX_STREAK_SCAN && dayHoldsStreak(days, grace, cursor)) {
    n += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  return n;
}

/** Le jour de grâce est-il encore disponible ce mois-ci ? */
export function graceAvailable(habits: HabitsState, todayKey: string): boolean {
  if (STREAK_GRACE.per_month <= 0) return false;
  return habits.graceUsedMonth !== monthKey(todayKey);
}

/** Quel jour un jour de grâce pourrait-il réparer ? `null` si rien à réparer.
 *
 *  Trois conditions, toutes nécessaires : l'oubli remonte à moins de
 *  `max_age_days` jours, il ne concerne qu'UNE journée isolée, et la veille de
 *  cette journée tenait la série. Autrement dit la grâce ne sert qu'à recoller
 *  une chaîne réelle — elle ne fabrique pas une série à partir de rien, et on
 *  ne laisse pas le joueur gâcher sa seule réparation du mois sur un trou
 *  qu'elle ne bouchera pas.
 *
 *  Depuis la fenêtre de saisie, un « trou » peut aussi être une journée NOTÉE
 *  APRÈS COUP : elle a payé son énergie sans tenir la chaîne, et la grâce est
 *  précisément l'outil prévu pour la raccrocher — une fois par mois, comme
 *  n'importe quel autre oubli. */
export function repairableDay(habits: HabitsState, todayKey: string): string | null {
  if (!graceAvailable(habits, todayKey)) return null;
  const grace = new Set(habits.graceDays);
  for (let age = 1; age <= STREAK_GRACE.max_age_days; age++) {
    const key = addDaysToKey(todayKey, -age);
    if (dayHoldsStreak(habits.days, grace, key)) continue; // ce jour-là tient déjà
    // Premier trou trouvé : réparable seulement s'il est isolé.
    const before = addDaysToKey(key, -1);
    return dayHoldsStreak(habits.days, grace, before) ? key : null;
  }
  return null;
}

/** Solde les paliers de série : verse ceux qui viennent d'être franchis, rouvre
 *  ceux qui sont retombés. Renvoie la nouvelle table et le delta d'énergie.
 *
 *  Un palier redevient gagnable après une rupture — c'est volontaire : le
 *  re-farm coûte alors sept jours pleins, et comme la table MONTE, casser sa
 *  série pour re-encaisser le palier 1 est toujours perdant. On ne reprend
 *  l'énergie que si le palier a été payé le jour même (le joueur annule une
 *  saisie du jour) : reprendre un bonus versé il y a trois semaines serait du
 *  vol pur et simple. */
export function settleStreakTiers(
  awards: Record<string, string>,
  streak: number,
  todayKey: string,
): { awards: Record<string, string>; energyDelta: number } {
  const next = { ...awards };
  let energyDelta = 0;
  for (const t of STREAK_TIERS) {
    const k = String(t.days);
    if (streak >= t.days) {
      if (!next[k]) {
        next[k] = todayKey;
        energyDelta += t.energy;
      }
    } else if (next[k]) {
      if (next[k] === todayKey) energyDelta -= t.energy;
      delete next[k];
    }
  }
  return { awards: next, energyDelta };
}

/* ---------- Calculs d'énergie ---------- */

export function emptyDayEntry(): HabitDayEntry {
  return {
    calories: 0,
    caloriesDone: false,
    steps: 0,
    mf: 0,
    alilou: 0,
    rituals: 0,
    repas: 0,
    energy: 0,
    validatedCount: 0,
  };
}

/** Énergie rapportée par une habitude pour une saisie donnée (barème v1,
 *  bilan calorique retouché : cf. commentaire d'en-tête). Le paramètre
 *  `calorieGoal` n'est plus utilisé par le type "calorie" (conservé dans la
 *  signature pour ne pas casser les appelants existants). */
export function habitEnergy(
  def: HabitDef,
  entry: HabitDayEntry,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- conservé pour compat d'appel
  calorieGoal: number,
): number {
  switch (def.type) {
    case "calorie": {
      // caloriesDone sert désormais de flag "saisi aujourd'hui" (posé
      // automatiquement dès que la valeur est modifiée — plus de bouton
      // "Valider" séparé) : une journée jamais touchée ne rapporte rien.
      if (!entry.caloriesDone) return 0;
      // NON-ATTRIBUTION, plus jamais de soustraction (26/07/2026, amélioration
      // n°10) : un surplus ne rapporte pas le bonus, il ne reprend RIEN. L'ancien
      // barème retirait jusqu'à −30 ⚡ sur le capital déjà accumulé — le seul
      // mécanisme du jeu qui détruisait une ressource gagnée, et il frappait le
      // geste le plus intime que le jeu demande (cf. habits_config.json).
      return entry.calories <= 0 ? (def.energyPerDay ?? 5) : 0;
    }
    case "rate": {
      const raw = Math.floor(entry.steps / (def.per ?? 1)) * (def.energyPer ?? 0);
      return Math.min(raw, def.capEnergy ?? Infinity);
    }
    case "count": {
      const count = Math.min(
        entry[def.id as "mf" | "alilou" | "rituals" | "repas"] ?? 0,
        def.capItems ?? Infinity,
      );
      return count * (def.energyPer ?? 0);
    }
  }
}

/** Une habitude est "validée" si elle rapporte au moins un point (ou est cochée). */
export function habitValidated(
  def: HabitDef,
  entry: HabitDayEntry,
  calorieGoal: number,
): boolean {
  if (def.type === "calorie") return habitEnergy(def, entry, calorieGoal) > 0;
  return (entry[def.id as "steps" | "mf" | "alilou" | "rituals" | "repas"] ?? 0) > 0;
}

/* ---------- Les 4 piliers de la journée parfaite ----------
   Un pilier est validé dès qu'UNE de ses habitudes l'est. « Travail » en porte
   deux (Magic Focus et Chantier ALILOU) : c'est tout le mécanisme, et c'est ce
   qui rend une journée de week-end parfaite sans outil de bureau. */

/** Les habitudes rattachées à un pilier, dans l'ordre du barème. */
export function pilierHabits(pilier: PilierId): HabitDef[] {
  return HABITS.filter((h) => h.pilier === pilier);
}

/** Ce pilier est-il validé pour cette saisie ? Une habitude suffit. */
export function pilierValidated(
  pilier: PilierId,
  entry: HabitDayEntry,
  calorieGoal: number,
): boolean {
  return pilierHabits(pilier).some((def) => habitValidated(def, entry, calorieGoal));
}

/** Nombre de piliers validés (0 à PILIERS.length). */
export function validatedPiliers(entry: HabitDayEntry, calorieGoal: number): number {
  return PILIERS.filter((p) => pilierValidated(p.id, entry, calorieGoal)).length;
}

/** LA journée parfaite : les quatre piliers, quelles que soient les habitudes
 *  qui les portent. Se recalcule intégralement depuis les valeurs brutes de la
 *  saisie, donc l'historique déjà enregistré répond juste sans migration. */
export function isPerfectDay(entry: HabitDayEntry, calorieGoal: number): boolean {
  return validatedPiliers(entry, calorieGoal) === PILIERS.length;
}

/** Énergie totale + nb d'habitudes validées d'une saisie. */
export function evaluateEntry(
  entry: HabitDayEntry,
  calorieGoal: number,
): { energy: number; validatedCount: number } {
  let energy = 0;
  let validatedCount = 0;
  for (const def of HABITS) {
    energy += habitEnergy(def, entry, calorieGoal);
    if (habitValidated(def, entry, calorieGoal)) validatedCount += 1;
  }
  return { energy, validatedCount };
}

/** Clamp une valeur d'habitude dans ses bornes de saisie. */
export function clampHabitValue(id: HabitId, value: number): number {
  const def = HABITS.find((h) => h.id === id)!;
  // Bilan calorique : seul type qui accepte une valeur négative (déficit).
  if (def.type === "calorie") {
    return Math.min(CALORIE_DELTA_MAX, Math.max(CALORIE_DELTA_MIN, Math.round(value)));
  }
  const v = Math.max(0, Math.round(value));
  if (def.type === "rate") return Math.min(v, def.max ?? v);
  return Math.min(v, def.capItems ?? v);
}
