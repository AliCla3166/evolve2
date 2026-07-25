/* Bandeau d'objectif + tableau des jalons (piste 3 du diagnostic UX,
   dette PLAN.md §5.8).

   Le problème réglé : passé l'étape 3 du micro-tutoriel, le joueur n'avait plus
   AUCUN objectif affiché. Il produisait des ressources sans savoir vers quoi, et
   les mues de membrane — la plus belle animation du projet — le surprenaient au
   lieu d'être désirées. Un jeu de gestion long tient sur la question « et
   après ? » : il faut qu'elle ait toujours une réponse visible à l'écran.

   Le bandeau est donc PERMANENT, juste sous le HUD, et ne montre jamais plus
   d'une chose à la fois : le prochain jalon atteignable, ou — priorité absolue —
   un jalon atteint qu'il reste à encaisser. Un tap ouvre le tableau complet, qui
   sert d'horizon chiffré de l'Âge 1 (les Points d'Âge).

   Zéro valeur d'équilibrage ici : tout vient de milestones_config.json via
   milestones.ts. Ce fichier ne fait que dessiner. */
"use client";

import { useState } from "react";
import { Panel, PixelButton, ResourceBar } from "@/components/ui/Pixel";
import { resourceName } from "@/lib/game/economy";
import { fmtInt } from "@/lib/game/format";
import {
  agePoints,
  allMilestones,
  claimableCount,
  focusMilestone,
  isResourceReward,
  NEAR_RATIO,
  rewardLabel,
  TOTAL_AGE_POINTS,
  type MilestoneConfig,
  type MilestoneView,
} from "@/lib/game/milestones";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import { playCue } from "@/lib/audio";
import type { ResourceId } from "@/lib/game/types";

/* Habillage purement visuel — aucune règle de jeu ne dépend de ces tables. */
const CATEGORY_ICON: Record<MilestoneConfig["category"], string> = {
  croissance: "🧬",
  collection: "🐟",
  discipline: "🔥",
  expansion: "🧭",
  defense: "⚔️",
  ascension: "✦",
};

const CATEGORY_LABEL: Record<MilestoneConfig["category"], string> = {
  croissance: "Croissance",
  collection: "Collection",
  discipline: "Discipline",
  expansion: "Expansion",
  defense: "Défense",
  ascension: "Ascension",
};

const CATEGORY_COLOR: Record<MilestoneConfig["category"], string> = {
  croissance: "var(--lime)",
  collection: "var(--cyan)",
  discipline: "var(--lime)",
  expansion: "var(--cyan)",
  defense: "var(--magenta)",
  ascension: "var(--magenta)",
};

/** « 4/8 », mais « Nv 2 / Nv 3 » quand la métrique est un niveau : sans ça, un
 *  jalon « tout Nv3 » s'affichait « 2/3 » et se lisait comme 2 bâtiments sur 3. */
function progressText(v: MilestoneView): string {
  const isLevel = v.cfg.metric === "min_building_level" || v.cfg.metric === "building_level";
  return isLevel ? `Nv ${v.current} / Nv ${v.target}` : `${fmtInt(v.current)} / ${fmtInt(v.target)}`;
}

/** Récompense en clair : « +120 ADN », « +2 jeton(s) de pêche ». */
function rewardText(reward: Record<string, number>): string {
  return Object.entries(reward)
    .map(([key, amount]) => {
      const name = isResourceReward(key) ? resourceName(key as ResourceId) : rewardLabel(key);
      return `+${fmtInt(amount)} ${name}`;
    })
    .join(" · ");
}

/* ------------------------------------------------------------------ */

/** Le bandeau permanent, monté sous le HUD dans /play. */
export function ObjectiveStrip() {
  // Lecture de l'état ENTIER : un jalon est une fonction pure de tout le
  // GameState (bâtiments, collection, série, vagues…), on ne peut pas
  // s'abonner à trois champs. L'objet du store est stable entre deux `set`,
  // donc ce sélecteur ne provoque pas de boucle ; le re-rendu suit le tick,
  // exactement comme QueueBanner.
  const state = useGame((s) => s);
  const claimMilestone = useGame((s) => s.claimMilestone);
  const [open, setOpen] = useState(false);

  const focus = focusMilestone(state);
  const ready = claimableCount(state);
  const pa = agePoints(state);

  const onClaim = (id: string) => {
    if (claimMilestone(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-pointer">
        <Panel variant="tooltip" className="px-3 py-1.5">
          {focus === null ? (
            /* Tout est encaissé : l'Âge 1 n'a plus de dette à réclamer. */
            <div className="flex items-center justify-center gap-2 text-[11px] text-cell-magenta">
              ✦ Âge 1 accompli — {fmtInt(pa)} points d&apos;Âge
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm" aria-hidden>
                {CATEGORY_ICON[focus.cfg.category]}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[11px] text-cell-cyan">{focus.cfg.label}</span>
                  <span className="ml-auto shrink-0 text-[9px] text-cell-teal/50">
                    {fmtInt(pa)}/{fmtInt(TOTAL_AGE_POINTS)} PA
                  </span>
                </div>

                {focus.achieved ? (
                  <div className="text-[9px] text-cell-lime">
                    Objectif atteint — {rewardText(focus.cfg.reward)}
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-2">
                    <ResourceBar
                      value={focus.current}
                      max={Math.max(1, focus.target)}
                      color={CATEGORY_COLOR[focus.cfg.category]}
                      width={110}
                      label={progressText(focus)}
                      title={focus.cfg.hint}
                    />
                    <span className="truncate text-[9px] text-cell-teal/50">
                      {focus.ratio >= NEAR_RATIO ? "Tu y es presque." : focus.cfg.hint}
                    </span>
                  </div>
                )}
              </div>

              {focus.achieved ? (
                <button
                  onClick={(e) => {
                    // Sans stopPropagation, encaisser ouvrirait aussi le tableau
                    // et masquerait la récompense qu'on vient de gagner.
                    e.stopPropagation();
                    onClaim(focus.cfg.id);
                  }}
                  className="shrink-0 animate-pulse rounded border border-cell-lime/60 px-2 py-1 text-[10px] text-cell-lime hover:bg-cell-lime/10 active:bg-cell-lime/20"
                >
                  RÉCLAMER ✦
                </button>
              ) : ready > 1 ? (
                <span className="shrink-0 text-[9px] text-cell-lime/70">+{ready - 1}</span>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      {open && <MilestonesPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Tableau complet des jalons — l'horizon chiffré de l'Âge 1. */
function MilestonesPanel({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s);
  const claimMilestone = useGame((s) => s.claimMilestone);

  const views = allMilestones(state);
  const pa = agePoints(state);
  const done = views.filter((v) => v.claimed).length;

  const onClaim = (id: string) => {
    if (claimMilestone(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-2 pb-nav pt-safe px-2 sm:max-w-2xl">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-base uppercase tracking-[0.3em] text-cell-cyan">Jalons</h1>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan"
          >
            ✕
          </button>
        </div>

        {/* Compteur global : la seule mesure honnête de « où j'en suis » dans l'Âge 1. */}
        <Panel variant="noyau" className="p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
              Points d&apos;Âge
            </span>
            <span className="ml-auto text-sm text-cell-magenta">
              {fmtInt(pa)} <span className="text-[10px] text-cell-teal/50">/ {fmtInt(TOTAL_AGE_POINTS)}</span>
            </span>
          </div>
          {/* Barre pleine largeur : ResourceBar est calibrée en px fixes, ce qui
              déborderait de la colonne mobile. */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-cell-teal/15">
              <div
                className="h-full rounded-full bg-cell-magenta transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.min(100, (pa / Math.max(1, TOTAL_AGE_POINTS)) * 100)}%`,
                }}
              />
            </div>
            <span className="shrink-0 text-[9px] text-cell-teal/50">
              {done}/{views.length} jalons
            </span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-cell-teal/60">
            L&apos;Âge 1 s&apos;achève quand tous les jalons sont réclamés. Chaque
            jalon se déclenche tout seul — il n&apos;y a rien à activer, seulement
            à encaisser.
          </p>
        </Panel>

        {views.map((v) => {
          const claimable = v.achieved && !v.claimed;
          return (
            <Panel
              key={v.cfg.id}
              variant="membrane"
              className={`p-2 ${v.claimed ? "opacity-45" : ""}`}
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 pt-0.5 text-sm" aria-hidden>
                  {CATEGORY_ICON[v.cfg.category]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[12px] text-cell-cyan">{v.cfg.label}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-cell-teal/45">
                      {CATEGORY_LABEL[v.cfg.category]} · {v.cfg.age_points} PA
                    </span>
                  </div>

                  <p className="mt-0.5 text-[10px] leading-snug text-cell-teal/60">{v.cfg.hint}</p>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ResourceBar
                      value={v.current}
                      max={Math.max(1, v.target)}
                      color={CATEGORY_COLOR[v.cfg.category]}
                      width={130}
                      label={progressText(v)}
                    />
                    <span
                      className={`text-[10px] ${claimable ? "text-cell-lime" : "text-cell-teal/50"}`}
                    >
                      {rewardText(v.cfg.reward)}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 self-center">
                  {v.claimed ? (
                    <span className="text-[10px] tracking-widest text-cell-magenta">✓ REÇU</span>
                  ) : claimable ? (
                    <PixelButton className="text-[10px]" onClick={() => onClaim(v.cfg.id)}>
                      RÉCLAMER
                    </PixelButton>
                  ) : null}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
