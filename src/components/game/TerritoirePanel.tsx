/* LA DÉRIVE — le panneau de la carte (25/07/2026).

   Overlay plein écran, même patron que NoyauHub.tsx / MarePanel.tsx : sélecteur de
   secteur, carte Canvas (TerritoireScene), fiche du foyer sélectionné, et le récapitulatif
   de ce que le territoire rapporte réellement.

   Deux règles respectées à la lettre :
   — aucun nombre d'équilibrage ici : tout vient de territoire_config.json via les
     fonctions pures de territoire.ts (paliers, coûts de développement, butins, bonus) ;
   — aucun `Date.now()` au rendu : le « maintenant » d'affichage est `state.lastTick`.

   Le lancement d'une sortie n'est PAS géré ici : le bouton remonte l'id du foyer à
   la page (`onAssault`), qui ouvre le lanceur du Bastion. La carte choisit la cible,
   le Bastion choisit le Péril et les Préparatifs — une décision par écran. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { resourceName, stateProductionPerHour } from "@/lib/game/economy";
import { fmtInt, fmtRate } from "@/lib/game/format";
import { destinationName } from "@/lib/game/military";
import { useGame } from "@/lib/game/store";
import { TerritoireScene } from "@/components/game/TerritoireScene";
import {
  abimeLoot,
  assaultPalier,
  cacheLoot,
  devCost,
  devLevel,
  foyerAvailable,
  foyerDef,
  foyerIncomePerHour,
  isCaptured,
  maxDevLevel,
  natureDef,
  nextSectorUnlock,
  runCount,
  SECTORS,
  sectorUnlocked,
  TERRITOIRE_ANTRES,
  territoireBonus,
  territoireIncomePerHour,
  territoireProgress,
  vestigeDef,
  type FoyerDef,
  type TerritoireBonusId,
} from "@/lib/game/territoire";
import type { ResourceId } from "@/lib/game/types";

/** Rend la description d'un vestige avec sa valeur : « Production de la base +5 % ».
 *  Le gabarit et le type (ratio/plat) viennent de la config — ici on ne fait que
 *  remplacer le jeton {v}. */
function bonusText(id: TerritoireBonusId, value: number): string {
  const def = vestigeDef(id);
  if (!def) return "";
  const v = def.kind === "ratio" ? `${Math.round(value * 100)} %` : fmtInt(value);
  return def.desc.replace("{v}", v);
}

function ResIcon({ res }: { res: ResourceId }) {
  return (
    <img
      src={`/assets/resources/${res}.png`}
      alt={resourceName(res)}
      title={resourceName(res)}
      width={14}
      height={14}
      className="pixelated"
      draggable={false}
    />
  );
}

/* ---------- Fiche d'un foyer ---------- */

function FoyerCard({
  foyer,
  onAssault,
}: {
  foyer: FoyerDef;
  onAssault?: (foyerId: string) => void;
}) {
  const territoire = useGame((s) => s.territoire);
  const buildings = useGame((s) => s.buildings);
  const resources = useGame((s) => s.resources);
  const palier = useGame((s) => s.waveCount);
  const percees = useGame((s) => s.bilan.percees);
  const develop = useGame((s) => s.developFoyer);

  // stateProductionPerHour alloue un nouvel objet : on le calcule APRÈS sélection,
  // jamais dans un sélecteur Zustand (cf. le piège corrigé dans Hud.tsx).
  const prod = stateProductionPerHour({ buildings, territoire });

  const nat = natureDef(foyer.nature);
  const taken = isCaptured(territoire, foyer.id);
  const sector = SECTORS.find((s) => s.foyers.some((f) => f.id === foyer.id));
  const open = sector ? sectorUnlocked(sector, palier) : false;
  const free = open && foyerAvailable(territoire, foyer);
  const target = assaultPalier(foyer, palier);
  const needsPercee = Boolean(nat.requires_percee);
  const dev = devLevel(territoire, foyer.id);
  const cost = taken ? devCost(foyer, dev, prod) : null;
  const canDevelop =
    cost !== null &&
    (resources[cost.resource] ?? 0) >= cost.amount &&
    resources.combat >= cost.combat;

  return (
    <Panel variant="noyau" className="p-3" style={{ background: "rgba(5, 11, 20, 0.92)" }}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none">{nat.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm tracking-wide" style={{ color: nat.color }}>
            {foyer.name}
          </div>
          <div className="text-[11px] text-cell-teal/70">
            {nat.name} · palier {target}
            {taken && " · capturé"}
            {!taken && !open && " · secteur verrouillé"}
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-white/80">{nat.desc}</p>

      {/* Ce que ce foyer apporte, nature par nature */}
      <div className="mt-2 space-y-1 border-t border-cell-cyan/15 pt-2 text-[11px]">
        {foyer.nature === "gisement" && foyer.resource && (
          <>
            <div className="flex items-center gap-1.5 text-cell-lime">
              <ResIcon res={foyer.resource} />
              {taken ? (
                <>
                  +{fmtRate(foyerIncomePerHour(territoire, foyer, prod))}/h · développement {dev}/
                  {maxDevLevel()}
                </>
              ) : (
                <>Produit de la {resourceName(foyer.resource)} en continu, hors ligne compris.</>
              )}
            </div>
            {taken && cost && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`flex items-center gap-1 ${(resources[cost.resource] ?? 0) >= cost.amount ? "text-cell-lime" : "text-red-400"}`}
                  >
                    <ResIcon res={cost.resource} />
                    {fmtInt(cost.amount)}
                  </span>
                  <span
                    className={`flex items-center gap-1 ${resources.combat >= cost.combat ? "text-cell-lime" : "text-red-400"}`}
                  >
                    <ResIcon res="combat" />
                    {fmtInt(cost.combat)}
                  </span>
                </span>
                <PixelButton
                  className="!min-w-[112px] shrink-0 !px-3 text-[10px]"
                  disabled={!canDevelop}
                  onClick={() => develop(foyer.id)}
                >
                  DÉVELOPPER
                </PixelButton>
              </div>
            )}
            {taken && !cost && (
              <p className="text-cell-teal/60">Gisement pleinement développé.</p>
            )}
          </>
        )}

        {foyer.nature === "cache" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-cell-teal/80">
            {Object.entries(cacheLoot(foyer, prod).resources).map(([res, amount]) => (
              <span key={res} className="flex items-center gap-1">
                <ResIcon res={res as ResourceId} />
                {fmtInt(amount)}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <ResIcon res="combat" />
              {fmtInt(cacheLoot(foyer, prod).combat)}
            </span>
          </div>
        )}

        {foyer.nature === "expedition" && foyer.dest_id && (
          <p className="text-cell-cyan/80">
            🧭 Destination garantie chaque jour : {destinationName(foyer.dest_id)}
          </p>
        )}

        {(foyer.nature === "vestige" || foyer.nature === "antre") && foyer.bonus && foyer.value && (
          <p style={{ color: nat.color }}>
            {vestigeDef(foyer.bonus)?.name} — {bonusText(foyer.bonus, foyer.value)}
          </p>
        )}

        {foyer.nature === "antre" && (
          <p className="text-cell-teal/70">
            {foyer.boss_name} · butin ×{TERRITOIRE_ANTRES.loot_mult} ·{" "}
            {TERRITOIRE_ANTRES.fragments} fragments de carte
          </p>
        )}

        {foyer.nature === "abime" && (
          <div className="space-y-0.5 text-cell-teal/80">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1">
                <ResIcon res="combat" />
                {fmtInt(abimeLoot(target).combat)}
              </span>
              <span>🧬 {abimeLoot(target).fragments} fragment(s)</span>
            </div>
            <p>{runCount(territoire, foyer.id)} passage(s) — se recale sur ton palier à chaque fois.</p>
          </div>
        )}
      </div>

      {/* Passage à l'acte */}
      <div className="mt-2 border-t border-cell-cyan/15 pt-2">
        {free ? (
          <>
            <PixelButton
              className="w-full text-xs"
              disabled={!onAssault || (needsPercee && percees <= 0)}
              onClick={() => onAssault?.(foyer.id)}
            >
              ⚔️ ASSAILLIR — PALIER {target}
            </PixelButton>
            {needsPercee && (
              <p className="mt-1 text-center text-[10px] text-cell-teal/60">
                Un antre coûte une Percée — tu en as {percees}.
              </p>
            )}
          </>
        ) : taken ? (
          <p className="text-center text-[11px] text-cell-lime/80">✓ Foyer capturé</p>
        ) : (
          <p className="text-center text-[11px] text-cell-teal/60">
            Ce secteur s&apos;ouvre au palier {sector?.unlock_palier ?? 0}.
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------- Panneau ---------- */

export function TerritoirePanel({
  onClose,
  onAssault,
}: {
  onClose: () => void;
  /** Remonte la cible choisie à la page, qui ouvre le lanceur de sortie du Bastion. */
  onAssault?: (foyerId: string) => void;
}) {
  const territoire = useGame((s) => s.territoire);
  const buildings = useGame((s) => s.buildings);
  const palier = useGame((s) => s.waveCount);
  const setSector = useGame((s) => s.setTerritoireSector);

  const [selected, setSelected] = useState<string | null>(null);

  // Secteur affiché : le dernier consulté, à condition qu'il soit encore ouvert.
  const stored = SECTORS.find((s) => s.id === territoire.lastSectorId);
  const sector = stored && sectorUnlocked(stored, palier) ? stored : SECTORS[0];

  const prod = stateProductionPerHour({ buildings, territoire });
  const income = territoireIncomePerHour(territoire, prod);
  const incomeRows = (Object.keys(income) as ResourceId[]).filter((r) => (income[r] ?? 0) > 0);
  const bonuses = territoireBonus(territoire);
  const bonusRows = (Object.keys(bonuses) as TerritoireBonusId[]).filter(
    (id) => (bonuses[id] ?? 0) > 0,
  );
  const progress = territoireProgress(territoire, palier);
  const nextSector = nextSectorUnlock(palier);
  const foyer = selected ? foyerDef(selected) : null;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <img
            src="/assets/buildings/raid/niveau3.png"
            alt=""
            width={40}
            height={40}
            className="pixelated"
            draggable={false}
          />
          <div className="flex-1">
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">La Dérive</h1>
            <p className="text-[11px] text-cell-teal/60">
              {progress.capturedUnlocked}/{progress.totalUnlocked} foyers pris dans les eaux
              ouvertes · palier {palier}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan"
          >
            ✕
          </button>
        </div>

        {/* Sélecteur de secteur */}
        <div className="flex flex-wrap gap-1.5">
          {SECTORS.map((s) => {
            const open = sectorUnlocked(s, palier);
            const active = s.id === sector.id;
            return (
              <button
                key={s.id}
                disabled={!open}
                onClick={() => {
                  setSector(s.id);
                  setSelected(null);
                }}
                className={`tap-h rounded-full border px-3 text-[11px] tracking-wide transition active:translate-y-px ${
                  active
                    ? "text-white"
                    : open
                      ? "border-cell-teal/30 text-cell-teal/70"
                      : "border-cell-teal/15 text-cell-teal/35"
                }`}
                style={active ? { borderColor: s.tint, background: `${s.tint}33` } : undefined}
              >
                {open ? s.name : `🔒 ${s.name} · P${s.unlock_palier}`}
              </button>
            );
          })}
        </div>

        {/* La carte */}
        <Panel variant="membrane" className="p-1.5" style={{ background: "rgba(5, 11, 20, 0.8)" }}>
          <TerritoireScene sectorId={sector.id} selected={selected} onSelect={setSelected} />
          <p className="px-1 pt-1.5 text-[11px] leading-relaxed text-cell-teal/60">{sector.desc}</p>
        </Panel>

        {/* Fiche du foyer sélectionné, ou invitation à en choisir un */}
        {foyer ? (
          <FoyerCard foyer={foyer} onAssault={onAssault} />
        ) : (
          <p className="px-2 text-center text-[11px] text-cell-teal/50">
            Touche un foyer sur la carte pour voir ce qu&apos;il cache.
          </p>
        )}

        {/* Ce que le territoire rapporte déjà */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">Revenu du territoire</h2>
        <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
          {incomeRows.length === 0 ? (
            <p className="text-[11px] text-cell-teal/50">
              Aucun gisement capturé — la carte ne rapporte encore rien.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-cell-lime">
              {incomeRows.map((res) => (
                <span key={res} className="flex items-center gap-1">
                  <ResIcon res={res} />+{fmtRate(income[res] ?? 0)}/h
                </span>
              ))}
            </div>
          )}
        </Panel>

        {/* Bonus permanents déjà acquis */}
        {bonusRows.length > 0 && (
          <>
            <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">
              Vestiges acquis
            </h2>
            <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
              <div className="space-y-0.5 text-[11px] text-cell-teal/80">
                {bonusRows.map((id) => (
                  <div key={id}>🏺 {bonusText(id, bonuses[id] ?? 0)}</div>
                ))}
              </div>
            </Panel>
          </>
        )}

        {nextSector && (
          <p className="px-2 pb-1 text-center text-[11px] text-cell-teal/50">
            Prochain secteur : {nextSector.name}, au palier {nextSector.unlock_palier}.
          </p>
        )}
      </div>
    </div>
  );
}
