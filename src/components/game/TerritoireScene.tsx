/* LA DÉRIVE — rendu Canvas de la carte (25/07/2026).

   Même patron que CellScene.tsx : une seule boucle requestAnimationFrame, autonome,
   qui lit le store via `useGame.getState()` et ne dépend d'AUCUNE prop React (les
   props transitent par des refs). Aucun `Date.now()` au rendu — l'animation se cale
   sur `performance.now()`, la donnée de jeu sur le store.

   Zéro asset à produire : un nœud = un disque + le glyphe de sa nature, tous deux
   définis dans territoire_config.json (`natures[].icon` / `natures[].color`). La
   teinte du secteur vient elle aussi de la config (`sectors[].tint`) : ce fichier
   ne contient ni couleur de contenu, ni libellé joueur, ni valeur d'équilibrage. */
"use client";

import { useEffect, useRef } from "react";
import { cardArt } from "@/lib/game/cards";
import { dailyOffers } from "@/lib/game/military";
import { useGame } from "@/lib/game/store";
import {
  assaultPalier,
  crewOf,
  devLevel,
  devSoftCap,
  isCaptured,
  natureDef,
  SECTORS,
  sectorUnlocked,
  TERRITOIRE_MAP,
  type FoyerDef,
  type SectorDef,
} from "@/lib/game/territoire";

/* ---------- Cache d'images (module-level, partagé entre montages) ----------
   Même patron que CellScene : les portraits des créatures postées aux gisements
   sont déjà sur disque, on ne produit aucun asset pour les animer. */

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

/* ---------- Petites aides de dessin ---------- */

/** "#rrggbb" -> "rgba(r, g, b, a)" (même utilitaire que CellScene). */
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Neige marine : les particules qui tombent en continu dans les eaux profondes.
 *  Purement décoratif, donc `Math.random()` est ici légitime (même dérogation que
 *  le plancton de CellScene : le PRNG à graine ne concerne que le jeu). */
interface Snow {
  x: number; // 0..1
  y: number;
  speed: number;
  wobble: number;
  phase: number;
  r: number;
}

function makeSnow(): Snow {
  return {
    x: Math.random(),
    y: Math.random(),
    speed: 0.006 + Math.random() * 0.018,
    wobble: 0.003 + Math.random() * 0.01,
    phase: Math.random() * Math.PI * 2,
    r: 0.6 + Math.random() * 1.6,
  };
}

const SNOW_COUNT = 46;
/** Durée du halo qui salue une capture toute fraîche. */
const CAPTURE_RING_MS = 1400;

/* ---------- L'ÉQUIPAGE AU TRAVAIL (étape B) -------------------------------
   Ce que le joueur voit, et qui manquait : les créatures qu'il a pêchées puis
   postées sur un gisement y travaillent réellement à l'écran — elles tournent
   autour du nœud, plongent dedans, et remontent une bulle de ressource. Un
   gisement sans équipage reste strictement inerte : rien ne change pour une
   partie qui n'a encore posté personne. */

/** Un cycle de travail complet : plonger, arracher, remonter. */
const CREW_CYCLE_MS = 2400;
/** Tour d'orbite complet autour du gisement. */
const CREW_ORBIT_MS = 11000;
/** Cadence d'émission des bulles, DIVISÉE par la taille de l'équipage :
 *  six créatures au travail font six fois plus de bulles qu'une seule. */
const MOTE_EVERY_MS = 1150;
/** Durée de vie d'une bulle qui remonte. */
const MOTE_LIFE_MS = 2100;
/** Plafond global de bulles à l'écran — garde-fou de performance. */
const MOTE_MAX = 90;

/* ---------- LA FAUNE DE FOND (étape C) ------------------------------------
   Ce qui distingue un secteur d'un autre ne doit pas être qu'une teinte : la
   zone photique voit passer des bancs rapides, l'abîme de grandes masses lentes.
   Tout est TRACÉ (aucun asset) et déterministe (aucun Math.random) : la même
   carte rejoue exactement la même chorégraphie d'un montage à l'autre. */

/** Traversée complète du champ par une silhouette, en secondes. */
const DRIFTER_CROSS_S = 52;

/** Hachage déterministe id + sel -> 0..1 (même utilitaire que CellScene). */
function hashed(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

/** Silhouette d'un nageur : un corps fuselé et une caudale, tracés à l'origine,
 *  orientés vers la droite. L'appelant s'occupe du placement et de l'échelle. */
function drifterPath(ctx: CanvasRenderingContext2D, len: number, ondul: number): void {
  const h = len * 0.3;
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0);
  ctx.quadraticCurveTo(len * 0.1, -h, -len * 0.3, -h * 0.42 + ondul * h * 0.3);
  ctx.lineTo(-len * 0.5, -h * 0.85 + ondul * h);
  ctx.quadraticCurveTo(-len * 0.4, 0, -len * 0.5, h * 0.85 + ondul * h);
  ctx.lineTo(-len * 0.3, h * 0.42 + ondul * h * 0.3);
  ctx.quadraticCurveTo(len * 0.1, h, len * 0.5, 0);
  ctx.closePath();
}

/** Une bulle de ressource remontant d'un gisement en cours d'exploitation. */
interface Mote {
  x: number;
  y: number;
  born: number;
  drift: number;
  rise: number;
  r: number;
  color: string;
}

/* ---------- LE REVENU QUI TOMBE (étape C) ---------------------------------
   Une bulle sur cinq ne se dissout pas : elle part vers le port, traverse la
   carte et s'y écrase en éclat. C'est le chaînon visuel qui manquait — le
   joueur voit littéralement la matière arrachée par SES créatures rejoindre sa
   base, au lieu de lire un nombre qui monte dans un panneau. */

/** Durée du trajet gisement -> port. */
const CONVOY_MS = 3200;
/** Plafond de convois simultanés — garde-fou de performance. */
const CONVOY_MAX = 24;
/** Une bulle sur N devient un convoi (sinon la carte se transforme en autoroute). */
const CONVOY_EVERY = 5;

/** Une charge de ressource en route vers le port. */
interface Convoy {
  x: number;
  y: number;
  born: number;
  bow: number;
  r: number;
  color: string;
}

/** Préfixe qui distingue, dans une même zone cliquable, un relais d'expédition
 *  (`@courant`) d'un foyer de secteur (`s1_herbier`). Le panneau lit ce préfixe
 *  pour savoir quelle fiche ouvrir. */
export const RELAIS_PREFIX = "@";

interface HitZone {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Somme des codes de caractères — sert uniquement à donner une place stable sur la
 *  carte à une expédition dont la destination n'est plus dans les offres du jour
 *  (les offres tournent à minuit, une escouade partie la veille est encore en mer). */
function charSum(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i);
  return n;
}

/** Point d'une courbe de Bézier quadratique — un trajet en mer n'est jamais droit. */
function bez(
  t: number,
  p0: [number, number],
  c: [number, number],
  p1: [number, number],
): [number, number] {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
  ];
}

/** Petite étoile à quatre branches TRACÉE (jamais `fillText`) : le glyphe « ✦ »
 *  se rend comme un point de 2 px dans certains moteurs — piège déjà rencontré
 *  dans ce projet. Sert à afficher le rang d'une destination. */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.22, y - r * 0.22, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.22, y + r * 0.22, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.22, y + r * 0.22, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.22, y - r * 0.22, x, y - r);
  ctx.closePath();
  ctx.fill();
}

export function TerritoireScene({
  sectorId,
  selected,
  onSelect,
}: {
  sectorId: string;
  selected: string | null;
  onSelect: (foyerId: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Miroirs en ref des props : la boucle rAF les lit sans jamais être relancée.
  const sectorRef = useRef(sectorId);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    sectorRef.current = sectorId;
    selectedRef.current = selected;
    onSelectRef.current = onSelect;
  }, [sectorId, selected, onSelect]);

  const hitZonesRef = useRef<HitZone[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const snow: Snow[] = Array.from({ length: SNOW_COUNT }, makeSnow);
    /** Foyers déjà capturés à la frame précédente : une prise qui apparaît sous les
     *  yeux du joueur déclenche une onde de choc sur SON nœud. */
    const seenCaptured = new Set<string>();
    let primed = false;
    const rings: { x: number; y: number; born: number; color: string }[] = [];

    /* Les bulles remontées par les équipages, et la prochaine échéance d'émission
       de chaque gisement. Vidées au changement de secteur : une bulle appartient
       à un gisement, elle n'a rien à faire au-dessus d'une autre carte. */
    const motes: Mote[] = [];
    const nextMoteAt = new Map<string, number>();
    /* Les charges en route vers le port, et le compteur qui décide laquelle des
       bulles arrivées en haut prend la route plutôt que de se dissoudre. */
    const convoys: Convoy[] = [];
    let moteSeq = 0;
    let shownSector = sectorRef.current;

    let cssSize = 0;
    let dpr = 1;
    const resize = () => {
      cssSize = Math.min(wrap.clientWidth, 560);
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
      const S = cssSize;
      if (S <= 0) return;

      const state = useGame.getState();
      const t = state.territoire;
      const palier = state.waveCount;
      const sector: SectorDef =
        SECTORS.find((s) => s.id === sectorRef.current) ?? SECTORS[0];
      const open = sectorUnlocked(sector, palier);
      if (sector.id !== shownSector) {
        shownSector = sector.id;
        motes.length = 0;
        convoys.length = 0;
        nextMoteAt.clear();
      }
      const space = TERRITOIRE_MAP.coord_space;
      const nodeR = (TERRITOIRE_MAP.node_radius_pct / 100) * S;

      /* --- Coordonnées écran d'un foyer --- */
      const px = (f: FoyerDef) => (f.x / space) * S;
      const py = (f: FoyerDef) => (f.y / space) * S;

      /* --- Détection d'une capture survenue à l'écran --- */
      for (const f of sector.foyers) {
        const taken = isCaptured(t, f.id);
        if (taken && primed && !seenCaptured.has(f.id)) {
          rings.push({ x: px(f), y: py(f), born: nowMs, color: natureDef(f.nature).color });
        }
        if (taken) seenCaptured.add(f.id);
        else seenCaptured.delete(f.id);
      }
      primed = true;

      /* --- Fond : les eaux du secteur --- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = false;

      const bg = ctx.createLinearGradient(0, 0, 0, S);
      bg.addColorStop(0, hexA(sector.tint, open ? 0.55 : 0.18));
      bg.addColorStop(0.55, hexA(sector.tint, open ? 0.24 : 0.08));
      bg.addColorStop(1, "rgba(5, 11, 20, 0.95)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, S, S);

      // Rais de lumière descendants : plus francs en surface, éteints dans la fosse.
      const light = Math.max(0, 1 - sector.unlock_palier / 60);
      if (light > 0.02) {
        for (let i = 0; i < 3; i++) {
          const cx = S * (0.2 + 0.3 * i) + Math.sin(nowMs / 4200 + i) * S * 0.03;
          const beam = ctx.createLinearGradient(cx, 0, cx, S * 0.8);
          beam.addColorStop(0, `rgba(207, 244, 255, ${(0.07 * light).toFixed(3)})`);
          beam.addColorStop(1, "rgba(207, 244, 255, 0)");
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(cx - S * 0.02, 0);
          ctx.lineTo(cx + S * 0.02, 0);
          ctx.lineTo(cx + S * 0.09, S * 0.8);
          ctx.lineTo(cx - S * 0.09, S * 0.8);
          ctx.closePath();
          ctx.fill();
        }
      }

      /* --- LA FAUNE DE FOND (étape C) ---
             Plus on descend, moins il y a de monde et plus il est gros : la
             photique voit passer un banc, l'abîme deux masses. En surface la
             silhouette est SOMBRE (elle se découpe sur l'eau claire) ; dans le
             noir elle devient un liseré bioluminescent, sans quoi on ne verrait
             rien du tout. */
      const deep = 1 - light; // 0 en surface, 1 dans la fosse
      const drifters = Math.round(5 - 2 * deep);
      const tSec = nowMs / 1000;
      for (let i = 0; i < drifters; i++) {
        const seed = sector.id;
        const lane = 0.1 + hashed(seed, i * 7 + 1) * 0.82;
        const dir = hashed(seed, i * 7 + 2) < 0.5 ? 1 : -1;
        const speed = DRIFTER_CROSS_S * (0.7 + hashed(seed, i * 7 + 3) * 0.9) * (1 + deep);
        const len = S * (0.07 + hashed(seed, i * 7 + 4) * 0.05) * (1 + deep * 2.2);
        const prog = (((tSec / speed + hashed(seed, i * 7 + 5)) % 1) + 1) % 1;
        const fx = dir > 0 ? prog : 1 - prog;
        const x = (-0.15 + fx * 1.3) * S;
        const swim = Math.sin(tSec * (0.5 + hashed(seed, i * 7 + 6) * 0.6) + i * 1.7);
        const y = (lane + swim * 0.03) * S;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(swim * 0.1);
        ctx.scale(dir > 0 ? 1 : -1, 1);
        drifterPath(ctx, len, swim);
        if (light > 0.35) {
          // Eau claire : la bête se découpe en ombre, comme vue à contre-jour.
          ctx.fillStyle = `rgba(3, 10, 18, ${(0.14 + 0.16 * light).toFixed(3)})`;
          ctx.fill();
        } else {
          /* Nuit permanente : une ombre y serait invisible. La créature
             abyssale se signale par son PROPRE liseré lumineux, qui palpite au
             rythme de sa nage, et par une rangée de photophores qui s'allument
             en vague de la tête vers la queue. */
          const glow = 0.32 + 0.24 * (0.5 + 0.5 * swim);
          ctx.shadowColor = hexA(sector.tint, 0.6);
          ctx.shadowBlur = Math.max(5, len * 0.16);
          ctx.strokeStyle = hexA(sector.tint, glow);
          ctx.lineWidth = 1.9;
          ctx.stroke();
          ctx.fillStyle = hexA(sector.tint, 0.1);
          ctx.fill();
          ctx.shadowBlur = 0;
          for (let k = 0; k < 4; k++) {
            const along = 0.3 - k * 0.19;
            const bio = 0.5 + 0.5 * Math.sin(tSec * 2.1 - k * 0.85 + i * 1.3);
            ctx.fillStyle = `rgba(228, 252, 255, ${(0.14 + 0.52 * bio).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(len * along, len * 0.3 * (0.12 + swim * 0.16 * (0.5 - along)), 1 + bio * 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      /* --- Neige marine --- */
      for (const p of snow) {
        p.y += p.speed * dt;
        p.phase += dt * 0.7;
        if (p.y > 1.02) {
          p.y = -0.02;
          p.x = Math.random();
        }
        const x = (p.x + Math.sin(p.phase) * p.wobble) * S;
        ctx.fillStyle = `rgba(180, 232, 240, ${(0.14 + 0.1 * Math.sin(p.phase * 1.7)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, p.y * S, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      /* --- Le fil du secteur : les foyers dans l'ordre des paliers ---
             Un segment s'allume quand ses DEUX extrémités sont prises : la carte
             raconte visuellement jusqu'où le joueur est descendu. */
      const route = [...sector.foyers].sort((a, b) => a.palier - b.palier);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        const lit = isCaptured(t, a.id) && isCaptured(t, b.id);
        ctx.save();
        ctx.strokeStyle = lit ? hexA(sector.tint, 0.75) : "rgba(150, 200, 210, 0.16)";
        ctx.lineWidth = lit ? 2 : 1;
        if (!lit) ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(b), py(b));
        ctx.stroke();
        ctx.restore();
      }

      /* --- Les foyers --- */
      const zones: HitZone[] = [];
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 620);

      for (const f of sector.foyers) {
        const nat = natureDef(f.nature);
        const x = px(f);
        const y = py(f);
        const taken = isCaptured(t, f.id);
        // Étape D : plus rien ne « termine » un foyer, seul le secteur peut être fermé.
        const free = open;
        zones.push({ id: f.id, x, y, r: nodeR * 1.15 });

        ctx.save();

        // Halo doux sous un nœud encore à prendre : c'est là que l'œil doit aller.
        if (free && !taken) {
          const glow = ctx.createRadialGradient(x, y, nodeR * 0.2, x, y, nodeR * 1.9);
          glow.addColorStop(0, hexA(nat.color, 0.22 + 0.12 * pulse));
          glow.addColorStop(1, hexA(nat.color, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, nodeR * 1.9, 0, Math.PI * 2);
          ctx.fill();
        }

        // Disque
        ctx.fillStyle = taken
          ? hexA(nat.color, 0.26)
          : open
            ? "rgba(6, 14, 24, 0.82)"
            : "rgba(6, 14, 24, 0.6)";
        ctx.beginPath();
        ctx.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx.fill();

        // Liseré : plein si pris, pointillé pulsant si à prendre, éteint si verrouillé.
        ctx.strokeStyle = open ? hexA(nat.color, taken ? 0.95 : 0.5 + 0.35 * pulse) : "rgba(120, 150, 165, 0.3)";
        ctx.lineWidth = taken ? 2.5 : 1.6;
        if (!taken && open) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Anneau de sélection : doré, pulsant, par-dessus tout le reste du nœud.
        if (selectedRef.current === f.id) {
          ctx.strokeStyle = `rgba(255, 207, 77, ${(0.55 + 0.4 * pulse).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, nodeR * (1.22 + 0.06 * pulse), 0, Math.PI * 2);
          ctx.stroke();
        }

        // Glyphe de la nature
        ctx.globalAlpha = open ? (taken ? 1 : 0.92) : 0.35;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${Math.round(nodeR * 1.05)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(nat.icon, x, y + nodeR * 0.04);
        ctx.globalAlpha = 1;

        // Pastille du palier, en bas à droite du disque
        // Un foyer déjà pris se re-défie à un palier RELEVÉ (étape D) : la pastille
        // doit annoncer ce palier-là, pas celui de la première prise.
        const label = String(assaultPalier(f, palier, t));
        ctx.font = "bold 10px ui-monospace, monospace";
        const w = ctx.measureText(label).width + 8;
        const bx = x + nodeR * 0.72;
        const by = y + nodeR * 0.72;
        ctx.fillStyle = "rgba(5, 11, 20, 0.9)";
        ctx.beginPath();
        ctx.roundRect(bx - w / 2, by - 7, w, 14, 7);
        ctx.fill();
        ctx.strokeStyle = open ? hexA(nat.color, 0.6) : "rgba(120, 150, 165, 0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = open ? "#cff4ff" : "rgba(207, 244, 255, 0.45)";
        ctx.fillText(label, bx, by + 0.5);

        // Jauge de développement d'un gisement : de petits points sous le nœud.
        const dev = devLevel(t, f.id);
        if (taken && f.nature === "gisement") {
          /* Le développement n'a plus de plafond (étape D) : la rangée de points
             ne peut donc plus être une jauge « x sur y ». On dessine les paliers
             calibrés — ceux qui augmentent encore le rendement horaire — puis, une
             fois la rangée pleine, un chevron qui pointe vers la droite et un
             compteur des niveaux PROFONDS. La rangée reste de largeur fixe : elle
             ne peut jamais déborder du nœud, si loin qu'aille le joueur. */
          const soft = devSoftCap();
          const deepLv = Math.max(0, dev - soft);
          const gap = nodeR * 0.34;
          const startX = x - (gap * (soft - 1)) / 2;
          const gy = y + nodeR * 1.42;
          for (let i = 0; i < soft; i++) {
            ctx.fillStyle = i < dev ? nat.color : "rgba(150, 200, 210, 0.25)";
            ctx.beginPath();
            ctx.arc(startX + gap * i, gy, 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
          if (deepLv > 0) {
            // Au-delà : la rangée continue hors du cadre, en une pointe qui bat.
            const ax = startX + gap * (soft - 1) + gap * 0.9;
            ctx.strokeStyle = hexA(nat.color, 0.75 + 0.25 * pulse);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(ax - 2, gy - 2.6);
            ctx.lineTo(ax + 1.6, gy);
            ctx.lineTo(ax - 2, gy + 2.6);
            ctx.stroke();
            ctx.font = "bold 8px ui-monospace, monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillStyle = hexA(nat.color, 0.9);
            ctx.fillText(`+${deepLv}`, ax + 3.4, gy + 0.5);
            ctx.textAlign = "center";
          }
        }

        /* --- L'ÉQUIPAGE AU TRAVAIL (étape B) ---
               Une créature postée n'est pas une ligne dans un menu : elle tourne
               autour de son gisement, plonge dedans et en remonte de la matière.
               C'est le circuit pêche → carte → revenu, rendu visible. */
        const crew = taken && f.nature === "gisement" ? crewOf(t, f.id) : [];
        if (crew.length > 0 && open) {
          // Halo de chantier : plus chaud que celui d'un nœud libre, il dit que
          // CE gisement produit à cet instant précis.
          const work = ctx.createRadialGradient(x, y, nodeR * 0.5, x, y, nodeR * 2.2);
          work.addColorStop(0, hexA(nat.color, 0.15 + 0.09 * pulse));
          work.addColorStop(1, hexA(nat.color, 0));
          ctx.fillStyle = work;
          ctx.beginPath();
          ctx.arc(x, y, nodeR * 2.2, 0, Math.PI * 2);
          ctx.fill();

          const size = nodeR * 0.74;
          for (let i = 0; i < crew.length; i++) {
            // Cycle décalé par créature : l'équipage ne plonge jamais en cadence.
            const ph = ((nowMs + i * 737) % CREW_CYCLE_MS) / CREW_CYCLE_MS;
            const wave = Math.sin(ph * Math.PI * 2);
            const dive = wave * 0.5 + 0.5; // 0 = en surface, 1 = au fond du gisement
            const a =
              (nowMs / CREW_ORBIT_MS) * Math.PI * 2 + (i / crew.length) * Math.PI * 2;
            // Orbite écrasée : la carte est vue de dessus, les créatures tournent
            // dans un plan incliné plutôt que sur un cercle parfait.
            const rad = nodeR * (1.8 - 0.74 * dive);
            const cx = x + Math.cos(a) * rad;
            const cy = y + Math.sin(a) * rad * 0.72;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(wave * 0.34);
            ctx.fillStyle = "rgba(5, 11, 20, 0.6)";
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.54, 0, Math.PI * 2);
            ctx.fill();
            const img = getImage(cardArt(crew[i]));
            if (ready(img)) {
              ctx.save();
              ctx.clip();
              ctx.drawImage(img, -size / 2, -size / 2, size, size);
              ctx.restore();
            } else {
              // Repli tant que le portrait n'est pas chargé : une silhouette teintée.
              ctx.fillStyle = hexA(nat.color, 0.85);
              ctx.beginPath();
              ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.strokeStyle = hexA(nat.color, 0.5 + 0.4 * dive);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.54, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Émission des bulles : la cadence est divisée par la taille de l'équipage,
          // donc un gisement à six postes bouillonne visiblement plus qu'un à un poste.
          if (nowMs >= (nextMoteAt.get(f.id) ?? 0)) {
            nextMoteAt.set(f.id, nowMs + MOTE_EVERY_MS / crew.length);
            if (motes.length < MOTE_MAX) {
              motes.push({
                x: x + (Math.random() - 0.5) * nodeR * 0.9,
                y: y - nodeR * 0.15,
                born: nowMs,
                drift: (Math.random() - 0.5) * nodeR * 0.6,
                rise: nodeR * (2.2 + Math.random() * 1.7),
                r: 1.5 + Math.random() * 1.8,
                color: nat.color,
              });
            }
          }
        }

        ctx.restore();
      }

      /* --- Les bulles remontées par les équipages ---
             Dessinées après tous les nœuds : la matière remonte PAR-DESSUS la carte,
             comme des bulles qui quittent le fond. */
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        const age = (nowMs - m.born) / MOTE_LIFE_MS;
        if (age >= 1) {
          // Arrivée en haut de sa course : une bulle sur CONVOY_EVERY ne se
          // dissout pas, elle prend la route du port. Le revenu du territoire
          // cesse d'être un nombre : on le voit traverser la carte.
          if (++moteSeq % CONVOY_EVERY === 0 && convoys.length < CONVOY_MAX) {
            convoys.push({
              x: m.x + m.drift,
              y: m.y - m.rise,
              born: nowMs,
              bow: (hashed(m.color, moteSeq) - 0.5) * 0.34,
              r: m.r * 1.25,
              color: m.color,
            });
          }
          motes.splice(i, 1);
          continue;
        }
        const mx = m.x + m.drift * age + Math.sin(age * 7 + m.drift) * 1.8;
        const my = m.y - m.rise * age;
        ctx.save();
        ctx.globalAlpha = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(mx, my, m.r * (1 - age * 0.3), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.beginPath();
        ctx.arc(mx - m.r * 0.3, my - m.r * 0.3, m.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* --- Ondes de choc « foyer capturé » --- */
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const age = (nowMs - r.born) / CAPTURE_RING_MS;
        if (age >= 1) {
          rings.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = (1 - age) * 0.85;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3 * (1 - age) + 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, nodeR * (1 + 2.6 * age), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      /* --- Voile d'un secteur encore fermé --- */
      if (!open) {
        ctx.fillStyle = "rgba(5, 11, 20, 0.55)";
        ctx.fillRect(0, 0, S, S);
      }

      /* --- LES RELAIS DU JOUR ---------------------------------------------------
             Les expéditions ont quitté le Noyau (cf. PLAN_DERIVE §3.7) : les quatre
             destinations du jour sont désormais posées ICI, au-dessus des foyers.
             Elles n'appartiennent à aucun secteur — un relais dérive avec le joueur —
             donc on les dessine APRÈS le voile : elles restent lisibles et cliquables
             même si le secteur affiché est encore fermé. */
      const rel = TERRITOIRE_MAP.relais;
      const relR = (rel.radius_pct / 100) * S;
      const offers = dailyOffers(state, state.lastTick);
      const slotXY = (i: number): [number, number] => {
        const slot = rel.slots[i % rel.slots.length];
        return [(slot.x / space) * S, (slot.y / space) * S];
      };
      const port: [number, number] = [(rel.port.x / space) * S, (rel.port.y / space) * S];
      /** Relais actuellement occupés par une escouade en mer. */
      const busy = new Set(state.expeditions.map((e) => e.destId));

      /* Le port : d'où partent les escouades. Un simple arc tracé, pas d'asset. */
      ctx.save();
      ctx.strokeStyle = hexA(rel.color, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(port[0], port[1], relR * 1.1, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = hexA(rel.color, 0.12 + 0.06 * pulse);
      ctx.beginPath();
      ctx.arc(port[0], port[1], relR * 1.1, Math.PI, 0);
      ctx.fill();
      ctx.restore();

      /* Les trajets en cours : une escouade avance vraiment le long de sa courbe,
         au prorata du temps écoulé. C'est le seul endroit du jeu où l'on VOIT
         passer les heures d'une expédition. */
      for (const exp of state.expeditions) {
        const idx = offers.findIndex((o) => o.destId === exp.destId);
        const slotI = idx >= 0 ? idx : charSum(exp.destId) % rel.slots.length;
        const target = slotXY(slotI);
        const total = Math.max(1, exp.endsAt - exp.startedAt);
        const prog = Math.min(1, Math.max(0, (state.lastTick - exp.startedAt) / total));
        // Le point de contrôle est décalé latéralement : deux escouades parties vers
        // deux relais voisins ne se superposent jamais.
        const ctrl: [number, number] = [
          (port[0] + target[0]) / 2 + S * 0.14 * (slotI % 2 === 0 ? -1 : 1),
          (port[1] + target[1]) / 2,
        ];

        ctx.save();
        // Trajet complet, en pointillé discret.
        ctx.strokeStyle = hexA(rel.color, 0.16);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 7]);
        ctx.beginPath();
        ctx.moveTo(port[0], port[1]);
        ctx.quadraticCurveTo(ctrl[0], ctrl[1], target[0], target[1]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Portion déjà parcourue, pleine : le sillage.
        ctx.strokeStyle = hexA(rel.color, 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(port[0], port[1]);
        for (let s = 1; s <= 40; s++) {
          const t = (s / 40) * prog;
          const p = bez(t, port, ctrl, target);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();

        // L'escouade : une nacelle et sa traîne de créatures, qui ondulent en nageant.
        for (let k = 0; k < 3; k++) {
          const t = Math.max(0, prog - k * 0.028);
          const p = bez(t, port, ctrl, target);
          const wob = Math.sin(nowMs / 340 + k * 1.7 + exp.id) * relR * 0.22;
          const rr = relR * (k === 0 ? 0.42 : 0.2);
          ctx.globalAlpha = k === 0 ? 0.95 : 0.6 - k * 0.12;
          ctx.fillStyle = rel.color;
          ctx.beginPath();
          ctx.ellipse(p[0] + wob, p[1], rr * 1.25, rr, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      /* Les quatre relais eux-mêmes. */
      for (let i = 0; i < offers.length && i < rel.slots.length; i++) {
        const offer = offers[i];
        const [x, y] = slotXY(i);
        const taken = busy.has(offer.destId);
        const id = RELAIS_PREFIX + offer.destId;
        zones.push({ id, x, y, r: relR * 1.5 });

        ctx.save();
        // Halo : un relais libre appelle, un relais occupé attend son escouade.
        const glow = ctx.createRadialGradient(x, y, relR * 0.2, x, y, relR * 2.1);
        glow.addColorStop(0, hexA(rel.color, taken ? 0.1 : 0.2 + 0.12 * pulse));
        glow.addColorStop(1, hexA(rel.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, relR * 2.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(6, 14, 24, 0.85)";
        ctx.beginPath();
        ctx.arc(x, y, relR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = hexA(rel.color, taken ? 0.4 : 0.55 + 0.35 * pulse);
        ctx.lineWidth = taken ? 1.2 : 1.8;
        if (taken) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, relR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        if (selectedRef.current === id) {
          ctx.strokeStyle = `rgba(255, 207, 77, ${(0.55 + 0.4 * pulse).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, relR * (1.35 + 0.08 * pulse), 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.globalAlpha = taken ? 0.5 : 1;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${Math.round(relR * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(rel.icon, x, y + relR * 0.04);
        ctx.globalAlpha = 1;

        // Rang de la destination : des étoiles TRACÉES, sous le disque.
        ctx.fillStyle = hexA(rel.color, 0.9);
        const sr = relR * 0.2;
        const sx = x - (sr * 2.6 * (offer.tier - 1)) / 2;
        for (let s = 0; s < offer.tier; s++) star(ctx, sx + s * sr * 2.6, y + relR * 1.5, sr);

        ctx.restore();
      }

      /* --- LE REVENU QUI TOMBE (étape C) ---
             Dessiné en tout dernier, donc au-dessus des relais : la charge
             arrachée par l'équipage file vers le port et s'y écrase en éclat.
             Rien ici ne modifie l'état du jeu — c'est la lecture visuelle d'un
             revenu déjà calculé par le moteur, pas une seconde source de vérité. */
      for (let i = convoys.length - 1; i >= 0; i--) {
        const c = convoys[i];
        const age = (nowMs - c.born) / CONVOY_MS;
        if (age >= 1) {
          convoys.splice(i, 1);
          continue;
        }
        const from: [number, number] = [c.x, c.y];
        // Point de contrôle décalé perpendiculairement : chaque charge décrit sa
        // propre courbe, deux convois du même gisement ne se superposent pas.
        const mx0 = (from[0] + port[0]) / 2;
        const my0 = (from[1] + port[1]) / 2;
        const ctrl2: [number, number] = [
          mx0 - (port[1] - from[1]) * c.bow,
          my0 + (port[0] - from[0]) * c.bow,
        ];
        const p = bez(age, from, ctrl2, port);

        ctx.save();
        // Traîne : quelques positions en arrière sur la même courbe.
        for (let k = 3; k >= 1; k--) {
          const tt = Math.max(0, age - k * 0.035);
          const q = bez(tt, from, ctrl2, port);
          ctx.globalAlpha = 0.1 * (4 - k);
          ctx.fillStyle = c.color;
          ctx.beginPath();
          ctx.arc(q[0], q[1], c.r * (1 - k * 0.18), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowColor = c.color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(p[0], p[1], c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        ctx.beginPath();
        ctx.arc(p[0] - c.r * 0.3, p[1] - c.r * 0.3, c.r * 0.32, 0, Math.PI * 2);
        ctx.fill();

        // Impact : le port encaisse la livraison par un anneau qui s'ouvre.
        if (age > 0.86) {
          const k = (age - 0.86) / 0.14;
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = c.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(port[0], port[1], relR * (0.6 + k * 1.5), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      hitZonesRef.current = zones;
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // Boucle autonome : lit le store via getState(), aucune dépendance React.
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const z of hitZonesRef.current) {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d <= z.r && (!best || d < best.d)) best = { id: z.id, d };
    }
    onSelectRef.current(best ? best.id : null);
  };

  return (
    <div ref={wrapRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="touch-manipulation cursor-pointer rounded-md"
        aria-label="Carte de La Dérive — touchez un foyer ou un relais pour ouvrir sa fiche"
      />
    </div>
  );
}
