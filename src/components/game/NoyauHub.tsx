/* Hub militaire du Noyau (Phase 5) — recrutement, défense, expéditions.
   Overlay plein écran mobile-first. Tout le tuning vient de military_config.json. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { resourceName } from "@/lib/game/economy";
import { fmtDuration, fmtInt } from "@/lib/game/format";
import {
  availableUnits,
  canRecruit,
  cardExpeditionBonus,
  dailyOffers,
  defensePower,
  estimatedWavePower,
  MILITARY,
  recruitCost,
  successChance,
  totalUnits,
  unitCap,
  unitConfig,
  UNIT_IDS,
} from "@/lib/game/military";
import { useGame } from "@/lib/game/store";
import type { ResourceId, UnitId } from "@/lib/game/types";

const EMPTY_SQUAD: Record<UnitId, number> = { garde: 0, sonde: 0, phage: 0 };

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

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        className="h-6 w-6 rounded border border-cell-cyan/40 text-xs text-cell-cyan disabled:opacity-30"
        disabled={value <= 0}
      >
        −
      </button>
      <span className="w-7 text-center text-xs text-white">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-6 w-6 rounded border border-cell-cyan/40 text-xs text-cell-cyan disabled:opacity-30"
        disabled={value >= max}
      >
        +
      </button>
    </span>
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
  const sendExpedition = useGame((s) => s.sendExpedition);
  const markNoyauSeen = useGame((s) => s.markNoyauSeen);

  /* Le badge « nouvelles destinations » de l'onglet NOYAU s'eteint des que le
     joueur a vu les offres du jour (piste 9b) : les 4 destinations sont tirees
     a partir de dayKey, donc elles changent a minuit sans que rien ne le dise. */
  useEffect(() => {
    markNoyauSeen();
  }, [markNoyauSeen]);

  const state = useGame.getState();
  const avail = availableUnits(state);
  const offers = dailyOffers(state, now);
  const cardBonus = cardExpeditionBonus(state);
  const cap = unitCap(buildings);
  const total = totalUnits(units);
  const def = defensePower(state);
  const waveIn = Math.max(0, nextAttackAt - now);
  const wavePower = estimatedWavePower(state, now);

  const [openOffer, setOpenOffer] = useState<number | null>(null);
  const [squad, setSquad] = useState<Record<UnitId, number>>(EMPTY_SQUAD);

  const squadSize = UNIT_IDS.reduce((s, u) => s + squad[u], 0);
  const slotsFree = MILITARY.expeditions.max_concurrent - expeditions.length;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <img src="/assets/buildings/noyau/niveau3.png" alt="" width={40} height={40} className="pixelated" draggable={false} />
          <div className="flex-1">
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">Le Noyau</h1>
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

        {/* Expéditions en cours */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">
          Expéditions ({expeditions.length}/{MILITARY.expeditions.max_concurrent})
        </h2>
        {expeditions.length === 0 ? (
          <p className="text-[11px] text-cell-teal/50">Aucune escouade en mer. Les offres changent chaque jour.</p>
        ) : (
          expeditions.map((exp) => (
            <Panel key={exp.id} variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-cell-cyan">🧭 {exp.destName}</span>
                <span className="text-cell-lime">retour dans {fmtDuration(exp.endsAt - now)}</span>
              </div>
              <div className="text-[11px] text-cell-teal/60">
                {UNIT_IDS.filter((u) => exp.squad[u] > 0)
                  .map((u) => `${exp.squad[u]}× ${unitConfig(u).name}`)
                  .join(" · ")}
              </div>
            </Panel>
          ))
        )}

        {/* Offres du jour */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">Destinations du jour</h2>
        {offers.map((offer, i) => {
          const opened = openOffer === i;
          const chance = successChance(offer, squad, cardBonus);
          return (
            <Panel key={`${offer.destId}-${i}`} variant="membrane" className="p-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
              <button
                className="w-full text-left"
                onClick={() => {
                  setOpenOffer(opened ? null : i);
                  setSquad(EMPTY_SQUAD);
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs tracking-wide text-cell-cyan">
                    {"✦".repeat(offer.tier)} {offer.destName}
                  </span>
                  <span className="text-[11px] text-cell-teal/70">{offer.durationH} h</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-cell-teal/70">
                  <span>risque {Math.round(offer.risk * 100)} %</span>
                  <span>difficulté {offer.difficulty}</span>
                  <span className="flex items-center gap-1">
                    {offer.rewards.map((r) => (
                      <img key={r} src={`/assets/resources/${r}.png`} alt={r} title={resourceName(r as ResourceId)} width={14} height={14} className="pixelated" draggable={false} />
                    ))}
                  </span>
                </div>
              </button>

              {opened && (
                <div className="mt-2 space-y-2 border-t border-cell-cyan/15 pt-2">
                  {UNIT_IDS.map((u) => (
                    <div key={u} className="flex items-center justify-between text-[11px]">
                      <span className="text-cell-teal/80">
                        {unitConfig(u).icon} {unitConfig(u).name}
                        <span className="text-cell-teal/50"> · {avail[u]} dispo</span>
                      </span>
                      <Stepper value={squad[u]} max={avail[u]} onChange={(v) => setSquad({ ...squad, [u]: v })} />
                    </div>
                  ))}
                  {(cardBonus.exp > 0 || cardBonus.atk > 0) && (
                    <p className="text-[10px] text-cell-teal/60">
                      🃏 Cartes assignées : +{cardBonus.exp} exploration · +{cardBonus.atk} assaut
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${chance >= 0.7 ? "text-cell-lime" : chance >= 0.4 ? "text-cell-teal" : "text-red-400"}`}>
                      Succès estimé : {Math.round(chance * 100)} %
                    </span>
                    <PixelButton
                      className="!min-w-[100px] !px-3 text-[10px]"
                      disabled={squadSize <= 0 || slotsFree <= 0}
                      onClick={() => {
                        if (sendExpedition(i, squad)) {
                          setOpenOffer(null);
                          setSquad(EMPTY_SQUAD);
                        }
                      }}
                    >
                      ENVOYER
                    </PixelButton>
                  </div>
                  {slotsFree <= 0 && (
                    <p className="text-[10px] text-cell-teal/50">Toutes tes escouades sont déjà en mer.</p>
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
