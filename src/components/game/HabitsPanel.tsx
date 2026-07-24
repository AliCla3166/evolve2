/* Panneau "Habitudes du jour" — saisie quotidienne -> Points d'énergie.
   Une saisie par jour calendaire (modifiable seulement le jour même — le
   store n'écrit que sur la clé du jour courant). Overlay plein écran ouvert
   depuis un bouton dédié de la nav basse (retour lisibilité : ça vivait avant
   en plein milieu de la page principale, ça prenait toute la place). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel } from "@/components/ui/Pixel";
import { fmtInt } from "@/lib/game/format";
import {
  CALORIE_DELTA_MAX,
  CALORIE_DELTA_MIN,
  CALORIE_STEP,
  dayKey,
  emptyDayEntry,
  habitEnergy,
  habitValidated,
  HABITS,
  STREAK_MILESTONES,
  type HabitDef,
} from "@/lib/game/habits";
import { useGame } from "@/lib/game/store";
import type { HabitDayEntry } from "@/lib/game/types";

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

export function HabitsPanel({ onClose }: { onClose: () => void }) {
  const habits = useGame((s) => s.habits);
  // "now" du rendu = dernier tick (1 s) : suit le passage de minuit sans Date.now() en rendu.
  const now = useGame((s) => s.lastTick);

  const key = dayKey(now);
  const entry = habits.days[key] ?? emptyDayEntry();
  const nextMilestone = STREAK_MILESTONES.find((m) => m.days > habits.streak);

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 px-2 pb-24 pt-3 sm:max-w-2xl">
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

        <Panel variant="noyau" className="p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-cell-magenta/40 px-2 py-0.5 text-[10px] text-cell-magenta"
              title={
                nextMilestone
                  ? `Série de jours avec au moins une habitude validée. Prochain jalon : ${nextMilestone.days} j → +${nextMilestone.energy} ⚡`
                  : "Série de jours avec au moins une habitude validée. Tous les jalons sont atteints !"
              }
            >
              🔥 {habits.streak} j
            </span>
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
            {nextMilestone && (
              <span className="text-[10px] text-cell-teal/60">
                jalon {nextMilestone.days} j : +{nextMilestone.energy} ⚡
              </span>
            )}
          </div>
          <div className="space-y-2">
            {HABITS.map((def) => (
              <HabitRow key={def.id} def={def} entry={entry} calorieGoal={habits.calorieGoal} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
