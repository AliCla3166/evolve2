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
import { dayKey, ENERGY_CAP, nextStreakTier } from "@/lib/game/habits";
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
  combat: "#ffcf4d",
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

/** Badge de série, visible en permanence (piste 6 du diagnostic).
 *
 *  La série était jusqu'ici enterrée dans le panneau Habitudes : le joueur ne la
 *  voyait qu'en allant la chercher, donc elle ne pesait rien dans sa décision
 *  d'ouvrir le jeu. Ici elle est sous les yeux à chaque session, et surtout elle
 *  change de couleur quand la journée n'est pas encore saisie — c'est ce rappel
 *  ambré, et pas le total d'énergie, qui ramène le joueur le soir. */
function StreakChip({ onOpen }: { onOpen?: () => void }) {
  const habits = useGame((s) => s.habits);
  // "now" du rendu = dernier tick (1 s) : suit minuit sans Date.now() en rendu.
  const now = useGame((s) => s.lastTick);

  const key = dayKey(now);
  const todayOk = (habits.days[key]?.validatedCount ?? 0) > 0;
  const streak = habits.streak;
  const next = nextStreakTier(streak);

  const nextLabel = next
    ? `Prochain palier : ${next.days} j → +${next.energy} ⚡ (encore ${next.days - streak} j)`
    : "Tous les paliers de série sont atteints.";

  let cls: string;
  let text: string;
  let title: string;
  if (streak === 0 && !todayOk) {
    cls = "border-cell-teal/30 text-cell-teal/60";
    text = "🔥 Démarrer";
    title = `Aucune série en cours. Valide une habitude aujourd'hui pour la lancer. ${nextLabel}`;
  } else if (!todayOk) {
    cls = "animate-pulse border-amber-400/60 bg-amber-400/10 text-amber-300";
    text = `🔥 ${streak} j · à saisir`;
    title = `Série de ${streak} j — pas encore saisie aujourd'hui, elle tombe à minuit. ${nextLabel}`;
  } else {
    cls = "border-cell-lime/50 bg-cell-lime/10 text-cell-lime";
    text = `🔥 ${streak} j`;
    title = `Série de ${streak} j, journée validée. ${nextLabel}`;
  }

  return (
    <button
      onClick={onOpen}
      title={title}
      aria-label={title}
      className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wide transition active:translate-y-px ${cls}`}
    >
      {text}
    </button>
  );
}

export function Hud({ onOpenHabits }: { onOpenHabits?: () => void }) {
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
        <StreakChip onOpen={onOpenHabits} />
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
