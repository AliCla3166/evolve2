/* Emplacements de sauvegarde ("slots") — demande utilisateur : pouvoir choisir
   entre la partie "perso" (réelle) et une partie "dev" isolée dans laquelle on
   peut se distribuer des ressources pour tester le jeu sans jamais risquer la
   vraie sauvegarde.

   Le slot "perso" réutilise TEL QUEL l'ancienne clé unique `evolve2_save_v1` —
   aucune migration nécessaire, les joueurs existants ne voient rien changer.
   Le slot "dev" vit dans une clé séparée `evolve2_save_v1__dev`, jamais lue
   par le slot perso et jamais synchronisée vers le cloud (cf. useCloudSync). */

export type SaveSlot = "perso" | "dev";

const ACTIVE_SLOT_KEY = "evolve2_active_slot";
const BASE_SAVE_KEY = "evolve2_save_v1";

export function slotStorageKey(slot: SaveSlot): string {
  return slot === "dev" ? `${BASE_SAVE_KEY}__dev` : BASE_SAVE_KEY;
}

/** Slot actif — lu depuis une clé séparée, hors de la sauvegarde elle-même
 *  (c'est une préférence d'appareil, pas une donnée de partie). */
export function getActiveSlot(): SaveSlot {
  if (typeof window === "undefined") return "perso";
  try {
    return localStorage.getItem(ACTIVE_SLOT_KEY) === "dev" ? "dev" : "perso";
  } catch {
    return "perso";
  }
}

export function setActiveSlot(slot: SaveSlot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_SLOT_KEY, slot);
  } catch {
    /* navigation privée / quota : le choix ne persistera pas, sans bloquer */
  }
}

/** true si ce slot n'a encore jamais été sauvegardé (permet de repartir d'un
 *  état neuf au lieu de laisser traîner en mémoire les données du slot précédent). */
export function slotHasSave(slot: SaveSlot): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(slotStorageKey(slot)) !== null;
  } catch {
    return false;
  }
}
