/* WALACHIE — rendu Canvas de l'écosystème (vue de dessus, fausse perspective).

   Même patron que CellScene / TerritoireScene : une seule boucle
   requestAnimationFrame autonome qui lit le store via useWalachie.getState(),
   aucune prop de données (l'animation se cale sur performance.now(), la donnée
   de jeu sur le store — jamais Date.now() pendant un rendu React).

   Le monde n'est PLUS un quadrillage de petites tuiles répétées : un seul
   grand décor peint (tools/gen_walachie.py, un par groupe d'ères — planète
   seule, bain primordial, eaux, rivage, tribal, village, cité, orbite,
   portail, système, constellation, galaxie…) couvre tout le cadre, et change
   à mesure que de nouvelles ères sont percées. Les créatures possédées se
   déplacent librement par-dessus, façon WorldBox : "erre" (déplacement libre
   avec laisse autour de sa zone), "proie" (fuit le prédateur le plus proche),
   "prédateur" (chasse la proie la plus proche, étincelle de capture), "orne"
   (flore/structures, ondulent sur place). Un tap est une Pulsation (+sève,
   texte flottant) ; un glissement panne la caméra.

   Créature brillante : tous les `shiny.seuil` exemplaires d'un même nœud
   possédé, une charge devient disponible (engine.shinyChargesAvailable) —
   distinct des améliorations meta qui ne se valident qu'une fois. La scène la
   dessine avec une aura dorée pulsante + des étincelles orbitales ; un tap
   dessus (prioritaire sur la pulsation normale) la fait exploser en paillettes
   et applique le multiplicateur (page.tsx via onTapShiny). */
"use client";

import { useEffect, useRef } from "react";
import { currentEraDef } from "@/lib/game/walachie/engine";
import { nodeDef, walachieSprite, WCFG } from "@/lib/game/walachie/config";
import { useWalachie } from "@/lib/game/walachie/store";

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

/** Hachage déterministe -> [0,1) (positions du monde, indépendantes du PRNG de jeu). */
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hachage d'une chaîne (id de nœud, y compris les ids de la queue infinie
 *  "essaim_k") -> entier stable, pour semer les positions sans liste fixe. */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

interface FloatText {
  x: number;
  y: number;
  born: number;
  text: string;
}

interface Spark {
  x: number;
  y: number;
  born: number;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  color: string;
}

interface ShinyHit {
  id: string;
  x: number;
  y: number;
  r: number;
}

interface Entity {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  angle: number;
  sprite: string;
  comportement: "predateur" | "proie" | "erre" | "orne";
  lastCatch: number;
}

const LEASH = 150; // distance max errante autour de sa zone d'origine avant de faire demi-tour
const FLEE_RADIUS = 120; // une proie qui voit un prédateur plus près que ça panique
const CATCH_DIST = 16; // distance de capture (déclenche l'étincelle de chasse)
const CATCH_COOLDOWN = 2600;
const CONFETTI_COLORS = ["#ffe896", "#ff5cdb", "#4af6b2", "#b98cff"];

export function WalachieScene({
  onPulse,
  shinyIds,
  onTapShiny,
}: {
  onPulse: (worldX: number, worldY: number) => string | null;
  /** Ids de nœuds possédant au moins une charge de créature brillante. */
  shinyIds: string[];
  /** Réclame la charge d'un nœud ; renvoie un texte flottant (ou null si rien à réclamer). */
  onTapShiny: (id: string) => string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onPulseRef = useRef(onPulse);
  const onTapShinyRef = useRef(onTapShiny);
  const shinyIdsRef = useRef(shinyIds);
  useEffect(() => {
    onPulseRef.current = onPulse;
  }, [onPulse]);
  useEffect(() => {
    onTapShinyRef.current = onTapShiny;
  }, [onTapShiny]);
  useEffect(() => {
    shinyIdsRef.current = shinyIds;
  }, [shinyIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = WCFG.scene.world_w;
    const H = WCFG.scene.world_h;
    const cam = { x: W / 2, y: H / 2 };
    let scale = 1;
    const floats: FloatText[] = [];
    const sparks: Spark[] = [];
    const confetti: Confetti[] = [];
    let shinyHits: ShinyHit[] = [];
    const entities = new Map<string, Entity>();
    let lastFrameT = performance.now();

    let raf = 0;
    let disposed = false;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // La caméra couvre toujours le viewport : on zoome pour que le monde déborde.
      scale = Math.max(parent.clientWidth / W, parent.clientHeight / H) * 1.25;
    };
    resize();
    window.addEventListener("resize", resize);

    /* ---- Interaction : glisser = panner, tap court = pulsation ---- */
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const viewSize = () => ({ vw: canvas.clientWidth, vh: canvas.clientHeight });

    const clampCam = () => {
      const { vw, vh } = viewSize();
      const hw = vw / 2 / scale;
      const hh = vh / 2 / scale;
      cam.x = Math.min(W - hw, Math.max(hw, cam.x));
      cam.y = Math.min(H - hh, Math.max(hh, cam.y));
    };

    const toWorld = (cx: number, cy: number) => {
      const { vw, vh } = viewSize();
      return { x: cam.x + (cx - vw / 2) / scale, y: cam.y + (cy - vh / 2) / scale };
    };

    const down = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      cam.x -= dx / scale;
      cam.y -= dy / scale;
      clampCam();
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved < 8) {
        const rect = canvas.getBoundingClientRect();
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
        // Une créature brillante sous le doigt prime sur la pulsation normale.
        let hitShiny: ShinyHit | null = null;
        for (const sh of shinyHits) {
          if ((sh.x - w.x) ** 2 + (sh.y - w.y) ** 2 <= sh.r * sh.r) {
            hitShiny = sh;
            break;
          }
        }
        if (hitShiny) {
          const label = onTapShinyRef.current(hitShiny.id);
          if (label) {
            floats.push({ x: hitShiny.x, y: hitShiny.y - 20, born: performance.now(), text: label });
            const born = performance.now();
            for (let i = 0; i < 20; i++) {
              const ang = (Math.PI * 2 * i) / 20 + hash01(i, 3) * 0.4;
              const spd = 60 + hash01(i, 7) * 90;
              confetti.push({
                x: hitShiny.x,
                y: hitShiny.y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 30,
                born,
                color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              });
            }
            return;
          }
        }
        const label = onPulseRef.current(w.x, w.y);
        if (label) floats.push({ x: w.x, y: w.y, born: performance.now(), text: label });
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    /* ---- Boucle de rendu ---- */
    const draw = () => {
      if (disposed) return;
      const t = performance.now();
      const dt = Math.min(0.12, Math.max(0, (t - lastFrameT) / 1000));
      lastFrameT = t;
      const s = useWalachie.getState();
      const { vw, vh } = viewSize();
      clampCam();

      ctx.clearRect(0, 0, vw, vh);
      ctx.save();
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(scale, scale);
      ctx.translate(-cam.x, -cam.y);
      ctx.imageSmoothingEnabled = false;

      // --- Décor plein cadre : un seul tableau peint, pas de quadrillage.
      // Il change à mesure que de nouvelles ères sont percées. ---
      const era = currentEraDef(s);
      const decorImg = getImage(walachieSprite(era.decor));
      if (ready(decorImg)) {
        ctx.drawImage(decorImg, 0, 0, W, H);
      } else {
        ctx.fillStyle = "#171126";
        ctx.fillRect(0, 0, W, H);
      }

      // --- Veines de sève (ambiance, procédural, par-dessus le décor) ---
      ctx.strokeStyle = "rgba(74, 246, 178, 0.08)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const sy = (H / 6) * (i + 1) + Math.sin(t / 4000 + i) * 8;
        ctx.moveTo(0, sy);
        for (let x = 0; x <= W; x += 64) {
          ctx.lineTo(x, sy + Math.sin(x / 140 + i * 2 + t / 5000) * 22);
        }
        ctx.stroke();
      }

      // --- Entités : une par exemplaire possédé (plafonné par la config),
      // avec comportement (chasse/fuite/errance/ornement). Les ids couvrent
      // aussi la queue infinie (essaim_k), résolus via nodeDef(). ---
      const cap = WCFG.scene.max_sprites_par_noeud;
      const seen = new Set<string>();
      const overflow: { id: string; count: number; bx: number; by: number }[] = [];

      for (const [id, count] of Object.entries(s.nodes)) {
        if (count <= 0) continue;
        const def = nodeDef(id);
        if (!def || !def.sprite) continue;
        const shown = Math.min(count, cap);
        const h1 = hashId(id);
        for (let k = 0; k < shown; k++) {
          const key = `${id}#${k}`;
          seen.add(key);
          let e = entities.get(key);
          if (!e) {
            const bx = 70 + hash01(h1 + 7, k * 17 + 3) * (W - 140);
            const by = 70 + hash01(k * 53 + 11, h1 + 5) * (H - 140);
            e = {
              x: bx,
              y: by,
              baseX: bx,
              baseY: by,
              angle: hash01(h1, k) * Math.PI * 2,
              sprite: def.sprite,
              comportement: def.comportement,
              lastCatch: 0,
            };
            entities.set(key, e);
          }
        }
        if (count > cap) {
          overflow.push({
            id,
            count,
            bx: 70 + hash01(h1 + 7, 3) * (W - 140),
            by: 70 + hash01(11, h1 + 5) * (H - 140),
          });
        }
      }

      // Steering : les prédateurs/proies se cherchent mutuellement.
      const predators: Entity[] = [];
      const preys: Entity[] = [];
      for (const [key, e] of entities) {
        if (!seen.has(key)) continue;
        if (e.comportement === "predateur") predators.push(e);
        else if (e.comportement === "proie") preys.push(e);
      }
      const nearest = (from: Entity, pool: Entity[]): Entity | null => {
        let best: Entity | null = null;
        let bestD = Infinity;
        for (const p of pool) {
          const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return best;
      };

      for (const [key, e] of entities) {
        if (!seen.has(key)) continue; // instance non affichée ce cycle (au-delà du plafond)
        if (e.comportement === "orne") {
          e.y = e.baseY + Math.sin(t / 1800 + e.baseX) * 1.5;
          continue;
        }
        let vx = 0;
        let vy = 0;
        let speed = 16;
        if (e.comportement === "predateur") {
          const target = nearest(e, preys);
          if (target) {
            const dx = target.x - e.x;
            const dy = target.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            vx = dx / dist;
            vy = dy / dist;
            speed = 40;
            if (dist < CATCH_DIST && t - e.lastCatch > CATCH_COOLDOWN) {
              e.lastCatch = t;
              sparks.push({ x: target.x, y: target.y, born: t });
            }
          } else {
            e.angle += (hash01(Math.floor(t / 900), key.length) - 0.5) * 1.2;
            vx = Math.cos(e.angle);
            vy = Math.sin(e.angle);
            speed = 20;
          }
        } else if (e.comportement === "proie") {
          const threat = nearest(e, predators);
          const distThreat = threat ? Math.hypot(threat.x - e.x, threat.y - e.y) : Infinity;
          if (threat && distThreat < FLEE_RADIUS) {
            const dx = e.x - threat.x;
            const dy = e.y - threat.y;
            const dist = Math.hypot(dx, dy) || 1;
            vx = dx / dist;
            vy = dy / dist;
            speed = 44;
          } else {
            e.angle += (hash01(Math.floor(t / 1100), key.length + 1) - 0.5) * 0.9;
            vx = Math.cos(e.angle);
            vy = Math.sin(e.angle) * 0.7;
            speed = 12;
          }
        } else {
          // erre : déplacement libre, laisse autour de la zone d'origine
          e.angle += (hash01(Math.floor(t / 1400), key.length + 2) - 0.5) * 0.7;
          vx = Math.cos(e.angle);
          vy = Math.sin(e.angle) * 0.7;
          speed = 15;
        }
        // Laisse : au-delà, on infléchit doucement le cap vers la base.
        const distBase = Math.hypot(e.x - e.baseX, e.y - e.baseY);
        if (distBase > LEASH) {
          vx += (e.baseX - e.x) / distBase;
          vy += (e.baseY - e.y) / distBase;
        }
        const norm = Math.hypot(vx, vy) || 1;
        e.x += (vx / norm) * speed * dt;
        e.y += (vy / norm) * speed * dt;
      }

      // Dessin (tri par y = fausse perspective : ce qui est "devant" recouvre).
      const drawList = [...entities.entries()].filter(([key]) => seen.has(key));
      drawList.sort((a, b) => a[1].y - b[1].y);
      for (const [, e] of drawList) {
        const img = getImage(walachieSprite(e.sprite));
        if (!ready(img)) continue;
        const size = img.naturalWidth;
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + size * 0.42, size * 0.34, size * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(img, e.x - size / 2, e.y - size / 2, size, size);
      }
      // Au-delà du plafond, le nombre s'écrit près du premier individu.
      for (const o of overflow) {
        ctx.font = "10px monospace";
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(`×${o.count}`, o.bx + 18, o.by - 18);
      }

      // --- Créature brillante : une aura dorée pulsante + étincelles orbitales
      // par nœud possédant une charge. Suit l'entité si elle existe (créature
      // vivante), sinon une position semée fixe (nœud sans sprite propre). ---
      const newShinyHits: ShinyHit[] = [];
      for (const id of shinyIdsRef.current) {
        const def = nodeDef(id);
        const e0 = entities.get(`${id}#0`);
        let px: number;
        let py: number;
        let size = 56;
        if (e0) {
          px = e0.x;
          py = e0.y;
          if (def?.sprite) size = getImage(walachieSprite(def.sprite)).naturalWidth || 56;
        } else {
          const h = hashId(id);
          px = 70 + hash01(h + 7, 3) * (W - 140);
          py = 70 + hash01(11, h + 5) * (H - 140);
        }
        const pulse = 1 + 0.14 * Math.sin(t / 260 + hashId(id));
        const r = size * 0.62 * pulse;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 1.9);
        grad.addColorStop(0, "rgba(255,232,150,0.55)");
        grad.addColorStop(1, "rgba(255,232,150,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const ang = t / 480 + (i * Math.PI) / 2;
          const sx = px + Math.cos(ang) * r * 1.3;
          const sy = py + Math.sin(ang) * r * 1.3 * 0.6;
          ctx.fillStyle = "#ffe896";
          ctx.beginPath();
          ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (def?.sprite) {
          const img = getImage(walachieSprite(def.sprite));
          if (ready(img)) ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
        } else {
          ctx.fillStyle = "#ffe896";
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        newShinyHits.push({ id, x: px, y: py, r: Math.max(size * 0.65, 26) });
      }
      shinyHits = newShinyHits;

      // --- Paillettes de la créature brillante réclamée ---
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        const age = (t - c.born) / 1000;
        if (age > 0.9) {
          confetti.splice(i, 1);
          continue;
        }
        const cx = c.x + c.vx * age;
        const cy = c.y + c.vy * age + 140 * age * age; // légère gravité
        ctx.globalAlpha = Math.max(0, 1 - age / 0.9);
        ctx.fillStyle = c.color;
        ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
        ctx.globalAlpha = 1;
      }

      // --- Étincelles de chasse (le prédateur rattrape une proie — visuel seul,
      // rien n'est jamais retiré, la proie repart aussitôt) ---
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        const age = (t - sp.born) / 1000;
        if (age > 0.5) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - age / 0.5;
        ctx.strokeStyle = "#ff5cdb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6 + age * 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- Aurore quand un événement est actif ---
      if (s.activeEvent) {
        const pulseA = 0.06 + 0.04 * Math.sin(t / 600);
        ctx.fillStyle = `rgba(255, 92, 219, ${pulseA})`;
        ctx.fillRect(0, 0, W, H);
      }

      // --- Textes flottants des pulsations ---
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        const age = (t - f.born) / 1000;
        if (age > 1.2) {
          floats.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - age / 1.2;
        ctx.font = "bold 13px monospace";
        ctx.fillStyle = "#4af6b2";
        ctx.fillText(f.text, f.x - 14, f.y - 20 - age * 34);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full touch-none select-none" />;
}

/** Vignette d'un nœud pour les listes (réutilise le cache d'images du module). */
export function nodeThumbSrc(id: string): string | null {
  const def = nodeDef(id);
  return def?.sprite ? walachieSprite(def.sprite) : null;
}
