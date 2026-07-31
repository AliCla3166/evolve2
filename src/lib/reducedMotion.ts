/* Lecture de `prefers-reduced-motion` pour les boucles de rendu Canvas
   (WalachieScene, EvolutionTree) qui animent en JS pur et non en classes CSS.

   Cote Cellule, la regle systeme est deja geree entierement par le media
   query `@media (prefers-reduced-motion: reduce)` de globals.css, qui coupe
   les classes CSS animees (cell-pulse, plankton, reveal-*...). Ca ne peut
   rien faire pour Walachie : ses mouvements (bob des bulles, veines de seve,
   pulsation de l'aura brillante) sont calcules image par image avec
   `Math.sin(performance.now() / ...)` a l'interieur d'un `requestAnimationFrame`,
   jamais poses comme une classe CSS — le media query ne les voit donc jamais.

   Lu de facon imperative (pas via `useSyncExternalStore`) : ces boucles ne
   sont pas des rendus React, elles tournent hors du cycle de rendu (meme
   patron que `useGame.getState()` dans CellScene/WalachieScene). La valeur
   est mise en cache et rafraichie par un listener `change`, pour ne pas
   interroger `matchMedia` a chaque frame. */
"use client";

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (cached === null) {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    cached = mq.matches;
    mq.addEventListener("change", (e) => {
      cached = e.matches;
    });
  }
  return cached;
}
