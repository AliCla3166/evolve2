/* File de construction multi-slots (v8) — une ligne par chantier en cours,
   plus une ligne d'invitation par slot libre (et le prochain déblocage). */
"use client";

import { BoostButton } from "@/components/game/BoostButton";
import { Panel, ResourceBar } from "@/components/ui/Pixel";
import {
  buildSlotConfig,
  getBuildingConfig,
  nextSlotUnlock,
  unlockedSlotCount,
} from "@/lib/game/economy";
import { fmtDuration } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";

export function QueueBanner() {
  const queue = useGame((s) => s.buildQueue);
  const buildings = useGame((s) => s.buildings);
  // "now" du rendu = dernier tick appliqué (mis à jour chaque seconde par le store,
  // et lecture pure côté React — pas de Date.now() pendant le rendu).
  const now = useGame((s) => s.lastTick);

  const slots = unlockedSlotCount(buildings);
  const unlock = nextSlotUnlock(buildings);

  return (
    <Panel variant="tooltip" className="px-3 py-1">
      <div className="flex flex-col gap-1">
        {Array.from({ length: slots }, (_, i) => {
          const task = queue.find((t) => t.slot === i);
          if (!task) {
            const cfg = buildSlotConfig(i);
            return (
              <div key={i} className="text-center text-[9px] text-cell-teal/60">
                🔨 {cfg.label} libre
                {cfg.max_hours !== null ? ` — chantiers ≤ ${cfg.max_hours} h` : ""}
              </div>
            );
          }
          const total = task.endsAt - task.startedAt;
          const elapsed = Math.min(total, Math.max(0, now - task.startedAt));
          const remaining = Math.max(0, task.endsAt - now);
          const name = getBuildingConfig(task.buildingId).name;
          return (
            <div
              key={i}
              className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
            >
              <span className="text-[11px] text-cell-cyan">
                🔨 {name} → Nv {task.targetLevel}
              </span>
              <ResourceBar
                value={elapsed}
                max={Math.max(1, total)}
                color="var(--lime)"
                width={120}
                label={fmtDuration(remaining)}
                title={`Chantier en cours : ${name} niveau ${task.targetLevel}`}
              />
              {/* Accélération à l'énergie (piste 4) — accessible sans ouvrir la fiche :
                  c'est le geste qu'on veut voir répété après une bonne journée. */}
              <BoostButton task={task} />
            </div>
          );
        })}
        {unlock ? (
          <div className="text-center text-[8px] text-cell-teal/45">
            🔒 {unlock.label} : {unlock.built}/{unlock.requiresBuilt} proto-organes
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
