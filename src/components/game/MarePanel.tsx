/* La Mare primordiale (Phase 6) — pêche (paillettes + tension, porté du
   prototype v1) et collection de cartes. Mobile-first, éléments interactifs
   en DOM (tap targets généreux, testables). Tuning : mare_config.json. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { CardFrame, Panel, PixelButton, type Rarity } from "@/components/ui/Pixel";
import { CardDetailSheet, type CardViewData } from "@/components/game/CardDetailSheet";
import {
  cardArt,
  cardLevel,
  cardsDefenseBonus,
  cardsExpeditionExpBonus,
  catchesToPlayable,
  creatureRecolteBonus,
  bestEditionIndex,
  editionConfig,
  editionCounts,
  editionEffect,
  isCardPlayable,
  isFreeSlotCard,
  jetonMax,
  MARE,
  nextLevelAt,
  rarityConfig,
  slotsUsed,
  type SpeciesConfig,
} from "@/lib/game/cards";
import { effectiveReserveCap } from "@/lib/game/bastion/config";
import {
  buildingOfPostedSpecies,
  posteResource,
  workLevelOf,
  workerBonus,
} from "@/lib/game/economy";
import { fmtInt } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import { crewedSpecies, foyerDef, foyerOfCrewSpecies } from "@/lib/game/territoire";
import type { CardEntry } from "@/lib/game/types";

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

/** Tout le calcul dérivé d'une carte de la collection — un seul calcul, utilisé
 *  à la fois par la grille (piste Phase 1 n°8 : elle ne garde plus que ce qui
 *  pèse sur la décision immédiate) et par la fiche détail qu'un tap ouvre
 *  (CardDetailSheet.tsx, qui porte le reste : rôle, édition, 4 stats, postes). */
function computeCardView(
  sp: SpeciesConfig,
  entry: CardEntry,
  ctx: {
    assignments: ReturnType<typeof useGame.getState>["cardAssignments"];
    territoire: ReturnType<typeof useGame.getState>["territoire"];
    postes: ReturnType<typeof useGame.getState>["postes"];
    fauneLevel: ReturnType<typeof useGame.getState>["fauneLevel"];
    collection: ReturnType<typeof useGame.getState>["collection"];
  },
): CardViewData {
  const posteA = foyerOfCrewSpecies(ctx.territoire, sp.id);
  const posteB = buildingOfPostedSpecies({ postes: ctx.postes }, sp.id);
  const edIdx = bestEditionIndex(entry);
  const edCounts = editionCounts(entry);
  const edTitle = MARE.editions
    .map((e, i) => (edCounts[i] > 0 ? `${e.name} × ${edCounts[i]}` : null))
    .filter(Boolean)
    .join(" · ");

  return {
    rar: rarityConfig(entry.bestRarity),
    level: cardLevel(entry.count),
    next: nextLevelAt(entry.count),
    inDef: ctx.assignments.defense.includes(sp.id),
    inExp: ctx.assignments.expedition.includes(sp.id),
    playable: isCardPlayable(entry),
    missing: catchesToPlayable(entry),
    edIdx,
    edTitle,
    freeSlot: isFreeSlotCard(entry),
    posteA,
    posteALabel: posteA ? (foyerDef(posteA)?.name ?? posteA) : null,
    posteARecoltePct: posteA ? Math.round(creatureRecolteBonus(sp.id, entry) * 100) : null,
    posteB,
    posteBLevel: posteB ? workLevelOf({ fauneLevel: ctx.fauneLevel }, sp.id) : null,
    posteBPct: posteB
      ? Math.round(
          workerBonus({ collection: ctx.collection, fauneLevel: ctx.fauneLevel }, sp.id, posteResource(posteB)) *
            100,
        )
      : null,
  };
}

export function MarePanel({ onClose }: { onClose: () => void }) {
  const jetons = useGame((s) => s.jetons);
  const fragments = useGame((s) => s.fragments);
  const energie = useGame((s) => s.resources.energie);
  const collection = useGame((s) => s.collection);
  const assignments = useGame((s) => s.cardAssignments);
  const territoire = useGame((s) => s.territoire);
  // Les postes de travail des organes (26/07). `fauneLevel` accompagne `postes` parce
  // que l'apport d'une ouvrière dépend de son ancienneté ; `fauneXp`, lui, reste dehors
  // — il bouge à chaque tick et re-rendrait cette grille de 62 cartes chaque seconde.
  const postes = useGame((s) => s.postes);
  const fauneLevel = useGame((s) => s.fauneLevel);
  // Le plafond "défense" alimente la réserve plaçable du Bastion-Défense jouable —
  // dynamique : acheté en Boutique + relevé par le vestige "Carcasse-atelier" de
  // La Dérive (cf. effectiveReserveCap, la même source que store.toggleCardAssign).
  const defenseCap = useGame(effectiveReserveCap);
  const jetonCap = useGame(jetonMax);
  const buyJeton = useGame((s) => s.buyJeton);
  const spendJeton = useGame((s) => s.spendJeton);
  const landCatch = useGame((s) => s.landCatch);
  const fuseFragments = useGame((s) => s.fuseFragments);
  const toggleCardAssign = useGame((s) => s.toggleCardAssign);

  const [tab, setTab] = useState<"peche" | "collection">("peche");
  /** Espèce dont la fiche détail est ouverte (piste Phase 1 n°8). */
  const [detailId, setDetailId] = useState<string | null>(null);
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
  // Le troisième poste possible d'une carte : la RÉCOLTE, sur un gisement de La
  // Dérive. Il ne s'attribue pas d'ici (c'est le lieu qui porte son équipage, on
  // poste depuis la fiche du gisement) — La Mare se contente de le montrer, pour
  // qu'on sache toujours où travaille une créature absente de la défense.
  const postees = crewedSpecies(territoire);
  // Le quatrième : un POSTE dans un organe de la base. Même principe — le lieu porte
  // ses ouvrières, on les affecte depuis la fiche de l'organe, La Mare ne fait que dire
  // où elles sont. Quatre emplois possibles, un seul à la fois par créature.
  const employees = Object.values(postes).reduce((n, crew) => n + (crew?.length ?? 0), 0);

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
            <h1 className="font-pixel text-base uppercase tracking-[0.3em] text-cell-cyan">La Mare</h1>
            <p className="text-[11px] text-cell-dim">
              Chaque prise devient une carte d&apos;unité pour ta cellule.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-dim hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Jetons + fragments */}
        <Panel variant="tooltip" className={`px-3 py-2 ${inertWhileFishing}`} style={{ background: "rgba(5, 11, 20, 0.85)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-cell-cyan">
              🎣 {jetons}/{jetonCap} jeton{jetons > 1 ? "s" : ""}
            </span>
            <PixelButton
              className="!min-w-[150px] !px-5 !py-1 text-[10px]"
              disabled={energie < MARE.jetons.cost_energie || jetons >= jetonCap}
              onClick={() => buyJeton()}
            >
              +1 🎣 · {MARE.jetons.cost_energie} ⚡
            </PixelButton>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-cell-dim">
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
                  : "border-cell-cyan/25 text-cell-dim"
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
            <p className="text-center text-[10px] leading-relaxed text-cell-faint">
              Rareté : {MARE.rarities.map((r) => (
                <span key={r.id} style={{ color: r.color }}>
                  {r.name.toLowerCase()}{" "}
                </span>
              ))}
            </p>
            {/* Le second axe, annoncé à l'endroit où l'on pêche : la rareté dit QUELLE
                bête sort de l'eau, l'édition dans quel état la carte tombe. Les effets
                sont composés depuis les nombres du JSON (editionEffect) — aucun libellé
                ne peut donc promettre autre chose que ce que le moteur applique. */}
            <p className="text-center text-[10px] leading-relaxed text-cell-faint">
              Édition : {MARE.editions.slice(1).map((e, i) => (
                <span key={e.id} style={{ color: e.color }}>
                  {e.name.toLowerCase()} ({editionEffect(i + 1)}){" "}
                </span>
              ))}
            </p>
          </>
        ) : (
          <>
            {/* Bonus d'assignation */}
            <p className="text-center text-[11px] text-cell-dim">
              Cartes assignées : 🛡️ +{fmtInt(defBonus)} défense · 🧭 +{fmtInt(expBonus)} exploration
              {/* On affiche les PLACES occupées, pas le nombre de cartes : une négative
                  n'en occupe aucune, donc « 6/6 » avec sept cartes posées est le compte
                  juste, et c'est exactement celui que le store applique (cards.slotsUsed). */}
              {" "}({slotsUsed(assignments.defense, collection)}/{defenseCap} · {slotsUsed(assignments.expedition, collection)}/{MARE.assign_slots.expedition})
            </p>
            <p className="text-center text-[10px] text-cell-faint">
              🛡️ Défense : bonus passif de la cellule ET réserve plaçable du Bastion-Défense jouable
              (plafond achetable dans sa Boutique).
            </p>
            <p className="text-center text-[10px] text-cell-faint">
              🔒 Une prise donne la carte, pas le droit de la jouer : il faut une 2ᵉ prise de la
              même espèce pour l&apos;assigner ou la mettre au travail.
            </p>
            {/* Les {" "} ne sont pas décoratifs : le compilateur de cette version mange
                l'espace écrit entre un pluriel ternaire et le texte qui le suit quand
                celui-ci passe à la ligne — on lisait « 9 créaturesau travail ». Vérifié
                dans le chunk compilé, pas deviné. Ne pas les retirer en reformatant. */}
            <p className="text-center text-[10px] text-cell-faint">
              ⛏️ Récolte : {postees.size} créature{postees.size > 1 ? "s" : ""}{" "}
              au travail sur les gisements de La Dérive. Une créature ne tient qu&apos;UN poste — on
              la poste depuis la fiche du gisement, sur la carte.
            </p>
            <p className="text-center text-[10px] text-cell-faint">
              ⚙️ Postes : {employees} créature{employees > 1 ? "s" : ""}{" "}
              au travail dans les organes de la base — chacune fait monter le rendement du sien et
              gagne un niveau de travail sans plafond. On la poste depuis la fiche de l&apos;organe.
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
                        <span className="absolute inset-0 flex items-center justify-center text-lg text-cell-faint">?</span>
                      </div>
                      <span className="text-center text-[10px] leading-tight text-cell-faint">Espèce inconnue</span>
                    </div>
                  );
                }
                // Tout le calcul dérivé (rareté, édition, postes, verrou) vit
                // dans computeCardView, partagé avec la fiche détail — voir la
                // note au-dessus de MarePanel.
                const view = computeCardView(sp, entry, {
                  assignments,
                  territoire,
                  postes,
                  fauneLevel,
                  collection,
                });
                const ed = editionConfig(view.edIdx);
                return (
                  <div key={sp.id} className="flex flex-col items-center gap-1">
                    {/* Refonte lisibilité 31/07 (piste Phase 1 n°8) : la grille ne
                        garde que ce qu'il faut voir tout de suite — portrait, nom,
                        rareté/niveau, verrou ou boutons d'assignation. Rôle, édition
                        en détail, 4 stats de combat et poste(s) éventuels vivent
                        désormais dans la fiche détail (tap sur le portrait/le nom). */}
                    <button
                      onClick={() => setDetailId(sp.id)}
                      className="flex flex-col items-center gap-1"
                      aria-label={`Détail de ${sp.name}`}
                    >
                      <div
                        style={
                          view.edIdx > 0
                            ? { filter: `drop-shadow(0 0 8px ${ed.color})` }
                            : undefined
                        }
                      >
                        <CardFrame rarity={view.rar.id as Rarity}>
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
                      </div>
                      <span className="text-center text-[11px] font-bold leading-tight text-cell-cyan">{sp.name}</span>
                      <span className="text-center text-[9px] leading-tight" style={{ color: view.rar.color }}>
                        {view.rar.name} · Nv {view.level}
                      </span>
                    </button>
                    {!view.playable ? (
                      <div
                        className="tap-h mt-0.5 flex w-full items-center justify-center rounded border border-cell-teal/20 text-[10px] text-cell-faint"
                        title="Une prise donne la carte, pas le droit de la jouer : il en faut une deuxième."
                      >
                        🔒 encore {view.missing} prise{view.missing > 1 ? "s" : ""}
                      </div>
                    ) : (
                    <div className="mt-0.5 flex w-full gap-1">
                      <button
                        onClick={() => toggleCardAssign(sp.id, "defense")}
                        className={`tap-h flex-1 rounded border text-[15px] ${
                          view.inDef ? "border-cell-lime bg-cell-lime/20 text-cell-lime" : "border-cell-teal/30 text-cell-dim"
                        }`}
                        title="Assigner à la défense de la cellule"
                        aria-pressed={view.inDef}
                        aria-label={`Assigner ${sp.name} à la défense de la cellule`}
                      >
                        🛡️
                      </button>
                      <button
                        onClick={() => toggleCardAssign(sp.id, "expedition")}
                        className={`tap-h flex-1 rounded border text-[15px] ${
                          view.inExp ? "border-cell-cyan bg-cell-cyan/20 text-cell-cyan" : "border-cell-teal/30 text-cell-dim"
                        }`}
                        title="Assigner aux expéditions"
                        aria-pressed={view.inExp}
                        aria-label={`Assigner ${sp.name} aux expéditions`}
                      >
                        🧭
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {detailId && collection[detailId] && (
        <CardDetailSheet
          sp={MARE.species.find((s) => s.id === detailId)!}
          entry={collection[detailId]}
          view={computeCardView(MARE.species.find((s) => s.id === detailId)!, collection[detailId], {
            assignments,
            territoire,
            postes,
            fauneLevel,
            collection,
          })}
          onClose={() => setDetailId(null)}
          onToggleAssign={toggleCardAssign}
        />
      )}
    </div>
  );
}
