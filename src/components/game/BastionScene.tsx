/* Scène Canvas du Bastion-Défense jouable — mode "placement" (slots tourelle/barracks/
   mortier + structures posées librement, lisible et tappable) et mode "bataille" (vague en
   direct simulée image par image via bastion/engine.ts, jamais persistée ni rejouée offline).
   Pattern calqué sur CellScene.tsx : cache d'images au niveau module, useRef+useEffect pour
   la boucle rAF, lecture directe de useGame.getState() (aucune prop de données lourde). */
"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { cardArt, speciesConfig } from "@/lib/game/cards";
import {
  activeBarracksSlots,
  activeMortarSlots,
  activeTurretSlots,
  bastionHpMax,
  buildingDef,
  buildingIcon,
  buildingRarityColor,
  buildStaticDefs,
  CANVAS_H,
  CANVAS_W,
  CASTLE,
  CORE_RADIUS,
  regenFieldStructures,
  SPAWN_X,
} from "@/lib/game/bastion/config";
import { applySupportActive, initBattle, registerKillsOnSupport, stepBattle } from "@/lib/game/bastion/engine";
import type {
  BastionSlotTarget,
  BattleState,
  FieldStructure,
  LiveWaveResult,
  SupportSlotState,
} from "@/lib/game/bastion/types";
import { useGame } from "@/lib/game/store";

/* ---------- Cache d'images (module-level, partagé entre montages) ---------- */

const imgCache = new Map<string, HTMLImageElement>();
function getImage(src: string): HTMLImageElement {
  let img = imgCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imgCache.set(src, img);
  }
  return img;
}
function ready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/* ---------- API impérative exposée à BastionPanel ---------- */

export interface BastionBattleSnapshot {
  active: boolean;
  waveN: number;
  bastionHp: number;
  bastionHpMax: number;
  kills: number;
  support: (SupportSlotState | null)[];
}

export interface BastionSceneHandle {
  /** Lance une vague EN DIRECT (régénère les structures à réparation, spawn immédiat
   *  des troupes de garnison). No-op si une bataille est déjà active. */
  startBattle: (waveN: number) => void;
  /** Déclenche le pouvoir actif d'un slot de support prêt (strikeAll/shieldBurst). */
  triggerSupportActive: (index: number) => void;
  /** Lecture ponctuelle de l'état de bataille (pour le HUD de BastionPanel, pollé à
   *  fréquence modeste — la boucle 60 fps elle-même reste interne à la scène). */
  getBattleSnapshot: () => BastionBattleSnapshot | null;
}

interface BastionSceneProps {
  /** Catégorie d'un item de réserve actuellement "armé" pour la pose — utilisé pour
   *  surligner les emplacements compatibles vides et prévisualiser la portée. */
  armedCategory: "turret" | "barracks" | "mortar" | "wall" | "trap" | null;
  armedRange?: number;
  /** Slot en cours de déplacement (anneau doré pulsant), état local à BastionPanel. */
  movingTarget: { kind: "turret" | "barracks" | "mortar"; id: string } | null;
  onTapSlot: (target: BastionSlotTarget) => void;
  /** Bataille terminée : résultat + structures survivantes (dégâts/destructions à
   *  répercuter sur l'état persisté via finishBastionBattle). */
  onBattleEnd: (result: LiveWaveResult, survivingStructures: FieldStructure[]) => void;
}

function depthScale(y: number): number {
  return 0.82 + 0.36 * ((y - 40) / (360 - 40));
}

function drawDashedEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  lineWidth: number,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pct: number, color: string) {
  ctx.fillStyle = "rgba(5,11,20,0.65)";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y - h / 2, w * Math.max(0, Math.min(1, pct)), h);
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRangeRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export const BastionScene = forwardRef<BastionSceneHandle, BastionSceneProps>(function BastionScene(
  { armedCategory, armedRange, movingTarget, onTapSlot, onBattleEnd },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const propsRef = useRef({ armedCategory, armedRange, movingTarget, onTapSlot, onBattleEnd });
  useEffect(() => {
    propsRef.current = { armedCategory, armedRange, movingTarget, onTapSlot, onBattleEnd };
  }, [armedCategory, armedRange, movingTarget, onTapSlot, onBattleEnd]);

  const battleRef = useRef<BattleState | null>(null);
  const supportRef = useRef<(SupportSlotState | null)[]>([]);
  const structuresRef = useRef<FieldStructure[]>([]);
  const endTimerRef = useRef<number | null>(null);

  /** Zones tappables du dernier rendu. */
  const hitZonesRef = useRef<BastionSlotTarget[]>([]);
  const hitPosRef = useRef<{ x: number; y: number; r: number }[]>([]);

  useImperativeHandle(ref, () => ({
    startBattle: (waveN) => {
      if (battleRef.current?.active) return;
      const state = useGame.getState();
      const structures = regenFieldStructures(state.bastion.fieldStructures);
      structuresRef.current = structures.map((s) => ({ ...s }));
      supportRef.current = state.bastion.support.map((s) => (s ? { ...s } : null));
      const ctx = buildStaticDefs(state, structuresRef.current);
      // PV du Bastion : socle de bastion_config.json × "Fondations renforcées" × vestige
      // "Socle basaltique" de La Dérive. Tout est calculé par bastionHpMax (module pur).
      battleRef.current = initBattle(waveN, bastionHpMax(state), ctx);
      endTimerRef.current = null;
    },
    triggerSupportActive: (index) => {
      const battle = battleRef.current;
      const s = supportRef.current[index];
      if (!battle || !battle.active || !s?.ready) return;
      applySupportActive(battle, s);
    },
    getBattleSnapshot: () => {
      const b = battleRef.current;
      if (!b) return null;
      return {
        active: b.active,
        waveN: b.waveN,
        bastionHp: b.bastionHp,
        bastionHpMax: b.bastionHpMax,
        kills: b.kills,
        support: supportRef.current,
      };
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    const resize = () => {
      cssW = Math.min(wrap.clientWidth, 700);
      cssH = cssW * (CANVAS_H / CANVAS_W);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();
    let lastKills = 0;

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      if (cssW <= 0) return;
      const scaleX = cssW / CANVAS_W;
      const scaleY = cssH / CANVAS_H;

      const state = useGame.getState();
      const bastion = state.bastion;
      const battle = battleRef.current;
      const { armedCategory: armed, armedRange: armedR, movingTarget: moving } = propsRef.current;

      /* --- Boucle de combat (si une bataille est en cours) --- */
      if (battle?.active) {
        const combatCtx = buildStaticDefs(state, structuresRef.current);
        stepBattle(battle, dt, combatCtx);
        structuresRef.current = combatCtx.fieldStructures;
        if (battle.kills > lastKills) {
          registerKillsOnSupport(supportRef.current, battle.kills - lastKills);
          lastKills = battle.kills;
        }
        if (!battle.active && battle.won !== null && endTimerRef.current === null) {
          endTimerRef.current = nowMs;
        }
      }
      if (battle && !battle.active && battle.won !== null && endTimerRef.current !== null) {
        if (nowMs - endTimerRef.current > 900) {
          const result: LiveWaveResult = {
            won: !!battle.won,
            waveN: battle.waveN,
            kills: battle.kills,
            bastionHpFrac: battle.bastionHpMax > 0 ? battle.bastionHp / battle.bastionHpMax : 0,
          };
          const surviving = structuresRef.current;
          battleRef.current = null;
          endTimerRef.current = null;
          lastKills = 0;
          propsRef.current.onBattleEnd(result, surviving);
        }
      }

      /* --- Rendu --- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.imageSmoothingEnabled = false;

      // Fond
      const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      g.addColorStop(0, "#0d2436");
      g.addColorStop(0.55, "#0a1626");
      g.addColorStop(1, "#050b14");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      const halo = ctx.createRadialGradient(CASTLE.x, CASTLE.y, 10, CASTLE.x, CASTLE.y, 260);
      halo.addColorStop(0, "rgba(143,123,255,0.16)");
      halo.addColorStop(1, "rgba(143,123,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      const rg = ctx.createLinearGradient(0, 0, 205, 0);
      rg.addColorStop(0, "rgba(90,70,150,0.5)");
      rg.addColorStop(1, "rgba(90,70,150,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, 205, CANVAS_H);

      // Ligne d'apparition
      ctx.save();
      ctx.strokeStyle = "rgba(255,84,214,0.3)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(SPAWN_X + 14, 8);
      ctx.lineTo(SPAWN_X + 14, CANVAS_H - 8);
      ctx.stroke();
      ctx.restore();

      // Anneau du cœur protégé
      ctx.save();
      ctx.strokeStyle = "rgba(255,207,77,0.28)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(CASTLE.x, CASTLE.y, CORE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Bastion (réutilise le sprite existant du bâtiment "defense" — pas de nouvel asset)
      const hqImg = getImage("/assets/buildings/defense/niveau1.png");
      if (ready(hqImg)) ctx.drawImage(hqImg, CASTLE.x - 42, CASTLE.y - 78, 84, 84);
      ctx.font = "10px monospace";
      ctx.fillStyle = "rgba(207,232,242,0.6)";
      ctx.textAlign = "center";
      ctx.fillText("BASTION", CASTLE.x, CASTLE.y + 50);

      // PV du Bastion (barre au-dessus, visible seulement en bataille)
      if (battle) {
        drawHpBar(ctx, CASTLE.x, CASTLE.y - 92, 90, 7, battle.bastionHp / Math.max(1, battle.bastionHpMax), "#a6ff3d");
        ctx.font = "9px monospace";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(`${Math.round(battle.bastionHp)}/${battle.bastionHpMax}`, CASTLE.x, CASTLE.y - 100);
      }

      // Anneau doré pulsant : slot en cours de déplacement
      if (moving && !battle) {
        const posOf = () => {
          if (moving.kind === "turret") return bastion.turretSlots.find((s) => s.id === moving.id);
          if (moving.kind === "mortar") return bastion.mortarSlots.find((s) => s.id === moving.id);
          return bastion.barracksSlots.find((s) => s.id === moving.id);
        };
        const mv = posOf();
        if (mv) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 6);
          ctx.save();
          ctx.strokeStyle = `rgba(255,207,77,${0.55 + 0.4 * pulse})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(mv.x, mv.y, 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Halos de portée de prévisualisation (item de réserve armé)
      if (!battle && armed === "turret" && armedR) {
        activeTurretSlots(bastion).forEach((s) => {
          if (!s.occupant) drawRangeRing(ctx, s.x, s.y, armedR, "rgba(109,246,255,0.9)");
        });
      }
      if (!battle && armed === "mortar" && armedR) {
        activeMortarSlots(bastion).forEach((s) => {
          if (!s.occupant) drawRangeRing(ctx, s.x, s.y, armedR, "rgba(201,168,119,0.95)");
        });
      }

      const zones: BastionSlotTarget[] = [];
      const zonePos: { x: number; y: number; r: number }[] = [];

      // Tourelles
      const wantsTurret = armed === "turret";
      activeTurretSlots(bastion).forEach((s) => {
        const scale = depthScale(s.y);
        if (!s.occupant) {
          drawDashedEllipse(ctx, s.x, s.y, 15 * scale, 11 * scale, wantsTurret ? "rgba(109,246,255,0.9)" : "rgba(109,246,255,0.25)", wantsTurret ? 1.6 : 1.1);
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = "#6df6ff";
          ctx.font = `${Math.round(10 * scale)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText("🗼", s.x, s.y + 4 * scale);
          ctx.restore();
        } else {
          const def = buildingDef(s.occupant);
          drawGroundShadow(ctx, s.x, s.y + 11 * scale, 11 * scale, 4 * scale, 0.35);
          const cd = battle?.turretCooldowns[s.id] ?? 0;
          const rate = def?.rate ?? 1;
          const pulse = cd > 1 / rate - 0.15 ? 1.15 : 1;
          const size = 26 * scale * pulse;
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = def ? buildingRarityColor(def.rarity) : "#6df6ff";
          ctx.beginPath();
          ctx.arc(s.x, s.y - 2 * scale, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.font = `${Math.round(13 * scale)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(def ? buildingIcon(def.id) : "🗼", s.x, s.y + 3 * scale);
          ctx.font = `${Math.round(7.5 * scale)}px monospace`;
          ctx.fillStyle = "rgba(207,232,242,0.7)";
          ctx.fillText(def?.name.split(" ")[0] ?? "?", s.x, s.y + 19 * scale);
        }
        zones.push({ kind: "turret", slotId: s.id });
        zonePos.push({ x: s.x, y: s.y, r: 18 });
      });

      // Barracks (idle : capsule colorée + pips d'escouade pleine ; en bataille, les
      // troupes réelles sont rendues plus bas depuis battle.troops)
      const wantsBarracks = armed === "barracks";
      activeBarracksSlots(bastion).forEach((s) => {
        const scale = depthScale(s.y);
        if (!s.occupant) {
          drawDashedEllipse(ctx, s.x, s.y, 15 * scale, 11 * scale, wantsBarracks ? "rgba(255,207,77,0.9)" : "rgba(255,207,77,0.25)", wantsBarracks ? 1.6 : 1.1);
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = "#ffcf4d";
          ctx.font = `${Math.round(10 * scale)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText("⛺", s.x, s.y + 4 * scale);
          ctx.restore();
        } else if (!battle) {
          const sp = speciesConfig(s.occupant);
          drawGroundShadow(ctx, s.x, s.y + 11 * scale, 11 * scale, 4 * scale, 0.35);
          const img = getImage(cardArt(s.occupant));
          const size = 26 * scale;
          if (ready(img)) ctx.drawImage(img, s.x - size / 2, s.y - size / 2 - 3 * scale, size, size);
          ctx.font = `${Math.round(7.5 * scale)}px monospace`;
          ctx.fillStyle = "rgba(207,232,242,0.7)";
          ctx.textAlign = "center";
          ctx.fillText(sp?.name.split(" ")[0] ?? "?", s.x, s.y + 19 * scale);
          if (s.treeLevel > 0) {
            ctx.font = "7px monospace";
            ctx.fillStyle = "#ffcf4d";
            ctx.fillText(`★${s.treeLevel}`, s.x + 13 * scale, s.y - 10 * scale);
          }
        }
        zones.push({ kind: "barracks", slotId: s.id });
        zonePos.push({ x: s.x, y: s.y, r: 18 });
      });

      // Mortiers
      const wantsMortar = armed === "mortar";
      activeMortarSlots(bastion).forEach((s) => {
        const scale = depthScale(s.y);
        if (!s.occupant) {
          drawDashedEllipse(ctx, s.x, s.y, 15 * scale, 11 * scale, wantsMortar ? "rgba(201,168,119,0.9)" : "rgba(201,168,119,0.3)", wantsMortar ? 1.6 : 1.1);
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = "#c9a877";
          ctx.font = `${Math.round(10 * scale)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText("💣", s.x, s.y + 4 * scale);
          ctx.restore();
        } else if (!battle) {
          const sp = speciesConfig(s.occupant);
          drawGroundShadow(ctx, s.x, s.y + 13 * scale, 12 * scale, 4 * scale, 0.35);
          const img = getImage(cardArt(s.occupant));
          const size = 28 * scale;
          if (ready(img)) ctx.drawImage(img, s.x - size / 2, s.y - size / 2 - 2 * scale, size, size);
          ctx.font = `${Math.round(7.5 * scale)}px monospace`;
          ctx.fillStyle = "rgba(207,232,242,0.7)";
          ctx.textAlign = "center";
          ctx.fillText(sp?.name.split(" ")[0] ?? "?", s.x, s.y + 21 * scale);
        }
        zones.push({ kind: "mortar", slotId: s.id });
        zonePos.push({ x: s.x, y: s.y, r: 18 });
      });

      // Structures posées librement (murs/pièges) — utilise la copie de combat pendant
      // une bataille (dégâts en direct), l'état persisté sinon.
      const structures = battle ? structuresRef.current : bastion.fieldStructures;
      structures.forEach((s) => {
        const def = buildingDef(s.occupant);
        if (!def) return;
        const scale = depthScale(s.y);
        const isTrap = def.category === "trap";
        ctx.save();
        ctx.globalAlpha = isTrap ? 0.6 : 0.95;
        ctx.fillStyle = isTrap ? "#ff9a3d" : buildingRarityColor(def.rarity);
        if (isTrap) {
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - 9 * scale);
          ctx.lineTo(s.x + 9 * scale, s.y);
          ctx.lineTo(s.x, s.y + 9 * scale);
          ctx.lineTo(s.x - 9 * scale, s.y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") ctx.roundRect(s.x - 13 * scale, s.y - 9 * scale, 26 * scale, 18 * scale, 4);
          else ctx.rect(s.x - 13 * scale, s.y - 9 * scale, 26 * scale, 18 * scale);
          ctx.fill();
        }
        ctx.restore();
        ctx.font = `${Math.round(11 * scale)}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(buildingIcon(def.id), s.x, s.y + 4 * scale);
        if (!isTrap) drawHpBar(ctx, s.x, s.y + 15 * scale, 28 * scale, 3, s.hp / s.hpMax, "#ff9a3d");
        zones.push({ kind: "structure", uid: s.uid });
        zonePos.push({ x: s.x, y: s.y, r: 14 });
      });

      // Zone de pose libre (mur/piège armé, hors bataille)
      if (!battle && (armed === "wall" || armed === "trap")) {
        ctx.save();
        ctx.strokeStyle = "rgba(166,255,61,0.35)";
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1.2;
        ctx.strokeRect(182, 48, 615 - 182, 352 - 48);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#a6ff3d";
        ctx.font = "9px monospace";
        ctx.fillText("touche le champ pour poser", (182 + 615) / 2, 40);
        ctx.restore();
      }

      /* --- Entités de combat éphémères --- */
      if (battle) {
        battle.troops.forEach((tr) => {
          const scale = depthScale(tr.y);
          drawGroundShadow(ctx, tr.x, tr.y + 14 * scale, 10 * scale, 3.5 * scale, 0.4);
          const img = getImage(cardArt(tr.speciesId));
          const size = 26 * scale;
          ctx.save();
          if (tr.hitFlash > 0) ctx.globalAlpha = 0.6;
          if (tr.dying) ctx.globalAlpha = Math.max(0, 1 - tr.deathTimer / 0.3);
          if (ready(img)) ctx.drawImage(img, tr.x - size / 2, tr.y - size / 2 - 6 * scale, size, size);
          ctx.restore();
          if (!tr.dying) drawHpBar(ctx, tr.x, tr.y + 11 * scale, 24 * scale, 3, tr.hp / tr.hpMax, tr.kind === "mortar" ? "#c9a877" : "#a6ff3d");
        });

        battle.enemies.forEach((en) => {
          const scale = depthScale(en.y);
          const size = (en.isBoss ? 46 : 24) * scale;
          drawGroundShadow(ctx, en.x, en.y + (en.isBoss ? 18 : 9) * scale, (en.isBoss ? 16 : 8) * scale, (en.isBoss ? 6 : 3) * scale, 0.35);
          const img = getImage(cardArt(en.typeId));
          ctx.save();
          if (en.hitFlash > 0) ctx.globalAlpha = 0.55;
          if (en.dying) ctx.globalAlpha = Math.max(0, 1 - en.deathTimer / 0.3);
          if (ready(img)) ctx.drawImage(img, en.x - size / 2, en.y - size / 2, size, size);
          ctx.restore();
          if (!en.dying) {
            drawHpBar(ctx, en.x, en.y - size / 2 - 6, (en.isBoss ? 42 : 22) * scale, 3, en.hp / en.hpMax, "#ff4d5e");
            if (en.isBoss) {
              ctx.font = `${Math.round(13 * scale)}px monospace`;
              ctx.fillStyle = "#fff";
              ctx.textAlign = "center";
              ctx.fillText("☠", en.x, en.y - size / 2 - 14);
            }
          }
        });

        battle.projectiles.forEach((p) => {
          const target = battle.enemies.find((e) => e.uid === p.targetUid);
          const tx = target ? target.x : p.fromX;
          const ty = target ? target.y : p.fromY;
          const frac = Math.min(1, p.t / p.travelTime);
          const px = p.fromX + (tx - p.fromX) * frac;
          const py = p.fromY + (ty - p.fromY) * frac - (p.arc ? Math.sin(Math.PI * frac) * 34 : 0);
          ctx.save();
          const colors: Record<string, string> = {
            basic: "#6df6ff",
            splash: "#ff9a3d",
            electric: "#eafcff",
            catapult: "#c9a877",
          };
          ctx.fillStyle = colors[p.vfx] ?? "#6df6ff";
          ctx.beginPath();
          ctx.arc(px, py, p.arc ? 3.4 : 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      ctx.restore();
      hitZonesRef.current = zones;
      /* Cibles tactiles du champ de bataille (piste 10 du diagnostic). Le terrain est
         dessine en 700x400 puis mis a l'echelle : sur un telephone de 380 px le facteur
         tombe a ~0,54 et un slot de rayon 18 ne fait plus que ~20 px de diametre, soit
         moitie moins que le seuil recommande de 44 px. On plancher donc le rayon de
         collision a 20 px CSS (~40 px de diametre) : handleClick arbitre deja les
         chevauchements au plus proche, donc elargir ne rend aucun tap ambigu, ca rattrape
         seulement les taps a cote. Exception quand le joueur tient un mur ou un piege : la
         pose libre commence a x=182 en espace de dessin, a deux pixels des slots
         d'avant-garde (x=180), et un rayon gonfle avalerait toute pose sur le bord gauche
         du champ — dans ce mode on garde donc le rayon geometrique exact. Les slots restant
         a ~25 px les uns des autres, le pinch-to-zoom rendu au joueur (maximumScale: 5, cf.
         layout.tsx) reste la vraie reponse d'accessibilite sur ce terrain precis. */
      const tapScale = Math.max(scaleX, scaleY);
      const placingFree = armed === "wall" || armed === "trap";
      hitPosRef.current = zonePos.map((p) => ({
        x: p.x * scaleX,
        y: p.y * scaleY,
        r: placingFree ? p.r * tapScale : Math.max(p.r * tapScale, 20),
      }));
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // Boucle autonome : lit le store via getState(), les props courantes via propsRef.
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (battleRef.current?.active) return; // pas d'interaction de pose pendant un combat
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const zones = hitZonesRef.current;
    const positions = hitPosRef.current;
    let best: { target: BastionSlotTarget; d: number } | null = null;
    for (let i = 0; i < zones.length; i++) {
      const p = positions[i];
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= p.r && (!best || d < best.d)) best = { target: zones[i], d };
    }
    if (best) {
      propsRef.current.onTapSlot(best.target);
      return;
    }
    // Tap dans le champ libre (hors slots) : pose de mur/piège si armé.
    const cssW = rect.width;
    const cssH = rect.height;
    const fx = (x / cssW) * CANVAS_W;
    const fy = (y / cssH) * CANVAS_H;
    if (fx >= 182 && fx <= 615 && fy >= 48 && fy <= 352) {
      propsRef.current.onTapSlot({ kind: "field", x: Math.round(fx), y: Math.round(fy) });
    }
  };

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="touch-manipulation cursor-pointer rounded-lg"
        aria-label="Champ de bataille du Bastion-Défense"
      />
    </div>
  );
});
