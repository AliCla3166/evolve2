/* Révélation de carte (Phase 6) — pop de la prise fraîchement pêchée
   (ou fusionnée depuis des fragments), avec badges NOUVELLE / rareté / niveau. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect } from "react";
import { CardFrame, PixelButton, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
  cardPowerAtk,
  cardPowerDef,
  cardPowerExp,
  rarityConfig,
  speciesConfig,
} from "@/lib/game/cards";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";

export function CardReveal() {
  const lastCatch = useGame((s) => s.lastCatch);
  const collection = useGame((s) => s.collection);
  const clearLastCatch = useGame((s) => s.clearLastCatch);

  // Petite pulsation physique à la révélation (plus marquée pour les hautes raretés).
  useEffect(() => {
    if (lastCatch) vibrate(lastCatch.rarity >= 3 ? [20, 40, 30] : [15, 30, 15]);
  }, [lastCatch]);

  if (!lastCatch) return null;
  const sp = speciesConfig(lastCatch.speciesId);
  const rar = rarityConfig(lastCatch.rarity);
  const entry = collection[lastCatch.speciesId];
  if (!sp || !entry) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-6">
      <div className="animate-card-reveal flex flex-col items-center gap-3 text-center">
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
  );
}
