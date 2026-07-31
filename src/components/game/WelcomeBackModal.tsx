/* Rapport de retour — « pendant ton absence… » (piste 1 du diagnostic UX).

   Pourquoi cette modale existe : le jeu produisait déjà hors ligne, mais le
   joueur revenait devant un état MUET — des chiffres qui avaient bougé, sans
   récit. Deux conséquences : (a) le travail de la cellule pendant l'absence
   n'était jamais crédité émotionnellement, (b) la production perdue au plafond
   de stockage restait totalement invisible, alors que c'est la principale fuite
   de valeur du jeu. Cet écran raconte les deux, et transforme la fuite en
   appel à l'action ("agrandis ton stockage").

   Cette modale ne bloque rien : un tap n'importe où la ferme. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import { getBuildingConfig, OFFLINE_REPORT, resourceName } from "@/lib/game/economy";
import { fmtDuration, fmtInt } from "@/lib/game/format";
import { useOverlay } from "@/lib/overlay";
import { useGame } from "@/lib/game/store";
import { totalGained, totalWasted } from "@/lib/game/tick";
import type { ResourceId } from "@/lib/game/types";

export function WelcomeBackModal() {
  const summary = useGame((s) => s.offlineSummary);
  const dismiss = useGame((s) => s.dismissOfflineSummary);

  /* Avant tout retour anticipe : un Hook ne peut pas etre conditionnel. */
  const dialogRef = useOverlay<HTMLDivElement>(summary !== null, dismiss);

  if (!summary) return null;

  const gains = (Object.entries(summary.gains) as [ResourceId, number][])
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1]);
  const wasted = (Object.entries(summary.wasted) as [ResourceId, number][])
    .filter(([, v]) => v >= 1)
    .sort((a, b) => b[1] - a[1]);

  const lost = totalWasted(summary);
  const kept = totalGained(summary);
  // Alerte de stockage : on compare le perdu au produit TOTAL (gardé + perdu),
  // pour que le message reste juste même quand tout est plein depuis longtemps.
  const wasteRatio = kept + lost > 0 ? lost / (kept + lost) : 0;
  const alert = wasteRatio >= OFFLINE_REPORT.waste_alert_ratio && lost >= 1;

  const events = summary.newReports.slice(0, OFFLINE_REPORT.max_lines);
  const hiddenEvents = summary.newReports.length - events.length;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 outline-none"
      onClick={dismiss}
    >
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
      <Panel
        variant="noyau"
        className="w-full p-4"
        style={{ background: "rgba(5, 11, 20, 0.97)" }}
      >
        <div className="text-center text-2xl">🧫</div>
        <h2 className="text-center text-sm uppercase tracking-[0.3em] text-cell-cyan">
          De retour
        </h2>
        <p className="mt-1 text-center text-[11px] text-cell-teal/70">
          Ta cellule a vécu {fmtDuration(summary.durationMs)} sans toi.
        </p>

        {/* Ce qui a été produit */}
        {gains.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
              Récolté
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {gains.map(([res, v]) => (
                <span key={res} className="flex items-center gap-1 text-[11px] text-cell-lime">
                  <img
                    src={`/assets/resources/${res}.png`}
                    alt=""
                    width={14}
                    height={14}
                    className="pixelated"
                    draggable={false}
                  />
                  +{fmtInt(v)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Chantiers terminés */}
        {summary.finished.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
              Chantiers achevés
            </div>
            {summary.finished.map((f, i) => (
              <div key={i} className="text-[11px] text-cell-cyan">
                ✅ {getBuildingConfig(f.buildingId).name} → Nv {f.targetLevel}
              </div>
            ))}
          </div>
        )}

        {/* Journal (expéditions, vagues, événements) */}
        {events.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
              Journal
            </div>
            {events.map((r) => (
              <div key={r.id} className="truncate text-[11px] text-cell-teal/80">
                {r.type === "pathogene" ? "🦠" : r.type === "expedition" ? "🧭" : "✦"} {r.title}
              </div>
            ))}
            {hiddenEvents > 0 && (
              <div className="text-[10px] text-cell-teal/50">+{hiddenEvents} autres</div>
            )}
          </div>
        )}

        {/* Fuite au plafond de stockage — le point le plus actionnable de l'écran */}
        {lost >= 1 && (
          <div
            className={`mt-3 rounded-sm border px-2 py-1.5 ${
              alert ? "border-red-400/50 bg-red-500/10" : "border-cell-teal/25"
            }`}
          >
            <div
              className={`text-[10px] uppercase tracking-[0.25em] ${
                alert ? "text-red-300" : "text-cell-teal/50"
              }`}
            >
              {alert ? "⚠ Stockage saturé" : "Débordement"}
            </div>
            <div className="mt-0.5 text-[11px] text-cell-teal/80">
              {fmtInt(lost)} unités perdues faute de place
              {wasted.length > 0 && (
                <span className="text-cell-teal/55">
                  {" "}
                  ({wasted
                    .slice(0, 3)
                    .map(([res, v]) => `${resourceName(res)} ${fmtInt(v)}`)
                    .join(", ")})
                </span>
              )}
              .
            </div>
            {alert && (
              <div className="mt-0.5 text-[10px] text-red-300/80">
                Monte le Noyau ou le Producteur de biomasse : ils relèvent le plafond.
              </div>
            )}
          </div>
        )}

        {gains.length === 0 && summary.finished.length === 0 && events.length === 0 && (
          <p className="mt-3 text-center text-[11px] text-cell-teal/60">
            Tout est resté calme.
          </p>
        )}

        <div className="mt-4 flex justify-center">
          <PixelButton className="w-full text-xs" onClick={dismiss}>
            REPRENDRE
          </PixelButton>
        </div>
      </Panel>
      </div>
    </div>
  );
}
