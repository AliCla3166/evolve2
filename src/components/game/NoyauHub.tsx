/* Le Noyau (Phase 5, resserré à l'étape 6c) — recrutement et défense de la cellule.

   Les EXPÉDITIONS ne vivent plus ici : elles ont déménagé sur la carte de La Dérive
   (PLAN_DERIVE §3.7), où les quatre destinations du jour sont devenues des relais
   qu'on touche pour composer et lancer une escouade. Le Noyau garde ce qui lui
   revient : produire des unités, et dire si la cellule tiendra la prochaine vague.

   Overlay plein écran mobile-first. Tout le tuning vient de military_config.json. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import { fmtDuration, fmtInt } from "@/lib/game/format";
import {
  availableUnits,
  canRecruit,
  defensePower,
  estimatedWavePower,
  recruitCost,
  totalUnits,
  unitCap,
  unitConfig,
  UNIT_IDS,
} from "@/lib/game/military";
import { useGame } from "@/lib/game/store";
import type { ResourceId } from "@/lib/game/types";

function CostRow({ cost, resources }: { cost: Record<string, number>; resources: Record<ResourceId, number> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {Object.entries(cost).map(([res, amount]) => {
        const ok = (resources[res as ResourceId] ?? 0) >= amount;
        return (
          <span key={res} className={`flex items-center gap-1 text-[11px] ${ok ? "text-cell-lime" : "text-red-400"}`}>
            <img src={`/assets/resources/${res}.png`} alt={res} width={14} height={14} className="pixelated" draggable={false} />
            {fmtInt(amount)}
          </span>
        );
      })}
    </div>
  );
}

export function NoyauHub({ onClose }: { onClose: () => void }) {
  const resources = useGame((s) => s.resources);
  const buildings = useGame((s) => s.buildings);
  const units = useGame((s) => s.units);
  const expeditions = useGame((s) => s.expeditions);
  const waveCount = useGame((s) => s.waveCount);
  const nextAttackAt = useGame((s) => s.nextAttackAt);
  const fragments = useGame((s) => s.fragments);
  const now = useGame((s) => s.lastTick);
  const recruit = useGame((s) => s.recruit);

  const state = useGame.getState();
  const avail = availableUnits(state);
  const cap = unitCap(buildings);
  const total = totalUnits(units);
  const def = defensePower(state);
  const waveIn = Math.max(0, nextAttackAt - now);
  const wavePower = estimatedWavePower(state, now);
  const deployed = UNIT_IDS.reduce((s, u) => s + (units[u] - avail[u]), 0);

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <img src="/assets/buildings/noyau/niveau3.png" alt="" width={40} height={40} className="pixelated" draggable={false} />
          <div className="flex-1">
            <h1 className="font-pixel text-base uppercase tracking-[0.3em] text-cell-cyan">Le Noyau</h1>
            <p className="text-[11px] text-cell-teal/60">
              Effectif {total}/{cap} · {fragments} fragment{fragments > 1 ? "s" : ""} de carte
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Défense */}
        <Panel variant="noyau" className="p-3" style={{ background: "rgba(5, 11, 20, 0.9)" }}>
          <div className="mb-1 text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Défense de la cellule</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-cell-lime">🛡️ Puissance : {fmtInt(def)}</span>
            <span className={wavePower > def ? "text-red-400" : "text-cell-teal"}>
              🦠 Prochaine vague ≈ {fmtInt(wavePower)} dans {fmtDuration(waveIn)}
            </span>
            <span className="text-cell-teal/60">{waveCount} vague{waveCount > 1 ? "s" : ""} affrontée{waveCount > 1 ? "s" : ""}</span>
          </div>
          {wavePower > def && (
            <p className="mt-1 text-[11px] text-red-400/90">
              ⚠️ Défense insuffisante — recrute des Gardes membranaires (les unités en expédition ne défendent pas).
            </p>
          )}
        </Panel>

        {/* Recrutement */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">Recruter</h2>
        {UNIT_IDS.map((id) => {
          const cfg = unitConfig(id);
          const ok = canRecruit(state, id);
          return (
            <Panel key={id} variant="membrane" className="p-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{cfg.icon}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs tracking-wide" style={{ color: cfg.accent }}>{cfg.name}</span>
                    <span className="text-[11px] text-cell-teal/70">
                      ×{units[id]} {avail[id] !== units[id] ? `(${avail[id]} dispo)` : ""}
                    </span>
                  </div>
                  <div className="text-[11px] text-cell-teal/60">{cfg.desc}</div>
                  <div className="flex gap-3 text-[10px] text-cell-teal/70">
                    <span>déf {cfg.power_def}</span>
                    <span>expl {cfg.power_exp}</span>
                    <span>asst {cfg.power_atk}</span>
                  </div>
                  <CostRow cost={recruitCost(id)} resources={resources} />
                </div>
                <PixelButton
                  className="!min-w-[92px] shrink-0 !px-3 text-[10px]"
                  disabled={!ok}
                  onClick={() => recruit(id)}
                >
                  RECRUTER
                </PixelButton>
              </div>
            </Panel>
          );
        })}
        {total >= cap && (
          <p className="text-center text-[11px] text-cell-teal/60">
            Effectif au maximum — améliore le Noyau pour l&apos;étendre.
          </p>
        )}

        {/* Renvoi vers la carte : c'est là que les unités recrutées partent en mer */}
        <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
          <p className="text-[11px] leading-relaxed text-cell-teal/70">
            🧭 Les expéditions se lancent sur <span className="text-cell-cyan">La Dérive</span> :
            les quatre relais du jour t&apos;y attendent en haut de la carte.
            {expeditions.length > 0 && (
              <>
                {" "}
                {deployed} unité{deployed > 1 ? "s" : ""} en mer, la plus proche rentre dans{" "}
                {fmtDuration(
                  Math.max(0, Math.min(...expeditions.map((e) => e.endsAt)) - now),
                )}
                .
              </>
            )}
          </p>
        </Panel>
      </div>
    </div>
  );
}
