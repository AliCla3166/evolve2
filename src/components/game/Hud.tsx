/* Bandeau HUD de ressources — barres compactes + tooltips natifs.
   Tap sur une ressource -> fiche info (nom + à quoi elle sert), pour savoir
   quoi farmer en premier (retour utilisateur). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { ResourceBar } from "@/components/ui/Pixel";
import { ResourceInfoModal } from "@/components/game/ResourceInfoModal";
import {
  cappedResources,
  ECONOMY,
  maxLevel,
  resourceName,
  storageCap,
  totalProductionPerHour,
} from "@/lib/game/economy";
import { fmtInt, fmtRate } from "@/lib/game/format";
import { ENERGY_CAP } from "@/lib/game/habits";
import { useGame } from "@/lib/game/store";
import type { ResourceId } from "@/lib/game/types";

const COLORS: Record<ResourceId, string> = {
  energie: "var(--magenta)",
  vitalite: "#7ef7c1",
  adn: "var(--cyan)",
  proteine: "#ffb347",
  biomasse: "var(--lime)",
  enzyme: "var(--teal)",
  lipide: "#ffd15c",
  signaux: "#c48bff",
};

function icon(res: ResourceId) {
  return (
    <img
      src={`/assets/resources/${res}.png`}
      alt=""
      width={18}
      height={18}
      className="pixelated shrink-0"
      draggable={false}
    />
  );
}

/** Cible d'affichage de la jauge de vitalité : le prochain coût en vitalité
 *  du Centre de mutation (dérivé du JSON — la vitalité n'a pas de cap de stockage). */
function vitaliteTarget(mutationLevel: number, value: number): number {
  for (let lvl = mutationLevel + 1; lvl <= maxLevel("mutation"); lvl++) {
    const cost = ECONOMY.buildings.mutation.levels[String(lvl)]?.cost?.vitalite;
    if (cost) return cost;
  }
  return Math.max(1, value);
}

export function Hud() {
  const resources = useGame((s) => s.resources);
  const buildings = useGame((s) => s.buildings);
  const [info, setInfo] = useState<ResourceId | null>(null);

  const cap = storageCap(buildings);
  const prod = totalProductionPerHour(buildings);
  const capped = cappedResources();
  const vitaliteMax = vitaliteTarget(buildings.mutation ?? 0, resources.vitalite);

  return (
    <div className="space-y-1">
      {/* Énergie (habitudes réelles) + Vitalité (méta) */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <button className="flex items-center gap-1" onClick={() => setInfo("energie")}>
          {icon("energie")}
          <ResourceBar
            value={resources.energie}
            max={ENERGY_CAP}
            color={COLORS.energie}
            width={150}
            label={`⚡ ${fmtInt(resources.energie)}`}
            title={`${resourceName("energie")} — gagnés via tes habitudes réelles (cap ${fmtInt(ENERGY_CAP)})`}
          />
        </button>
        <button className="flex items-center gap-1" onClick={() => setInfo("vitalite")}>
          {icon("vitalite")}
          <ResourceBar
            value={resources.vitalite}
            max={vitaliteMax}
            color={COLORS.vitalite}
            width={150}
            label={`${fmtInt(resources.vitalite)}`}
            title={`${resourceName("vitalite")} — produits par le Noyau (${fmtRate(prod.vitalite ?? 0)}/h). Prochain palier du Centre de mutation : ${fmtInt(vitaliteMax)}.`}
          />
        </button>
      </div>

      {/* Les 6 ressources productibles (cap de stockage partagé) */}
      <div className="grid grid-cols-2 justify-items-center gap-x-2 sm:grid-cols-3">
        {capped.map((res) => (
          <button key={res} className="flex items-center gap-1" onClick={() => setInfo(res)}>
            {icon(res)}
            <ResourceBar
              value={resources[res]}
              max={cap}
              color={COLORS[res]}
              width={130}
              label={fmtInt(resources[res])}
              title={`${resourceName(res)} : ${fmtInt(resources[res])} / ${fmtInt(cap)} (stockage) — production ${fmtRate(prod[res] ?? 0)}/h`}
            />
          </button>
        ))}
      </div>

      {info && <ResourceInfoModal id={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
