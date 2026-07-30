/* WALACHIE — arbre d'évolution en bulles interconnectées (façon Cell to
   Singularity), qui remplace la liste défilante précédente.

   Bas -> haut : chaque ère est une grosse bulle-portail (hub), et les nœuds
   qu'elle contient s'enchaînent au-dessus d'elle jusqu'au hub de l'ère
   suivante — l'arbre pousse littéralement vers le haut à mesure qu'on
   avance. Les bulles flottent légèrement (bob sinusoïdal, déphasé par
   nœud). On peut glisser pour circuler dans tout l'arbre déjà parcouru,
   pas seulement la frontière actuelle. Un tap sélectionne une bulle et
   ouvre un panneau d'action en bas (achat / percée d'ère) ; ce panneau est
   du DOM normal (pas dessiné au canvas) pour rester réactif à la sève qui
   monte sans dépendre d'un re-render de tout l'arbre.

   Même patron que WalachieScene : une boucle requestAnimationFrame qui lit
   useWalachie.getState() à chaque image (jamais Date.now() dans un rendu
   React), la structure des bulles ne se reconstruit que quand la frontière
   (erasUnlocked) avance. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  eraAt,
  nodesOfEra,
  walachieSprite,
} from "@/lib/game/walachie/config";
import {
  fmtSeve,
  nodeCost,
  nodeCostN,
  nodeMaxBuyable,
} from "@/lib/game/walachie/engine";
import { useWalachie } from "@/lib/game/walachie/store";

type BuyQty = 1 | 10 | "max";

function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

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

interface Bubble {
  kind: "hub" | "node";
  id: string; // id d'ère (hub) ou de nœud
  eraId: string;
  eraIndex: number;
  x: number;
  y: number;
  r: number;
  phase: number;
  label: string;
  sprite: string | null;
  icon: string | null;
  isFrontier: boolean; // le hub encore à percer
}

const HUB_R = 25;
const NODE_R = 19;
const NODE_GAP = 66;
const HUB_TO_FIRST_NODE = 66;
const LAST_NODE_TO_NEXT_HUB = 78;
const JITTER_X = 46;

function buildBubbles(erasUnlocked: number): { bubbles: Bubble[]; minY: number; maxY: number } {
  const bubbles: Bubble[] = [];
  let y = 0; // l'ère 0 (bas de l'arbre) part d'ici ; les ères suivantes montent (y décroît)
  for (let i = 0; i <= erasUnlocked; i++) {
    const era = eraAt(i);
    const hx = hash01(i, 3) * JITTER_X - JITTER_X / 2;
    const isFrontier = i === erasUnlocked;
    bubbles.push({
      kind: "hub",
      id: era.id,
      eraId: era.id,
      eraIndex: i,
      x: hx,
      y,
      r: HUB_R,
      phase: hash01(i, 11) * Math.PI * 2,
      label: era.nom,
      sprite: null,
      icon: era.icone,
      isFrontier,
    });
    if (!isFrontier) {
      const nodes = nodesOfEra(era.id);
      let ny = y - HUB_TO_FIRST_NODE;
      for (const n of nodes) {
        const h = hashId(n.id);
        const nx = (hash01(h, 5) - 0.5) * JITTER_X * 2.2;
        bubbles.push({
          kind: "node",
          id: n.id,
          eraId: era.id,
          eraIndex: i,
          x: nx,
          y: ny,
          r: NODE_R,
          phase: hash01(h, 17) * Math.PI * 2,
          label: n.nom,
          sprite: n.sprite,
          icon: null,
          isFrontier: false,
        });
        ny -= NODE_GAP;
      }
      y = ny + NODE_GAP - LAST_NODE_TO_NEXT_HUB;
    }
  }
  const ys = bubbles.map((b) => b.y);
  return { bubbles, minY: Math.min(...ys) - 60, maxY: Math.max(...ys) + 60 };
}

export function EvolutionTree({ erasUnlocked, qty }: { erasUnlocked: number; qty: BuyQty }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<Bubble | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selected ? selected.id : null;
  }, [selected]);

  const { bubbles, minY, maxY } = useMemo(() => buildBubbles(erasUnlocked), [erasUnlocked]);
  const bubblesRef = useRef(bubbles);
  const camRef = useRef({ x: 0, y: minY + 140, targetY: minY + 140 });
  useEffect(() => {
    bubblesRef.current = bubbles;
    // La frontière vient de pousser : recentre doucement en haut de l'arbre.
    camRef.current.targetY = minY + 140;
  }, [bubbles, minY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
    };
    resize();
    window.addEventListener("resize", resize);

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const clampCam = () => {
      const vh = canvas.clientHeight;
      const cam = camRef.current;
      const margin = vh * 0.4;
      cam.y = Math.min(maxY + margin, Math.max(minY - margin, cam.y));
      const vw = canvas.clientWidth;
      const marginX = vw * 0.3;
      cam.x = Math.min(marginX, Math.max(-marginX, cam.x));
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
      camRef.current.x -= dx;
      camRef.current.y -= dy;
      camRef.current.targetY = camRef.current.y; // l'utilisateur a pris la main
      clampCam();
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved < 10) {
        const rect = canvas.getBoundingClientRect();
        const vw = canvas.clientWidth;
        const vh = canvas.clientHeight;
        const wx = e.clientX - rect.left - vw / 2 + camRef.current.x;
        const wy = e.clientY - rect.top - vh / 2 + camRef.current.y;
        let hit: Bubble | null = null;
        for (const b of bubblesRef.current) {
          if ((b.x - wx) ** 2 + (b.y - wy) ** 2 <= (b.r + 10) ** 2) {
            hit = b;
            break;
          }
        }
        setSelected(hit);
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    const draw = () => {
      if (disposed) return;
      const t = performance.now();
      const cam = camRef.current;
      // Glisse doucement vers la frontière tant que l'utilisateur n'a pas panné.
      cam.y += (cam.targetY - cam.y) * 0.06;
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      const s = useWalachie.getState();

      ctx.clearRect(0, 0, vw, vh);
      ctx.save();
      ctx.translate(vw / 2 - cam.x, vh / 2 - cam.y);

      const bs = bubblesRef.current;
      const posOf = (b: Bubble) => ({
        x: b.x,
        y: b.y + Math.sin(t / 1600 + b.phase) * 4,
      });

      // Liens (l'arbre qui monte)
      ctx.strokeStyle = "rgba(185,140,255,0.35)";
      ctx.lineWidth = 2;
      for (let i = 1; i < bs.length; i++) {
        const prevSameEraChain =
          bs[i].kind === "node" && bs[i - 1].eraIndex === bs[i].eraIndex;
        const hubToFirstNode =
          bs[i].kind === "node" &&
          bs[i - 1].kind === "hub" &&
          bs[i - 1].eraIndex === bs[i].eraIndex;
        const lastNodeToNextHub =
          bs[i].kind === "hub" && bs[i - 1].eraIndex === bs[i].eraIndex - 1;
        if (prevSameEraChain || hubToFirstNode || lastNodeToNextHub) {
          const a = posOf(bs[i - 1]);
          const b = posOf(bs[i]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y);
          ctx.stroke();
        }
      }

      // Bulles
      for (const b of bs) {
        const p = posOf(b);
        const owned = b.kind === "node" ? s.nodes[b.id] ?? 0 : 0;
        const affordable =
          b.kind === "node" ? s.seve >= nodeCost(s, b.id) : b.isFrontier ? s.seve >= (eraAt(b.eraIndex).unlock_cost) : false;
        const selectedNow = selectedIdRef.current === b.id;

        if (b.isFrontier) {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = affordable ? "#ff5cdb" : "rgba(255,92,219,0.45)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, b.r + (affordable ? 3 + Math.sin(t / 300) * 2 : 0), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255,92,219,0.12)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
          ctx.fill();
        } else if (b.kind === "hub") {
          ctx.fillStyle = "rgba(185,140,255,0.16)";
          ctx.strokeStyle = "#b98cff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const lit = owned > 0;
          ctx.fillStyle = lit ? "rgba(74,246,178,0.18)" : "rgba(20,14,32,0.6)";
          ctx.strokeStyle = lit ? "#4af6b2" : "rgba(185,140,255,0.35)";
          ctx.lineWidth = lit ? 2 : 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (!lit && affordable) {
            ctx.strokeStyle = `rgba(255,232,150,${0.4 + 0.3 * Math.sin(t / 260)})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, b.r + 4, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (selectedNow) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, b.r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }

        const iconSrc = b.sprite ?? b.icon;
        if (iconSrc) {
          const img = getImage(walachieSprite(iconSrc));
          if (ready(img)) {
            const s2 = b.r * 1.3;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, p.x - s2 / 2, p.y - s2 / 2, s2, s2);
          }
        } else {
          ctx.fillStyle = "rgba(74,246,178,0.7)";
          ctx.font = `${b.r * 0.7}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("◈", p.x, p.y);
        }
        if (owned > 0) {
          ctx.font = "bold 10px monospace";
          ctx.fillStyle = "#0d0718";
          ctx.textAlign = "center";
          const label = `×${owned}`;
          const tw = ctx.measureText(label).width + 6;
          ctx.fillStyle = "#4af6b2";
          ctx.beginPath();
          ctx.roundRect(p.x - tw / 2, p.y + b.r - 2, tw, 13, 6);
          ctx.fill();
          ctx.fillStyle = "#0d0718";
          ctx.fillText(label, p.x, p.y + b.r + 4.5);
        }
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
  }, [minY, maxY]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full touch-none select-none" />
      <p className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] text-[#b98cff]/50">
        glisse pour circuler dans l&apos;arbre · tape une bulle
      </p>
      {selected && (
        <SelectedPanel bubble={selected} qty={qty} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function SelectedPanel({ bubble, qty, onClose }: { bubble: Bubble; qty: BuyQty; onClose: () => void }) {
  const seve = useWalachie((st) => st.seve);
  const nodesOwned = useWalachie((st) => st.nodes);
  const s = useWalachie.getState();

  if (bubble.kind === "hub") {
    const era = eraAt(bubble.eraIndex);
    if (!bubble.isFrontier) {
      return (
        <div className="absolute inset-x-3 bottom-3 rounded-xl border border-[#b98cff]/30 bg-[#100a1f]/95 p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#b98cff]">{era.nom}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-[#b98cff]/60">{era.desc}</div>
            </div>
            <button onClick={onClose} className="px-1 text-sm text-[#b98cff]/70">
              ✕
            </button>
          </div>
        </div>
      );
    }
    const can = seve >= era.unlock_cost;
    return (
      <div className="absolute inset-x-3 bottom-3 rounded-xl border border-dashed border-[#ff5cdb]/50 bg-[#100a1f]/95 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[#ff5cdb]">Percer : {era.nom}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-[#b98cff]/70">{era.desc}</div>
          </div>
          <button onClick={onClose} className="px-1 text-sm text-[#b98cff]/70">
            ✕
          </button>
        </div>
        <button
          onClick={() => useWalachie.getState().doUnlockEra()}
          disabled={!can}
          className={`mt-2 w-full rounded-lg border py-2 text-xs tracking-widest ${
            can ? "border-[#ff5cdb] text-[#ff5cdb]" : "border-[#b98cff]/20 text-[#b98cff]/40"
          }`}
        >
          {fmtSeve(era.unlock_cost)}
        </button>
      </div>
    );
  }

  // bulle de noeud : achat ×1/×10/×MAX comme avant
  const owned = nodesOwned[bubble.id] ?? 0;
  const nBuy = qty === "max" ? Math.max(1, nodeMaxBuyable(s, bubble.id)) : qty;
  const cost = qty === "max" ? nodeCostN(s, bubble.id, nBuy) : nodeCostN(s, bubble.id, qty);
  const can = seve >= (qty === "max" ? nodeCost(s, bubble.id) : cost);
  const nodeDefLabel = bubble.label;

  return (
    <div className="absolute inset-x-3 bottom-3 rounded-xl border border-[#4af6b2]/30 bg-[#100a1f]/95 p-3">
      <div className="flex items-center gap-2">
        {bubble.sprite ? (
          <img
            src={walachieSprite(bubble.sprite)}
            alt=""
            width={38}
            height={38}
            className="pixelated shrink-0"
            draggable={false}
          />
        ) : (
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-xl text-[#4af6b2]/60">
            ◈
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-sm text-[#eae2ff]">{nodeDefLabel}</span>
            {owned > 0 && <span className="text-[11px] text-[#4af6b2]">×{owned}</span>}
          </div>
        </div>
        <button onClick={onClose} className="px-1 text-sm text-[#b98cff]/70">
          ✕
        </button>
      </div>
      <button
        onClick={() => useWalachie.getState().doBuyNode(bubble.id, nBuy)}
        disabled={!can}
        className={`mt-2 w-full rounded-lg border py-2 text-xs tracking-widest ${
          can ? "border-[#4af6b2] text-[#4af6b2]" : "border-[#b98cff]/20 text-[#b98cff]/40"
        }`}
      >
        {qty === "max" ? `×${nBuy}` : `×${qty}`} · {fmtSeve(cost)}
      </button>
    </div>
  );
}
