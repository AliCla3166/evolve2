/* La Mare primordiale (Phase 6) — pêche (paillettes + tension, porté du
   prototype v1) et collection de cartes. Mobile-first, éléments interactifs
   en DOM (tap targets généreux, testables). Tuning : mare_config.json. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { CardFrame, Panel, PixelButton, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
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

/* ---------- Mini-jeu de pêche (refonte 24/07, façon Stardew Valley) ----------
   Une barre "canne" montée par pression maintenue (accélération vers le haut),
   qui retombe seule par gravité dès qu'on relâche. Un poisson se déplace de
   façon erratique (vitesse + fréquence de changement de cap dépendent de sa
   rareté, cf. mare_config.json). Rester chevauché remplit une jauge de succès
   (jauge pleine = ferré, jauge vide = échappé). La qualité du ferrage (ratio
   de temps passé en chevauchement) peut remonter la rareté d'un cran, comme
   l'ancienne mécanique de tension — cf. quality_luck, inchangé. */

interface FishSim {
  barPos: number; // 0..1, centre de la barre du joueur
  barVel: number;
  fishPos: number; // 0..1
  fishTarget: number; // 0..1, cap courant du poisson
  progress: number; // 0..1, jauge de succès
  overlapAccum: number; // secondes passées en chevauchement
  totalAccum: number; // secondes écoulées
  lastT: number; // performance.now() du dernier pas
  holding: boolean;
  done: "caught" | "escaped" | null;
}

/* Helpers impurs (performance.now / Math.random) hors du corps du composant —
   appelés uniquement depuis l'effet du rAF ou les gestionnaires d'événements. */

function barHalfHeight(rarity: number): number {
  const F = MARE.fishing;
  return Math.max(F.bar_height_min, F.bar_height * rarityConfig(rarity).bar_mult) / 2;
}

function initFishSim(rarity: number): FishSim {
  const half = barHalfHeight(rarity);
  return {
    barPos: 0.5,
    barVel: 0,
    fishPos: Math.max(half, Math.min(1 - half, 0.5 + (Math.random() - 0.5) * 0.4)),
    fishTarget: Math.random(),
    progress: MARE.fishing.start_progress,
    overlapAccum: 0,
    totalAccum: 0,
    lastT: performance.now(),
    holding: false,
    done: null,
  };
}

function stepFishSim(sim: FishSim, rarity: number, now: number): FishSim {
  const F = MARE.fishing;
  const rc = rarityConfig(rarity);
  const dt = Math.min(0.05, Math.max(0, (now - sim.lastT) / 1000));
  if (dt <= 0) return sim;

  // Physique de la barre du joueur : monte quand on maintient, gravité sinon.
  const half = barHalfHeight(rarity);
  const accel = (sim.holding ? F.rise_accel : 0) - F.gravity;
  let vel = (sim.barVel + accel * dt) * Math.exp(-F.drag * dt);
  vel = Math.max(-F.max_velocity, Math.min(F.max_velocity, vel));
  let barPos = sim.barPos + vel * dt;
  if (barPos < half) {
    barPos = half;
    vel = 0;
  } else if (barPos > 1 - half) {
    barPos = 1 - half;
    vel = 0;
  }

  // IA du poisson : changement de cap stochastique (processus de Poisson),
  // approche à vitesse plafonnée — crée un mouvement en zigzag plus ou moins
  // erratique selon fish_retarget_hz / fish_speed de la rareté.
  let fishTarget = sim.fishTarget;
  if (Math.random() < 1 - Math.exp(-rc.fish_retarget_hz * dt)) fishTarget = Math.random();
  const maxStep = rc.fish_speed * dt;
  const diff = Math.max(-maxStep, Math.min(maxStep, fishTarget - sim.fishPos));
  const fishPos = Math.max(0, Math.min(1, sim.fishPos + diff));

  // Jauge de succès : monte en chevauchement, descend sinon (plus vite pour les raretés hautes).
  const overlap = Math.abs(fishPos - barPos) <= half;
  const delta = (overlap ? F.fill_rate : -F.drain_rate * rc.drain_mult) * dt;
  const progress = Math.max(0, Math.min(1, sim.progress + delta));

  const totalAccum = sim.totalAccum + dt;
  const overlapAccum = sim.overlapAccum + (overlap ? dt : 0);
  const done: FishSim["done"] = progress >= 1 ? "caught" : progress <= 0 ? "escaped" : null;

  return { barPos, barVel: vel, fishPos, fishTarget, progress, overlapAccum, totalAccum, lastT: now, holding: sim.holding, done };
}

/** Palier de qualité (0..3) à partir du ratio de temps passé en chevauchement —
 *  remplace les "hits/3" de l'ancienne mécanique, même usage en aval (quality_luck). */
function qualityTier(overlapRatio: number): number {
  if (overlapRatio >= 0.85) return 3;
  if (overlapRatio >= 0.65) return 2;
  if (overlapRatio >= 0.45) return 1;
  return 0;
}

/** Composant isolé : son rAF ne re-rend que lui-même (60 fps), jamais le
 *  panneau entier — important pour la batterie mobile. Il occupe TOUT le
 *  bassin (`absolute inset-0`) et c'est cette surface entière qui sert de
 *  zone de maintien : inutile de viser les barres au pixel près, un appui
 *  n'importe où dans le bassin fait monter la canne. L'appui est capturé au
 *  pointeur pour ne jamais être perdu même si le doigt glisse. */
function FishingBar({
  rarity,
  onDone,
}: {
  rarity: number;
  onDone: (result: "caught" | "escaped", quality: number) => void;
}) {
  const [sim, setSim] = useState<FishSim>(() => initFishSim(rarity));
  const simRef = useRef(sim);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (doneRef.current) return;
      const next = stepFishSim(simRef.current, rarity, performance.now());
      simRef.current = next;
      setSim(next);
      if (next.done && !doneRef.current) {
        doneRef.current = true;
        const ratio = next.totalAccum > 0 ? next.overlapAccum / next.totalAccum : 0;
        onDoneRef.current(next.done, qualityTier(ratio));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // rarity ne change jamais en cours de prise (composant remonté à chaque tentative) ;
    // onDone est lu via onDoneRef (toujours à jour, cf. effet ci-dessus).
  }, [rarity]);

  const setHolding = (holding: boolean) => {
    simRef.current = { ...simRef.current, holding };
  };

  const rc = rarityConfig(rarity);
  const half = barHalfHeight(rarity);

  return (
    <div
      data-testid="fish-hold-area"
      className="absolute inset-0 flex touch-none cursor-pointer select-none flex-col items-center justify-center gap-3 bg-abyss/70 px-6"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setHolding(true);
      }}
      onPointerUp={() => setHolding(false)}
      onPointerCancel={() => setHolding(false)}
      onLostPointerCapture={() => setHolding(false)}
    >
      <span className="text-xs uppercase tracking-[0.3em]" style={{ color: rc.color }}>
        {rc.name}
      </span>

      <div className="flex items-center justify-center gap-4">
      {/* Piste principale : poisson + barre du joueur */}
      <div
        data-testid="fish-track"
        className="relative h-[240px] w-[68px] overflow-hidden rounded-full border border-cell-cyan/50 bg-abyss/90"
      >
        <span
          data-testid="fish-player-bar"
          className="absolute inset-x-0 rounded-full"
          style={{
            bottom: `${(sim.barPos - half) * 100}%`,
            height: `${half * 2 * 100}%`,
            background: `${rc.color}33`,
            boxShadow: `inset 0 0 0 2px ${rc.color}`,
          }}
        />
        <span
          data-testid="fish-marker"
          className="absolute inset-x-0 flex justify-center text-base leading-none"
          style={{ bottom: `calc(${sim.fishPos * 100}% - 9px)` }}
        >
          🐟
        </span>
      </div>

      {/* Jauge de succès */}
      <div
        data-testid="fish-progress-track"
        className="relative h-[240px] w-[14px] overflow-hidden rounded-full border border-cell-teal/40 bg-abyss/90"
      >
        <span
          data-testid="fish-progress"
          className="absolute inset-x-0 bottom-0 rounded-full"
          style={{
            height: `${sim.progress * 100}%`,
            background: sim.progress > 0.66 ? "#a6ff3d" : sim.progress > 0.33 ? "#ffcf5c" : "#ff5c5c",
          }}
        />
      </div>
      </div>

      <span className="max-w-[240px] text-center text-[11px] text-cell-cyan">
        MAINTIENS n&apos;importe où dans le bassin pour faire monter la canne, relâche pour
        la laisser retomber — garde-la sur le poisson !
      </span>
    </div>
  );
}

export function MarePanel({ onClose }: { onClose: () => void }) {
  const jetons = useGame((s) => s.jetons);
  const fragments = useGame((s) => s.fragments);
  const energie = useGame((s) => s.resources.energie);
  const collection = useGame((s) => s.collection);
  const assignments = useGame((s) => s.cardAssignments);
  // Le plafond "défense" alimente la réserve plaçable du Bastion-Défense jouable —
  // dynamique et achetable en Boutique, cf. bastion.reserveCap (store.toggleCardAssign).
  const defenseCap = useGame((s) => s.bastion.reserveCap);
  const buyJeton = useGame((s) => s.buyJeton);
  const spendJeton = useGame((s) => s.spendJeton);
  const landCatch = useGame((s) => s.landCatch);
  const fuseFragments = useGame((s) => s.fuseFragments);
  const toggleCardAssign = useGame((s) => s.toggleCardAssign);

  const [tab, setTab] = useState<"peche" | "collection">("peche");
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  /** Rareté de la prise en cours (null = pas de mini-jeu actif). */
  const [captureRarity, setCaptureRarity] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextKey = useRef(1);
  const captureRef = useRef<number | null>(null);
  useEffect(() => {
    captureRef.current = captureRarity;
  }, [captureRarity]);

  // Spawn/expiration des paillettes (3 max, durée de vie ~6 s).
  useEffect(() => {
    if (tab !== "peche") return;
    const id = setInterval(() => {
      setSparkles((prev) => {
        const now = performance.now();
        let next = prev.filter((s) => now - s.bornAt < 6000);
        if (next.length < 3 && captureRef.current === null) {
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
    if (captureRarity !== null) return;
    if (!spendJeton()) {
      setNotice(`Il te faut un jeton — achète-en un (${MARE.jetons.cost_energie} ⚡).`);
      return;
    }
    setNotice(null);
    setSparkles([]);
    setCaptureRarity(sp.rarity);
  };

  const handleFishDone = (result: "caught" | "escaped", quality: number) => {
    const rarity = captureRef.current;
    setCaptureRarity(null);
    if (rarity === null) return;
    if (result === "escaped") {
      setNotice("💨 Elle s'est échappée ! La paillette valait le coup pourtant…");
    } else {
      landCatch(rarity, quality); // → lastCatch → modal de révélation
      setNotice(null);
    }
  };

  const defBonus = cardsDefenseBonus({ collection, cardAssignments: assignments });
  const expBonus = cardsExpeditionExpBonus({ collection, cardAssignments: assignments });

  // Pendant le mini-jeu : le panneau passe au-dessus de la barre de navigation
  // (z-40) et tout ce qui n'est pas le bassin devient inerte — un appui égaré
  // ne peut plus changer d'onglet, acheter un jeton ou fermer La Mare.
  const capturing = captureRarity !== null;
  const inertWhileFishing = capturing ? "pointer-events-none opacity-40" : "";

  return (
    <div
      className={`fixed inset-0 overflow-y-auto overscroll-contain bg-abyss/95 backdrop-blur-sm ${
        capturing ? "z-50" : "z-30"
      }`}
    >
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-lg">
        {/* En-tête */}
        <div className={`flex items-center gap-3 ${inertWhileFishing}`}>
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
        <Panel variant="tooltip" className={`px-3 py-2 ${inertWhileFishing}`} style={{ background: "rgba(5, 11, 20, 0.85)" }}>
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
        <div className={`flex gap-2 ${inertWhileFishing}`}>
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
              {t === "peche" ? "Pêcher" : `Collection ${Object.keys(collection).length}/${MARE.species.length}`}
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
              {captureRarity === null && (
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

              {/* Mini-jeu isolé : rAF local, ne re-rend jamais le panneau entier.
                  Il couvre tout le bassin → toute la surface est zone de maintien. */}
              {captureRarity !== null && <FishingBar rarity={captureRarity} onDone={handleFishDone} />}
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
              {" "}({assignments.defense.length}/{defenseCap} · {assignments.expedition.length}/{MARE.assign_slots.expedition})
            </p>
            <p className="text-center text-[10px] text-cell-teal/50">
              🛡️ Défense : bonus passif de la cellule ET réserve plaçable du Bastion-Défense jouable
              (plafond achetable dans sa Boutique).
            </p>

            {/* La collection : toutes les espèces de MARE.species (62 au 24/07) */}
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
                      <img
                        src={cardArt(sp.id)}
                        alt={sp.name}
                        className="pixelated h-full w-full object-contain"
                        draggable={false}
                        onError={(e) => {
                          // Portrait pas encore généré (nouvelle espèce en attente de PixelLab) — repli neutre.
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = "/assets/ui/age01_cell_ui_card_slot_v001.png";
                        }}
                      />
                    </CardFrame>
                    {/* Lisibilite de la grille (piste 7) + cibles tactiles (piste 10) :
                        le nom passe a 11 px, les PV rejoignent la ligne de stats — on tombe
                        de 5 lignes de texte tassees a 4 — et les deux boutons d'assignation
                        passent de ~22 px a 44 px de haut sur toute la largeur de la carte. */}
                    <span className="text-center text-[11px] font-bold leading-tight text-cell-cyan">{sp.name}</span>
                    <span className="text-center text-[9px] leading-tight" style={{ color: rar.color }}>
                      {rar.name} · Nv {level}
                      {next !== null && <span className="text-cell-teal/50"> ({entry.count}/{next})</span>}
                    </span>
                    <span className="text-[9px] text-cell-teal/60">{ROLE_LABEL[sp.role]}</span>
                    <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-[10px] leading-tight">
                      <span className="text-cell-magenta/80">❤{cardHp(sp.id, entry)}</span>
                      <span className="text-cell-teal/70">🛡{cardPowerDef(sp.id, entry)}</span>
                      <span className="text-cell-teal/70">🧭{cardPowerExp(sp.id, entry)}</span>
                      <span className="text-cell-teal/70">⚔{cardPowerAtk(sp.id, entry)}</span>
                    </div>
                    <div className="mt-0.5 flex w-full gap-1">
                      <button
                        onClick={() => toggleCardAssign(sp.id, "defense")}
                        className={`tap-h flex-1 rounded border text-[15px] ${
                          inDef ? "border-cell-lime bg-cell-lime/20 text-cell-lime" : "border-cell-teal/30 text-cell-teal/60"
                        }`}
                        title="Assigner à la défense de la cellule"
                        aria-pressed={inDef}
                        aria-label={`Assigner ${sp.name} à la défense de la cellule`}
                      >
                        🛡️
                      </button>
                      <button
                        onClick={() => toggleCardAssign(sp.id, "expedition")}
                        className={`tap-h flex-1 rounded border text-[15px] ${
                          inExp ? "border-cell-cyan bg-cell-cyan/20 text-cell-cyan" : "border-cell-teal/30 text-cell-teal/60"
                        }`}
                        title="Assigner aux expéditions"
                        aria-pressed={inExp}
                        aria-label={`Assigner ${sp.name} aux expéditions`}
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
