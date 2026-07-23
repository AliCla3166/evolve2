/* Micro-tutoriel 3 étapes (Phase 4) — guide le nouveau joueur de zéro à sa
   première construction. Auto-avance en observant l'état du jeu ; la dernière
   étape se ferme d'un bouton. Jamais montré aux sauvegardes migrées. */
"use client";

import { useEffect } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { dayKey } from "@/lib/game/habits";
import { useGame } from "@/lib/game/store";
import { TUTORIAL_DONE } from "@/lib/game/types";

export function TutorialCoach() {
  const step = useGame((s) => s.tutorialStep);
  const buildQueue = useGame((s) => s.buildQueue);
  const habits = useGame((s) => s.habits);
  // "now" du rendu = dernier tick appliqué (pas de Date.now() en rendu).
  const now = useGame((s) => s.lastTick);
  const advanceTutorial = useGame((s) => s.advanceTutorial);

  const todayValidated = (habits.days[dayKey(now)]?.validatedCount ?? 0) > 0;

  // Auto-avance : l'état du jeu EST la validation de l'étape.
  useEffect(() => {
    if (step === 0 && todayValidated) advanceTutorial(1);
    else if (step === 1 && buildQueue !== null) advanceTutorial(2);
  }, [step, todayValidated, buildQueue, advanceTutorial]);

  if (step >= TUTORIAL_DONE) return null;

  return (
    <Panel
      variant="tooltip"
      className="px-3 py-2"
      style={{ background: "rgba(5, 11, 20, 0.9)" }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 animate-pulse text-cell-magenta">✦</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-cell-magenta">
            Éveil — étape {step + 1}/3
          </div>
          {step === 0 && (
            <p className="text-xs leading-relaxed text-cell-cyan">
              Ta cellule carbure au réel : descends jusqu&apos;aux{" "}
              <span className="text-cell-lime">Habitudes du jour</span> et
              valides-en une (tes pas, par exemple) pour gagner tes premiers ⚡.
            </p>
          )}
          {step === 1 && (
            <p className="text-xs leading-relaxed text-cell-cyan">
              Bien ! Maintenant, touche un bâtiment de ta cellule —{" "}
              <span className="text-cell-lime">halo vert = coût payable</span> —
              et lance ta première construction.
            </p>
          )}
          {step === 2 && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-cell-cyan">
                Chantier lancé ! Son timer s&apos;écoule en{" "}
                <span className="text-cell-lime">temps réel</span>, même quand le
                jeu est fermé. Reviens le voir aboutir — ta cellule, elle,
                n&apos;arrête jamais.
              </p>
              <div className="text-center">
                <PixelButton
                  className="!min-w-[110px] !px-4 !py-1 text-[11px]"
                  onClick={() => advanceTutorial(TUTORIAL_DONE)}
                >
                  COMPRIS
                </PixelButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
