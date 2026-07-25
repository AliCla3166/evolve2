/* Révélation de carte (Phase 6, refondue par la piste 7 du diagnostic UX).
 *
 * Avant : une seule animation de 0,45 s pour six raretés, deux motifs de
 * vibration pour six niveaux — la prise s'affichait, elle ne se DÉSIRAIT pas.
 *
 * Maintenant, une mise en scène GRADUÉE, entièrement pilotée par le bloc
 * `reveal` de mare_config.json :
 *   1. l'écran s'assombrit et un halo monte par paliers de couleur, un palier
 *      par cran de rareté, pendant une durée qui va de 0,3 s (commune) à 1,8 s
 *      (mythique) — la commune, qui fait 46 % des tirages, reste donc aussi
 *      rapide qu'avant : une mise en scène qu'on subit à chaque tirage devient
 *      un péage, pas un plaisir ;
 *   2. le halo peut monter AU-DESSUS du résultat réel, s'y maintenir, puis
 *      retomber (teasing de quasi-réussite — le ressort le plus efficace du
 *      genre, et sans danger ici : aucune monnaie réelle en jeu) ;
 *   3. l'apparition secoue l'écran et projette une gerbe d'étincelles à partir
 *      de la rareté 3, avec un motif de vibration propre à chaque rareté.
 *
 * Le sommet du halo (`teaseTo`) est tiré par le PRNG seedé du moteur au moment
 * de la prise, pas ici : la mise en scène fait partie du résultat et se rejoue
 * à l'identique. Ce composant ne fait que la dérouler.
 *
 * Deux garde-fous d'ergonomie : un tap passe la mise en scène (on ne bloque
 * jamais un joueur pressé), et `prefers-reduced-motion` affiche la carte
 * immédiatement, sans secousse ni gerbe. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CardFrame, PixelButton, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
  cardPowerAtk,
  cardPowerDef,
  cardPowerExp,
  MARE,
  rarityConfig,
  revealConfig,
  speciesConfig,
} from "@/lib/game/cards";
import { useOverlay } from "@/lib/overlay";
import { useGame } from "@/lib/game/store";
import type { LastCatch } from "@/lib/game/types";
import { vibrate } from "@/lib/prefs";
import { playCue, revealCue } from "@/lib/audio";

/** Étapes de la mise en scène. `hold`/`fall` n'existent qu'en cas de teasing. */
type Phase = "charge" | "hold" | "fall" | "done";

interface Stage {
  phase: Phase;
  /** Rareté dont le halo porte actuellement la couleur. */
  halo: number;
}

interface Spark {
  dx: number;
  dy: number;
  size: number;
  delay: number;
  life: number;
}

/** Gerbe déterministe : mêmes étincelles pour une même prise (donc rejouable,
 *  et vérifiable par le harnais Playwright). mulberry32, comme le moteur. */
function makeSparks(speciesId: string, rarity: number, count: number): Spark[] {
  let seed = 0x9e3779b9;
  for (const ch of speciesId) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  seed = (seed + Math.imul(rarity + 1, 0x85ebca6b)) >>> 0;
  const next = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Spark[] = [];
  for (let i = 0; i < count; i++) {
    // Angle réparti régulièrement puis bruité : une gerbe, pas un feu d'artifice
    // aléatoire qui laisserait des trous visibles.
    const angle = ((i + next() * 0.85) / count) * Math.PI * 2;
    const dist = 90 + next() * 150;
    out.push({
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 3 + Math.round(next() * 4),
      delay: Math.round(next() * 120),
      life: 620 + Math.round(next() * 320),
    });
  }
  return out;
}

export function CardReveal() {
  const lastCatch = useGame((s) => s.lastCatch);
  const collection = useGame((s) => s.collection);
  const clearLastCatch = useGame((s) => s.clearLastCatch);

  useOverlay(lastCatch !== null, clearLastCatch);

  /* L'avancement est mémorisé AVEC la prise qui l'a produit (comparaison de
     référence) : à l'arrivée d'une nouvelle prise, l'étape initiale se déduit
     du rendu au lieu d'être posée par un setState synchrone dans l'effet, qui
     provoquerait un rendu en cascade (react-hooks/set-state-in-effect). */
  const [prog, setProg] = useState<{ src: LastCatch; stage: Stage } | null>(null);
  const [reduced, setReduced] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* « Réduire les animations » est un réglage système d'accessibilité : on le lit
     dans un effet (jamais pendant le rendu — pas de matchMedia côté serveur). */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const rarity = lastCatch?.rarity ?? 0;
  const peak = Math.max(rarity, lastCatch?.teaseTo ?? rarity);
  const teased = peak > rarity;
  // Étape courante : celle en mémoire si elle concerne bien CETTE prise, sinon
  // le début de la mise en scène (ou directement la carte, animations réduites).
  const stage: Stage =
    prog && prog.src === lastCatch
      ? prog.stage
      : reduced
        ? { phase: "done", halo: rarity }
        : { phase: "charge", halo: 0 };

  /* Déroulé : toute la chronologie est planifiée d'un coup à l'arrivée de la
     prise, et purgée au démontage ou au changement de prise. */
  useEffect(() => {
    const clear = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    clear();
    if (!lastCatch) return;

    const finalCfg = revealConfig(rarity);
    // Animations réduites : l'étape initiale est déjà « done » (cf. `stage`),
    // il ne reste que le retour haptique à jouer.
    if (reduced) {
      vibrate(finalCfg.vibrate);
      playCue(revealCue(rarity));
      return clear;
    }

    const go = (stage: Stage) => setProg({ src: lastCatch, stage });
    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms));
    };
    const reveal = () => {
      go({ phase: "done", halo: rarity });
      vibrate(finalCfg.vibrate);
      // Trois variantes de révélation selon la rareté (piste 8) : la commune
      // s'efface, la mythique fleurit. La table de correspondance est en JSON.
      playCue(revealCue(rarity));
    };

    // La charge est calibrée sur le SOMMET du halo : un teasing vers légendaire
    // prend le temps d'un légendaire, sinon la tension ne serait pas crédible.
    const total = revealConfig(peak).charge_ms;
    const step = total / (peak + 1);
    /* Un tic sonore par palier, transposé d'une tierce mineure à chaque cran
       (cf. `transpose_semitones` dans audio_config.json) : la montée du halo
       s'ENTEND, ce qui est précisément ce qui rend l'attente désirable. */
    playCue("reveal_charge", 0);
    for (let i = 1; i <= peak; i++)
      at(step * i, () => {
        go({ phase: "charge", halo: i });
        playCue("reveal_charge", i);
      });

    if (!teased) {
      at(total, reveal);
      return clear;
    }
    const t = MARE.reveal.tease;
    at(total, () => {
      go({ phase: "hold", halo: peak });
      vibrate(t.vibrate);
      // Accord suspendu, jamais résolu : c'est ce qui fait la quasi-réussite.
      playCue("reveal_tease");
    });
    at(total + t.hold_ms, () => go({ phase: "fall", halo: rarity }));
    at(total + t.hold_ms + t.fallback_ms, reveal);
    return clear;
  }, [lastCatch, reduced, rarity, peak, teased]);

  const sparks = useMemo(
    () =>
      lastCatch
        ? makeSparks(lastCatch.speciesId, lastCatch.rarity, revealConfig(lastCatch.rarity).sparks)
        : [],
    [lastCatch],
  );

  if (!lastCatch) return null;
  const sp = speciesConfig(lastCatch.speciesId);
  const rar = rarityConfig(rarity);
  const entry = collection[lastCatch.speciesId];
  if (!sp || !entry) return null;

  const done = stage.phase === "done";
  const haloRar = rarityConfig(stage.halo);
  const finalCfg = revealConfig(rarity);
  // Le voile s'épaissit à mesure que le halo monte : le monde s'efface, il ne
  // reste que la carte qui arrive. Il ne redescend jamais sous l'opacité de
  // l'ancienne modale (0,75) — la première capture d'écran montrait le HUD et
  // la scène encore parfaitement lisibles derrière, ce qui tuait la tension.
  const veil = done ? 0.9 : Math.min(0.94, 0.78 + 0.032 * stage.halo);
  /** Les libellés se lisent par-dessus la scène et le halo : ombre portée partout. */
  const legible: CSSProperties = {
    textShadow: "0 0 14px rgba(2, 6, 12, 0.95), 0 2px 5px rgba(2, 6, 12, 0.9)",
  };

  /** Passer la mise en scène — un joueur pressé ne doit jamais être retenu. */
  const skip = () => {
    if (done) return;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    setProg({ src: lastCatch, stage: { phase: "done", halo: rarity } });
    vibrate(finalCfg.vibrate);
    playCue(revealCue(rarity));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ backgroundColor: `rgba(2, 6, 12, ${veil})`, transition: "background-color 240ms linear" }}
      onClick={skip}
    >
      {/* Halo de charge. Il DISPARAÎT à la révélation : un halo flou derrière la
          fiche lavait le nom, la rareté et la ligne de stats (constaté à la
          relecture des captures). La carte porte déjà sa propre lueur. */}
      {!done && (
        <div
          aria-hidden
          className="reveal-halo pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={
            {
              width: 170 + stage.halo * 22,
              height: 170 + stage.halo * 22,
              opacity: 0.36 + 0.06 * stage.halo,
              "--halo": haloRar.color,
              // La retombée du teasing doit se VOIR : elle prend le temps réglé
              // dans la config, là où une montée de palier est franche.
              transitionDuration: stage.phase === "fall" ? `${MARE.reveal.tease.fallback_ms}ms` : "240ms",
            } as CSSProperties
          }
        />
      )}

      {done ? (
        <div
          className={finalCfg.shake > 0 && !reduced ? "reveal-shake" : undefined}
          style={{ "--shake": finalCfg.shake } as CSSProperties}
        >
          <div className="animate-card-reveal relative flex flex-col items-center gap-3 text-center" style={legible}>
            {/* Gerbe d'étincelles : purement décorative, jamais cliquable. */}
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
              {sparks.map((s, i) => (
                <span
                  key={i}
                  className="reveal-spark absolute block rounded-full"
                  style={
                    {
                      width: s.size,
                      height: s.size,
                      marginLeft: -s.size / 2,
                      marginTop: -s.size / 2,
                      background: rar.color,
                      boxShadow: `0 0 8px ${rar.color}`,
                      "--dx": `${s.dx}px`,
                      "--dy": `${s.dy}px`,
                      "--spark-ms": `${s.life}ms`,
                      "--spark-delay": `${s.delay}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>

            <span className="text-xs uppercase tracking-[0.4em] text-cell-teal/80">
              {lastCatch.source === "fragments" ? "Fragments fusionnés !" : "Une prise !"}
            </span>

            <div style={{ filter: `drop-shadow(0 0 24px ${rar.color}88)` }}>
              <CardFrame rarity={rar.id as Rarity} scale={1.6}>
                <img
                  src={cardArt(lastCatch.speciesId)}
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

            <div className="space-y-0.5">
              <div className="text-sm tracking-wide text-cell-cyan">{sp.name}</div>
              <div className="text-xs" style={{ color: rar.color }}>
                {rar.name} · Nv {lastCatch.level}
              </div>
              <div className="text-[10px] text-cell-teal/70">
                ❤{cardHp(sp.id, entry)} PV · 🛡{cardPowerDef(sp.id, entry)} · 🧭{cardPowerExp(sp.id, entry)} · ⚔{cardPowerAtk(sp.id, entry)}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {lastCatch.isNew && (
                  <span className="rounded-full border border-cell-lime px-2 py-0.5 text-[10px] text-cell-lime">
                    ✨ NOUVELLE ESPÈCE
                  </span>
                )}
                {lastCatch.leveledUp && (
                  <span className="rounded-full border border-cell-cyan px-2 py-0.5 text-[10px] text-cell-cyan">
                    ▲ NIVEAU {lastCatch.level}
                  </span>
                )}
                {lastCatch.newBestRarity && (
                  <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: rar.color, color: rar.color }}>
                    ★ RARETÉ AMÉLIORÉE
                  </span>
                )}
              </div>
            </div>

            <PixelButton className="text-[11px]" onClick={() => clearLastCatch()}>
              GARDER
            </PixelButton>
            <p className="max-w-[240px] text-[10px] leading-relaxed text-cell-teal/60">
              Assigne tes cartes en défense ou en expédition depuis la Collection.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="relative flex flex-col items-center gap-5 text-center"
          // Le halo est lumineux et flou : sans ombre portée, les libellés
          // posés dessus deviennent illisibles dès la rareté 3.
          style={legible}
          data-reveal-phase={stage.phase}
          data-reveal-halo={stage.halo}
        >
          <span className="text-xs uppercase tracking-[0.4em] text-cell-teal/80">
            {lastCatch.source === "fragments" ? "Fusion…" : "Ça remonte…"}
          </span>

          {/* Jauge de raretés : rend LISIBLE la montée du halo, et donc la
              retombée du teasing — sans elle, le joueur ne saurait pas qu'il
              vient de frôler mieux. */}
          <div className="flex items-center gap-2">
            {MARE.rarities.map((r, i) => (
              <span
                key={r.id}
                aria-hidden
                className="block rounded-full transition-all duration-200"
                style={{
                  width: i <= stage.halo ? 12 : 7,
                  height: i <= stage.halo ? 12 : 7,
                  background: i <= stage.halo ? r.color : "rgba(109, 246, 255, 0.18)",
                  boxShadow: i <= stage.halo ? `0 0 10px ${r.color}` : "none",
                }}
              />
            ))}
          </div>

          <span
            className="text-sm tracking-[0.2em] transition-colors duration-200"
            style={{ color: haloRar.color }}
          >
            {haloRar.name.toUpperCase()}
          </span>
          <p className="text-[10px] text-cell-teal/50">Touche l&apos;écran pour passer</p>
        </div>
      )}
    </div>
  );
}
