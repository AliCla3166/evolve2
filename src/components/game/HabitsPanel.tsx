/* Panneau "Habitudes" — saisie quotidienne -> Points d'énergie.
   Une saisie par jour calendaire, éditable pendant la fenêtre glissante de
   SAISIE_WINDOW_DAYS jours (la bande de sélection en tête du bloc de saisie) :
   une journée réellement tenue mais notée après minuit ne doit pas être perdue.
   Une journée renseignée après son jour paie son énergie en entier mais ne tient
   pas la série — le panneau le dit AVANT la saisie, pas après, parce que la
   conséquence (un 🔥 30 qui reste à 30 au lieu de 31) serait sinon une très
   mauvaise surprise. Overlay plein écran ouvert depuis un bouton dédié de la nav
   basse (retour lisibilité : ça vivait avant en plein milieu de la page
   principale, ça prenait toute la place).

   Piste 6 du diagnostic UX : c'était le plus austère des six panneaux alors
   que c'est le cœur du concept. Il porte maintenant trois choses de plus —
   l'échelle des paliers hebdomadaires, la grille des 90 jours (la preuve
   tangible de la constance, qui EST le vrai produit du jeu), et le filet de
   sécurité (« jour de grâce ») — plus une célébration de la journée parfaite. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { playCue } from "@/lib/audio";
import { bilanStatus } from "@/lib/game/bilan";
import { fmtInt } from "@/lib/game/format";
import {
  addDaysToKey,
  BILAN,
  BILAN_OPTIONS,
  bilanOptionDesc,
  CALORIE_DELTA_MAX,
  CALORIE_DELTA_MIN,
  CALORIE_STEP,
  canEditDay,
  currentStreakTier,
  dayKey,
  editableDayKeys,
  emptyDayEntry,
  graceAvailable,
  habitEnergy,
  habitValidated,
  HABITS,
  HISTORY_DAYS,
  isPerfectDay,
  MAX_DAY_ENERGY,
  nextStreakTier,
  PILIERS,
  pilierHabits,
  pilierValidated,
  repairableDay,
  SAISIE_WINDOW_DAYS,
  STREAK_GRACE,
  STREAK_TIERS,
  TOTAL_STREAK_ENERGY,
  validatedPiliers,
  weekdayIndex,
  type BilanOptionDef,
  type HabitDef,
} from "@/lib/game/habits";
import { useGame } from "@/lib/game/store";
import type { HabitDayEntry, HabitsState } from "@/lib/game/types";
import { vibrate } from "@/lib/prefs";

/** Paliers de teinte de la grille, en FRACTION du maximum quotidien. Le dégradé
 *  suit donc le barème : le relever ne laisse pas la grille bloquée sur des
 *  seuils d'une autre échelle. (C'est exactement ce qui s'était produit avec
 *  l'ancienne constante `PERFECT_DAY_ENERGY = 95`, restée figée au-dessus du
 *  maximum réel de 90 : la case dorée ne pouvait plus jamais s'allumer.) */
const TINT_STEPS = [0.18, 0.36, 0.66];

function MiniBtn({
  children,
  onClick,
  disabled = false,
  wide = false,
  active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${wide ? "px-3" : "w-8"} h-8 rounded-md border text-xs transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "border-cell-lime/70 bg-cell-lime/15 text-cell-lime"
          : "border-cell-cyan/40 bg-membrane text-cell-cyan"
      }`}
    >
      {children}
    </button>
  );
}

function HabitRow({
  def,
  entry,
  calorieGoal,
  day,
}: {
  def: HabitDef;
  entry: HabitDayEntry;
  calorieGoal: number;
  /** Journée éditée (clé YYYY-MM-DD) — aujourd'hui, ou un jour de la fenêtre. */
  day: string;
}) {
  const updateHabitDay = useGame((s) => s.updateHabitDay);
  const patch = (p: Parameters<typeof updateHabitDay>[1]) => updateHabitDay(day, p);
  const energy = habitEnergy(def, entry, calorieGoal);
  const valid = habitValidated(def, entry, calorieGoal);

  let controls: React.ReactNode = null;
  if (def.type === "calorie") {
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        <MiniBtn
          onClick={() =>
            patch({ calories: Math.max(CALORIE_DELTA_MIN, entry.calories - CALORIE_STEP) })
          }
        >
          −
        </MiniBtn>
        <input
          type="number"
          step={CALORIE_STEP}
          min={CALORIE_DELTA_MIN}
          max={CALORIE_DELTA_MAX}
          value={entry.caloriesDone ? entry.calories : ""}
          placeholder="0"
          onChange={(e) => patch({ calories: Number(e.target.value) || 0 })}
          className="w-24 rounded-md border border-cell-cyan/40 bg-abyss px-2 py-1 text-center text-xs text-white outline-none focus:border-cell-cyan"
        />
        <MiniBtn
          onClick={() =>
            patch({ calories: Math.min(CALORIE_DELTA_MAX, entry.calories + CALORIE_STEP) })
          }
        >
          +
        </MiniBtn>
        <span className="text-[10px] text-cell-teal/60">
          kcal {entry.caloriesDone && entry.calories > 0 ? "(surplus)" : entry.caloriesDone ? "(déficit)" : ""}
        </span>
      </div>
    );
  } else if (def.type === "rate") {
    controls = (
      <div className="flex items-center gap-2">
        <MiniBtn onClick={() => patch({ steps: entry.steps - (def.step ?? 500) })}>
          −
        </MiniBtn>
        <span className="min-w-20 text-center text-xs text-white">
          {fmtInt(entry.steps)} {def.unit}
        </span>
        <MiniBtn onClick={() => patch({ steps: entry.steps + (def.step ?? 500) })}>
          +
        </MiniBtn>
      </div>
    );
  } else {
    const id = def.id as "mf" | "alilou" | "rituals" | "repas";
    controls = (
      <div className="flex items-center gap-2">
        <MiniBtn onClick={() => patch({ [id]: entry[id] - 1 })}>−</MiniBtn>
        {/* L'unité est affichée, pas sous-entendue : « 6 / 12 » ne dit pas si on
            compte des heures ou des tâches, et c'est exactement ce qui a changé
            sur les deux postes de travail le 26/07. */}
        <span className="min-w-14 text-center text-xs text-white">
          {entry[id]} / {def.capItems}
          {def.unitShort ? <span className="text-cell-teal/60"> {def.unitShort}</span> : null}
        </span>
        <MiniBtn
          disabled={entry[id] >= (def.capItems ?? Infinity)}
          onClick={() => patch({ [id]: entry[id] + 1 })}
        >
          +
        </MiniBtn>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border p-2 transition ${
        valid ? "border-cell-lime/50 bg-cell-lime/5" : "border-cell-cyan/15 bg-abyss/40"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm">{def.icon}</span>
        <span className="flex-1 text-xs tracking-wide text-cell-cyan">{def.name}</span>
        {valid && (
          <img
            src="/assets/ui/age01_cell_ui_check_habit_v001.png"
            alt="validée"
            width={18}
            height={18}
            className="pixelated"
            draggable={false}
          />
        )}
        <span className={`text-xs ${energy > 0 ? "text-cell-lime" : energy < 0 ? "text-red-400" : "text-cell-teal/50"}`}>
          {energy > 0 ? "+" : ""}
          {energy} ⚡
        </span>
      </div>
      <p className="mb-2 text-[10px] leading-4 text-cell-teal/60">{def.desc}</p>
      {controls}
    </div>
  );
}

/* ---------- La rangée des piliers ----------
   La règle de la journée parfaite a changé : ce ne sont plus les cinq habitudes,
   ce sont les quatre PILIERS. Cette rangée est le seul endroit où le joueur
   l'apprend — et surtout où il apprend que le pilier Travail se contente de
   Magic Focus OU du chantier. Sans elle, un samedi validé aurait l'air d'un bug.
   Le sous-titre liste donc les habitudes du pilier, séparées par « ou », et non
   par « et » : c'est la phrase entière du changement, en trois mots. */

function PiliersRow({ entry, calorieGoal }: { entry: HabitDayEntry; calorieGoal: number }) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1">
      {PILIERS.map((p) => {
        const ok = pilierValidated(p.id, entry, calorieGoal);
        const defs = pilierHabits(p.id);
        return (
          <div
            key={p.id}
            title={`${p.name} — ${defs.map((d) => d.name).join(" ou ")}`}
            className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center transition ${
              ok
                ? "border-cell-lime/50 bg-cell-lime/10"
                : "border-cell-cyan/15 bg-abyss/40"
            }`}
          >
            <span className={`text-sm ${ok ? "" : "opacity-40"}`}>{p.icon}</span>
            <span
              className={`text-[9px] leading-3 ${ok ? "text-cell-lime" : "text-cell-teal/50"}`}
            >
              {p.name}
            </span>
            {defs.length > 1 && (
              <span className="text-[8px] leading-3 text-cell-teal/45">
                {defs.map((d) => d.icon).join(" ou ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- La bande des jours saisissables ----------
   Le jeu ne demandait la journée qu'AU JOUR LE JOUR : passé minuit, une journée
   réellement tenue mais pas notée était perdue pour toujours — la règle la plus
   punitive du jeu, et elle punissait exactement le mauvais joueur. La bande ouvre
   la semaine écoulée, et chaque case dit son état d'un coup d'œil : tenue,
   rattrapée par la grâce, notée après coup, ou vide. Les mêmes trois couleurs que
   la grille des 90 jours — un joueur n'a qu'un seul code à apprendre. */

/** Lundi = 0, comme weekdayIndex(). */
const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

function DayStrip({
  habits,
  todayKey,
  selected,
  onSelect,
}: {
  habits: HabitsState;
  todayKey: string;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const grace = new Set(habits.graceDays);
  return (
    <div className="flex gap-1">
      {editableDayKeys(todayKey).map((k) => {
        const day = habits.days[k];
        const validated = (day?.validatedCount ?? 0) > 0;
        const isLate = Boolean(day?.late);
        const isGrace = grace.has(k);
        const isToday = k === todayKey;
        const isSel = k === selected;
        const tone = isGrace
          ? "border-cell-magenta/50 bg-cell-magenta/10 text-cell-magenta"
          : validated && isLate
            ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
            : validated
              ? "border-cell-lime/50 bg-cell-lime/10 text-cell-lime"
              : "border-cell-cyan/15 bg-abyss/40 text-cell-teal/55";
        const state = isGrace
          ? "rattrapée par la grâce"
          : validated && isLate
            ? "notée après coup"
            : validated
              ? `${day ? validatedPiliers(day, habits.calorieGoal) : 0}/${PILIERS.length} piliers · ${day?.energy} ⚡`
              : "rien de saisi";
        return (
          <button
            key={k}
            onClick={() => onSelect(k)}
            aria-pressed={isSel}
            title={`${k} — ${state}`}
            className={`flex flex-1 flex-col items-center justify-center rounded-md border py-1 transition active:translate-y-px ${tone} ${
              isSel ? "ring-1 ring-cell-cyan" : "opacity-80"
            }`}
          >
            <span className="text-[9px] leading-none opacity-70">
              {isToday ? "AUJ" : WEEKDAY_LETTERS[weekdayIndex(k)]}
            </span>
            <span className="mt-0.5 text-xs leading-none">{Number(k.slice(8))}</span>
            <span className="mt-0.5 text-[8px] leading-none">
              {isGrace ? "🩹" : validated && isLate ? "◷" : validated ? "✓" : "·"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Grille d'historique (façon calendrier de contributions) ---------- */

/** Teinte d'une case selon l'énergie du jour : quatre paliers + la case « parfaite ».
 *  Le dégradé rend la constance lisible d'un coup d'œil — un mois de vert clair
 *  raconte autre chose qu'un mois de trous, et c'est exactement la preuve que le
 *  joueur vient chercher.
 *
 *  Trois teintes hors dégradé, et elles ne doivent pas se confondre : magenta =
 *  jour RATTRAPÉ par la grâce (il tient la chaîne), ambre = jour NOTÉ APRÈS COUP
 *  (il a payé, il ne tient pas), vide = rien de saisi. Le vert reste réservé à ce
 *  qui a été fait ET noté le jour même — c'est la seule chose que la grille
 *  prétend prouver. */
function cellStyle(
  energy: number,
  validated: number,
  grace: boolean,
  late = false,
  perfect = false,
): React.CSSProperties {
  if (grace) {
    return { background: "rgba(255, 84, 214, 0.45)", boxShadow: "inset 0 0 0 1px rgba(255,84,214,0.8)" };
  }
  if (validated > 0 && late) {
    return { background: "rgba(251, 191, 36, 0.38)", boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.7)" };
  }
  if (validated <= 0) return { background: "rgba(109, 246, 255, 0.06)" };
  // La case dorée se lit sur les PILIERS, pas sur un seuil d'énergie : un samedi
  // de chantier (116 ⚡, sans Magic Focus) est une journée complète au même titre
  // qu'un mardi de bureau. Un seuil chiffré aurait forcément exclu l'un des deux.
  if (perfect) {
    return { background: "var(--lime)", boxShadow: "0 0 6px rgba(166,255,61,0.7)" };
  }
  if (energy >= MAX_DAY_ENERGY * TINT_STEPS[2]) return { background: "rgba(166, 255, 61, 0.72)" };
  if (energy >= MAX_DAY_ENERGY * TINT_STEPS[1]) return { background: "rgba(166, 255, 61, 0.45)" };
  return { background: "rgba(166, 255, 61, 0.22)" };
}

function HistoryGrid({ habits, todayKey }: { habits: HabitsState; todayKey: string }) {
  const grace = new Set(habits.graceDays);
  const firstKey = addDaysToKey(todayKey, -(HISTORY_DAYS - 1));
  const pad = weekdayIndex(firstKey);

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < pad; i++) {
    cells.push(<div key={`pad-${i}`} className="h-3 w-3" />);
  }
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const k = addDaysToKey(firstKey, i);
    const day = habits.days[k];
    const energy = day?.energy ?? 0;
    const validated = day?.validatedCount ?? 0;
    const isGrace = grace.has(k);
    const isLate = Boolean(day?.late);
    const isToday = k === todayKey;
    const isPerfect = day ? isPerfectDay(day, habits.calorieGoal) : false;
    const label = isGrace
      ? `${k} — jour rattrapé (grâce)`
      : validated > 0
        ? `${k} — ${day ? validatedPiliers(day, habits.calorieGoal) : 0}/${PILIERS.length} piliers · ${energy} ⚡${isPerfect ? " · journée parfaite" : ""}${isLate ? " · noté après coup" : ""}`
        : `${k} — rien de saisi`;
    cells.push(
      <div
        key={k}
        title={label}
        aria-label={label}
        className={`h-3 w-3 rounded-[2px] ${isToday ? "ring-1 ring-cell-cyan" : ""}`}
        style={cellStyle(energy, validated, isGrace, isLate, isPerfect)}
      />,
    );
  }

  const all = Object.values(habits.days);
  const perfect = all.filter((d) => isPerfectDay(d, habits.calorieGoal)).length;
  // « Tenus » = ce que la série compte réellement : saisi le jour même. Les
  // journées notées après coup ont leur propre compteur plutôt que d'être
  // fondues dans le premier — la grille ne doit jamais surestimer la constance.
  const held = all.filter((d) => d.validatedCount > 0 && !d.late).length;
  const lateCount = all.filter((d) => d.validatedCount > 0 && d.late).length;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-cell-cyan/70">
          {HISTORY_DAYS} derniers jours
        </span>
        <span className="text-[10px] text-cell-teal/60">
          {held} jours tenus · {perfect} parfaits
          {lateCount > 0 ? ` · ${lateCount} après coup` : ""}
        </span>
      </div>
      <div
        className="grid grid-flow-col justify-start gap-[3px] overflow-x-auto pb-1"
        style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
      >
        {cells}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[9px] text-cell-teal/50">
        <span>Moins</span>
        {TINT_STEPS.map((f) => (
          <span
            key={f}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={cellStyle(MAX_DAY_ENERGY * f, 1, false)}
          />
        ))}
        <span
          className="h-2.5 w-2.5 rounded-[2px]"
          style={cellStyle(MAX_DAY_ENERGY, 1, false, false, true)}
        />
        <span>Parfaite</span>
        <span className="ml-2 flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={cellStyle(0, 0, true)} />
          rattrapé
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={cellStyle(40, 1, false, true)} />
          noté après coup
        </span>
      </div>
    </div>
  );
}

/* ---------- Échelle des paliers hebdomadaires ---------- */

function TierLadder({ streak, awards }: { streak: number; awards: Record<string, string> }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {STREAK_TIERS.map((t) => {
        const done = streak >= t.days;
        const paid = Boolean(awards[String(t.days)]);
        const isNext = !done && t.days === (nextStreakTier(streak)?.days ?? -1);
        return (
          <div
            key={t.days}
            title={
              done
                ? `Palier ${t.days} j atteint${paid ? " — bonus versé" : ""} : +${t.energy} ⚡`
                : `Palier ${t.days} j : +${t.energy} ⚡ (encore ${t.days - streak} j)`
            }
            className={`shrink-0 rounded-md border px-2 py-1 text-center ${
              done
                ? "border-cell-lime/50 bg-cell-lime/10 text-cell-lime"
                : isNext
                  ? "border-cell-magenta/60 bg-cell-magenta/10 text-cell-magenta"
                  : "border-cell-cyan/15 text-cell-teal/45"
            }`}
          >
            <div className="text-[11px] leading-none">{t.days} j</div>
            <div className="mt-0.5 text-[9px] leading-none">
              {done ? "✓" : `+${t.energy}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Le Bilan du soir ---------- */

/** Où se dépense une Percée. Déduit des CHAMPS de l'option, jamais de son identifiant :
 *  une option qui durcit une vague se règle au Bastion, une option qui verse de la
 *  production se règle ici même, et tout le reste n'ouvre qu'une cible — donc la carte. */
function perceeVenue(opt: BilanOptionDef): "ici" | "bastion" | "derive" {
  if (opt.production_hours) return "ici";
  if (opt.palier_bonus || opt.loot_mult || opt.forced_peril || opt.fragments) return "bastion";
  return "derive";
}

/** Ce que le blocage du Bilan raconte au joueur. Une phrase par cause, jamais un code. */
function bilanReasonText(s: ReturnType<typeof bilanStatus>, hour: number): string {
  switch (s.reason) {
    case "deja_fait":
      return `Bilan de la journée du ${s.day} déjà fait. Prochain rendez-vous demain soir.`;
    case "trop_tot":
      return `Le Bilan s'ouvre à ${BILAN.min_hour} h — encore ${BILAN.min_hour - hour} h. La journée n'est pas finie.`;
    case "seuil":
      return `${s.energy} / ${s.threshold} ⚡ sur la journée — il manque ${s.threshold - s.energy} ⚡ pour ouvrir le Bilan.`;
    case "stock_plein":
      return `Stock de Percées plein (${s.maxStock}). Dépenses-en une avant d'en gagner d'autres.`;
    default:
      return "";
  }
}

/** LE RENDEZ-VOUS DE FIN DE JOURNÉE.
 *
 *  Toute la journée on grignote : on saisit une habitude, on lance une sortie, on développe
 *  un gisement. Le soir, un seul geste transforme la journée réelle en évènement de jeu — il
 *  délivre des Percées, la monnaie des coups d'éclat. Ce bloc est donc le seul du panneau à
 *  être placé AVANT la série : quand il est ouvert, il doit être ce qu'on voit en premier.
 *
 *  Il lit l'état complet parce que `bilanStatus` juge sur trois choses à la fois (les
 *  habitudes du jour, le stock de Percées, l'heure) ; il ne SÉLECTIONNE en revanche aucun
 *  objet fabriqué à la volée — le statut est calculé après la sélection, jamais dedans. */
function BilanBlock({ onGoto }: { onGoto?: (panel: "bastion" | "derive") => void }) {
  const state = useGame((s) => s);
  const now = state.lastTick;
  const status = bilanStatus(state, now);
  const hour = new Date(now).getHours();

  /* Célébration : ce que le Bilan vient de verser, figé au moment du clic. */
  const [ceremony, setCeremony] = useState<{ gained: number; energy: number; day: string } | null>(
    null,
  );
  /* Accusé de réception d'une dépense immédiate (« Poussée de croissance »). */
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  const gauge = Math.min(1, status.threshold > 0 ? status.energy / status.threshold : 1);

  return (
    <Panel variant="noyau" className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🌙</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs uppercase tracking-[0.25em] text-cell-magenta">Bilan du soir</h2>
          <p className="text-[10px] text-cell-teal/60">
            {status.catchup ? `rattrapage de la journée du ${status.day}` : `journée du ${status.day}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[9px] uppercase tracking-widest text-cell-teal/50">Percées</div>
          <div className="text-sm text-cell-magenta">
            {status.percees} / {status.maxStock}
          </div>
        </div>
      </div>

      {/* Jauge du seuil : la seule chose qui sépare la journée du rendez-vous. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-abyss">
        <div
          className={`h-full rounded-full transition-all ${gauge >= 1 ? "bg-cell-magenta" : "bg-cell-lime/70"}`}
          style={{ width: `${Math.round(gauge * 100)}%` }}
        />
      </div>

      {status.ok ? (
        <div className="space-y-1">
          <p className="text-[11px] leading-4 text-cell-lime">
            {status.energy} ⚡ tenus aujourd&apos;hui — le Bilan est ouvert.
          </p>
          <PixelButton
            className="w-full text-xs text-cell-magenta"
            onClick={() => {
              const gained = state.validateBilanDuSoir();
              if (gained <= 0) return;
              setCeremony({ gained, energy: status.energy, day: status.day });
              vibrate([18, 40, 18, 40, 120]);
              playCue("victory");
            }}
          >
            🌙 FAIRE LE BILAN — +{status.reward} PERCÉE{status.reward > 1 ? "S" : ""}
          </PixelButton>
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-cell-teal/60">{bilanReasonText(status, hour)}</p>
      )}

      {/* Les emplois d'une Percée. Toujours affichés, même à zéro : c'est la carte du
          menu, elle donne une raison de tenir la journée avant même de l'avoir tenue. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-[9px] uppercase tracking-[0.2em] text-cell-teal/50">
          Ce qu&apos;une Percée déclenche
        </p>
        {BILAN_OPTIONS.map((opt) => {
          const affordable = status.percees >= opt.cost;
          const venue = perceeVenue(opt);
          return (
            <div
              key={opt.id}
              className={`flex items-start gap-2 rounded-lg border p-2 transition ${
                affordable
                  ? "border-cell-magenta/40 bg-cell-magenta/5"
                  : "border-cell-cyan/15 bg-abyss/40"
              }`}
            >
              <span className="text-base leading-none">{opt.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-4 text-cell-cyan">
                  {opt.name}{" "}
                  <span className="text-cell-magenta">
                    · {opt.cost} Percée{opt.cost > 1 ? "s" : ""}
                  </span>
                </p>
                <p className="text-[10px] leading-4 text-cell-teal/60">{bilanOptionDesc(opt)}</p>
              </div>
              {venue === "ici" ? (
                <button
                  disabled={!affordable}
                  onClick={() => {
                    if (!state.spendPerceeNow(opt.id)) return;
                    setFlash(`${opt.name} : ${opt.production_hours} h de production versées d'un coup.`);
                    vibrate(30);
                    playCue("collect");
                  }}
                  className="shrink-0 rounded border border-cell-magenta/50 px-2 py-1 text-[10px] text-cell-magenta transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30"
                >
                  DÉPENSER
                </button>
              ) : (
                <button
                  disabled={!affordable || !onGoto}
                  onClick={() => onGoto?.(venue)}
                  className="shrink-0 rounded border border-cell-cyan/40 px-2 py-1 text-[10px] text-cell-cyan transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {venue === "bastion" ? "AU BASTION" : "SUR LA CARTE"}
                </button>
              )}
            </div>
          );
        })}
        {flash && <p className="text-[10px] leading-4 text-cell-lime">✔ {flash}</p>}
      </div>

      {/* La cérémonie. Plein écran et fermée à la main : c'est le seul moment de la
          journée où le jeu accuse réception d'une journée RÉELLE, il ne doit pas
          s'effacer tout seul pendant que le joueur regarde ailleurs. */}
      {ceremony && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-abyss/80 p-4 backdrop-blur-[2px]">
          <div className="animate-card-reveal flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl border border-cell-magenta/60 bg-deep px-6 py-6 text-center shadow-[0_0_60px_rgba(255,84,214,0.45)]">
            <span className="text-5xl">🌙</span>
            <p className="text-sm uppercase tracking-[0.25em] text-cell-magenta">Bilan du soir</p>
            <p className="text-[11px] leading-4 text-cell-teal/80">
              Journée du {ceremony.day} · {ceremony.energy} ⚡
            </p>
            <p className="text-lg leading-tight text-cell-magenta">
              +{ceremony.gained} Percée{ceremony.gained > 1 ? "s" : ""}
            </p>
            <p className="text-[11px] leading-4 text-cell-lime">
              +{status.bonusSorties} sorties gratuites demain
            </p>
            <p className="text-[10px] leading-4 text-cell-teal/60">
              Une Percée fait passer un cap d&apos;un coup : une vague hors norme, un antre, ou
              une poussée de production.
            </p>
            <PixelButton className="mt-1 text-xs" onClick={() => setCeremony(null)}>
              CONTINUER
            </PixelButton>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------- Panneau ---------- */

export function HabitsPanel({
  onClose,
  onGoto,
}: {
  onClose: () => void;
  /** Raccourci vers l'écran où se dépense une Percée de combat (Bastion ou La Dérive). */
  onGoto?: (panel: "bastion" | "derive") => void;
}) {
  const habits = useGame((s) => s.habits);
  const repairStreak = useGame((s) => s.repairStreak);
  // "now" du rendu = dernier tick (1 s) : suit le passage de minuit sans Date.now() en rendu.
  const now = useGame((s) => s.lastTick);

  const key = dayKey(now);

  /* JOURNÉE ÉDITÉE. Par défaut aujourd'hui — c'est le geste de tous les jours et
     il ne doit pas coûter un clic de plus.

     La sélection est ESTAMPILLÉE du jour où elle a été faite, et non simplement
     mémorisée : `editing` est alors une pure dérivée du rendu, sans effet de
     bord ni setState en cascade. Deux remises à zéro tombent gratuitement de
     cette forme — au passage de minuit (rester bloqué sur la veille au réveil
     serait le meilleur moyen de saisir sa journée dans la mauvaise case) et
     quand le jour choisi sort de la fenêtre pendant que le panneau est ouvert
     (repli par `canEditDay`). Dans les deux cas on retombe sur aujourd'hui. */
  const [picked, setPicked] = useState<{ day: string; stampedOn: string } | null>(null);
  const editing =
    picked && picked.stampedOn === key && canEditDay(picked.day, key) ? picked.day : key;
  const isToday = editing === key;
  const selectDay = (d: string) => setPicked({ day: d, stampedOn: key });

  const entry = habits.days[editing] ?? emptyDayEntry();
  const todayEntry = habits.days[key] ?? emptyDayEntry();
  const streak = habits.streak;
  const next = nextStreakTier(streak);
  const current = currentStreakTier(streak);
  // La carte de série parle TOUJOURS d'aujourd'hui, même quand on remplit lundi.
  const todayOk = todayEntry.validatedCount > 0;
  const repairable = repairableDay(habits, key);
  const graceLeft = graceAvailable(habits, key);
  const repairIsLate = Boolean(repairable && habits.days[repairable]?.late);

  // Célébration de la journée parfaite : les 4 PILIERS, pas les 5 habitudes.
  // Aucun état persisté : on compare simplement au compte précédent — le but est
  // de marquer le geste au moment où il est fait, pas de tenir une comptabilité
  // de plus.
  const piliersOk = validatedPiliers(entry, habits.calorieGoal);
  const [burst, setBurst] = useState(false);
  const prevValidated = useRef<number | null>(null);
  const prevKey = useRef(editing);

  useEffect(() => {
    if (prevKey.current !== editing) {
      prevKey.current = editing;
      prevValidated.current = null;
    }
    const before = prevValidated.current;
    prevValidated.current = piliersOk;
    if (before !== null && before < PILIERS.length && piliersOk >= PILIERS.length) {
      setBurst(true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([18, 45, 18, 45, 90]);
      }
      // Rituel complet : la seule occurrence quotidienne garantie, elle mérite
      // le repère de victoire plutôt qu'une simple collecte.
      playCue("victory");
    }
  }, [editing, piliersOk]);

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(false), 2800);
    return () => clearTimeout(t);
  }, [burst]);

  // Progression vers le prochain palier : bornée au palier courant pour que la
  // barre reparte de zéro à chaque semaine franchie (sinon elle rampe).
  const from = current?.days ?? 0;
  const span = next ? next.days - from : 1;
  const progress = next ? Math.min(1, Math.max(0, (streak - from) / span)) : 1;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <span className="text-3xl">🧬</span>
          <div className="flex-1">
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">
              {isToday ? "Habitudes du jour" : "Habitudes"}
            </h1>
            <p className="text-[11px] text-cell-teal/60">
              {editing} —{" "}
              {isToday ? "modifiable jusqu'à minuit" : "journée notée après coup"} ·{" "}
              {piliersOk}/{PILIERS.length} piliers
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan"
          >
            ✕
          </button>
        </div>

        {/* ----- Le Bilan du soir : le geste qui clôt la journée ----- */}
        <BilanBlock onGoto={onGoto} />

        {/* ----- La série : le vrai rendez-vous ----- */}
        <Panel variant="membrane" className="space-y-3 p-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border ${
                todayOk
                  ? "border-cell-lime/50 bg-cell-lime/10 text-cell-lime"
                  : streak > 0
                    ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                    : "border-cell-teal/25 text-cell-teal/50"
              }`}
            >
              <span className="text-lg leading-none">🔥</span>
              <span className="text-base leading-tight">{streak}</span>
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-xs text-cell-cyan">
                {todayOk
                  ? `Série de ${streak} jour${streak > 1 ? "s" : ""} — journée validée.`
                  : streak > 0
                    ? `Série de ${streak} jour${streak > 1 ? "s" : ""} — pas encore saisie aujourd'hui.`
                    : "Aucune série en cours. Une habitude validée suffit à la lancer."}
              </p>
              {next ? (
                <>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-abyss">
                    <div
                      className="h-full rounded-full bg-cell-magenta transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-cell-teal/60">
                    Palier {next.days} j : +{next.energy} ⚡ — encore {next.days - streak} jour
                    {next.days - streak > 1 ? "s" : ""}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-cell-lime">
                  Tous les paliers sont atteints — {fmtInt(TOTAL_STREAK_ENERGY)} ⚡ encaissés.
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[9px] uppercase tracking-widest text-cell-teal/50">Record</div>
              <div className="text-sm text-cell-cyan">{habits.bestStreak} j</div>
            </div>
          </div>

          <TierLadder streak={streak} awards={habits.streakAwards} />

          {/* Filet de sécurité : le jour de grâce */}
          {repairable ? (
            <div className="rounded-lg border border-cell-magenta/40 bg-cell-magenta/5 p-2">
              {/* Deux trous très différents portent le même bouton : la journée
                  jamais saisie, et celle notée après coup (qui a payé son énergie
                  mais ne tient pas la chaîne). Dire « oubliée » à quelqu'un qui
                  vient justement de la remplir serait le contredire. */}
              <p className="mb-2 text-[11px] leading-4 text-cell-magenta">
                {repairIsLate
                  ? `Journée du ${repairable} notée après coup : son énergie est déjà versée, mais elle ne tient pas la série. Ton jour de grâce du mois peut recoller la chaîne — sans énergie supplémentaire.`
                  : `Journée du ${repairable} oubliée. Tu peux la rattraper avec ton jour de grâce du mois — la chaîne repart, mais ce jour ne rapporte aucune énergie.`}
              </p>
              <button
                onClick={() => repairStreak()}
                className="pixel-btn px-3 py-1 text-[11px] text-cell-magenta"
              >
                🩹 Rattraper le {repairable}
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-cell-teal/50">
              Filet de sécurité : {STREAK_GRACE.per_month} jour de grâce par mois
              {graceLeft ? " — disponible" : " — déjà utilisé ce mois-ci"}. Il répare un oubli isolé
              de moins de {STREAK_GRACE.max_age_days} jours.
            </p>
          )}

          <HistoryGrid habits={habits} todayKey={key} />
        </Panel>

        {/* ----- La saisie ----- */}
        <Panel variant="noyau" className="p-3">
          {/* La bande des jours. En tête du bloc de saisie et nulle part ailleurs :
              c'est le seul endroit où le choix du jour a une conséquence, et le
              mettre plus haut ferait croire que tout le panneau change de date
              (la série, elle, parle toujours d'aujourd'hui). */}
          <DayStrip habits={habits} todayKey={key} selected={editing} onSelect={selectDay} />
          <p className="mt-1 mb-2 text-[9px] leading-3 text-cell-teal/50">
            Pas eu le temps de noter un jour ? Les {SAISIE_WINDOW_DAYS} derniers jours restent
            ouverts.
          </p>

          {/* L'avertissement arrive AVANT la saisie, jamais après : découvrir que
              son 🔥 30 est resté à 30 une fois les quatre piliers validés serait
              la pire des surprises. */}
          {!isToday && (
            <div className="mb-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-2">
              <p className="text-[10px] leading-4 text-amber-300">
                ◷ Journée notée après coup. L&apos;énergie est versée en entier — le travail a
                bien été fait. Mais la série mesure la régularité du rendez-vous, pas le travail :
                ce jour ne recollera pas la chaîne. Seul le jour de grâce le peut.
              </p>
            </div>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                entry.energy >= 0
                  ? "border-cell-lime/40 text-cell-lime"
                  : "border-red-400/40 text-red-400"
              }`}
            >
              {entry.energy >= 0 ? "+" : ""}
              {entry.energy} ⚡ {isToday ? "aujourd'hui" : "ce jour-là"}
            </span>
            <span className="text-[10px] text-cell-teal/60">
              journée parfaite = les {PILIERS.length} piliers
            </span>
          </div>
          <PiliersRow entry={entry} calorieGoal={habits.calorieGoal} />
          <div className="space-y-2">
            {HABITS.map((def) => (
              <HabitRow
                key={def.id}
                def={def}
                entry={entry}
                calorieGoal={habits.calorieGoal}
                day={editing}
              />
            ))}
          </div>
        </Panel>
      </div>

      {/* Célébration de la journée parfaite — le seul moment du jeu où le joueur
          a VRAIMENT accompli quelque chose dans le monde réel. Un voile plein
          écran (et pas juste une carte posée sur le formulaire) : c'est ce qui
          fait la différence entre un accusé de réception et une récompense. */}
      {burst && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-abyss/75 backdrop-blur-[2px]">
          <div className="animate-card-reveal flex flex-col items-center gap-2 rounded-2xl border border-cell-lime/60 bg-deep px-7 py-6 text-center shadow-[0_0_60px_rgba(166,255,61,0.45)]">
            <span className="text-5xl">🌟</span>
            <p className="text-sm uppercase tracking-[0.25em] text-cell-lime">Journée parfaite</p>
            <p className="text-[11px] leading-4 text-cell-teal/80">
              {PILIERS.length}/{PILIERS.length} piliers · {entry.energy} ⚡
              <br />
              {isToday ? "La mue du jour est complète." : `La journée du ${editing} est complète.`}
            </p>
            {/* La pastille de série ne s'affiche que pour aujourd'hui : brandir
                « 🔥 30 jours d'affilée » au moment précis où le joueur remplit un
                jour qui, lui, ne compte pas dans la chaîne serait une promesse
                fausse. Hors d'aujourd'hui, on dit exactement ce qui vient de se
                passer. */}
            {isToday ? (
              <p className="mt-1 rounded-full border border-cell-lime/40 px-3 py-0.5 text-[11px] text-cell-lime">
                {`🔥 ${streak} jour${streak > 1 ? "s" : ""} d'affilée`}
              </p>
            ) : (
              <p className="mt-1 rounded-full border border-amber-400/40 px-3 py-0.5 text-[11px] text-amber-300">
                ◷ énergie versée · série inchangée
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
