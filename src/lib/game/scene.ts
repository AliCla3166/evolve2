/* Configuration de la scène "Base vivante" (Phase 3) — données pures, sans DOM.
   Architecture en couches (cf. page Notion "Conception technique — Base vivante
   évolutive & animée") : fond → enveloppe (5 stades) → particules → bâtiments
   sur sockets → Noyau → VFX. L'enveloppe change par PALIERS discrets (jamais de
   déformation continue), le "vivant" (flottement, pulsation) est piloté en code. */

import { builtOrganCount } from "./economy";
import type { BuildingId } from "./types";

/* ---------- Stades d'enveloppe ----------
   Seuils = nombre de proto-organes construits (Noyau exclu).
   CORRECTION 24/07/2026 : les anciens seuils [0, 1, 4, 8, 11] recopiaient
   public/assets/manifest.json, qui supposait les 12 bâtiments constructibles.
   Or peche/defense/raid sont designed:false — seuls 8 proto-organes existent
   réellement (membrane, adn, proteine, biomasse, enzyme, lipide, signaux,
   mutation). Le stade 5 était donc INATTEIGNABLE (sprite niveau5.png mort) et
   le stade 4 n'arrivait qu'au tout dernier organe. Nouveaux seuils calés sur
   8 organes : la mue finale récompense la cellule complète.
   stade 1 : 0 · 2 : 1-2 · 3 : 3-4 · 4 : 5-7 · 5 : 8 (tous les organes). */
export const STAGE_MIN_BUILT = [0, 1, 3, 5, 8] as const;

/** Nombre de proto-organes construits (tout bâtiment ≥ Nv1, Noyau exclu).
 *  Règle partagée avec les déblocages de slots de chantier (cf. economy.ts). */
export const builtCount = builtOrganCount;

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
  /** Nom court affiché sous le bâtiment dans la scène (lisibilité). */
  label: string;
}

export const SOCKETS: Record<BuildingId, Socket> = {
  noyau: { x: 0.5, y: 0.5, size: 1.5, accent: "#6df6ff", label: "Noyau" },
  membrane: { x: 0.5, y: 0.15, size: 1.0, accent: "#3fe0d8", label: "Membrane" },
  // Producteurs — arc gauche, du haut vers le bas (aérés pour les labels)
  adn: { x: 0.29, y: 0.21, size: 1.0, accent: "#35e7ff", label: "ADN" },
  proteine: { x: 0.15, y: 0.35, size: 1.0, accent: "#58ff9e", label: "Protéines" },
  biomasse: { x: 0.12, y: 0.58, size: 1.0, accent: "#a6ff3d", label: "Biomasse" },
  enzyme: { x: 0.21, y: 0.76, size: 1.0, accent: "#ff9a3d", label: "Enzymes" },
  lipide: { x: 0.35, y: 0.85, size: 1.0, accent: "#7cf0c0", label: "Lipides" },
  signaux: { x: 0.52, y: 0.88, size: 1.0, accent: "#35d6ff", label: "Signaux" },
  // Centres spécialisés — arc droit
  mutation: { x: 0.71, y: 0.22, size: 1.05, accent: "#ff54d6", label: "Mutation" },
  defense: { x: 0.85, y: 0.4, size: 1.0, accent: "#8f7bff", label: "Défense" },
  raid: { x: 0.85, y: 0.62, size: 1.0, accent: "#ff3d5e", label: "Raid" },
  peche: { x: 0.69, y: 0.8, size: 1.0, accent: "#b06bff", label: "Pêche" },
};

/* ---------- Portails ----------
   Trois sockets ne sont pas des proto-organes (`designed: false` dans
   economy_config.json) : ce sont des PORTES vers d'autres écrans. Le Bastion
   est même le plus gros morceau jouable du projet, et il était pourtant
   dessiné grisé sous un cadenas, avec pour unique entrée une fiche quasi vide.
   Pêche et Raid, eux, renvoyaient le joueur vers une fiche qui lui expliquait
   d'aller ouvrir un onglet — un aller-retour pour rien.

   Piste 10 + piste 9b : un tap sur un portail ouvre directement l'écran
   concerné, et le cadenas disparaît (il annonçait « verrouillé » un contenu
   parfaitement ouvert). */
export type PortalTarget = "bastion" | "mare" | "noyau" | "derive";

export const PORTALS: Partial<Record<BuildingId, PortalTarget>> = {
  defense: "bastion",
  peche: "mare",
  /* Le socle « Raid » ouvrait le Noyau faute d'écran dédié. Il a maintenant le
     sien : La Dérive, la carte des eaux (cf. docs/PLAN_DERIVE.md). */
  raid: "derive",
};

export function portalTarget(id: BuildingId): PortalTarget | null {
  return PORTALS[id] ?? null;
}

/* ---------- Échelles par stade ----------
   L'enveloppe grandit par paliers ; les sockets s'écartent du centre avec elle
   (les bâtiments GLISSENT vers leur nouvelle position pendant la mue — le
   facteur est interpolé en continu côté rendu). */
/* Lisibilité (retour utilisateur) : à faible stade, l'ancien écartement (0.56)
   resserrait les 12 sockets bien plus près du centre que leur rayon de sprite
   ne le permettait (chevauchements). L'écartement de base est relevé et
   l'enveloppe agrandie en conséquence pour que la cellule "respire" dès le
   premier stade, quitte à ce que l'image centrale soit plus grande. */
export const ENVELOPE_SCALE = [0.76, 0.84, 0.91, 0.97, 1.04] as const;
export const SOCKET_SPREAD = [0.78, 0.85, 0.91, 0.96, 1.0] as const;

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
