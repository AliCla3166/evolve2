/* « L'énergie achète du temps » (piste 4 du diagnostic UX, dette PLAN.md §5.4).

   Pourquoi : l'énergie vient des habitudes RÉELLES du joueur (calories, pas,
   rituels…). Jusqu'ici elle n'ouvrait que la pêche — un système latéral. Elle
   n'avait aucune prise sur le seul vrai frein du jeu : le timer de chantier.
   Une journée impeccable devait pouvoir se voir sur la barre de progression le
   soir même. C'est ce que fait ce bouton.

   Le garde-fou est dans la config, pas ici : `energy_boost.max_ratio_per_task`
   plafonne le rachat à 25 % de la durée d'origine, et le coût monte au fur et à
   mesure qu'on entame ce quota. Un joueur discipliné accélère, il ne saute pas
   l'Âge 1 — le simulateur Phase 7 mesure ~39 h rachetées sur 90 jours (1,6 % du
   budget de chantier) pour l'archétype régulier.

   Deux tailles : "banner" (compact, file de construction) et "sheet" (détaillé
   avec la jauge de quota, dans la fiche du bâtiment). */
"use client";

import { boostQuote } from "@/lib/game/economy";
import { fmtDurationShort, fmtInt } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import { playCue } from "@/lib/audio";
import type { BuildTask } from "@/lib/game/types";

export function BoostButton({
  task,
  size = "banner",
}: {
  task: BuildTask;
  size?: "banner" | "sheet";
}) {
  // "now" du rendu = dernier tick appliqué (lecture pure, jamais Date.now() ici).
  const now = useGame((s) => s.lastTick);
  const energie = useGame((s) => s.resources.energie);
  const boostBuild = useGame((s) => s.boostBuild);

  const quote = boostQuote(task, now);
  // Quota épuisé (ou chantier trop court pour un pas utile) : on retire le
  // bouton plutôt que de le laisser grisé — un bouton mort qui reste affiché
  // se lit comme un bug, pas comme une limite de design.
  if (!quote) return null;

  const affordable = energie >= quote.cost;
  const usedPct = Math.round((quote.usedMs / quote.allowanceMs) * 100);
  const title =
    `Rachète ${fmtDurationShort(quote.ms)} de chantier pour ${quote.cost} ⚡ ` +
    `(tu as ${fmtInt(energie)} ⚡). Quota utilisé : ${usedPct} % — ` +
    `un chantier ne peut être raccourci que de 25 % au total.`;

  const onClick = () => {
    // vibrate() ne se déclenche que si l'action a réellement abouti : le store
    // revalide le devis avec l'horloge réelle et peut refuser (chantier échu).
    if (boostBuild(task.slot)) {
      vibrate([10, 30, 22]);
      playCue("build_start");
    }
  };

  if (size === "banner") {
    return (
      <button
        onClick={onClick}
        disabled={!affordable}
        title={title}
        aria-label={title}
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-tight transition-colors ${
          affordable
            ? "border-cell-lime/50 text-cell-lime hover:bg-cell-lime/10 active:bg-cell-lime/20"
            : "border-cell-teal/20 text-cell-teal/35"
        }`}
      >
        ⚡ −{fmtDurationShort(quote.ms)}
        <span className="opacity-60"> · {quote.cost}</span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={onClick}
        disabled={!affordable}
        title={title}
        className={`w-full rounded border px-2 py-1.5 text-[11px] transition-colors ${
          affordable
            ? "border-cell-lime/50 text-cell-lime hover:bg-cell-lime/10 active:bg-cell-lime/20"
            : "border-cell-teal/20 text-cell-teal/35"
        }`}
      >
        ⚡ ACCÉLÉRER −{fmtDurationShort(quote.ms)}
        <span className="opacity-70"> · {quote.cost} énergie</span>
      </button>

      {/* Jauge du quota : le joueur doit VOIR que l'accélération a un fond,
          sinon le premier refus ressemble à une panne. */}
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-cell-teal/15">
          <div
            className="h-full bg-cell-lime/60"
            style={{ width: `${Math.min(100, usedPct)}%` }}
          />
        </div>
        <span className="shrink-0 text-[9px] text-cell-teal/45">
          quota {usedPct} / 100
        </span>
      </div>

      {!affordable && (
        <p className="text-center text-[10px] text-cell-teal/45">
          Il te manque {fmtInt(quote.cost - energie)} ⚡ — coche tes habitudes du jour.
        </p>
      )}
    </div>
  );
}
