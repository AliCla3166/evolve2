/* La Mare primordiale (Phase 6) — pêche (paillettes + tension, porté du
   prototype v1) et collection de cartes. Mobile-first, éléments interactifs
   en DOM (tap targets généreux, testables). Tuning : mare_config.json. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { CardFrame, Panel, PixelButton, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardLevel,
  cardPowerAtk,
  cardPowerDef,
  cardPowerExp,
  cardsDefenseBonus,
  cardsExpeditionExpBonus,
  MARE,
  nextLevelAt,
  rarityConfig,
} from "@/lib/game/cards";
import { fmtInt } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";

/* ---------- Paillettes (spawn visuel côté client, comme la v1) ---------- */

interface Sparkle {
  key: number;
  x: number; // % dans le bassin
  y: number;
  rarity: number;
  bornAt: number;
}

function rollSparkleRarity(): number {
  // Poids v1 (le tirage d'ESPÈCE, lui, passe par le PRNG seedé du moteur).
  const total = MARE.rarities.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < MARE.rarities.length; i++) {
    roll -= MARE.rarities[i].weight;
    if (roll <= 0) return i;
  }
  return 0;
}

const ROLE_LABEL = { defense: "🛡️ Défense", exploration: "🧭 Exploration", assaut: "⚔️ Assaut" } as const;

/* ---------- Phase de tension ---------- */

interface Capture {
  rarity: number;
  round: number; // 0..rounds-1
  hits: number;
  zoneCenter: number; // 0..1
  zoneSize: number;
  startedAt: number;
  /** feedback du dernier tap ("hit" | "miss" | null) */
  last: "hit" | "miss" | null;
}

/** Position du curseur 0..1 : onde triangulaire, précise au tap (pas de state 60 fps). */
function cursorPos(capture: Capture, nowMs: number): number {
  const period = MARE.tension.base_period_ms / rarityConfig(capture.rarity).speed;
  const t = ((nowMs - capture.startedAt) % period) / period;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/* Helpers impurs (performance.now / Math.random) hors du corps du composant —
   appelés uniquement depuis des gestionnaires d'événements. */

function newCapture(rarity: number): Capture {
  return {
    rarity,
    round: 0,
    hits: 0,
    zoneCenter: 0.3 + Math.random() * 0.4,
    zoneSize: rarityConfig(rarity).zone,
    startedAt: performance.now(),
    last: null,
  };
}

function advanceCapture(c: Capture, hit: boolean): Capture {
  return {
    ...c,
    round: c.round + 1,
    hits: c.hits + (hit ? 1 : 0),
    zoneCenter: 0.2 + Math.random() * 0.6,
    // Plancher d'équité : jamais sous zone_min, même Mythique au dernier tap.
    zoneSize: Math.max(MARE.tension.zone_min, c.zoneSize * MARE.tension.zone_shrink_per_round),
    startedAt: performance.now(),
    last: hit ? "hit" : "miss",
  };
}

function tapIsHit(c: Capture): boolean {
  const pos = cursorPos(c, performance.now());
  return Math.abs(pos - c.zoneCenter) <= c.zoneSize / 2;
}

/** Barre de tension isolée : son rAF ne re-rend que la barre (60 fps),
 *  jamais le panneau entier — important pour la batterie mobile. */
function TensionBar({ capture }: { capture: Capture }) {
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      setCursor(cursorPos(capture, performance.now()));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [capture]);

  return (
    <span className="relative block h-6 w-full max-w-[300px] overflow-hidden rounded-full border border-cell-cyan/50 bg-abyss/90">
      <span
        data-testid="tension-zone"
        className="absolute top-0 h-full"
        style={{
          left: `${(capture.zoneCenter - capture.zoneSize / 2) * 100}%`,
          width: `${capture.zoneSize * 100}%`,
          background: "rgba(166, 255, 61, 0.45)",
          borderLeft: "1px solid #a6ff3d",
          borderRight: "1px solid #a6ff3d",
        }}
      />
      <span
        data-testid="tension-cursor"
        className="absolute top-0 h-full w-[3px] bg-white"
        style={{ left: `calc(${cursor * 100}% - 1px)`, boxShadow: "0 0 8px #6df6ff" }}
      />
    </span>
  );
}

export function MarePanel({ onClose }: { onClose: () => void }) {
  const jetons = useGame((s) => s.jetons);
  const fragments = useGame((s) => s.fragments);
  const energie = useGame((s) => s.resources.energie);
  const collection = useGame((s) => s.collection);
  const assignments = useGame((s) => s.cardAssignments);
  const buyJeton = useGame((s) => s.buyJeton);
  const spendJeton = useGame((s) => s.spendJeton);
  const landCatch = useGame((s) => s.landCatch);
  const fuseFragments = useGame((s) => s.fuseFragments);
  const toggleCardAssign = useGame((s) => s.toggleCardAssign);

  const [tab, setTab] = useState<"peche" | "collection">("peche");
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextKey = useRef(1);
  const captureRef = useRef<Capture | null>(null);
  useEffect(() => {
    captureRef.current = capture;
  }, [capture]);

  // Spawn/expiration des paillettes (3 max, durée de vie ~6 s).
  useEffect(() => {
    if (tab !== "peche") return;
    const id = setInterval(() => {
      setSparkles((prev) => {
        const now = performance.now();
        let next = prev.filter((s) => now - s.bornAt < 6000);
        if (next.length < 3 && !captureRef.current) {
          next = [
            ...next,
            {
              key: nextKey.current++,
              x: 12 + Math.random() * 76,
              y: 18 + Math.random() * 66,
              rarity: rollSparkleRarity(),
              bornAt: now,
            },
          ];
        }
        return next;
      });
    }, 1400);
    return () => clearInterval(id);
  }, [tab]);

  const startCapture = (sp: Sparkle) => {
    if (capture) return;
    if (!spendJeton()) {
      setNotice(`Il te faut un jeton — achète-en un (${MARE.jetons.cost_energie} ⚡).`);
      return;
    }
    setNotice(null);
    setSparkles([]);
    setCapture(newCapture(sp.rarity));
  };

  const tapTension = () => {
    const c = captureRef.current;
    if (!c) return;
    const hit = tapIsHit(c);
    const hits = c.hits + (hit ? 1 : 0);
    if (c.round + 1 >= MARE.tension.rounds) {
      setCapture(null);
      if (hits === 0) {
        setNotice("💨 Elle s'est échappée ! La paillette valait le coup pourtant…");
      } else {
        landCatch(c.rarity, hits); // → lastCatch → modal de révélation
        setNotice(null);
      }
      return;
    }
    setCapture(advanceCapture(c, hit));
  };

  const defBonus = cardsDefenseBonus({ collection, cardAssignments: assignments });
  const expBonus = cardsExpeditionExpBonus({ collection, cardAssignments: assignments });

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 px-2 pb-24 pt-3 sm:max-w-lg">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">La Mare</h1>
            <p className="text-[11px] text-cell-teal/60">
              Chaque prise devient une carte d&apos;unité pour ta cellule.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Jetons + fragments */}
        <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.85)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-cell-cyan">🎣 {jetons} jeton{jetons > 1 ? "s" : ""}</span>
            <PixelButton
              className="!min-w-[150px] !px-5 !py-1 text-[10px]"
              disabled={energie < MARE.jetons.cost_energie || jetons >= MARE.jetons.max_stock}
              onClick={() => buyJeton()}
            >
              +1 🎣 · {MARE.jetons.cost_energie} ⚡
            </PixelButton>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-cell-teal/70">
              🧩 {fragments}/{MARE.fragments_per_card} fragments (expéditions)
            </span>
            {fragments >= MARE.fragments_per_card && (
              <PixelButton className="!min-w-[150px] !px-5 !py-1 text-[10px]" onClick={() => fuseFragments()}>
                FUSIONNER 🧩
              </PixelButton>
            )}
          </div>
        </Panel>

        {/* Onglets */}
        <div className="flex gap-2">
          {(["peche", "collection"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md border px-3 py-1.5 text-[11px] uppercase tracking-[0.25em] ${
                tab === t
                  ? "border-cell-cyan bg-membrane text-cell-cyan"
                  : "border-cell-cyan/25 text-cell-teal/60"
              }`}
            >
              {t === "peche" ? "Pêcher" : `Collection ${Object.keys(collection).length}/12`}
            </button>
          ))}
        </div>

        {tab === "peche" ? (
          <>
            {/* Le bassin */}
            <div
              className="relative w-full overflow-hidden rounded-lg border border-cell-cyan/25"
              style={{
                aspectRatio: "1 / 1",
                backgroundImage: "url(/assets/mare/age01_cell_mare_bg_v001.png)",
                backgroundSize: "cover",
                imageRendering: "pixelated",
              }}
            >
              {!capture && (
                <>
                  {sparkles.map((sp) => {
                    const rc = rarityConfig(sp.rarity);
                    return (
                      <button
                        key={sp.key}
                        aria-label={`paillette ${rc.name}`}
                        onClick={() => startCapture(sp)}
                        className="absolute -translate-x-1/2 -translate-y-1/2 animate-pulse"
                        style={{ left: `${sp.x}%`, top: `${sp.y}%`, width: 44, height: 44 }}
                      >
                        <span
                          className="block h-4 w-4 rotate-45 rounded-[3px] mx-auto"
                          style={{ background: rc.color, boxShadow: `0 0 14px 4px ${rc.color}aa` }}
                        />
                      </button>
                    );
                  })}
                  <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-cell-teal/80">
                    {sparkles.length > 0
                      ? "Touche une paillette pour ferrer (1 🎣) — sa couleur = sa rareté"
                      : "Les paillettes arrivent…"}
                  </p>
                </>
              )}

              {capture && (
                <button data-testid="tension-tap" onClick={tapTension} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-abyss/60 px-6">
                  <span className="text-xs uppercase tracking-[0.3em]" style={{ color: rarityConfig(capture.rarity).color }}>
                    {rarityConfig(capture.rarity).name} — prise {capture.round + 1}/{MARE.tension.rounds}
                  </span>
                  {/* Barre de tension (composant isolé : rAF local) */}
                  <TensionBar capture={capture} />
                  <span className="text-[11px] text-cell-cyan">
                    TAPE quand le curseur est dans la zone verte !
                  </span>
                  <span className="text-[11px] text-cell-teal/80">
                    {capture.last === "hit" && "✅ Bien ferré !"}
                    {capture.last === "miss" && "❌ Raté — elle se débat…"}
                    {capture.hits > 0 && ` (${capture.hits} réussite${capture.hits > 1 ? "s" : ""})`}
                  </span>
                </button>
              )}
            </div>
            {notice && (
              <p className="text-center text-[11px] text-cell-magenta">{notice}</p>
            )}
            <p className="text-center text-[10px] leading-relaxed text-cell-teal/50">
              Rareté : {MARE.rarities.map((r) => (
                <span key={r.id} style={{ color: r.color }}>
                  {r.name.toLowerCase()}{" "}
                </span>
              ))}
            </p>
          </>
        ) : (
          <>
            {/* Bonus d'assignation */}
            <p className="text-center text-[11px] text-cell-teal/70">
              Cartes assignées : 🛡️ +{fmtInt(defBonus)} défense · 🧭 +{fmtInt(expBonus)} exploration
              {" "}({assignments.defense.length}/{MARE.assign_slots.defense} · {assignments.expedition.length}/{MARE.assign_slots.expedition})
            </p>

            {/* La collection : les 12 espèces */}
            <div className="grid grid-cols-3 gap-2">
              {MARE.species.map((sp) => {
                const entry = collection[sp.id];
                if (!entry) {
                  return (
                    <div key={sp.id} className="flex flex-col items-center gap-1 opacity-60">
                      <div className="relative h-[128px] w-[96px]">
                        <img src="/assets/ui/age01_cell_ui_card_slot_v001.png" alt="" className="pixelated absolute inset-0 h-full w-full" draggable={false} />
                        <span className="absolute inset-0 flex items-center justify-center text-lg text-cell-teal/50">?</span>
                      </div>
                      <span className="text-center text-[10px] leading-tight text-cell-teal/40">Espèce inconnue</span>
                    </div>
                  );
                }
                const rar = rarityConfig(entry.bestRarity);
                const level = cardLevel(entry.count);
                const next = nextLevelAt(entry.count);
                const inDef = assignments.defense.includes(sp.id);
                const inExp = assignments.expedition.includes(sp.id);
                return (
                  <div key={sp.id} className="flex flex-col items-center gap-1">
                    <CardFrame rarity={rar.id as Rarity}>
                      <img src={cardArt(sp.id)} alt={sp.name} className="pixelated h-full w-full object-contain" draggable={false} />
                    </CardFrame>
                    <span className="text-center text-[10px] leading-tight text-cell-cyan">{sp.name}</span>
                    <span className="text-[9px]" style={{ color: rar.color }}>
                      {rar.name} · Nv {level}
                      {next !== null && <span className="text-cell-teal/50"> ({entry.count}/{next})</span>}
                    </span>
                    <span className="text-[9px] text-cell-teal/60">{ROLE_LABEL[sp.role]}</span>
                    <span className="whitespace-nowrap text-[9px] text-cell-teal/70">
                      🛡{cardPowerDef(sp.id, entry)} · 🧭{cardPowerExp(sp.id, entry)} · ⚔{cardPowerAtk(sp.id, entry)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleCardAssign(sp.id, "defense")}
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          inDef ? "border-cell-lime bg-cell-lime/20 text-cell-lime" : "border-cell-teal/30 text-cell-teal/60"
                        }`}
                        title="Assigner à la défense de la cellule"
                      >
                        🛡️
                      </button>
                      <button
                        onClick={() => toggleCardAssign(sp.id, "expedition")}
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          inExp ? "border-cell-cyan bg-cell-cyan/20 text-cell-cyan" : "border-cell-teal/30 text-cell-teal/60"
                        }`}
                        title="Assigner aux expéditions"
                      >
                        🧭
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
