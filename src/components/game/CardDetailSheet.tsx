/* Fiche détail d'une carte de La Mare (refonte lisibilité 31/07, piste Phase 1
   n°8). Avant ce fichier, la grille de collection affichait TOUT en permanence
   pour chacune des 62 espèces : nom, rareté, édition, rôle, quatre stats de
   combat, poste(s) éventuel(s), verrou de doublon — jusqu'à 8 lignes de texte
   par carte, sur une grille en 3 colonnes. Un tap sur le portrait ou le nom
   ouvre désormais cette fiche ; la grille elle-même ne garde que ce qui pèse
   sur la décision immédiate (assigner ou pas), voir MarePanel.tsx. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { CardFrame, Panel, PixelButton, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
  cardPowerAtk,
  cardPowerDef,
  cardPowerExp,
  cardPowerRec,
  editionConfig,
  editionEffect,
  rarityConfig,
} from "@/lib/game/cards";
import { getBuildingConfig } from "@/lib/game/economy";
import { useOverlay } from "@/lib/overlay";
import type { BuildingId, CardEntry } from "@/lib/game/types";
import type { SpeciesConfig } from "@/lib/game/cards";

const ROLE_LABEL = { defense: "🛡️ Défense", exploration: "🧭 Exploration", assaut: "⚔️ Assaut" } as const;

/** Tout le calcul dérivé d'une carte, préparé une seule fois par MarePanel et
 *  partagé entre la grille (juste ce qu'il faut voir tout de suite) et cette
 *  fiche (le reste). Voir `computeCardView` dans MarePanel.tsx. */
export interface CardViewData {
  rar: ReturnType<typeof rarityConfig>;
  level: number;
  next: number | null;
  inDef: boolean;
  inExp: boolean;
  playable: boolean;
  missing: number;
  edIdx: number;
  edTitle: string;
  freeSlot: boolean;
  posteA: string | null;
  posteALabel: string | null;
  posteARecoltePct: number | null;
  posteB: BuildingId | null;
  posteBLevel: number | null;
  posteBPct: number | null;
}

export function CardDetailSheet({
  sp,
  entry,
  view,
  onClose,
  onToggleAssign,
}: {
  sp: SpeciesConfig;
  entry: CardEntry;
  view: CardViewData;
  onClose: () => void;
  onToggleAssign: (speciesId: string, slot: "defense" | "expedition") => void;
}) {
  const dialogRef = useOverlay<HTMLDivElement>(true, onClose);
  const ed = editionConfig(view.edIdx);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 outline-none sm:items-center"
      onClick={onClose}
    >
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <Panel variant="noyau" className="max-h-[85vh] space-y-2.5 overflow-y-auto p-4">
          <div className="flex items-start gap-3">
            <div
              className="w-[84px] shrink-0"
              style={view.edIdx > 0 ? { filter: `drop-shadow(0 0 8px ${ed.color})` } : undefined}
            >
              <CardFrame rarity={view.rar.id as Rarity}>
                <img
                  src={cardArt(sp.id)}
                  alt={sp.name}
                  className="pixelated h-full w-full object-contain"
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = "/assets/ui/age01_cell_ui_card_slot_v001.png";
                  }}
                />
              </CardFrame>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold leading-tight text-cell-cyan">{sp.name}</h3>
                <button
                  onClick={onClose}
                  aria-label="Fermer"
                  className="shrink-0 px-1 text-sm text-cell-dim hover:text-cell-cyan"
                >
                  ✕
                </button>
              </div>
              <p className="text-[11px]" style={{ color: view.rar.color }}>
                {view.rar.name} · Nv {view.level}
                {view.next !== null && (
                  <span className="text-cell-faint"> ({entry.count}/{view.next})</span>
                )}
              </p>
              <p className="mt-0.5 text-[10px] text-cell-dim">
                {ROLE_LABEL[sp.role]}
                {view.freeSlot && <span className="text-cell-faint"> · sans place</span>}
              </p>
              {view.edIdx > 0 && (
                <p className="mt-0.5 text-[10px] leading-snug" style={{ color: ed.color }} title={view.edTitle}>
                  ◈ {ed.name} · {editionEffect(view.edIdx)}
                </p>
              )}
            </div>
          </div>

          {/* Les quatre puissances de combat + la récolte dérivée. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cell-cyan/10 pt-2 text-[11px] leading-tight">
            <span className="text-cell-magenta/80">❤ {cardHp(sp.id, entry)}</span>
            <span className="text-cell-dim">🛡 {cardPowerDef(sp.id, entry)}</span>
            <span className="text-cell-dim">🧭 {cardPowerExp(sp.id, entry)}</span>
            <span className="text-cell-dim">⚔ {cardPowerAtk(sp.id, entry)}</span>
            <span className="text-cell-lime/80">⛏ {cardPowerRec(sp.id, entry)}</span>
          </div>

          {(view.posteA || view.posteB) && (
            <div className="space-y-1 border-t border-cell-cyan/10 pt-2 text-[10px] leading-tight text-cell-lime/90">
              {view.posteA && (
                <p>
                  ⛏️ {view.posteALabel} {" +"}
                  {view.posteARecoltePct} %
                </p>
              )}
              {view.posteB && (
                <p>
                  ⚙️ {getBuildingConfig(view.posteB).name} · nv{" "}
                  {view.posteBLevel} {" +"}
                  {view.posteBPct} %
                </p>
              )}
            </div>
          )}

          {!view.playable ? (
            <p
              className="border-t border-cell-cyan/10 pt-2 text-center text-[11px] text-cell-dim"
            >
              🔒 Une prise donne la carte, pas le droit de la jouer — encore {view.missing} prise
              {view.missing > 1 ? "s" : ""} de {sp.name} pour pouvoir l&apos;assigner ou la poster.
            </p>
          ) : (
            <div className="flex w-full gap-2 border-t border-cell-cyan/10 pt-2">
              <button
                onClick={() => onToggleAssign(sp.id, "defense")}
                className={`tap-h flex-1 rounded border text-[12px] ${
                  view.inDef ? "border-cell-lime bg-cell-lime/20 text-cell-lime" : "border-cell-teal/30 text-cell-dim"
                }`}
                aria-pressed={view.inDef}
              >
                🛡️ Défense
              </button>
              <button
                onClick={() => onToggleAssign(sp.id, "expedition")}
                className={`tap-h flex-1 rounded border text-[12px] ${
                  view.inExp ? "border-cell-cyan bg-cell-cyan/20 text-cell-cyan" : "border-cell-teal/30 text-cell-dim"
                }`}
                aria-pressed={view.inExp}
              >
                🧭 Expédition
              </button>
            </div>
          )}

          <PixelButton className="w-full text-[11px]" onClick={onClose}>
            FERMER
          </PixelButton>
        </Panel>
      </div>
    </div>
  );
}
