/* Moteur de combat pur du Bastion-Défense jouable — port du prototype autonome
   (evolve2_bastion_defense.html v8) en TypeScript. Contrairement à cards.ts/military.ts,
   ce moteur N'EST PAS seedé/déterministe : la bataille est du temps réel piloté par
   requestAnimationFrame côté client (composant BastionScene), jamais rejoué offline ni
   traversé par applyTick — Math.random() y est donc acceptable (cf. docs/JOURNAL.md).

   Le combat est délibérément simplifié par rapport au prototype (ciblage au plus proche,
   pas de vecteurs 2D élaborés) : même sensation de tower-defense, code plus court et
   testable indépendamment du rendu Canvas. */

import type { CardEntry } from "../types";
import {
  BASTION,
  BATTLE_Y_BOTTOM,
  BATTLE_Y_TOP,
  CASTLE,
  CORE_RADIUS,
  SPAWN_X,
  buildingDef,
  computeTreeMods,
  foundationsMult,
  rarityAcc,
  squadSizeFor,
  unitStatsFromSpecies,
} from "./config";
import type { PathogenDef } from "./config";
import type {
  BarracksSlot,
  BattleEnemy,
  BattleProjectile,
  BattleState,
  BattleTroop,
  EnemyId,
  FieldStructure,
  MortarSlot,
  StaticDefs,
  SupportSlotState,
} from "./types";

/* ---------- Constantes de combat (comportement, pas de rendu) ---------- */

const MELEE_RANGE = 22;
const ENEMY_ATTACK_RATE = 1.1; // coups/s au contact
const RESPAWN_DELAY_S = 2.5;
const TRAP_TRIGGER_RANGE_PAD = 0; // le rayon du piège suffit

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/* ---------- Génération de vague ---------- */

export interface LiveWavePlan {
  spawnQueue: { typeId: EnemyId; t: number; isBoss?: boolean }[];
  hpMult: number;
  dmgMult: number;
  isBoss: boolean;
}

/** PRNG local (mulberry32) semé par le NUMÉRO de vague : la COMPOSITION d'une vague est
 *  donc stable — la vague 7 contient toujours les mêmes espèces, quel que soit le moment
 *  où on la génère. C'est ce qui rend l'aperçu de la Vigie (previewWave) exact et non pas
 *  seulement indicatif. Le déroulé du combat, lui, reste non déterministe (Math.random
 *  dans stepBattle) : seul le contenu annoncé est garanti. */
function waveRng(waveN: number): () => number {
  let s = (waveN * 0x9e3779b1) ^ 0x5bf03635;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genLiveWave(waveN: number): LiveWavePlan {
  const w = BASTION.wave;
  const p = BASTION.pathogens;
  const rng = waveRng(waveN);
  const isBoss = waveN % p.boss_every === 0;
  const pool = p.roster.filter((e) => e.unlock <= waveN);
  const numTypes = Math.max(w.num_types_base, Math.min(w.num_types_max, w.num_types_base + Math.floor(waveN / w.num_types_per_waves)));
  const chosen: PathogenDef[] = [];
  const copy = pool.slice();
  for (let i = 0; i < numTypes && copy.length; i++) {
    const idx = Math.floor(rng() * copy.length);
    chosen.push(copy.splice(idx, 1)[0]);
  }
  if (chosen.length === 0 && pool.length) chosen.push(pool[0]);
  const count = Math.round(w.count_base + waveN * w.count_per_wave);
  const hpMult = 1 + waveN * w.hp_mult_per_wave;
  const dmgMult = 1 + waveN * w.dmg_mult_per_wave;
  const spawnGap = Math.max(w.spawn_gap_min, w.spawn_gap_base - waveN * w.spawn_gap_per_wave);
  const spawnQueue: LiveWavePlan["spawnQueue"] = [];
  for (let i = 0; i < count; i++) {
    spawnQueue.push({ typeId: chosen[i % chosen.length].id, t: i * spawnGap });
  }
  if (isBoss) {
    spawnQueue.push({ typeId: p.boss.id, t: count * spawnGap + 1.2, isBoss: true });
  }
  spawnQueue.sort((a, b) => a.t - b.t);
  return { spawnQueue, hpMult, dmgMult, isBoss };
}

/* ---------- Aperçu de vague (Vigie) ---------- */

export interface WavePreview {
  waveN: number;
  isBoss: boolean;
  total: number;
  hpMult: number;
  dmgMult: number;
  /** Effectif par espèce, du plus nombreux au moins nombreux (boss exclu). */
  types: { id: EnemyId; name: string; count: number; hp: number; dmg: number; ranged: boolean }[];
  boss: { id: EnemyId; name: string; hp: number; dmg: number } | null;
}

/** Contenu EXACT de la vague `waveN` — dérivé de genLiveWave lui-même (jamais réécrit
 *  en parallèle) pour que l'aperçu ne puisse pas diverger du combat réellement joué. */
export function previewWave(waveN: number): WavePreview {
  const plan = genLiveWave(waveN);
  const counts = new Map<EnemyId, number>();
  for (const s of plan.spawnQueue) {
    if (s.isBoss) continue;
    counts.set(s.typeId, (counts.get(s.typeId) ?? 0) + 1);
  }
  const types = [...counts.entries()]
    .map(([id, count]) => {
      const def = pathogenDef(id, false);
      return {
        id,
        name: def.name,
        count,
        hp: Math.round(def.hp * plan.hpMult),
        dmg: Math.round(def.dmg * plan.dmgMult),
        ranged: !!def.ranged,
      };
    })
    .sort((a, b) => b.count - a.count);
  const bossDef = BASTION.pathogens.boss;
  return {
    waveN,
    isBoss: plan.isBoss,
    total: plan.spawnQueue.length,
    hpMult: plan.hpMult,
    dmgMult: plan.dmgMult,
    types,
    boss: plan.isBoss
      ? {
          id: bossDef.id,
          name: bossDef.name,
          hp: Math.round(bossDef.hp * plan.hpMult),
          dmg: Math.round(bossDef.dmg * plan.dmgMult),
        }
      : null,
  };
}

function pathogenDef(typeId: EnemyId, isBoss: boolean): PathogenDef {
  if (isBoss) return BASTION.pathogens.boss;
  return BASTION.pathogens.roster.find((e) => e.id === typeId) ?? BASTION.pathogens.roster[0];
}

/* ---------- Init de bataille : spawn immédiat des troupes (barracks + mortiers) ---------- */

function spawnSquadTroop(
  battle: BattleState,
  slot: BarracksSlot,
  speciesId: string,
  entry: CardEntry,
  ctx: StaticDefs,
): BattleTroop {
  const base = unitStatsFromSpecies(speciesId, entry, "barracks")!;
  const tree = computeTreeMods(slot);
  const fMult = foundationsMult(ctx.slotBonusLevel);
  const jitterX = (Math.random() - 0.5) * 26;
  const jitterY = (Math.random() - 0.5) * 26;
  return {
    uid: battle.nextUid++,
    speciesId,
    sourceSlotId: slot.id,
    kind: "barracks",
    x: slot.x + 30 + jitterX,
    y: slot.y + jitterY,
    homeX: slot.x + 30,
    homeY: slot.y,
    hp: Math.round(base.hp * tree.hpMult * fMult),
    hpMax: Math.round(base.hp * tree.hpMult * fMult),
    dmg: Math.round(base.dmg * tree.dmgMult * ctx.mods.dmgMult * fMult),
    rate: base.rate * tree.rateMult,
    range: base.range,
    acc: base.acc,
    atkCd: 0,
    dying: false,
    deathTimer: 0,
    hitFlash: 0,
  };
}

function spawnMortarTroop(battle: BattleState, slot: MortarSlot, speciesId: string, entry: CardEntry, ctx: StaticDefs): BattleTroop {
  const base = unitStatsFromSpecies(speciesId, entry, "mortar")!;
  const fMult = foundationsMult(ctx.slotBonusLevel);
  return {
    uid: battle.nextUid++,
    speciesId,
    sourceSlotId: slot.id,
    kind: "mortar",
    x: slot.x,
    y: slot.y,
    homeX: slot.x,
    homeY: slot.y,
    hp: Math.round(base.hp * fMult),
    hpMax: Math.round(base.hp * fMult),
    dmg: Math.round(base.dmg * ctx.mods.dmgMult * fMult),
    rate: base.rate,
    range: base.range * ctx.mods.rangeMult,
    acc: base.acc,
    atkCd: 0,
    dying: false,
    deathTimer: 0,
    hitFlash: 0,
  };
}

export function initBattle(waveN: number, bastionHpMax: number, ctx: StaticDefs): BattleState {
  const plan = genLiveWave(waveN);
  const battle: BattleState = {
    active: true,
    waveN,
    bastionHp: bastionHpMax,
    bastionHpMax,
    elapsed: 0,
    spawnQueue: plan.spawnQueue,
    enemies: [],
    troops: [],
    projectiles: [],
    pendingRespawns: [],
    turretCooldowns: {},
    trapsTriggered: {},
    kills: 0,
    won: null,
    nextUid: 1,
  };
  ctx.barracksSlots.forEach((slot) => {
    if (!slot.occupant) return;
    const entry = ctx.collection[slot.occupant];
    if (!entry) return;
    const n = squadSizeFor(entry);
    for (let i = 0; i < n; i++) battle.troops.push(spawnSquadTroop(battle, slot, slot.occupant, entry, ctx));
  });
  ctx.mortarSlots.forEach((slot) => {
    if (!slot.occupant) return;
    const entry = ctx.collection[slot.occupant];
    if (!entry) return;
    battle.troops.push(spawnMortarTroop(battle, slot, slot.occupant, entry, ctx));
  });
  // Attache hpMult/dmgMult de la vague sur l'objet retourné pour spawnEnemy (closure via WeakMap
  // serait excessif ici — on les recalcule à la volée dans stepBattle via genLiveWave(waveN)).
  return battle;
}

/* ---------- Ciblage ---------- */

interface Target {
  kind: "structure" | "troop" | "core";
  x: number;
  y: number;
  ref?: FieldStructure | BattleTroop;
}

function nearestTargetForEnemy(en: BattleEnemy, ctx: StaticDefs, troops: BattleTroop[]): Target {
  let best: Target = { kind: "core", x: CASTLE.x, y: CASTLE.y };
  let bestD = dist(en.x, en.y, CASTLE.x, CASTLE.y);
  ctx.fieldStructures.forEach((s) => {
    const d = dist(en.x, en.y, s.x, s.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: "structure", x: s.x, y: s.y, ref: s };
    }
  });
  troops.forEach((t) => {
    if (t.dying) return;
    const d = dist(en.x, en.y, t.x, t.y);
    if (d < bestD) {
      bestD = d;
      best = { kind: "troop", x: t.x, y: t.y, ref: t };
    }
  });
  return best;
}

/* ---------- Projectiles ---------- */

const PROJECTILE_SPEED = 520; // px/s, purement une constante de rendu/rythme

function fireProjectile(
  battle: BattleState,
  from: { x: number; y: number },
  targetUid: number,
  targetPos: { x: number; y: number },
  dmg: number,
  acc: number,
  opts: Partial<Pick<BattleProjectile, "arc" | "splashRadius" | "chainCount" | "chainRadius" | "vfx">> = {},
): void {
  const travelTime = Math.max(0.05, dist(from.x, from.y, targetPos.x, targetPos.y) / PROJECTILE_SPEED);
  battle.projectiles.push({
    uid: battle.nextUid++,
    x: from.x,
    y: from.y,
    fromX: from.x,
    fromY: from.y,
    targetUid,
    dmg: Math.random() < acc ? dmg : 0,
    speed: PROJECTILE_SPEED,
    acc,
    arc: !!opts.arc,
    splashRadius: opts.splashRadius ?? 0,
    chainCount: opts.chainCount ?? 0,
    chainRadius: opts.chainRadius ?? 0,
    vfx: opts.vfx ?? "basic",
    t: 0,
    travelTime,
  });
}

function damageEnemy(battle: BattleState, en: BattleEnemy, amount: number): void {
  if (en.dying) return;
  en.hp -= amount;
  en.hitFlash = 0.15;
  if (en.hp <= 0) {
    en.dying = true;
    en.deathTimer = 0;
    battle.kills += 1;
  }
}

function resolveProjectileImpact(battle: BattleState, proj: BattleProjectile): void {
  const target = battle.enemies.find((e) => e.uid === proj.targetUid);
  if (!target || target.dying) return; // la cible est déjà tombée entre-temps : le tir se perd
  if (proj.dmg <= 0) return; // précision ratée (déjà tiré au hasard à l'émission)
  damageEnemy(battle, target, proj.dmg);
  if (proj.splashRadius > 0) {
    battle.enemies.forEach((e) => {
      if (e === target || e.dying) return;
      if (dist(e.x, e.y, target.x, target.y) <= proj.splashRadius) damageEnemy(battle, e, proj.dmg * 0.5);
    });
  }
  if (proj.chainCount > 0) {
    let prev = target;
    const hit = new Set([target.uid]);
    let falloff = 1;
    for (let i = 0; i < proj.chainCount; i++) {
      falloff *= 0.65;
      const candidates = battle.enemies.filter((e) => !hit.has(e.uid) && !e.dying && dist(e.x, e.y, prev.x, prev.y) <= proj.chainRadius);
      candidates.sort((a, b) => dist(a.x, a.y, prev.x, prev.y) - dist(b.x, b.y, prev.x, prev.y));
      const next = candidates[0];
      if (!next) break;
      hit.add(next.uid);
      damageEnemy(battle, next, proj.dmg * falloff);
      prev = next;
    }
  }
}

/* ---------- Boucle principale ---------- */

export function stepBattle(battle: BattleState, dt: number, ctx: StaticDefs): void {
  if (!battle.active) return;
  battle.elapsed += dt;

  // 1) apparitions programmées
  while (battle.spawnQueue.length && battle.spawnQueue[0].t <= battle.elapsed) {
    const spawn = battle.spawnQueue.shift()!;
    const type = pathogenDef(spawn.typeId, !!spawn.isBoss);
    const plan = genLiveWave(battle.waveN);
    const hp = Math.round(type.hp * plan.hpMult);
    battle.enemies.push({
      uid: battle.nextUid++,
      typeId: type.id,
      isBoss: !!spawn.isBoss,
      x: SPAWN_X,
      y: BATTLE_Y_TOP + Math.random() * (BATTLE_Y_BOTTOM - BATTLE_Y_TOP),
      hp,
      hpMax: hp,
      dmg: Math.round(type.dmg * plan.dmgMult),
      speed: type.speed,
      ranged: !!type.ranged,
      atkRange: type.atkRange ?? 0,
      atkCd: 0,
      slowUntil: 0,
      slowPct: 0,
      dying: false,
      deathTimer: 0,
      hitFlash: 0,
    });
  }

  // 2) ennemis : cible + déplacement + attaque
  battle.enemies.forEach((en) => {
    if (en.hitFlash > 0) en.hitFlash = Math.max(0, en.hitFlash - dt);
    if (en.dying) {
      en.deathTimer += dt;
      return;
    }
    const target = nearestTargetForEnemy(en, ctx, battle.troops);
    const isCore = target.kind === "core";
    const engageRange = isCore ? CORE_RADIUS : en.ranged ? en.atkRange : MELEE_RANGE;
    const d = dist(en.x, en.y, target.x, target.y);
    const slow = en.slowUntil > battle.elapsed ? 1 - en.slowPct : 1;
    if (d > engageRange) {
      const speed = en.speed * slow;
      en.x += ((target.x - en.x) / d) * speed * dt;
      en.y += ((target.y - en.y) / d) * speed * dt;
    } else {
      en.atkCd -= dt;
      if (en.atkCd <= 0) {
        en.atkCd = 1 / ENEMY_ATTACK_RATE;
        if (isCore) {
          battle.bastionHp = Math.max(0, battle.bastionHp - en.dmg);
        } else if (target.kind === "structure" && target.ref) {
          const s = target.ref as FieldStructure;
          s.hp = Math.max(0, s.hp - en.dmg);
          if (s.hp <= 0) {
            const idx = ctx.fieldStructures.indexOf(s);
            if (idx >= 0) ctx.fieldStructures.splice(idx, 1);
          }
        } else if (target.kind === "troop" && target.ref) {
          const t = target.ref as BattleTroop;
          if (!t.dying) {
            t.hp -= en.dmg;
            t.hitFlash = 0.15;
            if (t.hp <= 0) {
              t.dying = true;
              t.deathTimer = 0;
              if (ctx.inWaveRespawnUnlocked) {
                battle.pendingRespawns.push({
                  sourceSlotId: t.sourceSlotId,
                  kind: t.kind,
                  speciesId: t.speciesId,
                  at: battle.elapsed + RESPAWN_DELAY_S,
                });
              }
            }
          }
        }
      }
    }
  });

  // 3) troupes (barracks + mortiers) : ciblage + déplacement + attaque
  battle.troops.forEach((t) => {
    if (t.hitFlash > 0) t.hitFlash = Math.max(0, t.hitFlash - dt);
    if (t.dying) {
      t.deathTimer += dt;
      return;
    }
    let target: BattleEnemy | null = null;
    let bestD = Infinity;
    battle.enemies.forEach((en) => {
      if (en.dying) return;
      const d = dist(t.x, t.y, en.x, en.y);
      if (d < bestD) {
        bestD = d;
        target = en;
      }
    });
    if (t.kind === "barracks") {
      if (target && bestD > t.range) {
        const d = bestD;
        const tgt = target as BattleEnemy;
        t.x += ((tgt.x - t.x) / d) * 90 * dt;
        t.y += ((tgt.y - t.y) / d) * 90 * dt;
      } else {
        // revient doucement vers sa position d'origine si rien à combattre
        if (!target) {
          const d = dist(t.x, t.y, t.homeX, t.homeY);
          if (d > 4) {
            t.x += ((t.homeX - t.x) / d) * 60 * dt;
            t.y += ((t.homeY - t.y) / d) * 60 * dt;
          }
        }
      }
    }
    t.atkCd -= dt;
    if (target && bestD <= t.range && t.atkCd <= 0) {
      t.atkCd = 1 / t.rate;
      fireProjectile(battle, { x: t.x, y: t.y }, (target as BattleEnemy).uid, { x: (target as BattleEnemy).x, y: (target as BattleEnemy).y }, t.dmg, t.acc, {
        arc: t.kind === "mortar",
        vfx: t.kind === "mortar" ? "catapult" : "basic",
      });
    }
  });

  // 4) tourelles (statiques)
  ctx.turretSlots.forEach((slot) => {
    if (!slot.occupant) return;
    const def = buildingDef(slot.occupant);
    if (!def) return;
    const cd = (battle.turretCooldowns[slot.id] ?? 0) - dt;
    battle.turretCooldowns[slot.id] = cd;
    const range = (def.range ?? 820) * ctx.mods.rangeMult;
    let target: BattleEnemy | null = null;
    let bestD = range;
    battle.enemies.forEach((en) => {
      if (en.dying) return;
      const d = dist(slot.x, slot.y, en.x, en.y);
      if (d <= bestD) {
        bestD = d;
        target = en;
      }
    });
    if (target && cd <= 0) {
      battle.turretCooldowns[slot.id] = 1 / (def.rate ?? 1);
      const acc = Math.min(0.99, rarityAcc(3) + ctx.mods.accBonus);
      fireProjectile(battle, slot, (target as BattleEnemy).uid, { x: (target as BattleEnemy).x, y: (target as BattleEnemy).y }, (def.dmg ?? 5) * ctx.mods.dmgMult, acc, {
        splashRadius: def.splash ?? 0,
        chainCount: def.chainCount ?? 0,
        chainRadius: def.chainRadius ?? 0,
        vfx: def.chainCount ? "electric" : def.splash ? "splash" : "basic",
      });
    }
  });

  // 5) pièges (une seule fois par vague, au premier ennemi qui entre dans le rayon)
  ctx.fieldStructures.forEach((s) => {
    const def = buildingDef(s.occupant);
    if (!def || def.category !== "trap") return;
    if (battle.trapsTriggered[s.uid]) return;
    const hit = battle.enemies.filter((en) => !en.dying && dist(en.x, en.y, s.x, s.y) <= (def.radius ?? 70) + TRAP_TRIGGER_RANGE_PAD);
    if (hit.length) {
      battle.trapsTriggered[s.uid] = true;
      hit.forEach((en) => {
        damageEnemy(battle, en, def.burst ?? 20);
        if (def.slowPct) {
          en.slowPct = def.slowPct;
          en.slowUntil = battle.elapsed + (def.slowDur ?? 2);
        }
      });
    }
  });

  // 6) projectiles en vol
  battle.projectiles = battle.projectiles.filter((p) => {
    p.t += dt;
    if (p.t >= p.travelTime) {
      resolveProjectileImpact(battle, p);
      return false;
    }
    const frac = p.t / p.travelTime;
    const target = battle.enemies.find((e) => e.uid === p.targetUid);
    const tx = target ? target.x : p.fromX;
    const ty = target ? target.y : p.fromY;
    p.x = p.fromX + (tx - p.fromX) * frac;
    p.y = p.fromY + (ty - p.fromY) * frac;
    return true;
  });

  // 7) nettoyage des morts (après le temps d'anim de mort ~0.3s)
  battle.enemies = battle.enemies.filter((e) => !(e.dying && e.deathTimer > 0.3));
  battle.troops = battle.troops.filter((t) => !(t.dying && t.deathTimer > 0.3));

  // 8) renforts en combat (si débloqué)
  if (ctx.inWaveRespawnUnlocked && battle.pendingRespawns.length) {
    const ready = battle.pendingRespawns.filter((r) => r.at <= battle.elapsed);
    if (ready.length) {
      battle.pendingRespawns = battle.pendingRespawns.filter((r) => r.at > battle.elapsed);
      ready.forEach((r) => {
        const entry = ctx.collection[r.speciesId];
        if (!entry) return;
        if (r.kind === "barracks") {
          const slot = ctx.barracksSlots.find((b) => b.id === r.sourceSlotId && b.occupant === r.speciesId);
          if (slot) battle.troops.push(spawnSquadTroop(battle, slot, r.speciesId, entry, ctx));
        } else {
          const slot = ctx.mortarSlots.find((m) => m.id === r.sourceSlotId && m.occupant === r.speciesId);
          if (slot) battle.troops.push(spawnMortarTroop(battle, slot, r.speciesId, entry, ctx));
        }
      });
    }
  }

  // 9) conditions de fin
  if (battle.bastionHp <= 0) {
    battle.bastionHp = 0;
    battle.won = false;
    battle.active = false;
  } else if (battle.spawnQueue.length === 0 && battle.enemies.length === 0) {
    battle.won = true;
    battle.active = false;
  }
}

/* ---------- Pouvoirs de support actifs (déclenchés par un tap du joueur) ---------- */

export function applySupportActive(battle: BattleState, support: SupportSlotState): void {
  const def = buildingDef(support.occupant);
  if (!def || !def.active) return;
  if (def.effect === "strikeAll") {
    battle.enemies.forEach((en) => {
      if (!en.dying) damageEnemy(battle, en, def.value ?? 40);
    });
  } else if (def.effect === "shieldBurst") {
    battle.bastionHp = Math.min(battle.bastionHpMax, battle.bastionHp + battle.bastionHpMax * (def.value ?? 0.35));
  }
  support.charge = 0;
  support.ready = false;
}

/** Appelé par le composant à chaque élimination pour créditer les supports ACTIFS
 *  (charge en éliminations, indépendant du round — mirroring le prototype autonome). */
export function registerKillsOnSupport(support: (SupportSlotState | null)[], killCount: number): void {
  if (killCount <= 0) return;
  support.forEach((s) => {
    if (!s) return;
    const def = buildingDef(s.occupant);
    if (!def?.active) return;
    if (s.ready) return;
    s.charge = Math.min(def.chargeKills ?? 999, s.charge + killCount);
    if (s.charge >= (def.chargeKills ?? 999)) s.ready = true;
  });
}
