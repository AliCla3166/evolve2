/* Bandeau d'objectifs + tableau (jalons & objectifs du jour).

   HISTOIRE DU COMPOSANT. Né avec la piste 3 du diagnostic UX (« passé l'étape 3
   du micro-tutoriel, le joueur n'avait plus AUCUN objectif affiché »), il ne
   montrait alors qu'UNE chose à la fois. Le retour complet du 26/07 a mesuré la
   limite de ce choix : 22 jalons pour 90 jours et un seul affiché, c'est cacher
   95 % de l'horizon (amélioration n°3). Balatro montre trois blinds côte à côte,
   avec cible et récompense — le joueur ne subit pas un parcours, il en choisit un.

   Le bandeau porte donc TROIS emplacements, toujours les mêmes :
     1. AUJOURD'HUI — l'objectif du jour le plus avancé (daily.ts, n°2) ;
     2. JALON — le jalon d'Âge en cours (focusMilestone, règle inchangée) ;
     3. PROCHAIN — le prochain déblocage (progression.nextUnlock, le
        « nouveau héros à la vague 30 » de Grow Castle).

   Un tap ouvre le tableau complet : objectifs du jour réclamables, puis les
   jalons et l'horizon chiffré des Points d'Âge.

   Zéro valeur d'équilibrage ici : tout vient de daily_config.json,
   milestones_config.json et progression_config.json. Ce fichier ne fait que
   dessiner. */
"use client";

import { useState } from "react";
import { Panel, PixelButton, ResourceBar } from "@/components/ui/Pixel";
import { resourceName } from "@/lib/game/economy";
import { fmtInt } from "@/lib/game/format";
import {
  dailyClaimedCount,
  dailyViews,
  DAILY_CFG,
  focusDaily,
  type DailyObjectiveView,
} from "@/lib/game/daily";
import {
  agePoints,
  allMilestones,
  claimableCount,
  focusMilestone,
  isResourceReward,
  rewardLabel,
  TOTAL_AGE_POINTS,
  type MilestoneConfig,
  type MilestoneView,
} from "@/lib/game/milestones";
import { nextUnlock } from "@/lib/game/progression";
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

/** Une cellule du bandeau : icône, libellé, et SOIT une mini-jauge, SOIT le
 *  bouton d'encaissement. Trois par rangée sur un écran de 320 px : chaque
 *  caractère compte — la jauge dit l'essentiel, le tableau dit le reste. */
function StripCell({
  header,
  icon,
  label,
  current,
  target,
  color,
  claimable,
  onClaim,
}: {
  header: string;
  icon: string;
  label: string;
  current?: number;
  target?: number;
  color: string;
  claimable?: boolean;
  onClaim?: () => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[8px] uppercase tracking-[0.18em] text-cell-teal/45">
        {header}
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <span className="shrink-0 text-[11px] leading-none" aria-hidden>
          {icon}
        </span>
        <span className="truncate text-[10px] leading-tight text-cell-cyan">{label}</span>
      </div>
      {claimable && onClaim ? (
        <button
          onClick={(e) => {
            // Sans stopPropagation, encaisser ouvrirait aussi le tableau et
            // masquerait la récompense qu'on vient de gagner.
            e.stopPropagation();
            onClaim();
          }}
          className="mt-1 w-full animate-pulse rounded border border-cell-lime/60 px-1 py-0.5 text-[9px] text-cell-lime hover:bg-cell-lime/10 active:bg-cell-lime/20"
        >
          RÉCLAMER ✦
        </button>
      ) : current !== undefined && target !== undefined ? (
        <div className="mt-1 flex items-center gap-1">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-cell-teal/15">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.min(100, (current / Math.max(1, target)) * 100)}%`,
                background: color,
              }}
            />
          </div>
          <span className="shrink-0 text-[8px] tabular-nums text-cell-teal/55">
            {fmtInt(Math.min(current, target))}/{fmtInt(target)}
          </span>
        </div>
      ) : (
        <div className="mt-1 text-[8px] text-cell-teal/45">—</div>
      )}
    </div>
  );
}

/** Le bandeau permanent, monté sous le HUD dans /play. */
export function ObjectiveStrip() {
  // Lecture de l'état ENTIER : jalons et objectifs du jour sont des fonctions
  // pures de tout le GameState — on ne peut pas s'abonner à trois champs.
  // L'objet du store est stable entre deux `set`, donc ce sélecteur ne provoque
  // pas de boucle ; le re-rendu suit le tick, exactement comme QueueBanner.
  const state = useGame((s) => s);
  const claimMilestone = useGame((s) => s.claimMilestone);
  const claimDailyObjective = useGame((s) => s.claimDailyObjective);
  const [open, setOpen] = useState(false);
  const now = state.lastTick;

  const daily = focusDaily(state, now);
  const dailyDone = dailyClaimedCount(state, now);
  const focus = focusMilestone(state);
  const unlock = nextUnlock(state);
  const pa = agePoints(state);

  const onClaimMilestone = (id: string) => {
    if (claimMilestone(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };
  const onClaimDaily = (id: string) => {
    if (claimDailyObjective(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-pointer">
        <Panel variant="tooltip" className="px-2 py-1.5">
          <div className="flex items-stretch gap-2">
            <StripCell
              header={`Aujourd'hui ${dailyDone}/${DAILY_CFG.count_per_day}`}
              icon={daily ? daily.cfg.icon : "☀️"}
              label={daily ? daily.cfg.label : "Tout est encaissé"}
              current={daily && !daily.achieved ? daily.current : undefined}
              target={daily && !daily.achieved ? daily.target : undefined}
              color="var(--cyan)"
              claimable={!!daily?.achieved && !daily?.claimed}
              onClaim={daily ? () => onClaimDaily(daily.cfg.id) : undefined}
            />
            <div className="w-px shrink-0 bg-cell-teal/15" />
            <StripCell
              header={`Jalon · ${fmtInt(pa)} PA`}
              icon={focus ? CATEGORY_ICON[focus.cfg.category] : "✦"}
              label={focus ? focus.cfg.label : "Âge 1 accompli"}
              current={focus && !focus.achieved ? focus.current : undefined}
              target={focus && !focus.achieved ? focus.target : undefined}
              color={focus ? CATEGORY_COLOR[focus.cfg.category] : "var(--magenta)"}
              claimable={!!focus?.achieved}
              onClaim={focus ? () => onClaimMilestone(focus.cfg.id) : undefined}
            />
            <div className="w-px shrink-0 bg-cell-teal/15" />
            <StripCell
              header="Prochain"
              icon={unlock ? unlock.icon : "✔"}
              label={unlock ? unlock.label : "Tout est ouvert"}
              current={unlock ? unlock.current : undefined}
              target={unlock ? unlock.target : undefined}
              color="var(--magenta)"
            />
          </div>
        </Panel>
      </div>

      {open && <MilestonesPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

/** Une carte d'objectif du jour dans le tableau complet. */
function DailyCard({ v, onClaim }: { v: DailyObjectiveView; onClaim: (id: string) => void }) {
  const claimable = v.achieved && !v.claimed;
  return (
    <Panel variant="membrane" className={`p-2 ${v.claimed ? "opacity-45" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 pt-0.5 text-sm" aria-hidden>
          {v.cfg.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12px] text-cell-cyan">{v.cfg.label}</span>
            <span className="ml-auto shrink-0 text-[9px] text-cell-teal/45">aujourd&apos;hui</span>
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-cell-teal/60">{v.cfg.hint}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <ResourceBar
              value={v.current}
              max={Math.max(1, v.target)}
              color="var(--cyan)"
              width={130}
              label={`${fmtInt(Math.min(v.current, v.target))} / ${fmtInt(v.target)}`}
            />
            <span className={`text-[10px] ${claimable ? "text-cell-lime" : "text-cell-teal/50"}`}>
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
}

/** Tableau complet : les objectifs du jour, puis les jalons — l'horizon chiffré
 *  de l'Âge 1. */
function MilestonesPanel({ onClose }: { onClose: () => void }) {
  const state = useGame((s) => s);
  const claimMilestone = useGame((s) => s.claimMilestone);
  const claimDailyObjective = useGame((s) => s.claimDailyObjective);
  const now = state.lastTick;

  const dailies = dailyViews(state, now);
  const views = allMilestones(state);
  const pa = agePoints(state);
  const done = views.filter((v) => v.claimed).length;
  const ready = claimableCount(state);

  const onClaim = (id: string) => {
    if (claimMilestone(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };
  const onClaimDaily = (id: string) => {
    if (claimDailyObjective(id)) {
      vibrate([12, 40, 12, 40, 30]);
      playCue("collect");
    }
  };

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-2 pb-nav pt-safe px-2 sm:max-w-2xl">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-base uppercase tracking-[0.3em] text-cell-cyan">Objectifs</h1>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan"
          >
            ✕
          </button>
        </div>

        {/* ----- Les objectifs du jour (amélioration n°2) : tirés chaque jour du
            pool (daily_config.json), réclamables d'un tap, jamais punitifs — un
            objectif raté disparaît à minuit, c'est tout. ----- */}
        <div className="flex items-baseline justify-between px-1">
          <span className="text-[10px] uppercase tracking-[0.25em] text-cell-cyan/70">
            Objectifs du jour
          </span>
          <span className="text-[9px] text-cell-teal/50">
            trois nouveaux chaque jour à minuit
          </span>
        </div>
        {dailies.map((v) => (
          <DailyCard key={v.cfg.id} v={v} onClaim={onClaimDaily} />
        ))}

        {/* ----- Les jalons de l'Âge ----- */}
        <div className="flex items-baseline justify-between px-1 pt-2">
          <span className="text-[10px] uppercase tracking-[0.25em] text-cell-cyan/70">
            Jalons de l&apos;Âge 1
          </span>
          {ready > 0 && <span className="text-[9px] text-cell-lime">{ready} à réclamer</span>}
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
          {/* Une barre honnête vaut mieux qu'une barre flatteuse (amélioration n°5) :
              on dit aussi ce qu'il RESTE, pas seulement le total. Depuis que serie_90
              est descendu à 60 jours, chaque point est réellement atteignable. */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-cell-teal/60">
            Encore {fmtInt(TOTAL_AGE_POINTS - pa)} PA à encaisser. L&apos;Âge 1 s&apos;achève
            quand tous les jalons sont réclamés — chaque jalon se déclenche tout seul, il
            n&apos;y a rien à activer, seulement à encaisser.
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
