/* Bandeau d'installation PWA — demande utilisateur : proposer d'installer le
   jeu dès l'ouverture. Monté dans le layout racine (donc visible sur / et
   /play, quel que soit le point d'entrée réel).

   Contraintes de plateforme (pas de choix de conception, ce sont des limites
   du web) :
   - `beforeinstallprompt` (Chrome/Edge/Android) : on l'intercepte, on garde
     l'événement, et on affiche un bouton "Installer" explicite dès qu'il tire
     — le navigateur décide seul QUAND il tire (heuristiques internes), on ne
     peut pas le forcer plus tôt.
   - iOS Safari ne déclenche JAMAIS cet événement (API absente) : seul un
     mode d'emploi manuel ("Partage -> Sur l'écran d'accueil") est possible. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "evolve2_install_dismissed_at";
const DISMISS_COOLDOWN_MS = 3 * 24 * 3_600_000; // 3 jours avant de reproposer

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** true si on est autorisé à (re)proposer l'installation : pas déjà
 *  installée, et pas rejetée récemment (cooldown). Lu une fois à
 *  l'initialisation (état de plateforme figé pour la durée de la page). */
function computeEligible(): boolean {
  if (isStandalone()) return false;
  try {
    const lastDismiss = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - lastDismiss >= DISMISS_COOLDOWN_MS;
  } catch {
    return true; // navigation privée : pas de cooldown mémorisable, on tente
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // Calculés une fois à l'initialisation (pas de setState depuis l'effet) :
  // ce sont des faits statiques du device/de la session, pas des abonnements.
  const [eligible] = useState(computeEligible);
  const [showIosHint] = useState(() => eligible && isIos());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [eligible]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome !== "accepted") dismiss();
    else setDismissed(true);
    setDeferred(null);
  };

  if (dismissed || !eligible || (!deferred && !showIosHint)) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-2 pt-2">
      <div className="pointer-events-auto w-full max-w-md">
        <Panel variant="noyau" className="flex items-center gap-3 p-2.5">
          <img
            src="/icons/icon-192.png"
            alt=""
            width={36}
            height={36}
            className="pixelated shrink-0 rounded-lg"
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] tracking-wide text-cell-cyan">Installer EVOLVE</div>
            <p className="text-[10px] leading-snug text-cell-teal/70">
              {deferred
                ? "Plein écran, accès direct depuis ton écran d'accueil."
                : "Partage ⬆️ puis « Sur l'écran d'accueil »."}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {deferred && (
              <PixelButton className="!min-w-0 !py-1 text-[10px]" onClick={install}>
                INSTALLER
              </PixelButton>
            )}
            <button onClick={dismiss} className="text-[10px] text-cell-teal/50 hover:text-cell-teal">
              Plus tard
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
