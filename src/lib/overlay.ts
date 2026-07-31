/* Comportement commun à TOUS les panneaux et modales du jeu (piste 10, puis
   refonte lisibilité 31/07 — piste Phase 1 n°11).

   Trois manques signalés, sans rapport apparent mais qui se règlent au même
   endroit — au moment où un overlay s'ouvre :

   1. Le bouton retour d'Android quittait le jeu. Aucun `popstate` n'était
      écouté : avec un panneau plein écran ouvert, le réflexe n°1 d'un joueur
      Android (le retour système) fermait la PWA au lieu de fermer le panneau.
      On empile une entrée d'historique bidon à l'ouverture ; le retour la
      consomme, et le jeu reste ouvert.

   2. Le fond continuait de défiler sous l'overlay. Un geste qui dépassait le
      bas d'un panneau faisait glisser la page en dessous, et le joueur
      retrouvait la base à un autre endroit en refermant.

   3. (31/07) Rien ne posait le focus DANS l'overlay à l'ouverture, ni ne le
      rendait à son point de départ à la fermeture — un clavier ou un lecteur
      d'écran qui ouvrait un panneau restait sur le bouton qui l'a ouvert,
      SOUS l'overlay, et Tab s'évadait vers la nav basse en dessous. Et rien
      ne bornait Tab À L'INTÉRIEUR de l'overlay, qui n'avait donc aucun piège
      de focus. Corrigé au même endroit que 1 et 2, sur le sommet de la MÊME
      pile : quand un inspecteur s'ouvre par-dessus un panneau (fiche de slot
      du Bastion, fiche de bâtiment), seul le sommet capte Tab — exactement
      la même règle que `handlePop` applique déjà au retour système, pour
      qu'il n'y ait jamais deux overlays qui se disputent la même touche.

   Un seul `useOverlay(open, close)` par overlay suffit ; il renvoie une ref à
   poser sur le conteneur racine (`role="dialog"`, `aria-modal="true"`,
   `tabIndex={-1}` — voir CodexPanel.tsx pour l'exemple le plus simple). */
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
  /** Conteneur DOM de CET overlay — sert au piège de focus (n°3). */
  ref: { current: HTMLElement | null };
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

/** Piège de focus (n°3) : Tab/Shift+Tab bouclent parmi les seuls éléments
 *  focusables du SOMMET de la pile. Un écouteur global, comme `handlePop` et
 *  pour la même raison — deux overlays empilés ne doivent jamais se disputer
 *  la même touche. Les éléments du dessous restent dans le DOM (l'overlay du
 *  dessus ne les démonte pas) mais Tab ne doit plus pouvoir y atterrir tant
 *  qu'un autre overlay est au-dessus. */
function handleTabTrap(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const top = stack[stack.length - 1];
  const container = top?.ref.current;
  if (!container) return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Le retour système ferme l'overlay au lieu de quitter l'application, ET
 *  gère le focus (n°3) — même pile, même jeton, pour rester exactement
 *  synchronisés sur ce qui est réellement ouvert. Renvoie une ref à poser sur
 *  le conteneur racine de l'overlay (`role="dialog"`, `tabIndex={-1}`). */
export function useBackDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  close: () => void,
) {
  /* `close` est souvent une closure recréée à chaque rendu : on la garde dans
     une ref pour que l'effet ne se rejoue pas (et ne réempile pas d'entrée)
     à chaque rendu. La ref est synchronisée dans un effet, pas pendant le
     rendu — un rendu doit rester pur (règle du projet, cf. react-hooks/refs). */
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  const containerRef = useRef<T | null>(null);
  /** Élément qui avait le focus juste avant l'ouverture — pour le lui rendre
   *  à la fermeture, où qu'elle vienne (croix, voile, retour système). */
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const entry: OverlayEntry = {
      token: ++seq,
      close: () => closeRef.current(),
      closedByBack: false,
      ref: containerRef,
    };
    stack.push(entry);
    if (!listening) {
      window.addEventListener("popstate", handlePop);
      window.addEventListener("keydown", handleTabTrap);
      listening = true; // jamais retiré : des écouteurs passifs uniques pour la session.
    }
    // Même URL, donc aucune navigation Next : on n'empile qu'un état.
    window.history.pushState({ evolveOverlay: entry.token }, "");

    // Focus initial sur le conteneur lui-même : sans ça, le focus resterait
    // sur le bouton qui vient d'ouvrir le panneau, SOUS l'overlay. Un `rAF`
    // laisse le DOM du panneau se poser avant de le déplacer.
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => containerRef.current?.focus());

    return () => {
      cancelAnimationFrame(raf);
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
      // Restauration du focus — seulement si la cible est encore attachée au
      // DOM (elle peut avoir disparu : fermeture depuis un autre chemin, ou
      // le bouton qui a ouvert le panneau ne s'y affiche plus).
      if (restoreRef.current && document.contains(restoreRef.current)) {
        restoreRef.current.focus();
      }
    };
  }, [open]);

  return containerRef;
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

/** Les trois d'un coup — ce qu'appellent tous les overlays du jeu. Renvoie la
 *  ref à poser sur le conteneur racine :
 *
 *    const dialogRef = useOverlay<HTMLDivElement>(true, onClose);
 *    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} ...>
 */
export function useOverlay<T extends HTMLElement = HTMLDivElement>(open: boolean, close: () => void) {
  const containerRef = useBackDismiss<T>(open, close);
  useScrollLock(open);
  return containerRef;
}

/** Défilement doux, sauf si le joueur a demandé moins d'animations. */
export function scrollToTop() {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}
