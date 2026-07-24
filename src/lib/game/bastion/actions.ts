/* Actions pures du Bastion-Défense jouable — mutent un DRAFT de GameState déjà cloné par
   l'appelant (store.ts), exactement comme military.ts/tick.ts : ces fonctions écrivent
   directement sur `state.bastion`/`state.resources`, jamais sur l'état persisté original.
   Tous les tirages aléatoires utilisent le PRNG seedé (rand/state.rngSeed) — jamais
   Math.random ici, contrairement à engine.ts qui simule une bataille éphémère non persistée. */

import { rand } from "../military";
import { speciesConfig } from "../cards";
import type { CardEntry, GameState } from "../types";
import {
  BASTION,
  IN_WAVE_RESPAWN_COST,
  barracksSlotUnlockCost,
  buildingDef,
  foundationsCost,
  mortarSlotUnlockCost,
  recruitBuildingCost,
  reserveCapCost,
  rollBuildingDef,
  specCapCost,
  turretSlotUnlockCost,
} from "./config";
import type { BastionState, FieldStructure } from "./types";

/* ---------- Clonage superficiel d'un draft mutable (mirroring applyTick) ---------- */

export function cloneBastion(b: BastionState): BastionState {
  return {
    ...b,
    turretSlots: b.turretSlots.map((s) => ({ ...s })),
    barracksSlots: b.barracksSlots.map((s) => ({ ...s, treePath: [...s.treePath] })),
    mortarSlots: b.mortarSlots.map((s) => ({ ...s })),
    fieldStructures: b.fieldStructures.map((s) => ({ ...s })),
    support: b.support.map((s) => (s ? { ...s } : null)),
    buildingReserve: b.buildingReserve.map((s) => ({ ...s })),
  };
}

/** À appeler en tête de chaque action du store qui touche le Bastion : produit un draft
 *  sûr à muter (bastion cloné, resources clonées) à partir de l'état post-tick. */
export function draftWithBastion(s: GameState): GameState {
  return { ...s, resources: { ...s.resources }, bastion: cloneBastion(s.bastion) };
}

function spend(state: GameState, amount: number): boolean {
  if ((state.resources.combat ?? 0) < amount) return false;
  state.resources.combat -= amount;
  return true;
}

/* ---------- Réserve de créatures (pont La Mare -> Bastion) ---------- */

/** Espèces actuellement assignées en défense (cardAssignments.defense) mais PAS encore
 *  placées sur le champ — c'est la "réserve de garnison" affichée dans le panneau. */
export function availableDefenseSpecies(state: GameState): string[] {
  const placed = new Set<string>();
  state.bastion.barracksSlots.forEach((s) => s.occupant && placed.add(s.occupant));
  state.bastion.mortarSlots.forEach((s) => s.occupant && placed.add(s.occupant));
  return state.cardAssignments.defense.filter((id) => !placed.has(id));
}

export function placeSpeciesCard(
  state: GameState,
  speciesId: string,
  kind: "barracks" | "mortar",
  slotId: string,
): boolean {
  if (!state.cardAssignments.defense.includes(speciesId)) return false;
  if (availableDefenseSpecies(state).includes(speciesId) === false) return false; // déjà placée ailleurs
  const sp = speciesConfig(speciesId);
  if (!sp) return false;
  if (kind === "barracks") {
    if (sp.role !== "defense") return false;
    const slot = state.bastion.barracksSlots.find((s) => s.id === slotId);
    const active = state.bastion.barracksSlots.indexOf(slot!) < state.bastion.barracksSlotsUnlocked;
    if (!slot || !active || slot.occupant) return false;
    slot.occupant = speciesId;
  } else {
    if (sp.role !== "assaut") return false;
    const slot = state.bastion.mortarSlots.find((s) => s.id === slotId);
    const active = state.bastion.mortarSlots.indexOf(slot!) < state.bastion.mortarSlotsUnlocked;
    if (!slot || !active || slot.occupant) return false;
    slot.occupant = speciesId;
  }
  return true;
}

export function removeSpeciesFromSlot(state: GameState, kind: "barracks" | "mortar", slotId: string): void {
  const list = kind === "barracks" ? state.bastion.barracksSlots : state.bastion.mortarSlots;
  const slot = list.find((s) => s.id === slotId);
  if (slot) slot.occupant = null;
}

/* ---------- Réserve de bâtiments (tourelles/murs/pièges/support, recrutés en Boutique) ---------- */

export function ownedBuildingCount(bastion: BastionState): number {
  const placed =
    bastion.turretSlots.filter((s) => s.occupant).length +
    bastion.mortarSlots.length * 0 + // les mortiers reçoivent des créatures, pas des bâtiments
    bastion.fieldStructures.length +
    bastion.support.filter((s) => s).length;
  return placed + bastion.buildingReserve.length;
}

export function recruitBuilding(state: GameState): boolean {
  const cost = recruitBuildingCost(ownedBuildingCount(state.bastion));
  if (!spend(state, cost)) return false;
  const [roll1, seed1] = rand(state.rngSeed);
  const [roll2, seed2] = rand(seed1);
  state.rngSeed = seed2;
  const def = rollBuildingDef(roll1, roll2);
  state.bastion.buildingReserve.push({ uid: state.bastion.nextBuildingUid++, defId: def.id });
  return true;
}

export function recycleBuilding(state: GameState, uid: number): boolean {
  const idx = state.bastion.buildingReserve.findIndex((b) => b.uid === uid);
  if (idx < 0) return false;
  const def = buildingDef(state.bastion.buildingReserve[idx].defId);
  state.bastion.buildingReserve.splice(idx, 1);
  if (def) state.resources.combat = (state.resources.combat ?? 0) + Math.round(def.cost * 0.5);
  return true;
}

const MIN_STRUCTURE_DIST = 46;

export function canPlaceFieldStructureAt(bastion: BastionState, x: number, y: number, excludeUid?: number): boolean {
  return !bastion.fieldStructures.some((s) => s.uid !== excludeUid && Math.hypot(s.x - x, s.y - y) < MIN_STRUCTURE_DIST);
}

export function placeBuildingFromReserve(
  state: GameState,
  uid: number,
  kind: "turret" | "support" | "wall" | "trap",
  target: { slotId?: string; supportIndex?: number; x?: number; y?: number },
): boolean {
  const idx = state.bastion.buildingReserve.findIndex((b) => b.uid === uid);
  if (idx < 0) return false;
  const inst = state.bastion.buildingReserve[idx];
  const def = buildingDef(inst.defId);
  if (!def || def.category !== (kind === "turret" ? "turret" : kind === "support" ? "support" : kind)) return false;

  if (kind === "turret") {
    const slot = state.bastion.turretSlots.find((s) => s.id === target.slotId);
    const active = slot && state.bastion.turretSlots.indexOf(slot) < state.bastion.turretSlotsUnlocked;
    if (!slot || !active || slot.occupant) return false;
    slot.occupant = inst.defId;
  } else if (kind === "support") {
    const i = target.supportIndex ?? -1;
    if (i < 0 || i >= state.bastion.support.length || state.bastion.support[i]) return false;
    state.bastion.support[i] = { occupant: inst.defId, charge: 0, ready: false };
  } else {
    if (target.x === undefined || target.y === undefined) return false;
    if (!canPlaceFieldStructureAt(state.bastion, target.x, target.y)) return false;
    const s: FieldStructure = {
      uid: state.bastion.nextStructureUid++,
      x: target.x,
      y: target.y,
      occupant: inst.defId,
      hp: def.blockHp ?? 40,
      hpMax: def.blockHp ?? 40,
    };
    state.bastion.fieldStructures.push(s);
  }
  state.bastion.buildingReserve.splice(idx, 1);
  return true;
}

export function removeTurretToReserve(state: GameState, slotId: string): boolean {
  const slot = state.bastion.turretSlots.find((s) => s.id === slotId);
  if (!slot?.occupant) return false;
  state.bastion.buildingReserve.push({ uid: state.bastion.nextBuildingUid++, defId: slot.occupant });
  slot.occupant = null;
  return true;
}

export function removeSupportToReserve(state: GameState, index: number): boolean {
  const s = state.bastion.support[index];
  if (!s) return false;
  state.bastion.buildingReserve.push({ uid: state.bastion.nextBuildingUid++, defId: s.occupant });
  state.bastion.support[index] = null;
  return true;
}

export function removeFieldStructureToReserve(state: GameState, structUid: number): boolean {
  const idx = state.bastion.fieldStructures.findIndex((s) => s.uid === structUid);
  if (idx < 0) return false;
  const s = state.bastion.fieldStructures[idx];
  state.bastion.buildingReserve.push({ uid: state.bastion.nextBuildingUid++, defId: s.occupant });
  state.bastion.fieldStructures.splice(idx, 1);
  return true;
}

/* ---------- Déplacer / échanger ---------- */

export function moveOrSwapTurret(state: GameState, fromId: string, toId: string): boolean {
  const from = state.bastion.turretSlots.find((s) => s.id === fromId);
  const to = state.bastion.turretSlots.find((s) => s.id === toId);
  if (!from || !to || from === to) return false;
  const tmp = to.occupant;
  to.occupant = from.occupant;
  from.occupant = tmp;
  return true;
}

export function moveOrSwapMortar(state: GameState, fromId: string, toId: string): boolean {
  const from = state.bastion.mortarSlots.find((s) => s.id === fromId);
  const to = state.bastion.mortarSlots.find((s) => s.id === toId);
  if (!from || !to || from === to) return false;
  const tmp = to.occupant;
  to.occupant = from.occupant;
  from.occupant = tmp;
  return true;
}

/** Les barracks échangent uniquement l'occupant : l'arborescence de spécialisation
 *  (treeLevel/treePath) reste attachée à l'emplacement, pas à la créature — même
 *  logique que le prototype autonome (on investit dans "cette position"). */
export function moveOrSwapBarracks(state: GameState, fromId: string, toId: string): boolean {
  const from = state.bastion.barracksSlots.find((s) => s.id === fromId);
  const to = state.bastion.barracksSlots.find((s) => s.id === toId);
  if (!from || !to || from === to) return false;
  const tmp = to.occupant;
  to.occupant = from.occupant;
  from.occupant = tmp;
  return true;
}

export function moveOrSwapSupport(state: GameState, fromIndex: number, toIndex: number): boolean {
  const { support } = state.bastion;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= support.length || toIndex >= support.length) return false;
  const tmp = support[toIndex];
  support[toIndex] = support[fromIndex];
  support[fromIndex] = tmp;
  return true;
}

export function moveFieldStructure(state: GameState, uid: number, x: number, y: number): boolean {
  const s = state.bastion.fieldStructures.find((f) => f.uid === uid);
  if (!s) return false;
  if (!canPlaceFieldStructureAt(state.bastion, x, y, uid)) return false;
  s.x = x;
  s.y = y;
  return true;
}

/* ---------- Boutique : emplacements, réserve, spécialisation, fondations, renforts ---------- */

export function buySlotUnlock(state: GameState, kind: "turret" | "barracks" | "mortar"): boolean {
  const b = state.bastion;
  if (kind === "turret") {
    if (b.turretSlotsUnlocked >= BASTION.slots.turret_total) return false;
    const cost = turretSlotUnlockCost(b.turretSlotsUnlocked + 1);
    if (!spend(state, cost)) return false;
    b.turretSlotsUnlocked += 1;
  } else if (kind === "barracks") {
    if (b.barracksSlotsUnlocked >= BASTION.slots.barracks_total) return false;
    const cost = barracksSlotUnlockCost(b.barracksSlotsUnlocked + 1);
    if (!spend(state, cost)) return false;
    b.barracksSlotsUnlocked += 1;
  } else {
    if (b.mortarSlotsUnlocked >= BASTION.slots.mortar_total) return false;
    const cost = mortarSlotUnlockCost(b.mortarSlotsUnlocked + 1);
    if (!spend(state, cost)) return false;
    b.mortarSlotsUnlocked += 1;
  }
  return true;
}

export function buyReserveCap(state: GameState): boolean {
  const b = state.bastion;
  if (b.reserveCap >= BASTION.reserve.max_cap) return false;
  if (!spend(state, reserveCapCost(b.reserveCap))) return false;
  b.reserveCap += 1;
  return true;
}

export function buySpecCap(state: GameState): boolean {
  const b = state.bastion;
  if (b.maxTreeLevel >= BASTION.tree_cap.max_level) return false;
  if (!spend(state, specCapCost(b.maxTreeLevel))) return false;
  b.maxTreeLevel += 1;
  return true;
}

export function buyFoundations(state: GameState): boolean {
  const b = state.bastion;
  if (b.slotBonusLevel >= BASTION.foundations.max_level) return false;
  if (!spend(state, foundationsCost(b.slotBonusLevel))) return false;
  b.slotBonusLevel += 1;
  return true;
}

export function buyInWaveRespawn(state: GameState): boolean {
  const b = state.bastion;
  if (b.inWaveRespawnUnlocked) return false;
  if (!spend(state, IN_WAVE_RESPAWN_COST)) return false;
  b.inWaveRespawnUnlocked = true;
  return true;
}

/* ---------- Arborescence de spécialisation des barracks ---------- */

export function chooseTreeOption(state: GameState, slotId: string, choice: "a" | "b"): boolean {
  const slot = state.bastion.barracksSlots.find((s) => s.id === slotId);
  if (!slot || !slot.occupant) return false;
  if (slot.treeLevel >= state.bastion.maxTreeLevel) return false;
  if (slot.treeLevel >= BASTION.barracks_tree.length) return false;
  slot.treePath = [...slot.treePath, choice];
  slot.treeLevel += 1;
  return true;
}

/** À appeler par le species non trouvée -> fallback safe pour la satisfaction TS des appelants. */
export function isDefenseEligible(speciesId: string): boolean {
  const sp = speciesConfig(speciesId);
  return !!sp && sp.role === "defense";
}
export function isAssaultEligible(speciesId: string): boolean {
  const sp = speciesConfig(speciesId);
  return !!sp && sp.role === "assaut";
}

export type { CardEntry };
