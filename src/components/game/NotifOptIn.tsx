/* Demande d'autorisation des rappels (étape 9, piste 2 du diagnostic UX).
 *
 *  Le diagnostic est explicite sur le MOMENT : « pas au premier lancement, mais
 *  juste après la première fin de chantier, quand le joueur vient de comprendre
 *  ce qu'il rate. » D'où un composant monté DANS la modale de fin de chantier
 *  plutôt qu'au démarrage de l'application.
 *
 *  Et une demande maison AVANT le prompt natif, parce que celui-ci ne se joue
 *  qu'une seule fois par installation : le déclencher sur un joueur qui allait
 *  refuser grille définitivement la seule cartouche disponible. Ici, « NON
 *  MERCI » laisse la porte ouverte — une seconde proposition passé le délai de
 *  `reask_after_days`, puis plus jamais. */
"use client";

import { useState, useSyncExternalStore } from "react";
import { PixelButton } from "@/components/ui/Pixel";
import { useGame } from "@/lib/game/store";
import {
  NOTIF,
  getNotifServerSnapshot,
  getNotifSnapshot,
  recordOptInAsk,
  requestNotifPermission,
  shouldOfferOptIn,
  subscribeNotifStore,
} from "@/lib/notifications";

const P = NOTIF.permission;

export function NotifOptIn() {
  const snap = useSyncExternalStore(
    subscribeNotifStore,
    getNotifSnapshot,
    getNotifServerSnapshot,
  );
  /* `Date.now()` pendant un rendu est proscrit dans ce projet (rendu impur) :
     l'horloge du jeu est `lastTick`, avancée par le tick de /play. */
  const now = useGame((s) => s.lastTick);
  const [outcome, setOutcome] = useState<"granted" | "denied" | "later" | null>(null);

  if (outcome === "later") return null;
  if (outcome) {
    return (
      <p className="mt-3 text-center text-[11px] leading-relaxed text-cell-teal/70">
        {outcome === "granted" ? P.prompt_granted : P.prompt_denied}
      </p>
    );
  }
  if (!shouldOfferOptIn(now, snap)) return null;

  const accept = async () => {
    recordOptInAsk(now);
    const res = await requestNotifPermission();
    setOutcome(res === "granted" ? "granted" : "denied");
  };

  const decline = () => {
    recordOptInAsk(now);
    setOutcome("later");
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border border-cell-cyan/25 bg-abyss/60 p-3">
      <div className="text-xs text-cell-cyan">{P.prompt_title}</div>
      <p className="text-[11px] leading-relaxed text-cell-teal/70">{P.prompt_body}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <PixelButton className="!py-1 text-[10px]" onClick={() => void accept()}>
          {P.prompt_accept}
        </PixelButton>
        <button
          onClick={decline}
          className="tap-h px-3 text-[10px] tracking-widest text-cell-teal/60 hover:text-cell-cyan"
        >
          {P.prompt_decline}
        </button>
      </div>
    </div>
  );
}
