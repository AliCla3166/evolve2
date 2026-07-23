/* Panneau "Habitudes du jour" — saisie quotidienne -> Points d'énergie.
   Une saisie par jour calendaire local, modifiable seulement le jour même
   (le store n'écrit que sur la clé du jour courant). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel } from "@/components/ui/Pixel";
import { fmtInt } from "@/lib/game/format";
import {
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
  const setCalorieGoal = useGame((s) => s.setCalorieGoal);
  const energy = habitEnergy(def, entry, calorieGoal);
  const valid = habitValidated(def, entry, calorieGoal);

  let controls: React.ReactNode = null;
  if (def.type === "calorie") {
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[10px] text-cell-teal/80">
          kcal
          <input
            type="number"
            min={0}
            max={6000}
            step={10}
            value={entry.calories || ""}
            placeholder="0"
            onChange={(e) => updateHabitToday({ calories: Number(e.target.value) || 0 })}
            className="w-20 rounded-md border border-cell-cyan/40 bg-abyss px-2 py-1 text-xs text-white outline-none focus:border-cell-cyan"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-cell-teal/80">
          objectif
          <input
            type="number"
            min={800}
            max={6000}
            step={50}
            value={calorieGoal}
            onChange={(e) => setCalorieGoal(Number(e.target.value) || calorieGoal)}
            className="w-20 rounded-md border border-cell-cyan/40 bg-abyss px-2 py-1 text-xs text-white outline-none focus:border-cell-cyan"
          />
        </label>
        <MiniBtn
          wide
          active={entry.caloriesDone}
          onClick={() => updateHabitToday({ caloriesDone: !entry.caloriesDone })}
        >
          {entry.caloriesDone ? "Journée close ✔" : "Valider"}
        </MiniBtn>
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
        <span className={`text-xs ${energy > 0 ? "text-cell-lime" : "text-cell-teal/50"}`}>
          +{energy} ⚡
        </span>
      </div>
      <p className="mb-2 text-[10px] leading-4 text-cell-teal/60">{def.desc}</p>
      {controls}
    </div>
  );
}

export function HabitsPanel() {
  const habits = useGame((s) => s.habits);
  // "now" du rendu = dernier tick (1 s) : suit le passage de minuit sans Date.now() en rendu.
  const now = useGame((s) => s.lastTick);

  const key = dayKey(now);
  const entry = habits.days[key] ?? emptyDayEntry();
  const nextMilestone = STREAK_MILESTONES.find((m) => m.days > habits.streak);

  return (
    <Panel variant="noyau" className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">
          Habitudes du jour
        </h2>
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
        <span className="rounded-full border border-cell-lime/40 px-2 py-0.5 text-[10px] text-cell-lime">
          +{entry.energy} ⚡ aujourd&apos;hui
        </span>
      </div>
      <p className="mb-2 text-[10px] text-cell-teal/60">
        {key} — modifiable jusqu&apos;à minuit · {entry.validatedCount}/{HABITS.length} validées
        {nextMilestone &&
          ` · jalon ${nextMilestone.days} j : +${nextMilestone.energy} ⚡`}
      </p>
      <div className="space-y-2">
        {HABITS.map((def) => (
          <HabitRow key={def.id} def={def} entry={entry} calorieGoal={habits.calorieGoal} />
        ))}
      </div>
    </Panel>
  );
}
