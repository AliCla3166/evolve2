/* Panneau "Habitudes du jour" — saisie quotidienne -> Points d'énergie.
   Une saisie par jour calendaire (modifiable seulement le jour même — le
   store n'écrit que sur la clé du jour courant). Overlay plein écran ouvert
   depuis un bouton dédié de la nav basse (retour lisibilité : ça vivait avant
   en plein milieu de la page principale, ça prenait toute la place).

   Piste 6 du diagnostic UX : c'était le plus austère des six panneaux alors
   que c'est le cœur du concept. Il porte maintenant trois choses de plus —
   l'échelle des paliers hebdomadaires, la grille des 90 jours (la preuve
   tangible de la constance, qui EST le vrai produit du jeu), et le filet de
   sécurité (« jour de grâce ») — plus une célébration de la journée parfaite. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Pixel";
import { playCue } from "@/lib/audio";
import { fmtInt } from "@/lib/game/format";
import {
  addDaysToKey,
  CALORIE_DELTA_MAX,
  CALORIE_DELTA_MIN,
  CALORIE_STEP,
  currentStreakTier,
  dayKey,
  emptyDayEntry,
  graceAvailable,
  habitEnergy,
  habitValidated,
  HABITS,
  HISTORY_DAYS,
  nextStreakTier,
  repairableDay,
  STREAK_GRACE,
  STREAK_TIERS,
  TOTAL_STREAK_ENERGY,
  weekdayIndex,
  type HabitDef,
} from "@/lib/game/habits";
import { useGame } from "@/lib/game/store";
import type { HabitDayEntry, HabitsState } from "@/lib/game/types";

/** Énergie d'une journée parfaite (5/5) — dérivée du barème, jamais codée en dur. */
const PERFECT_DAY_ENERGY = 95;

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
}: {
  def: HabitDef;
  entry: HabitDayEntry;
  calorieGoal: number;
}) {
  const updateHabitToday = useGame((s) => s.updateHabitToday);
  const energy = habitEnergy(def, entry, calorieGoal);
  const valid = habitValidated(def, entry, calorieGoal);

  let controls: React.ReactNode = null;
  if (def.type === "calorie") {
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        <MiniBtn
          onClick={() =>
            updateHabitToday({ calories: Math.max(CALORIE_DELTA_MIN, entry.calories - CALORIE_STEP) })
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
          onChange={(e) => updateHabitToday({ calories: Number(e.target.value) || 0 })}
          className="w-24 rounded-md border border-cell-cyan/40 bg-abyss px-2 py-1 text-center text-xs text-white outline-none focus:border-cell-cyan"
        />
        <MiniBtn
          onClick={() =>
            updateHabitToday({ calories: Math.min(CALORIE_DELTA_MAX, entry.calories + CALORIE_STEP) })
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
        <MiniBtn onClick={() => updateHabitToday({ steps: entry.steps - (def.step ?? 500) })}>
          −
        </MiniBtn>
        <span className="min-w-20 text-center text-xs text-white">
          {fmtInt(entry.steps)} {def.unit}
        </span>
        <MiniBtn onClick={() => updateHabitToday({ steps: entry.steps + (def.step ?? 500) })}>
          +
        </MiniBtn>
      </div>
    );
  } else {
    const id = def.id as "mf" | "alilou" | "rituals";
    controls = (
      <div className="flex items-center gap-2">
        <MiniBtn onClick={() => updateHabitToday({ [id]: entry[id] - 1 })}>−</MiniBtn>
        <span className="min-w-14 text-center text-xs text-white">
          {entry[id]} / {def.capItems}
        </span>
        <MiniBtn
          disabled={entry[id] >= (def.capItems ?? Infinity)}
          onClick={() => updateHabitToday({ [id]: entry[id] + 1 })}
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

/* ---------- Grille d'historique (façon calendrier de contributions) ---------- */

/** Teinte d'une case selon l'énergie du jour : quatre paliers + la case « parfaite ».
 *  Le dégradé rend la constance lisible d'un coup d'œil — un mois de vert clair
 *  raconte autre chose qu'un mois de trous, et c'est exactement la preuve que le
 *  joueur vient chercher. */
function cellStyle(energy: number, validated: number, grace: boolean): React.CSSProperties {
  if (grace) {
    return { background: "rgba(255, 84, 214, 0.45)", boxShadow: "inset 0 0 0 1px rgba(255,84,214,0.8)" };
  }
  if (validated <= 0) return { background: "rgba(109, 246, 255, 0.06)" };
  if (energy >= PERFECT_DAY_ENERGY) {
    return { background: "var(--lime)", boxShadow: "0 0 6px rgba(166,255,61,0.7)" };
  }
  if (energy >= 60) return { background: "rgba(166, 255, 61, 0.72)" };
  if (energy >= 30) return { background: "rgba(166, 255, 61, 0.45)" };
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
    const isToday = k === todayKey;
    const label = isGrace
      ? `${k} — jour rattrapé (grâce)`
      : validated > 0
        ? `${k} — ${validated}/${HABITS.length} validées · ${energy} ⚡`
        : `${k} — rien de saisi`;
    cells.push(
      <div
        key={k}
        title={label}
        aria-label={label}
        className={`h-3 w-3 rounded-[2px] ${isToday ? "ring-1 ring-cell-cyan" : ""}`}
        style={cellStyle(energy, validated, isGrace)}
      />,
    );
  }

  const perfect = Object.values(habits.days).filter((d) => d.energy >= PERFECT_DAY_ENERGY).length;
  const held = Object.values(habits.days).filter((d) => d.validatedCount > 0).length;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-cell-cyan/70">
          {HISTORY_DAYS} derniers jours
        </span>
        <span className="text-[10px] text-cell-teal/60">
          {held} jours tenus · {perfect} parfaits
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
        {[0, 20, 45, 75, PERFECT_DAY_ENERGY].map((e) => (
          <span
            key={e}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={cellStyle(e, e > 0 ? 1 : 0, false)}
          />
        ))}
        <span>Plus</span>
        <span className="ml-2 flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={cellStyle(0, 0, true)} />
          rattrapé
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

/* ---------- Panneau ---------- */

export function HabitsPanel({ onClose }: { onClose: () => void }) {
  const habits = useGame((s) => s.habits);
  const repairStreak = useGame((s) => s.repairStreak);
  // "now" du rendu = dernier tick (1 s) : suit le passage de minuit sans Date.now() en rendu.
  const now = useGame((s) => s.lastTick);

  const key = dayKey(now);
  const entry = habits.days[key] ?? emptyDayEntry();
  const streak = habits.streak;
  const next = nextStreakTier(streak);
  const current = currentStreakTier(streak);
  const todayOk = entry.validatedCount > 0;
  const repairable = repairableDay(habits, key);
  const graceLeft = graceAvailable(habits, key);

  // Célébration de la journée parfaite (5/5). Aucun état persisté : on compare
  // simplement au compte précédent — le but est de marquer le geste au moment
  // où il est fait, pas de tenir une comptabilité de plus.
  const [burst, setBurst] = useState(false);
  const prevValidated = useRef<number | null>(null);
  const prevKey = useRef(key);

  useEffect(() => {
    if (prevKey.current !== key) {
      prevKey.current = key;
      prevValidated.current = null;
    }
    const before = prevValidated.current;
    prevValidated.current = entry.validatedCount;
    if (before !== null && before < HABITS.length && entry.validatedCount >= HABITS.length) {
      setBurst(true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([18, 45, 18, 45, 90]);
      }
      // Rituel complet : la seule occurrence quotidienne garantie, elle mérite
      // le repère de victoire plutôt qu'une simple collecte.
      playCue("victory");
    }
  }, [key, entry.validatedCount]);

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
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">Habitudes du jour</h1>
            <p className="text-[11px] text-cell-teal/60">
              {key} — modifiable jusqu&apos;à minuit · {entry.validatedCount}/{HABITS.length} validées
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
              <p className="mb-2 text-[11px] leading-4 text-cell-magenta">
                Journée du {repairable} oubliée. Tu peux la rattraper avec ton jour de grâce du mois —
                la chaîne repart, mais ce jour ne rapporte aucune énergie.
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

        {/* ----- La saisie du jour ----- */}
        <Panel variant="noyau" className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                entry.energy >= 0
                  ? "border-cell-lime/40 text-cell-lime"
                  : "border-red-400/40 text-red-400"
              }`}
            >
              {entry.energy >= 0 ? "+" : ""}
              {entry.energy} ⚡ aujourd&apos;hui
            </span>
            <span className="text-[10px] text-cell-teal/60">
              journée parfaite = {PERFECT_DAY_ENERGY} ⚡ ({HABITS.length}/{HABITS.length})
            </span>
          </div>
          <div className="space-y-2">
            {HABITS.map((def) => (
              <HabitRow key={def.id} def={def} entry={entry} calorieGoal={habits.calorieGoal} />
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
              {HABITS.length}/{HABITS.length} habitudes · {entry.energy} ⚡
              <br />
              La mue du jour est complète.
            </p>
            <p className="mt-1 rounded-full border border-cell-lime/40 px-3 py-0.5 text-[11px] text-cell-lime">
              {`🔥 ${streak} jour${streak > 1 ? "s" : ""} d'affilée`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
