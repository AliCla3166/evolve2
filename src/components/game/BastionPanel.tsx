/* Overlay plein écran du Bastion-Défense jouable (intégration profonde) — même pattern que
   NoyauHub.tsx/MarePanel.tsx. Réservoir de garnison (pont La Mare -> Bastion), réservoir de
   bâtiments (tirage payé en monnaie de combat), Boutique (emplacements/plafonds/fondations),
   scène Canvas (BastionScene), et le combat en direct d'une vague. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardFrame, Panel, PixelButton, RARITY_LABEL, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
  cardPowerAtk,
  cardPowerDef,
  rarityConfig,
  speciesConfig,
} from "@/lib/game/cards";
import { availableDefenseSpecies, ownedBuildingCount } from "@/lib/game/bastion/actions";
import {
  BASTION,
  barracksSlotUnlockCost,
  buildingDef,
  buildingIcon,
  buildingRarityColor,
  buildingsByCategory,
  foundationsCost,
  foundationsMult,
  mortarSlotUnlockCost,
  recruitBuildingCost,
  reserveCapCost,
  scoutCost,
  specCapCost,
  turretSlotUnlockCost,
  WAVE_LEAD_WINDOW_MS,
} from "@/lib/game/bastion/config";
import { previewWave } from "@/lib/game/bastion/engine";
import type { BastionSceneHandle } from "./BastionScene";
import { BastionScene } from "./BastionScene";
import type { BastionSlotTarget, LiveWaveResult } from "@/lib/game/bastion/types";
import { estimatedWavePower } from "@/lib/game/military";
import { fmtDuration, fmtInt } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";

/** Ce que chaque niveau de Vigie dévoile (index = bastion.scoutLevel). */
const SCOUT_LEVEL_LABEL: string[] = [
  "aucun renseignement",
  "effectif total + présence d'un boss",
  "+ espèces présentes",
  "+ effectif et stats par espèce",
];

/** Aperçu de la vague suivante — exact (genLiveWave est déterministe par numéro de vague),
 *  mais dévoilé par paliers selon le niveau de Vigie acheté en Boutique. */
function WavePreview({ waveN, level }: { waveN: number; level: number }) {
  const preview = useMemo(() => previewWave(waveN), [waveN]);
  if (level <= 0) {
    return (
      <p className="text-[10px] text-cell-teal/50">
        🔭 Aucune vigie : tu défendras à l&apos;aveugle. (Boutique → Améliorations → Vigie)
      </p>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border border-cell-teal/20 bg-black/30 p-2">
      <div className="flex items-center justify-between text-[10px] text-cell-cyan">
        <span>🔭 Vigie — vague {preview.waveN}</span>
        <span className="text-cell-teal/60">
          {preview.total} ennemi{preview.total > 1 ? "s" : ""}
          {preview.isBoss ? " · 👑 BOSS" : ""}
        </span>
      </div>
      {level >= 2 && (
        <div className="flex flex-wrap gap-1">
          {preview.types.map((t) => (
            <span
              key={t.id}
              className="rounded border border-cell-teal/30 px-1.5 py-0.5 text-[10px] text-cell-teal/80"
            >
              {t.ranged ? "🏹" : "🦠"} {t.name}
              {level >= 3 && (
                <span className="text-cell-teal/50">
                  {" "}
                  ×{t.count} · {t.hp} PV · {t.dmg} dgt
                </span>
              )}
            </span>
          ))}
          {preview.boss && (
            <span className="rounded border border-cell-magenta/50 px-1.5 py-0.5 text-[10px] text-cell-magenta">
              👑 {preview.boss.name}
              {level >= 3 && (
                <span className="opacity-70">
                  {" "}
                  · {preview.boss.hp} PV · {preview.boss.dmg} dgt
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {level >= 3 && (
        <p className="text-[9px] text-cell-teal/50">
          Multiplicateurs de vague : PV ×{preview.hpMult.toFixed(2)} · dégâts ×{preview.dmgMult.toFixed(2)}
        </p>
      )}
    </div>
  );
}

type ArmedItem =
  | { type: "creature"; speciesId: string; role: "defense" | "assaut" }
  | { type: "building"; uid: number; defId: string; category: "turret" | "support" | "wall" | "trap" };

type MovingItem = { kind: "turret" | "barracks" | "mortar"; id: string };

function CombatCost({ amount, have }: { amount: number; have: number }) {
  const ok = have >= amount;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${ok ? "text-cell-lime" : "text-red-400"}`}>
      <img src="/assets/resources/combat.png" alt="" width={14} height={14} className="pixelated" draggable={false} />
      {fmtInt(amount)}
    </span>
  );
}

export function BastionPanel({ onClose }: { onClose: () => void }) {
  const sceneRef = useRef<BastionSceneHandle>(null);

  const bastion = useGame((s) => s.bastion);
  const resources = useGame((s) => s.resources);
  const collection = useGame((s) => s.collection);
  const cardAssignments = useGame((s) => s.cardAssignments);
  const nextAttackAt = useGame((s) => s.nextAttackAt);
  const waveCount = useGame((s) => s.waveCount);
  const now = useGame((s) => s.lastTick);

  const placeBastionCreature = useGame((s) => s.placeBastionCreature);
  const removeBastionCreature = useGame((s) => s.removeBastionCreature);
  const recruitBastionBuilding = useGame((s) => s.recruitBastionBuilding);
  const recycleBastionBuilding = useGame((s) => s.recycleBastionBuilding);
  const placeBastionBuilding = useGame((s) => s.placeBastionBuilding);
  const removeBastionTurretToReserve = useGame((s) => s.removeBastionTurretToReserve);
  const removeBastionSupportToReserve = useGame((s) => s.removeBastionSupportToReserve);
  const removeBastionStructureToReserve = useGame((s) => s.removeBastionStructureToReserve);
  const moveBastionSlot = useGame((s) => s.moveBastionSlot);
  const buyBastionSlotUnlock = useGame((s) => s.buyBastionSlotUnlock);
  const buyBastionReserveCap = useGame((s) => s.buyBastionReserveCap);
  const buyBastionSpecCap = useGame((s) => s.buyBastionSpecCap);
  const buyBastionFoundations = useGame((s) => s.buyBastionFoundations);
  const buyBastionInWaveRespawn = useGame((s) => s.buyBastionInWaveRespawn);
  const buyBastionScouting = useGame((s) => s.buyBastionScouting);
  const chooseBastionTreeOption = useGame((s) => s.chooseBastionTreeOption);
  const beginBastionBattle = useGame((s) => s.beginBastionBattle);
  const finishBastionBattle = useGame((s) => s.finishBastionBattle);

  const [tab, setTab] = useState<"champ" | "boutique">("champ");
  const [armed, setArmed] = useState<ArmedItem | null>(null);
  const [moving, setMoving] = useState<MovingItem | null>(null);
  const [inspect, setInspect] = useState<BastionSlotTarget | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<NonNullable<typeof sceneRef.current>["getBattleSnapshot"]> | null>(null);
  const [banner, setBanner] = useState<LiveWaveResult | null>(null);

  // Poll léger (pas de re-render 60 fps) : HUD de bataille + charge des supports actifs.
  useEffect(() => {
    const id = setInterval(() => setSnapshot(sceneRef.current?.getBattleSnapshot() ?? null), 200);
    return () => clearInterval(id);
  }, []);

  const inBattle = !!snapshot?.active;
  // cardAssignments est souscrit ci-dessus (re-render à jour dès qu'une carte est
  // assignée/retirée depuis la Mare) ; on relit l'état complet ici pour dériver la
  // réserve sans dupliquer la logique de filtrage d'availableDefenseSpecies.
  void cardAssignments;
  const reserveSpecies = availableDefenseSpecies(useGame.getState());
  const waveIn = nextAttackAt - now;
  const canPlayLive = nextAttackAt > 0 && waveIn <= WAVE_LEAD_WINDOW_MS && !inBattle && !banner;

  const armedRange = (() => {
    if (armed?.type !== "building") return undefined;
    const def = buildingDef(armed.defId);
    return def?.range;
  })();
  const armedCategory: "turret" | "barracks" | "mortar" | "wall" | "trap" | null = armed
    ? armed.type === "creature"
      ? armed.role === "defense"
        ? "barracks"
        : "mortar"
      : armed.category === "support"
        ? null
        : armed.category
    : null;

  function cancelModes() {
    setArmed(null);
    setMoving(null);
  }

  function handleTapSlot(target: BastionSlotTarget) {
    if (moving) {
      if (
        (target.kind === "turret" && moving.kind === "turret") ||
        (target.kind === "barracks" && moving.kind === "barracks") ||
        (target.kind === "mortar" && moving.kind === "mortar")
      ) {
        moveBastionSlot(moving.kind, moving.id, target.slotId);
        vibrate(20);
      }
      setMoving(null);
      return;
    }
    if (armed) {
      let ok = false;
      if (armed.type === "creature" && target.kind === "barracks" && armed.role === "defense") {
        ok = placeBastionCreature(armed.speciesId, "barracks", target.slotId);
      } else if (armed.type === "creature" && target.kind === "mortar" && armed.role === "assaut") {
        ok = placeBastionCreature(armed.speciesId, "mortar", target.slotId);
      } else if (armed.type === "building" && armed.category === "turret" && target.kind === "turret") {
        ok = placeBastionBuilding(armed.uid, "turret", { slotId: target.slotId });
      } else if (armed.type === "building" && (armed.category === "wall" || armed.category === "trap") && target.kind === "field") {
        ok = placeBastionBuilding(armed.uid, armed.category, { x: target.x, y: target.y });
      }
      if (ok) {
        vibrate(20);
        setArmed(null);
      }
      return;
    }
    if (target.kind !== "field") setInspect(target);
  }

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 px-2 pb-24 pt-3 sm:max-w-2xl">
        {/* En-tête */}
        <div className="flex items-center gap-3">
          <img src="/assets/buildings/defense/niveau1.png" alt="" width={40} height={40} className="pixelated" draggable={false} />
          <div className="flex-1">
            <h1 className="text-base uppercase tracking-[0.3em] text-cell-cyan">Bastion-Défense</h1>
            <p className="flex items-center gap-1 text-[11px] text-cell-teal/60">
              <img src="/assets/resources/combat.png" alt="" width={14} height={14} className="pixelated" draggable={false} />
              {fmtInt(resources.combat ?? 0)} monnaie de combat
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Bannière de fin de bataille */}
        {banner && (
          <Panel variant="tooltip" className="space-y-1 p-2 text-center" style={{ background: banner.won ? "rgba(10,40,20,0.9)" : "rgba(40,10,15,0.9)" }}>
            <p className={`text-sm ${banner.won ? "text-cell-lime" : "text-red-400"}`}>
              {banner.won ? `🛡️ Vague ${banner.waveN} repoussée !` : `🦠 Vague ${banner.waveN} — le Bastion a cédé`}
            </p>
            <p className="text-[11px] text-cell-teal/70">
              {banner.kills} élimination{banner.kills > 1 ? "s" : ""} · Bastion à {Math.round(banner.bastionHpFrac * 100)}% PV
            </p>
            <PixelButton className="text-xs" onClick={() => setBanner(null)}>
              CONTINUER
            </PixelButton>
          </Panel>
        )}

        {/* Bannière de vague imminente / bataille en cours */}
        {!banner && inBattle && snapshot && (
          <Panel variant="tooltip" className="space-y-1 p-2" style={{ background: "rgba(30,5,20,0.9)" }}>
            <div className="flex items-center justify-between text-[11px] text-red-400">
              <span>⚔️ Vague {snapshot.waveN} en direct</span>
              <span>{snapshot.kills} élimination{snapshot.kills > 1 ? "s" : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full bg-cell-lime transition-[width]"
                style={{ width: `${Math.max(0, Math.min(100, (snapshot.bastionHp / Math.max(1, snapshot.bastionHpMax)) * 100))}%` }}
              />
            </div>
            {snapshot.support.some((s) => s?.ready) && (
              <div className="flex flex-wrap gap-1 pt-1">
                {snapshot.support.map((s, i) => {
                  if (!s) return null;
                  const def = buildingDef(s.occupant);
                  if (!def?.active) return null;
                  return (
                    <button
                      key={i}
                      disabled={!s.ready}
                      onClick={() => sceneRef.current?.triggerSupportActive(i)}
                      className={`rounded border px-2 py-1 text-[10px] ${
                        s.ready
                          ? "animate-pulse border-cell-lime bg-cell-lime/20 text-cell-lime"
                          : "border-cell-teal/30 text-cell-teal/50"
                      }`}
                    >
                      {buildingIcon(def.id)} {def.name} {s.ready ? "— PRÊT" : `(${s.charge}/${def.chargeKills ?? "?"})`}
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        )}
        {/* Lancement manuel — TOUJOURS visible hors bataille : la vague planifiée peut être
            jouée en avance (cf. WAVE_LEAD_WINDOW_MS). Le bouton n'est grisé que si la
            prochaine vague est encore trop loin dans le calendrier. */}
        {!banner && !inBattle && (
          <Panel variant="tooltip" className="space-y-2 p-2" style={{ background: "rgba(30,5,20,0.85)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-red-400">
                🦠 Vague {waveCount + 1} · puissance ≈ {fmtInt(estimatedWavePower(useGame.getState(), now))}
                {waveIn > 0 ? ` · planifiée dans ${fmtDuration(waveIn)}` : " · échue"}
              </span>
              <PixelButton
                className="shrink-0 text-[10px]"
                disabled={!canPlayLive}
                onClick={() => {
                  cancelModes();
                  // Pose le verrou anti-double-résolution AVANT de démarrer la simulation
                  // locale — cf. store.beginBastionBattle.
                  beginBastionBattle();
                  sceneRef.current?.startBattle(waveCount + 1);
                }}
              >
                ⚔️ LANCER LA VAGUE
              </PixelButton>
            </div>
            {!canPlayLive && (
              <p className="text-[10px] text-cell-teal/60">
                Les pathogènes ne sont pas encore en approche : une vague se joue jusqu&apos;à{" "}
                {Math.round(WAVE_LEAD_WINDOW_MS / 3_600_000)} h à l&apos;avance. Fenêtre ouverte dans{" "}
                {fmtDuration(Math.max(0, waveIn - WAVE_LEAD_WINDOW_MS))}.
              </p>
            )}
            <WavePreview waveN={waveCount + 1} level={bastion.scoutLevel} />
          </Panel>
        )}

        {/* Onglets */}
        {!inBattle && (
          <div className="flex gap-2">
            <button
              onClick={() => setTab("champ")}
              className={`flex-1 rounded-lg border py-1.5 text-[11px] tracking-widest ${tab === "champ" ? "border-cell-cyan bg-cell-cyan/15 text-cell-cyan" : "border-cell-teal/30 text-cell-teal/60"}`}
            >
              CHAMP
            </button>
            <button
              onClick={() => setTab("boutique")}
              className={`flex-1 rounded-lg border py-1.5 text-[11px] tracking-widest ${tab === "boutique" ? "border-cell-cyan bg-cell-cyan/15 text-cell-cyan" : "border-cell-teal/30 text-cell-teal/60"}`}
            >
              BOUTIQUE
            </button>
          </div>
        )}

        {/* Scène Canvas — toujours visible (aussi pendant la bataille) */}
        <BastionScene
          ref={sceneRef}
          armedCategory={armedCategory}
          armedRange={armedRange}
          movingTarget={moving}
          onTapSlot={handleTapSlot}
          onBattleEnd={(result, survivingStructures) => {
            finishBastionBattle(result, survivingStructures);
            setBanner(result);
            vibrate(result.won ? 40 : 25);
          }}
        />

        {(moving || armed) && !inBattle && (
          <div className="flex items-center justify-between rounded-lg border border-cell-magenta/40 bg-cell-magenta/10 px-2 py-1 text-[11px] text-cell-magenta">
            <span>{moving ? "Touche un emplacement de destination…" : "Touche un emplacement pour poser…"}</span>
            <button onClick={cancelModes} className="underline">
              annuler
            </button>
          </div>
        )}

        {!inBattle && tab === "champ" && (
          <>
            {/* Réserve de garnison (pont La Mare -> Bastion) */}
            <Panel className="space-y-2 p-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
                <span>Garnison en réserve</span>
                <span>{reserveSpecies.length}/{bastion.reserveCap}</span>
              </div>
              {reserveSpecies.length === 0 ? (
                <p className="text-[11px] text-cell-teal/50">
                  Aucune créature en réserve — assigne des cartes en 🛡️ Défense/⚔️ Assaut depuis la Mare.
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {reserveSpecies.map((id) => {
                    const sp = speciesConfig(id);
                    const entry = collection[id];
                    if (!sp || !entry) return null;
                    const rar = rarityConfig(entry.bestRarity);
                    const armedHere = armed?.type === "creature" && armed.speciesId === id;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setMoving(null);
                          setArmed(armedHere ? null : { type: "creature", speciesId: id, role: sp.role === "assaut" ? "assaut" : "defense" });
                        }}
                        className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg p-1 ${armedHere ? "bg-cell-cyan/20 ring-2 ring-cell-cyan" : ""}`}
                      >
                        <CardFrame rarity={rar.id as Rarity} scale={0.55}>
                          <img src={cardArt(id)} alt={sp.name} className="pixelated h-full w-full object-contain" draggable={false} />
                        </CardFrame>
                        <span className="max-w-[60px] truncate text-[9px] text-cell-cyan">{sp.name}</span>
                        <span className="text-[9px] text-cell-teal/60">{sp.role === "assaut" ? "💣 mortier" : "⛺ barracks"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* Réserve de bâtiments (tourelles/murs/pièges/support) */}
            <Panel className="space-y-2 p-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">
                <span>Réserve de bâtiments</span>
                <span>{bastion.buildingReserve.length}</span>
              </div>
              {bastion.buildingReserve.length === 0 ? (
                <p className="text-[11px] text-cell-teal/50">Aucun bâtiment en réserve — recrute-en un en Boutique.</p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {bastion.buildingReserve.map((inst) => {
                    const def = buildingDef(inst.defId);
                    if (!def) return null;
                    const armedHere = armed?.type === "building" && armed.uid === inst.uid;
                    return (
                      <div key={inst.uid} className="flex shrink-0 flex-col items-center gap-0.5">
                        <button
                          onClick={() => {
                            setMoving(null);
                            setArmed(
                              armedHere
                                ? null
                                : { type: "building", uid: inst.uid, defId: inst.defId, category: def.category === "wall" || def.category === "trap" ? def.category : def.category === "support" ? "support" : "turret" },
                            );
                          }}
                          className={`flex h-14 w-14 flex-col items-center justify-center rounded-lg border-2 text-lg ${armedHere ? "ring-2 ring-cell-cyan" : ""}`}
                          style={{ borderColor: buildingRarityColor(def.rarity) }}
                          title={def.desc}
                        >
                          {buildingIcon(def.id)}
                        </button>
                        <span className="max-w-[60px] truncate text-center text-[9px] text-cell-cyan">{def.name}</span>
                        {def.category === "support" ? (
                          <button
                            onClick={() => {
                              const idx = bastion.support.findIndex((s) => !s);
                              if (idx >= 0) placeBastionBuilding(inst.uid, "support", { supportIndex: idx });
                            }}
                            className="text-[9px] text-cell-lime underline"
                          >
                            placer support
                          </button>
                        ) : null}
                        <button onClick={() => recycleBastionBuilding(inst.uid)} className="text-[9px] text-cell-teal/50 underline">
                          recycler
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <PixelButton
                className="w-full text-[11px]"
                disabled={(resources.combat ?? 0) < recruitBuildingCost(ownedBuildingCount(bastion))}
                onClick={() => recruitBastionBuilding() && vibrate(20)}
              >
                🎲 RECRUTER — <CombatCost amount={recruitBuildingCost(ownedBuildingCount(bastion))} have={resources.combat ?? 0} />
              </PixelButton>
            </Panel>

            {/* Emplacements de support (3, hors canvas) */}
            <Panel className="space-y-2 p-2">
              <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Support ({bastion.support.filter((s) => s).length}/{bastion.support.length})</div>
              <div className="flex gap-2">
                {bastion.support.map((s, i) => {
                  const def = s ? buildingDef(s.occupant) : null;
                  return (
                    <div key={i} className="flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-cell-teal/25 text-center">
                      {def ? (
                        <>
                          <span className="text-lg">{buildingIcon(def.id)}</span>
                          <span className="max-w-[70px] truncate text-[9px] text-cell-cyan">{def.name}</span>
                          <button onClick={() => removeBastionSupportToReserve(i)} className="text-[8px] text-cell-teal/50 underline">
                            retirer
                          </button>
                        </>
                      ) : (
                        <span className="text-[9px] text-cell-teal/40">vide</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </>
        )}

        {!inBattle && tab === "boutique" && (
          <Panel className="space-y-3 p-3">
            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Emplacements</div>
            {(["turret", "barracks", "mortar"] as const).map((kind) => {
              const unlocked = kind === "turret" ? bastion.turretSlotsUnlocked : kind === "barracks" ? bastion.barracksSlotsUnlocked : bastion.mortarSlotsUnlocked;
              const total = kind === "turret" ? BASTION.slots.turret_total : kind === "barracks" ? BASTION.slots.barracks_total : BASTION.slots.mortar_total;
              const cost = kind === "turret" ? turretSlotUnlockCost(unlocked + 1) : kind === "barracks" ? barracksSlotUnlockCost(unlocked + 1) : mortarSlotUnlockCost(unlocked);
              const label = kind === "turret" ? "🗼 Tourelles (avant-postes inclus)" : kind === "barracks" ? "⛺ Barracks" : "💣 Mortiers";
              const maxed = unlocked >= total;
              return (
                <div key={kind} className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
                  <div>
                    <div className="text-[11px] text-cell-cyan">{label}</div>
                    <div className="text-[10px] text-cell-teal/60">{unlocked}/{total} débloqués</div>
                  </div>
                  {maxed ? (
                    <span className="text-[10px] text-cell-magenta">MAX</span>
                  ) : (
                    <PixelButton
                      className="text-[10px]"
                      disabled={(resources.combat ?? 0) < cost}
                      onClick={() => buyBastionSlotUnlock(kind) && vibrate(20)}
                    >
                      DÉBLOQUER — <CombatCost amount={cost} have={resources.combat ?? 0} />
                    </PixelButton>
                  )}
                </div>
              );
            })}

            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Améliorations</div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
              <div>
                <div className="text-[11px] text-cell-cyan">📦 Réserve de garnison</div>
                <div className="text-[10px] text-cell-teal/60">{bastion.reserveCap}/{BASTION.reserve.max_cap}</div>
              </div>
              {bastion.reserveCap >= BASTION.reserve.max_cap ? (
                <span className="text-[10px] text-cell-magenta">MAX</span>
              ) : (
                <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < reserveCapCost(bastion.reserveCap)} onClick={() => buyBastionReserveCap() && vibrate(20)}>
                  +1 — <CombatCost amount={reserveCapCost(bastion.reserveCap)} have={resources.combat ?? 0} />
                </PixelButton>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
              <div>
                <div className="text-[11px] text-cell-cyan">🌳 Spécialisation avancée</div>
                <div className="text-[10px] text-cell-teal/60">Plafond {bastion.maxTreeLevel}/{BASTION.tree_cap.max_level}</div>
              </div>
              {bastion.maxTreeLevel >= BASTION.tree_cap.max_level ? (
                <span className="text-[10px] text-cell-magenta">MAX</span>
              ) : (
                <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < specCapCost(bastion.maxTreeLevel)} onClick={() => buyBastionSpecCap() && vibrate(20)}>
                  +1 — <CombatCost amount={specCapCost(bastion.maxTreeLevel)} have={resources.combat ?? 0} />
                </PixelButton>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
              <div>
                <div className="text-[11px] text-cell-cyan">🧬 Fondations renforcées</div>
                <div className="text-[10px] text-cell-teal/60">
                  Niv {bastion.slotBonusLevel}/{BASTION.foundations.max_level} · +{Math.round((foundationsMult(bastion.slotBonusLevel) - 1) * 100)}% PV/dégâts (garnison entière)
                </div>
              </div>
              {bastion.slotBonusLevel >= BASTION.foundations.max_level ? (
                <span className="text-[10px] text-cell-magenta">MAX</span>
              ) : (
                <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < foundationsCost(bastion.slotBonusLevel)} onClick={() => buyBastionFoundations() && vibrate(20)}>
                  +1 — <CombatCost amount={foundationsCost(bastion.slotBonusLevel)} have={resources.combat ?? 0} />
                </PixelButton>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
              <div>
                <div className="text-[11px] text-cell-cyan">🔭 Vigie</div>
                <div className="text-[10px] text-cell-teal/60">
                  Niv {bastion.scoutLevel}/{BASTION.scouting.max_level} · {SCOUT_LEVEL_LABEL[bastion.scoutLevel] ?? SCOUT_LEVEL_LABEL[0]}
                </div>
              </div>
              {bastion.scoutLevel >= BASTION.scouting.max_level ? (
                <span className="text-[10px] text-cell-magenta">MAX</span>
              ) : (
                <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < scoutCost(bastion.scoutLevel)} onClick={() => buyBastionScouting() && vibrate(20)}>
                  +1 — <CombatCost amount={scoutCost(bastion.scoutLevel)} have={resources.combat ?? 0} />
                </PixelButton>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 p-2">
              <div>
                <div className="text-[11px] text-cell-cyan">💫 Renforts en combat</div>
                <div className="text-[10px] text-cell-teal/60">Une troupe tombée revient après un court délai</div>
              </div>
              {bastion.inWaveRespawnUnlocked ? (
                <span className="text-[10px] text-cell-lime">ACQUIS</span>
              ) : (
                <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < BASTION.in_wave_respawn.cost} onClick={() => buyBastionInWaveRespawn() && vibrate(20)}>
                  DÉBLOQUER — <CombatCost amount={BASTION.in_wave_respawn.cost} have={resources.combat ?? 0} />
                </PixelButton>
              )}
            </div>

            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Catalogue (tirage pondéré à l&apos;aveugle)</div>
            <div className="grid grid-cols-2 gap-2">
              {(["turret", "wall", "trap", "support"] as const).flatMap((cat) => buildingsByCategory(cat)).map((def) => (
                <div key={def.id} className="rounded-lg border p-1.5 text-center" style={{ borderColor: buildingRarityColor(def.rarity) }}>
                  <div className="text-lg">{buildingIcon(def.id)}</div>
                  <div className="text-[9px] text-cell-cyan">{def.name}</div>
                  <div className="text-[8px]" style={{ color: buildingRarityColor(def.rarity) }}>
                    {RARITY_LABEL[def.rarity as Rarity] ?? def.rarity}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Inspecteur de slot (bottom sheet léger) */}
        {inspect && !inBattle && (
          <SlotInspector
            target={inspect}
            onClose={() => setInspect(null)}
            onMove={(kind, id) => {
              setInspect(null);
              setArmed(null);
              setMoving({ kind, id });
            }}
            onRemoveCreature={(kind, slotId) => {
              removeBastionCreature(kind, slotId);
              setInspect(null);
            }}
            onRemoveTurret={(slotId) => {
              removeBastionTurretToReserve(slotId);
              setInspect(null);
            }}
            onRemoveStructure={(uid) => {
              removeBastionStructureToReserve(uid);
              setInspect(null);
            }}
            onChooseTree={(slotId, choice) => chooseBastionTreeOption(slotId, choice)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Inspecteur de slot (tooltip simplifié en bottom sheet mobile) ---------- */

function SlotInspector({
  target,
  onClose,
  onMove,
  onRemoveCreature,
  onRemoveTurret,
  onRemoveStructure,
  onChooseTree,
}: {
  target: BastionSlotTarget;
  onClose: () => void;
  onMove: (kind: "turret" | "barracks" | "mortar", id: string) => void;
  onRemoveCreature: (kind: "barracks" | "mortar", slotId: string) => void;
  onRemoveTurret: (slotId: string) => void;
  onRemoveStructure: (uid: number) => void;
  onChooseTree: (slotId: string, choice: "a" | "b") => boolean;
}) {
  const bastion = useGame((s) => s.bastion);
  const collection = useGame((s) => s.collection);

  let body: React.ReactNode = null;
  if (target.kind === "barracks" || target.kind === "mortar") {
    const slot = (target.kind === "barracks" ? bastion.barracksSlots : bastion.mortarSlots).find((s) => s.id === target.slotId);
    if (!slot?.occupant) return null;
    const sp = speciesConfig(slot.occupant);
    const entry = collection[slot.occupant];
    if (!sp || !entry) return null;
    const treeSlot = target.kind === "barracks" ? bastion.barracksSlots.find((s) => s.id === target.slotId) : null;
    const nextTier = treeSlot && treeSlot.treeLevel < bastion.maxTreeLevel ? BASTION.barracks_tree[treeSlot.treeLevel] : null;
    body = (
      <>
        <div className="flex items-center gap-3">
          <img src={cardArt(slot.occupant)} alt={sp.name} className="pixelated h-14 w-14 rounded object-contain" draggable={false} />
          <div>
            <div className="text-sm text-cell-cyan">{sp.name}</div>
            <div className="text-[10px] text-cell-teal/60">
              ❤{cardHp(slot.occupant, entry)} · 🛡{cardPowerDef(slot.occupant, entry)} · ⚔{cardPowerAtk(slot.occupant, entry)}
            </div>
            {treeSlot && treeSlot.treeLevel > 0 && (
              <div className="text-[10px] text-cell-magenta">
                ★ Palier {treeSlot.treeLevel} : {treeSlot.treePath.map((c, i) => BASTION.barracks_tree[i][c].name).join(" → ")}
              </div>
            )}
          </div>
        </div>
        {nextTier && (
          <div className="space-y-1 pt-1">
            <div className="text-[10px] uppercase tracking-[0.2em] text-cell-teal/50">Prochain palier</div>
            <div className="flex gap-2">
              {(["a", "b"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => onChooseTree(target.slotId, c) && vibrate(20)}
                  className="flex-1 rounded-lg border border-cell-cyan/30 p-1.5 text-left text-[10px] text-cell-teal/80 hover:border-cell-cyan"
                >
                  <div className="text-cell-cyan">{nextTier[c].name}</div>
                  <div className="text-[9px] text-cell-teal/60">{nextTier[c].desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <PixelButton className="flex-1 text-[10px]" onClick={() => onMove(target.kind, target.slotId)}>
            DÉPLACER
          </PixelButton>
          <PixelButton className="flex-1 text-[10px]" onClick={() => onRemoveCreature(target.kind, target.slotId)}>
            RETIRER
          </PixelButton>
        </div>
      </>
    );
  } else if (target.kind === "turret") {
    const slot = bastion.turretSlots.find((s) => s.id === target.slotId);
    if (!slot?.occupant) return null;
    const def = buildingDef(slot.occupant);
    if (!def) return null;
    body = (
      <>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 text-2xl" style={{ borderColor: buildingRarityColor(def.rarity) }}>
            {buildingIcon(def.id)}
          </div>
          <div>
            <div className="text-sm text-cell-cyan">{def.name}</div>
            <div className="text-[10px] text-cell-teal/60">{def.desc}</div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <PixelButton className="flex-1 text-[10px]" onClick={() => onMove("turret", target.slotId)}>
            DÉPLACER
          </PixelButton>
          <PixelButton className="flex-1 text-[10px]" onClick={() => onRemoveTurret(target.slotId)}>
            RETIRER
          </PixelButton>
        </div>
      </>
    );
  } else if (target.kind === "structure") {
    const s = bastion.fieldStructures.find((f) => f.uid === target.uid);
    if (!s) return null;
    const def = buildingDef(s.occupant);
    if (!def) return null;
    body = (
      <>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 text-2xl" style={{ borderColor: buildingRarityColor(def.rarity) }}>
            {buildingIcon(def.id)}
          </div>
          <div>
            <div className="text-sm text-cell-cyan">{def.name}</div>
            <div className="text-[10px] text-cell-teal/60">
              PV {Math.round(s.hp)}/{s.hpMax} · {def.desc}
            </div>
          </div>
        </div>
        <PixelButton className="w-full text-[10px]" onClick={() => onRemoveStructure(s.uid)}>
          RETIRER
        </PixelButton>
      </>
    );
  } else {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      {/* pb-16 (au lieu de pb-2) : ce bloc est imbriqué dans le conteneur racine z-30 de
          BastionPanel, qui forme son propre contexte d'empilement — le z-50 local ne le fait
          donc PAS passer au-dessus de la nav basse fixe (z-40) du contexte parent. On garantit
          plutôt l'absence de chevauchement géométrique avec la nav, comme le reste du panneau
          (cf. pb-24 sur le conteneur scrollable de BastionPanel) et comme BuildingSheet.tsx. */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-2 pb-16 sm:max-w-lg">
        <Panel variant="noyau" className="space-y-2 p-3" style={{ background: "rgba(5, 11, 20, 0.97)" }}>
          {body}
        </Panel>
      </div>
    </>
  );
}
