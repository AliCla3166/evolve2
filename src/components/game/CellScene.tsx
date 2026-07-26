/* Scène Canvas de la base vivante (Phase 3).
   Couches : cytoplasme → enveloppe (5 stades, crossfade à la mue) → plancton →
   bâtiments sur sockets (flottement/rotation à phase aléatoire, ghost, chantier,
   halo "amélioration possible") → Noyau (métronome) → VFX (mue : flash + burst
   + zoom-punch). Tap sur un bâtiment → onSelect (panneau React au-dessus). */
"use client";

import { useEffect, useRef } from "react";
import {
  BUILDING_ORDER,
  buildTimeHours,
  canAfford,
  findFreeSlot,
  isDesigned,
  levelCost,
  maxLevel,
  posteOf,
  posteSlots,
} from "@/lib/game/economy";
import { cardArt } from "@/lib/game/cards";
import { canRecruit, totalUnits, unitCap, UNIT_IDS } from "@/lib/game/military";
import {
  animPhase,
  ENVELOPE_SCALE,
  envelopeSprite,
  envelopeStage,
  HEARTBEAT_MS,
  portalTarget,
  SOCKET_SPREAD,
  socketPos,
  SOCKETS,
} from "@/lib/game/scene";
import { creatureSprite } from "@/lib/game/sprites";
import { useGame } from "@/lib/game/store";
import { crewedSpecies } from "@/lib/game/territoire";
import type { BuildingId } from "@/lib/game/types";

/* ---------- Cache d'images (module-level, partagé entre montages) ---------- */

const imgCache = new Map<string, HTMLImageElement>();
const grayCache = new Map<string, HTMLCanvasElement>();

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

/** "#rrggbb" -> "rgba(r, g, b, a)" (liserés/textes aux couleurs d'accent). */
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Variante désaturée (bâtiments verrouillés/ghost) — précalculée une fois,
 *  sans ctx.filter (support Safari incertain) : luminance par pixel. */
function getGrayscale(src: string): HTMLCanvasElement | null {
  const cached = grayCache.get(src);
  if (cached) return cached;
  const img = getImage(src);
  if (!ready(img)) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = lum;
  }
  ctx.putImageData(data, 0, 0);
  grayCache.set(src, c);
  return c;
}

/* ---------- Particules ---------- */

interface Plankton {
  x: number; // 0..1
  y: number;
  speed: number; // vitesse verticale (unité/s)
  wobble: number; // amplitude du zigzag horizontal
  phase: number;
  r: number; // rayon px
  hue: "cyan" | "lime" | "teal";
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  color: string;
}

const PLANKTON_COLORS = {
  cyan: "rgba(109, 246, 255,",
  lime: "rgba(166, 255, 61,",
  teal: "rgba(63, 224, 216,",
} as const;

function makePlankton(): Plankton {
  const hues: Plankton["hue"][] = ["cyan", "cyan", "teal", "lime"];
  return {
    x: Math.random(),
    y: Math.random(),
    speed: 0.008 + Math.random() * 0.02,
    wobble: 0.004 + Math.random() * 0.012,
    phase: Math.random() * Math.PI * 2,
    r: 0.8 + Math.random() * 1.8,
    hue: hues[Math.floor(Math.random() * hues.length)],
  };
}

/* ---------- LA FAUNE DE LA BASE (étape C) ----------

   Les créatures pêchées ne dorment plus dans un menu : celles qui ne travaillent
   pas sur un gisement de La Dérive nagent DANS la cellule, derrière les organes.
   Purement décoratif — aucune donnée de jeu ne sort d'ici — mais c'est ce qui fait
   qu'une collection qui grandit se VOIT sans ouvrir un seul panneau.

   Aucune particule aléatoire : la trajectoire d'une espèce est dérivée de son
   identifiant, donc stable d'un montage à l'autre. Le poisson qu'on a vu passer
   à gauche repassera à gauche. */

/** Au-delà, la scène devient illisible sur un écran de téléphone. */
const FAUNA_MAX = 9;
/** Durée d'une traversée complète de l'écran, en secondes (avant variation). */
const FAUNA_CROSS_S = 30;

/** Hachage déterministe id + sel -> 0..1. Ni PRNG de jeu, ni Math.random : deux
 *  montages successifs de la scène donnent exactement la même chorégraphie. */
function hashed(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

/* ---------- État interne du rendu (hors React) ---------- */

interface SceneAnim {
  spread: number; // écartement des sockets, interpolé en continu
  stage: number; // stade affiché (source du crossfade)
  moltStart: number; // timestamp du début de la mue (-1 = aucune)
  moltFrom: number; // stade quitté
  plankton: Plankton[];
  burst: BurstParticle[];
  /** Niveaux vus à la frame précédente : une hausse = un chantier vient de se
   *  terminer sous les yeux du joueur ⇒ gerbe de particules sur SON socket
   *  (piste 5 du diagnostic : la fin de chantier doit être un événement visuel). */
  levels: Partial<Record<BuildingId, number>>;
  /** Ondes de choc "organe terminé" (coordonnées normalisées). */
  rings: { x: number; y: number; born: number; color: string }[];
  /** Grains de récolte remontés par les ouvrières vers le bandeau de ressources. */
  harvest: BurstParticle[];
  /** Prochaine émission d'un grain, par couple organe:espèce (timestamp rAF).
   *  Borné par nature (12 organes × 62 espèces), donc jamais purgé. */
  nextWork: Map<string, number>;
}

const MOLT_MS = 900;
/** Durée de l'onde de choc de fin de chantier. */
const RING_MS = 1100;
/** Durée de vie d'un grain de récolte (le temps de monter vers le HUD). */
const HARVEST_MS = 1500;
/** Au-delà, on cesse d'en empiler : garde-fou, jamais atteint en usage normal. */
const HARVEST_MAX = 120;

export function CellScene({
  selected,
  onSelect,
}: {
  selected: BuildingId | null;
  onSelect: (id: BuildingId | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Miroirs en ref des props (lus par la boucle rAF sans la relancer).
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    selectedRef.current = selected;
    onSelectRef.current = onSelect;
  }, [selected, onSelect]);
  /** Zones tappables du dernier rendu (coordonnées CSS px). */
  const hitZonesRef = useRef<{ id: BuildingId; x: number; y: number; r: number }[]>([]);
  /** Rebond visuel du bâtiment fraîchement tapé. */
  const tapRef = useRef<{ id: BuildingId; at: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const initialStage = envelopeStage(useGame.getState().buildings);
    const anim: SceneAnim = {
      spread: SOCKET_SPREAD[initialStage - 1],
      stage: initialStage,
      moltStart: -1,
      moltFrom: initialStage,
      plankton: [],
      burst: [],
      levels: { ...useGame.getState().buildings },
      rings: [],
      harvest: [],
      nextWork: new Map(),
    };

    let cssSize = 0;
    let dpr = 1;
    const resize = () => {
      cssSize = Math.min(wrap.clientWidth, 580);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const S = cssSize;
      if (S <= 0) return;

      const state = useGame.getState();
      const { buildings, resources, buildQueue } = state;

      /* --- Détection de fin de chantier (un niveau qui monte) --- */
      for (const id of BUILDING_ORDER) {
        const lvl = buildings[id] ?? 0;
        const prev = anim.levels[id] ?? 0;
        if (lvl > prev) {
          anim.levels[id] = lvl;
          const p = socketPos(id, anim.spread);
          const accent = SOCKETS[id].accent;
          anim.rings.push({ x: p.x, y: p.y, born: nowMs, color: accent });
          for (let i = 0; i < 22; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 0.06 + Math.random() * 0.16;
            anim.burst.push({
              x: p.x,
              y: p.y,
              vx: Math.cos(a) * v,
              vy: Math.sin(a) * v - 0.03, // léger biais vers le haut : ça "éclot"
              born: nowMs,
              color: i % 3 === 0 ? "#a6ff3d" : accent,
            });
          }
        }
      }

      /* --- Détection de mue (changement de stade) --- */
      const targetStage = envelopeStage(buildings);
      if (targetStage !== anim.stage && anim.moltStart < 0) {
        anim.moltStart = nowMs;
        anim.moltFrom = anim.stage;
        anim.stage = targetStage;
        // Burst de particules bioluminescentes depuis le centre
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 0.12 + Math.random() * 0.3;
          anim.burst.push({
            x: 0.5,
            y: 0.5,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            born: nowMs,
            color: i % 3 === 0 ? "#a6ff3d" : "#6df6ff",
          });
        }
      }
      const moltP =
        anim.moltStart < 0 ? 1 : Math.min(1, (nowMs - anim.moltStart) / MOLT_MS);
      if (moltP >= 1) anim.moltStart = -1;

      // Écartement des sockets : glisse en douceur vers le stade courant
      const targetSpread = SOCKET_SPREAD[anim.stage - 1];
      anim.spread += (targetSpread - anim.spread) * Math.min(1, dt * 3.5);

      // Battement global (métronome = le Noyau)
      const beat = Math.sin((nowMs / HEARTBEAT_MS) * Math.PI * 2);

      /* --- Fond --- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = false;

      // Zoom-punch de mue (toute la scène respire un coup)
      if (anim.moltStart >= 0 || moltP < 1) {
        const punch = 1 + 0.045 * Math.sin(Math.PI * Math.min(1, moltP * 1.6));
        ctx.translate(S / 2, S / 2);
        ctx.scale(punch, punch);
        ctx.translate(-S / 2, -S / 2);
      }

      const envScale =
        ENVELOPE_SCALE[anim.stage - 1] * (1 + 0.012 * Math.sin((nowMs / (HEARTBEAT_MS * 2)) * Math.PI * 2));
      const envSize = S * envScale;

      // Cytoplasme : disque radial sombre sous l'enveloppe
      const grad = ctx.createRadialGradient(S / 2, S / 2, envSize * 0.08, S / 2, S / 2, envSize * 0.52);
      grad.addColorStop(0, "rgba(16, 38, 58, 0.85)");
      grad.addColorStop(0.75, "rgba(10, 22, 38, 0.55)");
      grad.addColorStop(1, "rgba(10, 22, 38, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, envSize * 0.52, 0, Math.PI * 2);
      ctx.fill();

      /* --- Enveloppe (crossfade pendant la mue, masqué par le flash) --- */
      const drawEnvelope = (stage: number, alpha: number) => {
        const img = getImage(envelopeSprite(stage));
        if (!ready(img) || alpha <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, (S - envSize) / 2, (S - envSize) / 2, envSize, envSize);
        ctx.globalAlpha = 1;
      };
      if (moltP < 1) {
        drawEnvelope(anim.moltFrom, 1 - moltP);
        drawEnvelope(anim.stage, moltP);
      } else {
        drawEnvelope(anim.stage, 1);
      }

      // Voile intérieur : repousse l'enveloppe en arrière-plan pour que les
      // bâtiments restent lisibles même sur les stades les plus denses.
      const veil = ctx.createRadialGradient(S / 2, S / 2, envSize * 0.06, S / 2, S / 2, envSize * 0.52);
      veil.addColorStop(0, "rgba(5, 11, 20, 0.5)");
      veil.addColorStop(0.8, "rgba(5, 11, 20, 0.34)");
      veil.addColorStop(1, "rgba(5, 11, 20, 0)");
      ctx.fillStyle = veil;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, envSize * 0.52, 0, Math.PI * 2);
      ctx.fill();

      /* --- Plancton (couche 2 : densité ∝ bâtiments construits) --- */
      const built = BUILDING_ORDER.filter(
        (id) => id !== "noyau" && (buildings[id] ?? 0) > 0,
      ).length;
      const wanted = 10 + built * 2;
      while (anim.plankton.length < wanted) anim.plankton.push(makePlankton());
      while (anim.plankton.length > wanted) anim.plankton.pop();
      for (const p of anim.plankton) {
        p.y -= p.speed * dt;
        if (p.y < -0.02) {
          p.y = 1.02;
          p.x = Math.random();
        }
        const x = (p.x + Math.sin(t * 0.7 + p.phase) * p.wobble) * S;
        const y = p.y * S;
        const tw = 0.35 + 0.3 * Math.sin(t * 2 + p.phase);
        ctx.fillStyle = `${PLANKTON_COLORS[p.hue]}${tw.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      /* --- LA FAUNE : les créatures pêchées nagent dans la cellule (étape C) ---
             Dessinées entre le plancton et les organes : elles passent DERRIÈRE
             les bâtiments, donc elles n'entrent jamais en concurrence avec les
             cibles tactiles. Celles postées sur un gisement sont absentes — elles
             travaillent sur la carte, et on les y voit. Celles POSTÉES DANS UN ORGANE
             le sont aussi : elles sont dessinées juste après, à leur poste, et une
             créature qu'on verrait à la fois nager et travailler mentirait sur la
             règle même du jeu — un seul emploi à la fois. */
      const auTravail = crewedSpecies(state.territoire);
      for (const crew of Object.values(state.postes)) {
        if (crew) for (const sid of crew) auTravail.add(sid);
      }
      const nageuses = Object.keys(state.collection)
        .filter((id) => !auTravail.has(id))
        .sort()
        .slice(0, FAUNA_MAX);
      for (let i = 0; i < nageuses.length; i++) {
        const id = nageuses[i];
        // Portrait détouré (cf. sprites.ts) : sans lui, une nageuse est un carré
        // noir qui glisse sur le décor. C'est aussi ce qui permet de remonter son
        // opacité — ce qu'on voulait cacher, c'était le cadre, pas la créature.
        const img = creatureSprite(cardArt(id));
        if (!img) continue;
        // Couloir de nage, vitesse et phase : dérivés de l'identifiant de l'espèce.
        const lane = 0.16 + hashed(id, 1) * 0.66;
        const speed = FAUNA_CROSS_S * (0.75 + hashed(id, 2) * 0.7);
        const dir = hashed(id, 3) < 0.5 ? 1 : -1;
        const size = S * (0.062 + hashed(id, 4) * 0.03);
        const prog = ((t / speed + hashed(id, 5)) % 1 + 1) % 1;
        const fx = dir > 0 ? prog : 1 - prog;
        const x = (-0.12 + fx * 1.24) * S;
        // Ondulation verticale + tangage : une nageuse ne va jamais tout droit.
        const swim = Math.sin(t * (0.6 + hashed(id, 6) * 0.5) + i) ;
        const y = (lane + swim * 0.035) * S;
        ctx.save();
        ctx.globalAlpha = 0.66 + 0.14 * Math.sin(t * 0.9 + i);
        ctx.translate(x, y);
        ctx.rotate(swim * 0.16);
        // Le portrait regarde vers la droite : on le retourne quand elle nage à gauche.
        ctx.scale(dir > 0 ? 1 : -1, 1);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      /* --- Bâtiments sur leurs sockets --- */
      /* Pastilles d'alerte posées sur un SOCLE plutôt que sur un onglet.
         Depuis l'étape 6c, le Noyau n'a plus d'onglet dans la barre : le signal
         doit vivre là où se trouve la porte, sinon il ne sert à rien. Ce n'est
         plus le renouvellement des destinations d'expédition (elles ont déménagé
         sur La Dérive, dont l'onglet porte désormais ce signal) mais ce que le
         Noyau seul sait faire : « tu peux recruter, là, tout de suite ». */
      const alerts: Partial<Record<BuildingId, boolean>> = {
        noyau:
          totalUnits(state.units) < unitCap(state.buildings) &&
          UNIT_IDS.some((u) => canRecruit(state, u)),
      };
      const zones: { id: BuildingId; x: number; y: number; r: number }[] = [];
      // Labels + badges dessinés en 2e passe, AU-DESSUS de tous les sprites
      // (sinon le bâtiment voisin recouvre le texte -> illisible).
      const overlays: {
        id: BuildingId;
        cx: number;
        cy: number;
        padR: number;
        level: number;
        designed: boolean;
        /** Pastille « il y a du neuf ici » (cf. `alerts`). */
        alert: boolean;
      }[] = [];
      const baseSize = S * 0.14;

      const drawBuilding = (id: BuildingId) => {
        const socket = SOCKETS[id];
        const pos = socketPos(id, anim.spread);
        const level = buildings[id] ?? 0;
        const designed = isDesigned(id);
        /* Portail (Bastion / Pêche / Raid) : pas un organe à construire, une
           porte vers un autre écran. Il se dessine donc VIVANT, sans cadenas. */
        const portal = portalTarget(id) !== null;
        const task = buildQueue.find((b) => b.buildingId === id) ?? null;
        const inBuild = task !== null;
        const phase = animPhase(id);
        const size = baseSize * socket.size;

        // Flottement + dérive (phase aléatoire par bâtiment, jamais synchrones)
        const period = 2.2 + phase * 1.8;
        let cx = pos.x * S;
        let cy = pos.y * S + Math.sin((t / period + phase) * Math.PI * 2) * (S * 0.006);
        const rot = id === "noyau" ? 0 : Math.sin((t / (period * 1.7) + phase * 7) * Math.PI * 2) * 0.045;

        // Vibration de chantier
        if (inBuild) {
          cx += Math.sin(t * 43 + phase) * 0.8;
          cy += Math.cos(t * 37 + phase) * 0.8;
        }

        // Pulsation du Noyau (métronome) / micro-pulsation des autres, calée dessus
        let scale = 1;
        if (id === "noyau") scale = 1 + 0.045 * beat;
        else if (level > 0) scale = 1 + 0.015 * Math.sin((nowMs / (HEARTBEAT_MS / 2)) * Math.PI * 2 + phase * Math.PI * 2);

        // Petit rebond au tap
        if (tapRef.current?.id === id) {
          const tp = (nowMs - tapRef.current.at) / 260;
          if (tp < 1) scale *= 1 + 0.1 * Math.sin(Math.PI * tp);
          else tapRef.current = null;
        }

        const spriteLevel = Math.max(1, level);
        const src = `/assets/buildings/${id}/niveau${spriteLevel}.png`;
        const img = getImage(src);
        const d = size * scale;
        const padR = size * 0.52;

        // Socle : disque sombre + liseré accent — détache le sprite du décor
        if (id !== "noyau") {
          ctx.fillStyle = "rgba(5, 11, 20, 0.55)";
          ctx.beginPath();
          ctx.arc(cx, cy, padR, 0, Math.PI * 2);
          ctx.fill();
          /* Un portail garde un liseré franc — il mène quelque part, il ne
             doit pas être lu comme un emplacement vide. Il respire même un
             peu, pour signaler qu'on peut le toucher. */
          const ringA = portal
            ? 0.5 + 0.22 * Math.sin((nowMs / HEARTBEAT_MS) * Math.PI * 2 + phase * 6)
            : designed && level > 0
              ? 0.6
              : 0.22;
          ctx.strokeStyle = hexA(socket.accent, ringA);
          ctx.lineWidth = portal ? 2 : 1.5;
          ctx.stroke();
        }

        // Halo du Noyau (respire avec le battement)
        if (id === "noyau") {
          const halo = ctx.createRadialGradient(cx, cy, d * 0.15, cx, cy, d * 0.85);
          halo.addColorStop(0, `rgba(109, 246, 255, ${(0.28 + 0.14 * beat).toFixed(3)})`);
          halo.addColorStop(1, "rgba(109, 246, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(cx, cy, d * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }

        // Halo lime "amélioration possible" (un slot compatible est libre + coût payable)
        // v8 : le slot dépend de la durée du chantier (les auxiliaires refusent les longs).
        if (
          designed &&
          !inBuild &&
          level < maxLevel(id) &&
          findFreeSlot(buildings, buildQueue, buildTimeHours(id, level + 1)) >= 0
        ) {
          const cost = levelCost(id, level + 1);
          if (cost && canAfford(resources, cost)) {
            const pulse = 0.16 + 0.1 * Math.sin((nowMs / (HEARTBEAT_MS / 2)) * Math.PI * 2 + phase);
            const halo = ctx.createRadialGradient(cx, cy, d * 0.2, cx, cy, d * 0.72);
            halo.addColorStop(0, `rgba(166, 255, 61, ${pulse.toFixed(3)})`);
            halo.addColorStop(1, "rgba(166, 255, 61, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(cx, cy, d * 0.72, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);

        if (portal) {
          // Porte ouverte : couleurs pleines, à peine en retrait des organes.
          ctx.globalAlpha = 0.92;
          if (ready(img)) ctx.drawImage(img, -d / 2, -d / 2, d, d);
          ctx.globalAlpha = 1;
        } else if (!designed || level === 0) {
          // Verrouillé ("À venir") ou ghost non construit : désaturé + translucide
          const gray = getGrayscale(src);
          ctx.globalAlpha = designed ? 0.42 : 0.3;
          if (gray) ctx.drawImage(gray, -d / 2, -d / 2, d, d);
          else if (ready(img)) ctx.drawImage(img, -d / 2, -d / 2, d, d);
          ctx.globalAlpha = 1;
        } else if (ready(img)) {
          ctx.drawImage(img, -d / 2, -d / 2, d, d);
        }

        // Overlay verrou — plus aucun portail n'en porte (piste 10).
        if (!designed && !portal) {
          const lock = getImage("/assets/ui/age01_cell_ui_overlay_locked_v001.png");
          if (ready(lock)) {
            ctx.globalAlpha = 0.85;
            ctx.drawImage(lock, -d / 2, -d / 2, d, d);
            ctx.globalAlpha = 1;
          }
        }

        // Overlay chantier (cocon organique)
        if (inBuild) {
          const scaffold = getImage("/assets/ui/age01_cell_ui_overlay_construction_v001.png");
          if (ready(scaffold)) ctx.drawImage(scaffold, -d / 2, -d / 2, d, d);
        }
        ctx.restore();

        // Arc de progression du chantier
        if (task) {
          const total = task.endsAt - task.startedAt;
          // Date.now() est légitime ici : boucle rAF (canvas), pas un rendu React.
          const p = Math.max(0, Math.min(1, (Date.now() - task.startedAt) / Math.max(1, total)));
          ctx.strokeStyle = "rgba(166, 255, 61, 0.9)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, padR + 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
          ctx.stroke();
        }

        // Anneau de sélection (pointillés en rotation lente)
        if (selectedRef.current === id) {
          ctx.save();
          ctx.strokeStyle = "rgba(109, 246, 255, 0.95)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.lineDashOffset = -((nowMs / 40) % 11);
          ctx.beginPath();
          ctx.arc(cx, cy, (id === "noyau" ? d * 0.62 : padR) + 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        overlays.push({ id, cx, cy, padR, level, designed, alert: alerts[id] === true });
        zones.push({ id, x: cx, y: cy, r: Math.max(padR + 6, 26) });
      };

      // Couche 3 : tous sauf le Noyau… puis couche 4 : le Noyau au-dessus
      for (const id of BUILDING_ORDER) if (id !== "noyau") drawBuilding(id);
      drawBuilding("noyau");
      hitZonesRef.current = zones;

      /* --- LES OUVRIÈRES À LEUR POSTE (26/07) ----------------------------------

         C'est la contrepartie visible du moteur des postes : la créature qu'on a
         pêchée, puis affectée à un organe depuis sa fiche, on la VOIT y travailler.
         Elle tourne autour de son organe, se penche dessus par à-coups, et remonte
         régulièrement un grain de récolte vers le bandeau de ressources.

         Dessinées APRÈS les organes (donc devant) mais AVANT les labels : une
         ouvrière peut passer sur un sprite, jamais sur le nom d'un bâtiment. Leurs
         postes sont répartis sur l'arc SUPÉRIEUR pour la même raison — le bas du
         socle appartient au label.

         Purement décoratif : rien de ce qui est calculé ici ne retourne dans l'état.
         Toute la chorégraphie est dérivée de l'identifiant de l'espèce (`hashed`),
         donc identique d'un montage à l'autre — la même créature reprend sa place. */
      for (const id of BUILDING_ORDER) {
        const crew = posteOf(state, id);
        if (crew.length === 0) continue;
        const slots = posteSlots(id, buildings[id] ?? 0);
        if (slots <= 0) continue;
        const actifs = crew.slice(0, slots);

        const socket = SOCKETS[id];
        const pos = socketPos(id, anim.spread);
        const phase = animPhase(id);
        const period = 2.2 + phase * 1.8;
        // Même flottement que le sprite de l'organe : l'équipe reste collée à lui.
        const cx = pos.x * S;
        const cy = pos.y * S + Math.sin((t / period + phase) * Math.PI * 2) * (S * 0.006);
        const padR = baseSize * socket.size * 0.52;
        const wsize = baseSize * 0.44;

        for (let i = 0; i < actifs.length; i++) {
          const sid = actifs[i];
          const img = creatureSprite(cardArt(sid));
          if (!img) continue;
          const ph = hashed(sid, 11);

          const arc = Math.PI * 0.86;
          const a0 = -Math.PI / 2 - arc / 2 + ((i + 0.5) / actifs.length) * arc;
          const sway = Math.sin(t * (0.5 + ph * 0.4) + ph * 6) * 0.11;
          // Coup de collier : elle se penche vers l'organe. La phase vient de son
          // identifiant, donc deux ouvrières voisines ne travaillent jamais à
          // l'unisson — c'est ce décalage qui fait qu'une équipe a l'air vivante.
          const effort = Math.max(0, Math.sin(t * 1.9 + ph * Math.PI * 2));
          const a = a0 + sway;
          const r = padR * (1.2 - 0.16 * effort);
          const wx = cx + Math.cos(a) * r;
          const wy = cy + Math.sin(a) * r;

          // Halo d'atelier : détache l'ouvrière du sprite de l'organe, sur lequel
          // elle passe. Il s'intensifie au moment de l'effort.
          const glow = ctx.createRadialGradient(wx, wy, 0, wx, wy, wsize * 0.75);
          glow.addColorStop(0, hexA(socket.accent, 0.3 + 0.22 * effort));
          glow.addColorStop(1, hexA(socket.accent, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(wx, wy, wsize * 0.75, 0, Math.PI * 2);
          ctx.fill();

          ctx.save();
          ctx.translate(wx, wy);
          // Elle regarde son organe : le portrait pointe à droite, on le retourne
          // quand elle se tient à droite du socle.
          ctx.scale(Math.cos(a) > 0 ? -1 : 1, 1);
          ctx.rotate(-0.28 * effort);
          ctx.drawImage(img, -wsize / 2, -wsize / 2, wsize, wsize);
          ctx.restore();

          /* Grain de récolte : elle remonte quelque chose vers le bandeau, à
             intervalle irrégulier. C'est le seul lien VISUEL entre une créature
             et les chiffres du HUD — sans lui, le bonus de production resterait
             une ligne de texte dans une fiche. */
          let due = anim.nextWork.get(`${id}:${sid}`);
          if (due === undefined) {
            due = nowMs + ph * 1800;
            anim.nextWork.set(`${id}:${sid}`, due);
          }
          if (nowMs >= due) {
            anim.nextWork.set(`${id}:${sid}`, nowMs + 1400 + hashed(sid, 12) * 1500);
            if (anim.harvest.length < HARVEST_MAX) {
              anim.harvest.push({
                x: wx / S,
                y: wy / S,
                vx: (hashed(sid, 13) - 0.5) * 0.06,
                vy: -0.15 - hashed(sid, 14) * 0.07,
                born: nowMs,
                color: socket.accent,
              });
            }
          }
        }
      }

      // 2e passe : badges de niveau + noms courts, au-dessus de tous les sprites
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const o of overlays) {
        const accent = SOCKETS[o.id].accent;
        // Nom court (le Noyau aussi : lève l'ambiguïté avec ses voisins)
        const text = SOCKETS[o.id].label;
        const ly = o.cy + o.padR + 9;
        ctx.font = "600 10px ui-monospace, monospace";
        const w = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(5, 11, 20, 0.78)";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(o.cx - w / 2 - 5, ly - 8, w + 10, 16, 6);
        } else {
          ctx.rect(o.cx - w / 2 - 5, ly - 8, w + 10, 16);
        }
        ctx.fill();
        ctx.fillStyle = !o.designed
          ? "rgba(140, 170, 180, 0.85)"
          : o.level > 0
            ? accent
            : "rgba(207, 232, 242, 0.8)";
        ctx.fillText(text, o.cx, ly + 0.5);

        // Badge de niveau (bâtiments construits)
        if (o.designed && o.level > 0) {
          const br = o.id === "noyau" ? 11 : 10;
          // Badge maintenu À L'INTÉRIEUR du socle : jamais de collision
          // avec le label d'un bâtiment voisin.
          const off = o.id === "noyau" ? o.padR * 0.5 : o.padR * 0.55;
          const bx = o.cx + off;
          const by = o.cy - off;
          ctx.fillStyle = "rgba(5, 11, 20, 0.85)";
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = accent;
          ctx.font = "bold 11px ui-monospace, monospace";
          ctx.fillText(String(o.level), bx, by + 0.5);
        }

        // Pastille d'alerte — en HAUT À GAUCHE, en miroir du badge de niveau
        // (qui occupe la droite), donc jamais l'un sur l'autre. Elle respire
        // lentement : c'est un appel du regard, pas un clignotement d'alarme.
        if (o.alert) {
          const off = o.id === "noyau" ? o.padR * 0.5 : o.padR * 0.55;
          const bx = o.cx - off;
          const by = o.cy - off;
          const pulse = 0.75 + 0.25 * Math.sin(nowMs / 320);
          ctx.save();
          ctx.shadowColor = "rgba(255, 84, 214, 0.9)";
          ctx.shadowBlur = 10 * pulse;
          ctx.fillStyle = "#ff54d6";
          ctx.beginPath();
          ctx.arc(bx, by, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          /* L'étoile est TRACÉE, pas écrite. Un `fillText("✦")` dépend d'une
             police de symboles que la pile `ui-monospace, monospace` n'a pas :
             en pratique le glyphe se réduit à un point de 2 px, illisible. Un
             chemin à quatre branches, lui, est net à n'importe quelle taille. */
          ctx.fillStyle = "#050b14";
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (Math.PI / 4) * i - Math.PI / 2;
            const rr = i % 2 === 0 ? 6.2 : 2.1; // pointe / creux
            const px = bx + Math.cos(a) * rr;
            const py = by + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }

      /* --- Ondes de choc "chantier terminé" --- */
      anim.rings = anim.rings.filter((r) => nowMs - r.born < RING_MS);
      for (const r of anim.rings) {
        const age = (nowMs - r.born) / RING_MS;
        const radius = S * (0.03 + 0.16 * age);
        ctx.save();
        ctx.globalAlpha = (1 - age) * 0.8;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2.5 * (1 - age) + 0.5;
        ctx.beginPath();
        ctx.arc(r.x * S, r.y * S, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      /* --- Grains de récolte : ce que les ouvrières remontent vers le HUD ---
             Ils accélèrent en montant et sortent par le haut du cadre, exactement
             là où se trouve le bandeau de ressources : le regard fait le trajet. */
      anim.harvest = anim.harvest.filter((p) => nowMs - p.born < HARVEST_MS);
      for (const p of anim.harvest) {
        const age = (nowMs - p.born) / HARVEST_MS;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 0.06 * dt;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - age) * 1.8);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 7;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x * S, p.y * S, 2.7 * (1 - age * 0.45), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* --- VFX de mue : burst + flash radial --- */
      anim.burst = anim.burst.filter((b) => nowMs - b.born < 750);
      for (const b of anim.burst) {
        const age = (nowMs - b.born) / 750;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        ctx.globalAlpha = (1 - age) * 0.9;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x * S, b.y * S, 2.2 * (1 - age * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (moltP < 0.55) {
        const fp = moltP / 0.55;
        const flash = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.7);
        flash.addColorStop(0, `rgba(207, 244, 255, ${(0.75 * (1 - fp)).toFixed(3)})`);
        flash.addColorStop(1, "rgba(109, 246, 255, 0)");
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, S, S);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // Boucle autonome : lit le store via getState(), aucune dépendance React.
  }, []);

  // Tap → hit-test sur les zones du dernier rendu
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { id: BuildingId; d: number } | null = null;
    for (const z of hitZonesRef.current) {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d <= z.r && (!best || d < best.d)) best = { id: z.id, d };
    }
    if (best) tapRef.current = { id: best.id, at: performance.now() };
    onSelectRef.current(best ? best.id : null);
  };

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="touch-manipulation cursor-pointer"
        aria-label="Base cellulaire — touchez un bâtiment pour ouvrir son panneau"
      />
    </div>
  );
}
