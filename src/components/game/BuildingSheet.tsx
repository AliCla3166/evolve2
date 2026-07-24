/* Panneau d'amélioration d'un bâtiment (Phase 3) — bottom sheet mobile-first,
   ouvert au tap sur un bâtiment de la scène. Remplace l'ancienne liste :
   niveau, production actuelle → prochaine, coûts (payable ou non), temps,
   bouton AMÉLIORER/CONSTRUIRE ; états chantier / verrouillé / niveau max. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton, ResourceBar } from "@/components/ui/Pixel";
import {
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
import { SOCKETS } from "@/lib/game/scene";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import type { BuildingId, ResourceId } from "@/lib/game/types";

function CostLine({
  cost,
  resources,
}: {
  cost: Record<string, number>;
  resources: Record<ResourceId, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {Object.entries(cost).map(([res, amount]) => {
        const have = resources[res as ResourceId] ?? 0;
        const ok = have >= amount;
        return (
          <span
            key={res}
            className={`flex items-center gap-1 text-xs ${ok ? "text-cell-lime" : "text-red-400"}`}
            title={`${resourceName(res as ResourceId)} : ${fmtInt(have)} en stock`}
          >
            <img
              src={`/assets/resources/${res}.png`}
              alt={res}
              width={16}
              height={16}
              className="pixelated"
              draggable={false}
            />
            {fmtInt(amount)}
            <span className="text-[10px] opacity-60">/ {fmtInt(have)}</span>
          </span>
        );
      })}
    </div>
  );
}

function ProdLine({ prod, empty }: { prod: Record<string, number>; empty: string }) {
  const entries = Object.entries(prod);
  if (entries.length === 0)
    return <span className="text-[11px] text-cell-teal/50">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-x-3 text-xs text-cell-lime/90">
      {entries.map(([res, rate]) => (
        <span key={res}>
          +{fmtRate(rate)}/h {resourceName(res as ResourceId)}
        </span>
      ))}
    </div>
  );
}

export function BuildingSheet({
  id,
  onClose,
}: {
  id: BuildingId;
  onClose: () => void;
}) {
  const resources = useGame((s) => s.resources);
  const buildings = useGame((s) => s.buildings);
  const task = useGame((s) => s.buildQueue);
  const startUpgrade = useGame((s) => s.startUpgrade);
  // "now" du rendu = dernier tick appliqué (pas de Date.now() en rendu).
  const now = useGame((s) => s.lastTick);

  const cfg = getBuildingConfig(id);
  const designed = isDesigned(id);
  const level = buildings[id] ?? 0;
  const max = maxLevel(id);
  const accent = SOCKETS[id].accent;
  const sprite = `/assets/buildings/${id}/niveau${Math.max(1, level)}.png`;

  const inConstruction = task?.buildingId === id;
  const maxed = designed && level >= max;
  const nextLevel = level + 1;
  const cost = designed && !maxed ? levelCost(id, nextLevel) : null;
  const affordable = cost !== null && canAfford(resources, cost);
  const queueBusy = task !== null;
  const prod = buildingProductionPerHour(id, level);
  const nextProd = designed && !maxed ? buildingProductionPerHour(id, nextLevel) : {};

  return (
    <>
      {/* Voile de fermeture */}
      <div className="fixed inset-0 z-20 bg-black/50" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md animate-sheet-up px-2 pb-2 sm:max-w-lg">
        {/* Fond opaque : le remplissage du panneau membrane est semi-transparent */}
        <Panel variant="noyau" className="p-3" style={{ background: "rgba(5, 11, 20, 0.96)" }}>
          {/* En-tête : sprite + nom + niveau + fermer */}
          <div className="flex items-center gap-3">
            <div className="relative h-16 w-16 shrink-0">
              <img
                src={sprite}
                alt={cfg.name}
                className={`pixelated h-full w-full ${!designed || level === 0 ? "opacity-50 grayscale" : ""}`}
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-base tracking-wide" style={{ color: accent }}>
                {cfg.name}
              </div>
              {designed ? (
                <div className="text-[11px] text-cell-teal/70">
                  Niveau {level}/{max}
                  {level === 0 && " — non construit"}
                </div>
              ) : (
                <div className="text-[11px] text-cell-teal/50">Mini-jeu en préparation</div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="shrink-0 px-2 py-1 text-sm text-cell-teal/70 hover:text-cell-cyan"
            >
              ✕
            </button>
          </div>

          {/* Corps selon l'état */}
          {!designed ? (
            <p className="mt-2 text-xs leading-relaxed text-cell-teal/60">
              Ce proto-organe s&apos;éveillera avec son propre mini-jeu dans une
              future mise à jour. <span className="text-cell-teal">À venir.</span>
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {/* Production actuelle */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
                  Production
                </div>
                <ProdLine
                  prod={prod}
                  empty={
                    level === 0
                      ? "Aucune — à construire"
                      : cfg.role === "support"
                        ? "Soutien — renforce la cellule"
                        : cfg.role === "sink"
                          ? "Capstone — prépare la transition d'Âge"
                          : "—"
                  }
                />
              </div>

              {inConstruction && task ? (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
                    Chantier en cours → Nv {task.targetLevel}
                  </div>
                  <ResourceBar
                    value={Math.min(task.endsAt - task.startedAt, Math.max(0, now - task.startedAt))}
                    max={Math.max(1, task.endsAt - task.startedAt)}
                    color="var(--lime)"
                    width={180}
                    label={fmtDuration(task.endsAt - now)}
                  />
                </div>
              ) : maxed ? (
                <div className="text-xs tracking-widest text-cell-magenta">
                  ✦ NIVEAU MAX — cet organe a atteint sa forme finale
                </div>
              ) : (
                cost && (
                  <>
                    {/* Prochain niveau */}
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
                        {level === 0 ? "Construction" : `Amélioration → Nv ${nextLevel}`}
                      </div>
                      <CostLine cost={cost} resources={resources} />
                      <div className="mt-1 text-[11px] text-cell-teal/60">
                        ⏱ {fmtDuration(buildTimeMs(id, nextLevel))}
                        {Object.entries(nextProd).map(([res, rate]) => (
                          <span key={res} className="text-cell-lime/80">
                            {" "}
                            → +{fmtRate(rate)}/h {resourceName(res as ResourceId)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <PixelButton
                        className="flex-1 text-xs"
                        disabled={queueBusy || !affordable}
                        onClick={() => {
                          if (startUpgrade(id)) vibrate(20);
                        }}
                      >
                        {level === 0 ? "CONSTRUIRE" : "AMÉLIORER"}
                      </PixelButton>
                    </div>
                    {queueBusy && !inConstruction && (
                      <p className="text-center text-[11px] text-cell-teal/50">
                        File de construction occupée — 1 chantier à la fois.
                      </p>
                    )}
                    {!queueBusy && !affordable && (
                      <p className="text-center text-[11px] text-red-400/80">
                        Ressources insuffisantes.
                      </p>
                    )}
                  </>
                )
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
