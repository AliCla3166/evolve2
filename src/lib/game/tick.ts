/* Moteur de tick à timestamps réels (Date.now) — pur et testable.
   - Accumule la production depuis state.lastTick, plafonnée aux caps de stockage.
   - Termine les constructions échues (1 seul slot de file, règle stricte).
   - Le rattrapage offline est le même code : au chargement on appelle applyTick
     une seule fois avec `now` courant => un seul gros tick (la production étant
     plafonnée par le stockage, le gain offline est naturellement borné). */

import {
  resourceCap,
  totalProductionPerHour,
} from "./economy";
import { applyMilitary } from "./military";
import type { GameState, ResourceId } from "./types";

/** Ajoute la production entre deux timestamps (ms) aux stocks, plafonnée aux caps.
 *  Un stock déjà au-dessus de son cap n'est jamais réduit (il cesse juste de croître). */
function produce(state: GameState, fromMs: number, toMs: number): void {
  const dtHours = (toMs - fromMs) / 3_600_000;
  if (dtHours <= 0) return;
  const perHour = totalProductionPerHour(state.buildings);
  for (const [res, rate] of Object.entries(perHour)) {
    const id = res as ResourceId;
    const current = state.resources[id] ?? 0;
    const cap = resourceCap(id, state.buildings);
    if (current >= cap) continue;
    state.resources[id] = Math.min(cap, current + rate * dtHours);
  }
}

/** Applique tout ce qui s'est passé entre state.lastTick et `now`.
 *  Pur : retourne un nouvel état, ne mute pas l'entrée.
 *  Si une construction se termine dans l'intervalle, la production est découpée
 *  en deux segments (avant/après la fin du chantier) pour un rattrapage offline exact. */
export function applyTick(state: GameState, now: number): GameState {
  const next: GameState = {
    ...state,
    resources: { ...state.resources },
    buildings: { ...state.buildings },
    buildQueue: state.buildQueue ? { ...state.buildQueue } : null,
    units: { ...state.units },
    expeditions: [...state.expeditions],
    reports: state.reports, // pushReport remplace le tableau (jamais de mutation en place)
    pendingEvent: state.pendingEvent ? { ...state.pendingEvent } : null,
  };

  const from = next.lastTick > 0 ? next.lastTick : now;
  // Horloge revenue en arrière (changement d'heure système, triche…) :
  // on se resynchronise sans produire ni annuler quoi que ce soit.
  if (now <= from) {
    next.lastTick = Math.min(from, now);
    // Une construction échue reste finalisable même à temps figé.
    if (next.buildQueue && next.buildQueue.endsAt <= now) {
      next.buildings[next.buildQueue.buildingId] = next.buildQueue.targetLevel;
      next.buildQueue = null;
    }
    return next;
  }

  const task = next.buildQueue;
  if (task && task.endsAt <= now) {
    // Segment 1 : production avec les niveaux actuels jusqu'à la fin du chantier.
    const completionAt = Math.max(from, task.endsAt);
    produce(next, from, completionAt);
    // Fin de chantier : le bâtiment passe au niveau cible, le slot se libère.
    next.buildings[task.buildingId] = task.targetLevel;
    next.buildQueue = null;
    // Segment 2 : production avec les nouveaux niveaux jusqu'à maintenant.
    produce(next, completionAt, now);
  } else {
    produce(next, from, now);
  }

  // Couche militaire : expéditions échues, vagues de pathogènes, événements.
  applyMilitary(next, now);

  next.lastTick = now;
  return next;
}
