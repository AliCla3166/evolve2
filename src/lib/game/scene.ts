/* Configuration de la scène "Base vivante" (Phase 3) — données pures, sans DOM.
   Architecture en couches (cf. page Notion "Conception technique — Base vivante
   évolutive & animée") : fond → enveloppe (5 stades) → particules → bâtiments
   sur sockets → Noyau → VFX. L'enveloppe change par PALIERS discrets (jamais de
   déformation continue), le "vivant" (flottement, pulsation) est piloté en code. */

import { BUILDING_ORDER } from "./economy";
import type { BuildingId } from "./types";

/* ---------- Stades d'enveloppe ----------
   Seuils = nombre de proto-organes construits (Noyau exclu), copie exacte de
   public/assets/manifest.json → envelope_stages :
   stade 1 : 0 bâtiment · 2 : 1-3 · 3 : 4-7 · 4 : 8-10 · 5 : 11-12. */
export const STAGE_MIN_BUILT = [0, 1, 4, 8, 11] as const;

/** Nombre de proto-organes construits (tout bâtiment ≥ Nv1, Noyau exclu). */
export function builtCount(buildings: Record<BuildingId, number>): number {
  return BUILDING_ORDER.filter((id) => id !== "noyau" && (buildings[id] ?? 0) > 0)
    .length;
}

/** Stade d'enveloppe courant (1..5). */
export function envelopeStage(buildings: Record<BuildingId, number>): number {
  const n = builtCount(buildings);
  let stage = 1;
  for (let i = 0; i < STAGE_MIN_BUILT.length; i++) {
    if (n >= STAGE_MIN_BUILT[i]) stage = i + 1;
  }
  return stage;
}

export function envelopeSprite(stage: number): string {
  return `/assets/envelope/niveau${Math.min(5, Math.max(1, stage))}.png`;
}

/* ---------- Sockets ----------
   Coordonnées normalisées (0..1) dans une scène carrée, Noyau au centre.
   Règle de la Charte Graphique : producteurs (cyan/vert) groupés à gauche,
   centres spécialisés (violet/magenta) à droite, Membrane près du bord.
   `size` = échelle relative du sprite ; `accent` = couleur du manifest. */
export interface Socket {
  x: number;
  y: number;
  size: number;
  accent: string;
}

export const SOCKETS: Record<BuildingId, Socket> = {
  noyau: { x: 0.5, y: 0.5, size: 1.5, accent: "#6df6ff" },
  membrane: { x: 0.5, y: 0.16, size: 1.0, accent: "#3fe0d8" },
  // Producteurs — arc gauche, du haut vers le bas
  adn: { x: 0.3, y: 0.24, size: 1.0, accent: "#35e7ff" },
  proteine: { x: 0.19, y: 0.37, size: 1.0, accent: "#58ff9e" },
  biomasse: { x: 0.15, y: 0.53, size: 1.0, accent: "#a6ff3d" },
  enzyme: { x: 0.19, y: 0.69, size: 1.0, accent: "#ff9a3d" },
  lipide: { x: 0.3, y: 0.81, size: 1.0, accent: "#7cf0c0" },
  signaux: { x: 0.45, y: 0.87, size: 1.0, accent: "#35d6ff" },
  // Centres spécialisés — arc droit
  mutation: { x: 0.7, y: 0.24, size: 1.05, accent: "#ff54d6" },
  defense: { x: 0.82, y: 0.4, size: 1.0, accent: "#8f7bff" },
  raid: { x: 0.82, y: 0.62, size: 1.0, accent: "#ff3d5e" },
  peche: { x: 0.68, y: 0.79, size: 1.0, accent: "#b06bff" },
};

/* ---------- Échelles par stade ----------
   L'enveloppe grandit par paliers ; les sockets s'écartent du centre avec elle
   (les bâtiments GLISSENT vers leur nouvelle position pendant la mue — le
   facteur est interpolé en continu côté rendu). */
export const ENVELOPE_SCALE = [0.6, 0.72, 0.84, 0.94, 1.02] as const;
export const SOCKET_SPREAD = [0.56, 0.68, 0.8, 0.91, 1.0] as const;

/** Position d'un socket pour un écartement donné (spread interpolé 0..1). */
export function socketPos(
  id: BuildingId,
  spread: number,
): { x: number; y: number } {
  const s = SOCKETS[id];
  return { x: 0.5 + (s.x - 0.5) * spread, y: 0.5 + (s.y - 0.5) * spread };
}

/** Phase d'animation stable par bâtiment (0..1) — jamais synchronisés entre eux. */
export function animPhase(id: BuildingId): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return h / 997;
}

/** Métronome global de la scène : le battement du Noyau (ms). Tous les effets
 *  de pulsation sont calés sur un multiple de ce rythme (un seul cœur qui bat). */
export const HEARTBEAT_MS = 2800;
