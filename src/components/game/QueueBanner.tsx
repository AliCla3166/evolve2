/* File de construction (1 slot) — bannière avec temps restant live. */
"use client";

import { Panel, ResourceBar } from "@/components/ui/Pixel";
import { getBuildingConfig } from "@/lib/game/economy";
import { fmtDuration } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";

export function QueueBanner() {
  const task = useGame((s) => s.buildQueue);
  // "now" du rendu = dernier tick appliqué (mis à jour chaque seconde par le store,
  // et lecture pure côté React — pas de Date.now() pendant le rendu).
  const now = useGame((s) => s.lastTick);

  if (!task) {
    return (
      <Panel variant="tooltip" className="px-3 py-1 text-center text-[10px] text-cell-teal/70">
        🔨 File de construction libre — 1 chantier à la fois
      </Panel>
    );
  }

  const total = task.endsAt - task.startedAt;
  const elapsed = Math.min(total, Math.max(0, now - task.startedAt));
  const remaining = Math.max(0, task.endsAt - now);
  const name = getBuildingConfig(task.buildingId).name;

  return (
    <Panel variant="tooltip" className="px-3 py-1">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
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
      </div>
    </Panel>
  );
}
