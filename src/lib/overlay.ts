/* Comportement commun à TOUS les panneaux et modales du jeu (piste 10).

   Deux manques signalés par le diagnostic, sans rapport apparent mais qui se
   règlent au même endroit — au moment où un overlay s'ouvre :

   1. Le bouton retour d'Android quittait le jeu. Aucun `popstate` n'était
      écouté : avec un panneau plein écran ouvert, le réflexe n°1 d'un joueur
      Android (le retour système) fermait la PWA au lieu de fermer le panneau.
      On empile une entrée d'historique bidon à l'ouverture ; le retour la
      consomme, et le jeu reste ouvert.

   2. Le fond continuait de défiler sous l'overlay. Un geste qui dépassait le
      bas d'un panneau faisait glisser la page en dessous, et le joueur
      retrouvait la base à un autre endroit en refermant.

   Un seul `useOverlay(open, close)` par overlay suffit. */
"use client";

import { useEffect, useRef } from "react";

/** Jeton croissant : identifie NOTRE entrée d'historique parmi les overlays
 *  empilés (fiche de bâtiment ouverte par-dessus un panneau, par exemple). */
let seq = 0;

/** Nombre d'overlays ouverts. Le verrou de défilement se relâche au dernier
 *  fermé, jamais au premier — sinon deux overlays empilés se déverrouillent
 *  mutuellement en se fermant. */
let locks = 0;

interface OverlayEntry {
  token: number;
  close: () => void;
  closedByBack: boolean;
}

/** Pile des overlays ouverts, du plus ancien au plus récent. */
const stack: OverlayEntry[] = [];

/** Retours d'historique que NOUS avons provoqués et qu'il ne faut donc pas
 *  interpréter comme un appui sur le bouton retour. */
let selfPops = 0;

let listening = false;

/* `popstate` est un événement GLOBAL : si chaque overlay pose son propre
   écouteur, deux problèmes apparaissent dès qu'ils s'empilent (fiche de
   bâtiment par-dessus un panneau, révélation de carte par-dessus les
   Réglages) — un seul appui sur retour les fermait TOUS d'un coup, et le
   `history.back()` qu'un overlay émet pour retirer proprement sa propre
   entrée faisait fermer en cascade celui du dessous. D'où un écouteur unique,
   qui ne s'adresse qu'au sommet de la pile, et un compteur de retours émis
   par nous-mêmes. */
function handlePop() {
  if (selfPops > 0) {
    selfPops--;
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  top.closedByBack = true;
  top.close();
}

/** Le retour système ferme l'overlay au lieu de quitter l'application. */
export function useBackDismiss(open: boolean, close: () => void) {
  /* `close` est souvent une closure recréée à chaque rendu : on la garde dans
     une ref pour que l'effet ne se rejoue pas (et ne réempile pas d'entrée)
     à chaque rendu. La ref est synchronisée dans un effet, pas pendant le
     rendu — un rendu doit rester pur (règle du projet, cf. react-hooks/refs). */
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const entry: OverlayEntry = {
      token: ++seq,
      close: () => closeRef.current(),
      closedByBack: false,
    };
    stack.push(entry);
    if (!listening) {
      window.addEventListener("popstate", handlePop);
      listening = true; // jamais retiré : un écouteur passif unique pour la session.
    }
    // Même URL, donc aucune navigation Next : on n'empile qu'un état.
    window.history.pushState({ evolveOverlay: entry.token }, "");

    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      /* Fermeture par l'interface (croix, voile, onglet) : on retire notre
         entrée nous-mêmes, sinon le joueur hériterait d'un retour fantôme qui
         ne ferait plus rien. Si c'est le retour système qui a fermé, l'entrée
         est déjà partie — d'où le drapeau.
         Le test porte sur `>=` et non sur l'égalité : quand deux overlays
         empilés sont démontés dans le même cycle (fermer le panneau ferme
         aussi son inspecteur), le nettoyage du plus profond s'exécute avant
         que le `popstate` du plus haut ne soit arrivé — l'état courant porte
         alors un jeton plus récent que le nôtre, mais un retour retire bien
         l'une de NOS entrées. Un état sans `evolveOverlay` signifie en
         revanche que le joueur a quitté /play : on ne touche à rien. */
      if (!entry.closedByBack) {
        const st = window.history.state as { evolveOverlay?: number } | null;
        if (typeof st?.evolveOverlay === "number" && st.evolveOverlay >= entry.token) {
          selfPops++;
          window.history.back();
        }
      }
    };
  }, [open]);
}

/** Empêche l'arrière-plan de défiler tant qu'un overlay est ouvert. */
export function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    locks++;
    document.body.classList.add("overlay-open");
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.classList.remove("overlay-open");
    };
  }, [locked]);
}

/** Les deux d'un coup — ce qu'appellent tous les overlays du jeu. */
export function useOverlay(open: boolean, close: () => void) {
  useBackDismiss(open, close);
  useScrollLock(open);
}

/** Défilement doux, sauf si le joueur a demandé moins d'animations. */
export function scrollToTop() {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}
