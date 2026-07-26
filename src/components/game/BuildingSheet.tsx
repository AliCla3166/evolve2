/* Panneau d'amélioration d'un bâtiment (Phase 3) — bottom sheet mobile-first,
   ouvert au tap sur un bâtiment de la scène. Remplace l'ancienne liste :
   niveau, production actuelle → prochaine, coûts (payable ou non), temps,
   bouton AMÉLIORER/CONSTRUIRE ; états chantier / verrouillé / niveau max. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { BoostButton } from "@/components/game/BoostButton";
import { PostesSection } from "@/components/game/PostesSection";
import { Panel, PixelButton, ResourceBar } from "@/components/ui/Pixel";
import { buildingPurpose } from "@/lib/game/buildingInfo";
import {
  buildingProductionPerHour,
  buildTimeHours,
  canAfford,
  effectiveBuildTimeMs,
  findFreeSlot,
  getBuildingConfig,
  isDesigned,
  isScriptedFirstBuild,
  levelCost,
  maxLevel,
  resourceName,
  unlockedSlotCount,
} from "@/lib/game/economy";
import { fmtDuration, fmtInt, fmtRate } from "@/lib/game/format";
import { SOCKETS } from "@/lib/game/scene";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import { playCue } from "@/lib/audio";
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

/* Bâtiments dont la fiche ouvre un écran à part entière. Le LIBELLÉ vit ici, au
   plus près du bouton ; la page ne fournit que l'action.

   - "defense" : filet de sécurité. Son socle est un PORTAIL (cf. scene.ts), donc
     un tap l'ouvre déjà sans passer par cette fiche.
   - "noyau" : sa PORTE PRINCIPALE. Depuis que LA DÉRIVE a pris sa place dans la
     barre de navigation (cf. docs/PLAN_DERIVE.md §3.7), le Noyau ne s'atteint
     plus que par son socle — le bouton doit donc être le premier élément lisible
     de la fiche, pas une option perdue en bas. */
const SHEET_ACTION: Partial<Record<BuildingId, string>> = {
  defense: "⚔️ JOUER",
  noyau: "🧬 OUVRIR LE NOYAU — recrutement & expéditions",
};

export function BuildingSheet({
  id,
  onClose,
  onPlay,
}: {
  id: BuildingId;
  onClose: () => void;
  /** Ouvre l'écran associé à ce bâtiment (cf. `SHEET_ACTION`). */
  onPlay?: () => void;
}) {
  const resources = useGame((s) => s.resources);
  const buildings = useGame((s) => s.buildings);
  const queue = useGame((s) => s.buildQueue);
  const tutorialStep = useGame((s) => s.tutorialStep);
  const startUpgrade = useGame((s) => s.startUpgrade);
  // "now" du rendu = dernier tick appliqué (pas de Date.now() en rendu).
  const now = useGame((s) => s.lastTick);

  const cfg = getBuildingConfig(id);
  const designed = isDesigned(id);
  const level = buildings[id] ?? 0;
  const max = maxLevel(id);
  const accent = SOCKETS[id].accent;
  const sprite = `/assets/buildings/${id}/niveau${Math.max(1, level)}.png`;

  const task = queue.find((t) => t.buildingId === id) ?? null;
  const inConstruction = task !== null;
  const maxed = designed && level >= max;
  const nextLevel = level + 1;
  const cost = designed && !maxed ? levelCost(id, nextLevel) : null;
  const affordable = cost !== null && canAfford(resources, cost);
  // File multi-slots (v8) : on cherche un slot LIBRE et COMPATIBLE avec la durée
  // du chantier (les slots auxiliaires refusent les gros chantiers, cf. build_slots).
  const nextHours = designed && !maxed ? buildTimeHours(id, nextLevel) : 0;
  const freeSlot = designed && !maxed ? findFreeSlot(buildings, queue, nextHours) : -1;
  const queueBusy = freeSlot < 0;
  // Distinguer "tous les slots occupés" de "aucun slot n'accepte un chantier si long".
  const anySlotFree = queue.length < unlockedSlotCount(buildings);
  const prod = buildingProductionPerHour(id, level);
  const nextProd = designed && !maxed ? buildingProductionPerHour(id, nextLevel) : {};
  /* Le devis affiché est la durée EFFECTIVE : sur une partie neuve, le premier
     chantier est scripté à quelques minutes (economy_config.json -> tutorial), et
     annoncer 1 h 51 pour un chantier qui en durera 4 serait un mensonge. */
  const sheetState = { tutorialStep, buildings, buildQueue: queue };
  const scripted = isScriptedFirstBuild(sheetState);
  const nextDurationMs = designed && !maxed ? effectiveBuildTimeMs(sheetState, id, nextLevel) : 0;

  return (
    <>
      {/* Voile de fermeture */}
      <div className="fixed inset-0 z-20 bg-black/50" onClick={onClose} />

      {/* z-50 (comme le SlotInspector du Bastion) : la nav basse fixe est en z-40 et
          intercepterait sinon les taps sur le bouton d'action, tout en bas de la sheet. */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md animate-sheet-up px-2 pb-2 sm:max-w-lg">
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
              ) : id === "defense" ? (
                <div className="text-[11px] text-cell-lime/80">Mini-jeu jouable — économie séparée</div>
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

          {/* À quoi ça sert — en gros, avant les chiffres (retour lisibilité) */}
          <p
            className="mt-2 rounded-lg border-l-4 bg-black/20 px-2.5 py-2 text-[12px] leading-relaxed text-white/90"
            style={{ borderColor: accent }}
          >
            {buildingPurpose(id)}
          </p>

          {/* Porte vers l'écran du bâtiment (Bastion jouable, hub du Noyau) */}
          {onPlay && SHEET_ACTION[id] && (
            <div className="mt-2">
              <PixelButton className="w-full text-xs" onClick={onPlay}>
                {SHEET_ACTION[id]}
              </PixelButton>
            </div>
          )}

          {/* Corps selon l'état */}
          {!designed ? null : (
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

              {/* Les ouvrières postées dans cet organe. La section se masque d'elle-même
                  si l'organe ne produit rien ou n'est pas encore bâti — elle est placée
                  juste sous la production parce qu'elle en est la suite immédiate : ce
                  qu'on lit au-dessus, c'est le débit nu ; ici, qui le fait monter. */}
              <PostesSection id={id} />

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
                  {/* L'énergie gagnée sur les habitudes rachète du temps (piste 4). */}
                  <BoostButton task={task} size="sheet" />
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
                        ⏱ {fmtDuration(nextDurationMs)}
                        {scripted && (
                          <span className="text-cell-lime"> — premier chantier accéléré ✦</span>
                        )}
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
                          if (startUpgrade(id)) {
                            vibrate(20);
                            playCue("build_start");
                            /* Pendant le tutoriel, la fiche se referme d'elle-même : l'étape
                               suivante du coach (et son bouton « COMPRIS ») vit derrière le
                               voile z-20 de cette sheet — le laisser ouvert, c'était cacher
                               le tutoriel derrière la fiche qu'il venait de faire ouvrir. */
                            if (scripted) onClose();
                          }
                        }}
                      >
                        {level === 0 ? "CONSTRUIRE" : "AMÉLIORER"}
                      </PixelButton>
                    </div>
                    {queueBusy && !inConstruction && (
                      <p className="text-center text-[11px] text-cell-teal/50">
                        {anySlotFree
                          ? "Chantier trop long pour un slot auxiliaire — libère le chantier principal."
                          : "Tous les chantiers sont occupés."}
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
