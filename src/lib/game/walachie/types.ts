/* Types du mode Walachie — état persisté séparément du jeu principal.
   AUCUNE valeur d'équilibrage ici : uniquement de la forme. Le mode a sa propre
   clé localStorage (`evolve2_walachie_v1`) et son propre numéro de version,
   volontairement indépendants de SAVE_VERSION : casser l'un ne doit jamais
   pouvoir casser l'autre. */

/** Événement spontané en cours (bonus temporaire — le hasard ajoute, jamais ne retire). */
export interface WalachieEventActive {
  /** id dans walachie_config.json -> events.pool */
  id: string;
  /** Fin de l'effet (ms epoch). Les effets instantanés n'ouvrent pas d'entrée ici. */
  endsAt: number;
}

/** Une ligne du journal des moments spontanés (affichage seulement). */
export interface WalachieEventLogEntry {
  id: string;
  at: number;
  /** Sève versée pour les effets instantanés (0 pour les multiplicateurs). */
  seve: number;
}

export interface WalachieState {
  version: number;
  /** Sève en stock (monnaie unique du mode). */
  seve: number;
  /** Sève totale gagnée depuis le début du CYCLE en cours (assiette des Éclats). */
  seveCycle: number;
  /** Sève totale gagnée depuis la toute première partie (vitrine, jamais dépensée). */
  seveAllTime: number;
  /** Pulsations (clics) depuis le début, vitrine. */
  pulsations: number;
  /** Nombre possédé par nœud d'évolution (id -> compte). */
  nodes: Record<string, number>;
  /** Nombre d'ères percées (1 = seule la première est ouverte). */
  erasUnlocked: number;
  /** Éclats de Conscience en stock (monnaie de Renaissance). */
  eclats: number;
  /** Renaissances accomplies. */
  cycles: number;
  /** Niveaux des améliorations permanentes (id -> niveau). */
  meta: Record<string, number>;
  /** Créatures brillantes déjà réclamées par nœud (id -> nombre de charges consommées).
   *  Charges disponibles = floor(nodes[id] / shiny.seuil) - shinyClaimed[id]. Distinct
   *  des améliorations meta : ceci se déclenche à chaque palier de 100, pas une seule fois. */
  shinyClaimed: Record<string, number>;
  /** Dernier tick (ms epoch) — la production hors ligne part d'ici. */
  lastTick: number;
  /** Graine du PRNG des événements (mulberry32, un pas par tirage). */
  rngSeed: number;
  /** Prochain moment spontané (ms epoch, planifié à l'avance et persisté). */
  nextEventAt: number;
  /** Effet temporaire en cours, s'il y en a un. */
  activeEvent: WalachieEventActive | null;
  /** Journal des derniers moments spontanés (borné côté moteur). */
  eventLog: WalachieEventLogEntry[];
}
