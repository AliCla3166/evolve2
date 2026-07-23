/* Liste des 12 bâtiments — niveau, production, coût, amélioration.
   Tout l'équilibrage (coûts, temps, production, niveaux max) vient du JSON d'économie. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import {
  BUILDING_ORDER,
  buildingProductionPerHour,
  buildTimeMs,
  canAfford,
  getBuildingConfig,
  isDesigned,
  levelCost,
  maxLevel,
  resourceName,
} from "@/lib/game/economy";
import { fmtDuration, fmtInt, fmtRate } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import type { BuildingId, ResourceId } from "@/lib/game/types";

function CostLine({ cost, resources }: { cost: Record<string, number>; resources: Record<ResourceId, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {Object.entries(cost).map(([res, amount]) => {
        const ok = (resources[res as ResourceId] ?? 0) >= amount;
        return (
          <span
            key={res}
            className={`flex items-center gap-1 text-[11px] ${ok ? "text-cell-lime" : "text-red-400"}`}
            title={`${resourceName(res as ResourceId)} : ${fmtInt(resources[res as ResourceId] ?? 0)} en stock`}
          >
            <img
              src={`/assets/resources/${res}.png`}
              alt={res}
              width={14}
              height={14}
              className="pixelated"
              draggable={false}
            />
            {fmtInt(amount)}
          </span>
        );
      })}
    </div>
  );
}

function BuildingRow({ id }: { id: BuildingId }) {
  const resources = useGame((s) => s.resources);
  const buildings = useGame((s) => s.buildings);
  const task = useGame((s) => s.buildQueue);
  const startUpgrade = useGame((s) => s.startUpgrade);
  // "now" du rendu = dernier tick appliqué (timer live sans Date.now() en rendu).
  const now = useGame((s) => s.lastTick);

  const cfg = getBuildingConfig(id);
  const designed = isDesigned(id);
  const level = buildings[id] ?? 0;
  const max = maxLevel(id);
  const sprite = `/assets/buildings/${id}/niveau${Math.max(1, level)}.png`;

  // --- Bâtiments "À venir" (peche / defense / raid : designed=false) ---
  if (!designed) {
    return (
      <Panel variant="membrane" className="p-2 opacity-70">
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <img src={sprite} alt={cfg.name} className="pixelated h-full w-full grayscale" draggable={false} />
            <img
              src="/assets/ui/age01_cell_ui_overlay_locked_v001.png"
              alt="verrouillé"
              className="pixelated absolute inset-0 h-full w-full"
              draggable={false}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs tracking-wide text-cell-teal/60">{cfg.name}</div>
            <div className="text-[10px] text-cell-teal/40">Mini-jeu en préparation</div>
          </div>
          <span className="rounded-full border border-cell-teal/30 px-2 py-0.5 text-[10px] text-cell-teal/60">
            À venir
          </span>
        </div>
      </Panel>
    );
  }

  const inConstruction = task?.buildingId === id;
  const maxed = level >= max;
  const nextLevel = level + 1;
  const cost = maxed ? null : levelCost(id, nextLevel);
  const affordable = cost !== null && canAfford(resources, cost);
  const queueBusy = task !== null;
  const prod = buildingProductionPerHour(id, level);
  const nextProd = maxed ? {} : buildingProductionPerHour(id, nextLevel);

  return (
    <Panel variant="membrane" className="p-2">
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0">
          <img
            src={sprite}
            alt={cfg.name}
            className={`pixelated h-full w-full ${level === 0 ? "opacity-40 grayscale" : ""}`}
            draggable={false}
          />
          {inConstruction && (
            <img
              src="/assets/ui/age01_cell_ui_overlay_construction_v001.png"
              alt="en chantier"
              className="pixelated absolute inset-0 h-full w-full"
              draggable={false}
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs tracking-wide text-cell-cyan">{cfg.name}</span>
            <span className="shrink-0 rounded-full border border-cell-cyan/30 px-1.5 text-[10px] text-cell-teal">
              Nv {level}/{max}
            </span>
          </div>

          {/* Production actuelle (ou rôle si non producteur) */}
          {Object.keys(prod).length > 0 ? (
            <div className="flex flex-wrap gap-x-3 text-[10px] text-cell-lime/90">
              {Object.entries(prod).map(([res, rate]) => (
                <span key={res}>
                  +{fmtRate(rate)}/h {resourceName(res as ResourceId)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-cell-teal/50">
              {level === 0
                ? "Non construit"
                : cfg.role === "support"
                  ? "Soutien — renforce la cellule"
                  : cfg.role === "sink"
                    ? "Capstone — prépare la transition d'Âge"
                    : ""}
            </div>
          )}

          {/* Chantier en cours / coût du prochain niveau */}
          {inConstruction && task ? (
            <div className="text-[11px] text-cell-lime">
              ⏳ Nv {task.targetLevel} dans {fmtDuration(task.endsAt - now)}
            </div>
          ) : maxed ? (
            <div className="text-[10px] tracking-widest text-cell-magenta">NIVEAU MAX</div>
          ) : (
            cost && (
              <div className="space-y-0.5">
                <CostLine cost={cost} resources={resources} />
                <div className="text-[10px] text-cell-teal/50">
                  ⏱ {fmtDuration(buildTimeMs(id, nextLevel))}
                  {Object.entries(nextProd).map(([res, rate]) => (
                    <span key={res}>
                      {" "}
                      → +{fmtRate(rate)}/h {resourceName(res as ResourceId)}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {!maxed && !inConstruction && (
          <PixelButton
            className="!min-w-[96px] shrink-0 !px-3 text-[10px]"
            disabled={queueBusy || !affordable}
            onClick={() => startUpgrade(id)}
          >
            {level === 0 ? "CONSTRUIRE" : "AMÉLIORER"}
          </PixelButton>
        )}
      </div>
    </Panel>
  );
}

export function BuildingList() {
  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-[0.3em] text-cell-cyan">Bâtiments</h2>
      {BUILDING_ORDER.map((id) => (
        <BuildingRow key={id} id={id} />
      ))}
    </div>
  );
}
