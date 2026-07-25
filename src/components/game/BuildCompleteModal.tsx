/* Célébration de fin de chantier (piste 5 du diagnostic UX).

   Pourquoi : un chantier de 40 heures se terminait en silence — la barre
   disparaissait, le sprite changeait, et c'était tout. Or c'est LE moment de
   récompense le plus rare et le plus mérité du jeu. On lui donne enfin une
   scène : sprite en grand, ce que ça change concrètement (production, plafond,
   mue à venir), vibration, et une sortie en un tap.

   Le burst de particules sur la scène est géré par CellScene (il détecte le
   changement de niveau lui-même) — ici on s'occupe du récit. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { NotifOptIn } from "@/components/game/NotifOptIn";
import {
  buildingProductionPerHour,
  getBuildingConfig,
  maxLevel,
  recommendNextBuild,
  resourceName,
  storageCap,
} from "@/lib/game/economy";
import { fmtInt, fmtRate } from "@/lib/game/format";
import { envelopeStage, SOCKETS, STAGE_MIN_BUILT, builtCount } from "@/lib/game/scene";
import { useOverlay } from "@/lib/overlay";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import { playCue } from "@/lib/audio";
import type { BuildingId, ResourceId } from "@/lib/game/types";

/** `onNext` ouvre la fiche du chantier suivant recommandé : c'est le point clé de
 *  la piste 5 du diagnostic — transformer une FIN de session en DÉBUT de session.
 *  Sans ce bouton, le joueur ferme la modale et referme souvent l'app derrière. */
export function BuildCompleteModal({ onNext }: { onNext?: (id: BuildingId) => void }) {
  const celebrations = useGame((s) => s.buildCelebrations);
  const dismiss = useGame((s) => s.dismissBuildCelebration);
  const buildings = useGame((s) => s.buildings);
  const resources = useGame((s) => s.resources);
  const queue = useGame((s) => s.buildQueue);
  const done = celebrations[0] ?? null;

  useOverlay(done !== null, dismiss);

  // Une seule vibration par chantier célébré (le motif "réussite" : long-court-long).
  useEffect(() => {
    if (done) {
      vibrate([28, 60, 18, 40, 44]);
      // Le repère sonore de la piste 8 : c'est la récompense la plus rare et la
      // plus méritée du jeu, c'est donc elle qui a droit à la floraison complète.
      playCue("build_done");
    }
  }, [done]);

  if (!done) return null;

  const cfg = getBuildingConfig(done.buildingId);
  const accent = SOCKETS[done.buildingId].accent;
  const level = done.targetLevel;
  const sprite = `/assets/buildings/${done.buildingId}/niveau${Math.max(1, level)}.png`;

  // Gain de production apporté par CE niveau (avant → après).
  const before = buildingProductionPerHour(done.buildingId, level - 1);
  const after = buildingProductionPerHour(done.buildingId, level);
  const deltas = (Object.entries(after) as [ResourceId, number][])
    .map(([res, v]) => [res, v - (before[res] ?? 0)] as [ResourceId, number])
    .filter(([, d]) => d > 0);

  // Le plafond de stockage dépend du Noyau et de la Biomasse : on le dit.
  const capChanged = done.buildingId === "noyau" || done.buildingId === "biomasse";

  // Première construction d'un organe ⇒ on est peut-être à une mue près.
  const built = builtCount(buildings);
  const stage = envelopeStage(buildings);
  const nextStageAt = STAGE_MIN_BUILT[stage] ?? null;
  const organsToMolt = nextStageAt !== null ? nextStageAt - built : null;

  // Chantier suivant conseillé. On exclut celui qu'on vient de finir : enchaîner
  // deux fois le même organe est rarement le meilleur coup, et surtout ça donne
  // l'impression d'un jeu qui tourne en rond.
  const next = onNext ? recommendNextBuild(buildings, resources, queue, done.buildingId) : null;
  const nextCfg = next ? getBuildingConfig(next.id) : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
      onClick={dismiss}
    >
      <div className="w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
        <Panel
          variant="noyau"
          className="w-full p-4 text-center"
          style={{ background: "rgba(5, 11, 20, 0.97)" }}
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-cell-lime">
            Chantier achevé
          </div>

          <div className="relative mx-auto mt-2 h-28 w-28">
            {/* Halo pulsant derrière le sprite */}
            <div
              className="absolute inset-0 animate-pulse rounded-full blur-xl"
              style={{ background: accent, opacity: 0.35 }}
            />
            <img
              src={sprite}
              alt={cfg.name}
              className="pixelated relative h-full w-full animate-sheet-up"
              draggable={false}
            />
          </div>

          <div className="mt-1 text-base tracking-wide" style={{ color: accent }}>
            {cfg.name}
          </div>
          <div className="text-[11px] text-cell-teal/70">
            Niveau {level}/{maxLevel(done.buildingId)}
            {level >= maxLevel(done.buildingId) && " — forme finale ✦"}
          </div>

          {deltas.length > 0 && (
            <div className="mt-3 space-y-0.5">
              {deltas.map(([res, d]) => (
                <div key={res} className="text-[11px] text-cell-lime">
                  +{fmtRate(d)}/h {resourceName(res)}
                </div>
              ))}
            </div>
          )}

          {capChanged && (
            <div className="mt-2 text-[11px] text-cell-cyan">
              Stockage porté à {fmtInt(storageCap(buildings))}
            </div>
          )}

          {organsToMolt !== null && organsToMolt > 0 && organsToMolt <= 2 && (
            <div className="mt-2 text-[10px] text-cell-magenta">
              Encore {organsToMolt} proto-organe{organsToMolt > 1 ? "s" : ""} avant la prochaine mue
            </div>
          )}

          {next && nextCfg ? (
            <>
              <div className="mt-4 text-[10px] uppercase tracking-[0.25em] text-cell-teal/45">
                Et ensuite ?
              </div>
              <div className="text-[11px] text-cell-teal/80">
                {nextCfg.name} Nv&nbsp;{next.level}
                {!next.affordable && (
                  <span className="text-cell-teal/45"> — ressources en cours</span>
                )}
              </div>
              <PixelButton
                className="mt-2 w-full text-xs"
                onClick={() => {
                  dismiss();
                  onNext?.(next.id);
                }}
              >
                ENCHAÎNER →
              </PixelButton>
              <button
                onClick={dismiss}
                className="mt-2 w-full text-[10px] tracking-[0.25em] text-cell-teal/45 hover:text-cell-teal"
              >
                PLUS TARD
              </button>
            </>
          ) : (
            <PixelButton className="mt-4 w-full text-xs" onClick={dismiss}>
              SUPERBE
            </PixelButton>
          )}

          {/* Rappels (piste 2) : le diagnostic demande la permission ICI et pas
              ailleurs — « juste après la première fin de chantier, quand le
              joueur vient de comprendre ce qu'il rate ». Placé SOUS les boutons
              pour ne pas disputer l'écran à l'action principale ; le composant
              ne rend rien tant que le moment n'est pas venu. */}
          <NotifOptIn />
        </Panel>
      </div>
    </div>
  );
}
