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
import { useGame } from "@/lib/game/store";
import {
  assaultPalier,
  devLevel,
  foyerAvailable,
  isCaptured,
  maxDevLevel,
  natureDef,
  SECTORS,
  sectorUnlocked,
  TERRITOIRE_MAP,
  type FoyerDef,
  type SectorDef,
} from "@/lib/game/territoire";

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

interface HitZone {
  id: string;
  x: number;
  y: number;
  r: number;
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
        const free = open && foyerAvailable(t, f);
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
        const label = String(assaultPalier(f, palier));
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
          const max = maxDevLevel();
          const gap = nodeR * 0.34;
          const startX = x - (gap * (max - 1)) / 2;
          for (let i = 0; i < max; i++) {
            ctx.fillStyle = i < dev ? nat.color : "rgba(150, 200, 210, 0.25)";
            ctx.beginPath();
            ctx.arc(startX + gap * i, y + nodeR * 1.42, 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }
      hitZonesRef.current = zones;

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
        aria-label="Carte de La Dérive — touchez un foyer pour ouvrir sa fiche"
      />
    </div>
  );
}
