/* Overlay plein écran du Bastion-Défense jouable (intégration profonde) — même pattern que
   NoyauHub.tsx/MarePanel.tsx. Réservoir de garnison (pont La Mare -> Bastion), réservoir de
   bâtiments (tirage payé en monnaie de combat), Boutique (emplacements/plafonds/fondations),
   scène Canvas (BastionScene), et le combat en direct d'une vague. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { CardFrame, Panel, PixelButton, RARITY_LABEL, type Rarity } from "@/components/ui/Pixel";
import {
  cardArt,
  cardHp,
  cardPowerAtk,
  cardPowerDef,
  rarityConfig,
  slotsUsed,
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
  effectiveReserveCap,
  foundationsCost,
  foundationsMult,
  hasGarrison,
  mortarSlotUnlockCost,
  recruitBuildingCost,
  recruitRarityRates,
  recruitsUntilPity,
  reserveCapCost,
  scoutCost,
  specCapCost,
  turretSlotUnlockCost,
  WAVE_LEAD_WINDOW_MS,
} from "@/lib/game/bastion/config";
import { previewWave } from "@/lib/game/bastion/engine";
import {
  maxPeril,
  perilDef,
  PREPARATIFS,
  sortieAvailability,
  sortieLootMult,
  sortieModifier,
} from "@/lib/game/bastion/sorties";
import type { BastionSceneHandle } from "./BastionScene";
import { BastionScene } from "./BastionScene";
import type { BastionSlotTarget, LiveWaveResult, SortieModifier } from "@/lib/game/bastion/types";
import { bilanOptionDef } from "@/lib/game/habits";
import {
  assaultPalier,
  bonusValue,
  foyerDef,
  natureDef,
  sectorOfFoyer,
  sectorUnlocked,
  TERRITOIRE_ANTRES,
} from "@/lib/game/territoire";
import { estimatedWavePower } from "@/lib/game/military";
import { fmtDuration, fmtInt } from "@/lib/game/format";
import { useOverlay } from "@/lib/overlay";
import { useGame } from "@/lib/game/store";
import { vibrate } from "@/lib/prefs";
import { playCue } from "@/lib/audio";

/** Ce que chaque niveau de Vigie dévoile (index = bastion.scoutLevel). */
const SCOUT_LEVEL_LABEL: string[] = [
  "aucun renseignement",
  "effectif total + présence d'un boss",
  "+ espèces présentes",
  "+ effectif et stats par espèce",
];

/** Aperçu de la vague suivante — exact (genLiveWave est déterministe par numéro de vague),
 *  mais dévoilé par paliers selon le niveau de Vigie acheté en Boutique.
 *
 *  `mod` porte le durcissement d'une sortie (Péril + Préparatifs). On le passe pour que le
 *  joueur voie le PRIX de son pari avant de le prendre, jamais après : monter le Péril doit
 *  gonfler les PV et les boss sous ses yeux, à côté du butin qu'il achète.
 *
 *  Volontairement pas de `useMemo` : `mod` est reconstruit à chaque rendu, mémoriser sur son
 *  identité ne servirait donc jamais, et mémoriser sur ses champs demanderait de désactiver
 *  la règle des dépendances. `previewWave` n'agrège qu'une file de quelques dizaines
 *  d'apparitions — c'est moins cher que la comparaison. */
function WavePreview({ waveN, level, mod }: { waveN: number; level: number; mod?: SortieModifier }) {
  const preview = previewWave(waveN, mod);
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
              {preview.boss.count > 1 && ` ×${preview.boss.count}`}
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

/** La phrase de menace de la vague PLANIFIÉE — le Boss Blind de Balatro : la règle
 *  est annoncée AVANT, le joueur prépare au lieu de subir. Composée depuis l'aperçu
 *  exact (previewWave est déterministe), jamais inventée. */
function threatText(preview: ReturnType<typeof previewWave>): string {
  const parts: string[] = [];
  if (preview.boss) {
    parts.push(
      preview.boss.count > 1
        ? `${preview.boss.count} ${preview.boss.name} mènent la vague`
        : `un ${preview.boss.name} mène la vague`,
    );
  }
  const ranged = preview.types.filter((t) => t.ranged);
  if (ranged.length > 0) {
    parts.push(
      `${ranged.map((t) => t.name).join(" et ")} tirent à distance — tes troupes devront aller les chercher`,
    );
  }
  const swarm = preview.types[0];
  if (!preview.boss && ranged.length === 0 && swarm) {
    parts.push(`${swarm.count} ${swarm.name} en tête — du nombre plus que du blindage`);
  }
  if (parts.length === 0) return "";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

type ArmedItem =
  | { type: "creature"; speciesId: string; role: "defense" | "assaut" }
  | { type: "building"; uid: number; defId: string; category: "turret" | "support" | "wall" | "trap" };

type MovingItem = { kind: "turret" | "barracks" | "mortar"; id: string };

/** Écran de fin de bataille. Le titre et le détail sont repris tels quels du rapport que
 *  la résolution vient de pousser dans le journal : une seule formulation du butin, écrite
 *  une seule fois côté logique, plutôt qu'une version d'écran qui dériverait de l'autre. */
type BattleBanner = { result: LiveWaveResult; title: string; lines: string[] };

function CombatCost({ amount, have }: { amount: number; have: number }) {
  const ok = have >= amount;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${ok ? "text-cell-lime" : "text-red-400"}`}>
      <img src="/assets/resources/combat.png" alt="" width={14} height={14} className="pixelated" draggable={false} />
      {fmtInt(amount)}
    </span>
  );
}

export function BastionPanel({
  onClose,
  initialTargetId = null,
}: {
  onClose: () => void;
  /** Foyer choisi sur la carte de La Dérive (`onAssault`) — présélectionne la cible de la
   *  sortie. `null` = sortie contre le Bastion lui-même (défense libre). */
  initialTargetId?: string | null;
}) {
  const sceneRef = useRef<BastionSceneHandle>(null);
  /** Nature de la bataille en cours : une sortie et une vague planifiée se résolvent par
   *  deux fonctions différentes (`finishSortie` / `finishBastionBattle`), et rien dans
   *  l'état persisté ne les distingue — une sortie contre le Bastion a elle aussi
   *  `sortieTargetId === null`. On mémorise donc le chemin emprunté au lancement.
   *  Une ref, et non un état : `onBattleEnd` est un rappel, pas un rendu. */
  const flightRef = useRef<"vague" | "sortie" | null>(null);

  const bastion = useGame((s) => s.bastion);
  const resources = useGame((s) => s.resources);
  const collection = useGame((s) => s.collection);
  const cardAssignments = useGame((s) => s.cardAssignments);
  const territoire = useGame((s) => s.territoire);
  const percees = useGame((s) => s.bilan.percees);
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
  const beginSortie = useGame((s) => s.beginSortie);
  const finishSortie = useGame((s) => s.finishSortie);

  const [tab, setTab] = useState<"champ" | "boutique">("champ");
  const [armed, setArmed] = useState<ArmedItem | null>(null);
  const [moving, setMoving] = useState<MovingItem | null>(null);
  const [inspect, setInspect] = useState<BastionSlotTarget | null>(null);
  const [snapshot, setSnapshot] = useState<ReturnType<NonNullable<typeof sceneRef.current>["getBattleSnapshot"]> | null>(null);
  const [banner, setBanner] = useState<BattleBanner | null>(null);

  /* Paramètres de la sortie en préparation (jamais persistés : tant qu'on n'a pas lancé,
     rien n'est engagé — ni énergie, ni quota, ni Percée). */
  const [targetId, setTargetId] = useState<string | null>(initialTargetId);
  const [peril, setPeril] = useState(0);
  const [preparatifIds, setPreparatifIds] = useState<string[]>([]);
  const [wantPercee, setWantPercee] = useState(false);

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
  /* Le garde-fou n°6 : AUCUNE bataille ne se lance terrain vide. Sans lui, une partie
     neuve pouvait ouvrir le tower-defense avec strictement rien à poser — face à 4
     pathogènes, boutique payable dans une monnaie qu'on n'obtient qu'en gagnant. */
  const garrisonOk = hasGarrison(bastion);
  const canPlayLive =
    nextAttackAt > 0 && waveIn <= WAVE_LEAD_WINDOW_MS && garrisonOk && !inBattle && !banner;

  /* ---------- Sortie en préparation ---------- */
  const targetFoyer = targetId ? foyerDef(targetId) : null;
  const targetNature = targetFoyer ? natureDef(targetFoyer.nature) : null;
  // Un antre ne s'ouvre qu'avec une Percée : la cible impose alors l'option, il n'y a pas
  // de choix à faire. Ailleurs, la Vague de Percée est un pari facultatif du joueur.
  const forcedPerceeId = targetNature?.requires_percee ? "assaut_antre" : null;
  const perceeOptionId = forcedPerceeId ?? (wantPercee ? "vague_percee" : null);
  const perceeOpt = perceeOptionId ? bilanOptionDef(perceeOptionId) : undefined;
  const perceeOk = !perceeOpt || percees >= perceeOpt.cost;
  // Le Péril choisi ne peut pas descendre sous celui qu'impose la Percée dépensée —
  // même formule que `store.beginSortie`, pour que l'aperçu ne mente jamais.
  const perilTop = maxPeril(bastion.bestPeril);
  const effPeril = Math.max(0, Math.min(perilTop, Math.max(peril, perceeOpt?.forced_peril ?? 0)));
  const perilInfo = perilDef(effPeril);
  // Les crans écrits à la main, puis ceux que le joueur a ouverts en gagnant. `perilDef`
  // les fabrique au-delà du dernier nommé : la liste n'a donc pas de fin, seulement un
  // bout visible qui recule d'un cran à chaque victoire.
  const perilLadder = Array.from({ length: perilTop + 1 }, (_, i) => perilDef(i));
  // Palier assailli, calculé UNE FOIS ici et transmis tel quel au moteur : `resolveSortie`
  // le relit sur `result.waveN` et n'y réapplique aucun décalage.
  const sortiePalier =
    (targetFoyer ? assaultPalier(targetFoyer, waveCount, territoire) : waveCount + 1) +
    (perceeOpt?.palier_bonus ?? 0);
  const sortieMod = sortieModifier(effPeril, preparatifIds);
  const antreMult = targetFoyer?.nature === "antre" ? TERRITOIRE_ANTRES.loot_mult : 1;
  const lootMult =
    sortieLootMult(
      effPeril,
      preparatifIds,
      bonusValue(territoire, "combat_mult"),
      perceeOpt?.loot_mult ?? 1,
    ) * antreMult;
  const avail = sortieAvailability(
    bastion,
    resources.energie,
    now,
    preparatifIds,
    bonusValue(territoire, "free_sortie"),
  );
  /* Un foyer déjà pris reste une cible valable (étape D) : on le reprend à un palier
     relevé. La seule condition qui subsiste est l'ouverture de son secteur. */
  const targetReachable =
    !targetFoyer || sectorUnlocked(sectorOfFoyer(targetFoyer.id)!, waveCount);
  const canLaunchSortie =
    avail.ok && perceeOk && targetReachable && garrisonOk && !inBattle && !banner;

  function togglePreparatif(id: string) {
    setPreparatifIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-2xl">
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

        {/* Bannière de fin de bataille. La CHAÎNE DE CALCUL s'anime ligne par ligne
            (n°9, la mécanique la plus copiable de Balatro) : chaque gain apparaît à
            son tour au lieu d'un total déjà calculé — la causalité devient visible.
            Les lignes de butin (+…) sont soulignées en couleur au passage. */}
        {banner && (
          <Panel
            variant="tooltip"
            className="space-y-1 p-2 text-center"
            style={{ background: banner.result.won ? "rgba(10,40,20,0.9)" : "rgba(40,10,15,0.9)" }}
          >
            <p className={`animate-line-reveal text-sm ${banner.result.won ? "text-cell-lime" : "text-red-400"}`}>
              {banner.title}
            </p>
            {banner.lines.map((line, i) => (
              <p
                key={i}
                className={`animate-line-reveal text-[11px] ${
                  line.startsWith("+")
                    ? "text-cell-lime"
                    : line.startsWith("−")
                      ? "text-red-400/90"
                      : "text-cell-teal/70"
                }`}
                style={{ animationDelay: `${0.25 + i * 0.35}s` }}
              >
                {line}
              </p>
            ))}
            <div
              className="animate-line-reveal"
              style={{ animationDelay: `${0.25 + banner.lines.length * 0.35}s` }}
            >
              <PixelButton className="text-xs" onClick={() => setBanner(null)}>
                CONTINUER
              </PixelButton>
            </div>
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
        {/* Vague PLANIFIÉE — le chemin historique, inchangé : c'est la vague subie, celle qui
            fait avancer le calendrier et que l'auto-résolution reprendra si on l'ignore.
            Jouable en avance dans la fenêtre WAVE_LEAD_WINDOW_MS, jamais avant. */}
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
                  flightRef.current = "vague";
                  beginBastionBattle();
                  playCue("wave_start");
                  sceneRef.current?.startBattle(waveCount + 1);
                }}
              >
                ⚔️ DÉFENDRE
              </PixelButton>
            </div>
            {/* Le Boss Blind (n°7) : la vague SUBIE annonce sa règle avant qu'on
                s'engage. La phrase et l'aperçu viennent de previewWave — exact,
                jamais indicatif. La Vigie garde ses niveaux 2-3 (espèces, stats)
                et tout l'aperçu des sorties : ici, seul le minimum vital est
                offert (cf. bastion_config.json -> $comment_preview_free). */}
            {(() => {
              const preview = previewWave(waveCount + 1);
              const threat = threatText(preview);
              return threat ? (
                <p className="text-[10px] leading-4 text-amber-300">⚠ {threat}</p>
              ) : null;
            })()}
            {/* « Appeler la vague en avance » (n°7) : la décision TD la plus simple —
                de la sécurité contre de la récompense, affichée AVANT le pari. */}
            {canPlayLive && waveIn >= BASTION.wave.early_call.min_lead_h * 3_600_000 && (
              <p className="text-[10px] leading-4 text-cell-lime">
                ⚡ Vague appelée en avance : butin ×{BASTION.wave.early_call.reward_mult} si tu la
                joues maintenant, plutôt que d&apos;attendre son échéance.
              </p>
            )}
            <WavePreview
              waveN={waveCount + 1}
              level={Math.max(BASTION.wave.preview_free_level, bastion.scoutLevel)}
            />
            {!canPlayLive && (
              <p className="text-[10px] text-cell-teal/60">
                {!garrisonOk
                  ? "Terrain vide : pose au moins une défense (ta réserve contient une tourelle de départ) avant d'affronter la vague."
                  : `Les pathogènes ne sont pas encore en approche : une vague se joue jusqu'à ${Math.round(WAVE_LEAD_WINDOW_MS / 3_600_000)} h à l'avance. Fenêtre ouverte dans ${fmtDuration(Math.max(0, waveIn - WAVE_LEAD_WINDOW_MS))}.`}
              </p>
            )}
          </Panel>
        )}

        {/* LANCEUR DE SORTIE — la bataille à la demande. Aucune attente : ce qui la freine,
            c'est le quota du jour puis l'énergie, donc les habitudes réellement tenues.
            Tout se décide ici, en un écran : la cible, le Péril, les Préparatifs, la Percée. */}
        {!banner && !inBattle && (
          <Panel variant="tooltip" className="space-y-2 p-2" style={{ background: "rgba(6,22,32,0.9)" }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.25em] text-cell-cyan">Sortie</span>
              <span className="text-[10px] text-cell-teal/60">
                {avail.freeLeft > 0
                  ? `${avail.freeLeft} gratuite${avail.freeLeft > 1 ? "s" : ""} aujourd'hui`
                  : `${avail.used}/${avail.maxPerDay} aujourd'hui`}
              </span>
            </div>

            {/* Cible */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cell-teal/20 bg-black/30 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[11px]" style={{ color: targetNature?.color ?? "#7fe7d8" }}>
                  {targetNature?.icon ?? "🛡️"} {targetFoyer ? targetFoyer.name : "Bastion — défense libre"}
                </p>
                <p className="text-[10px] text-cell-teal/60">
                  palier {sortiePalier}
                  {targetNature ? ` · ${targetNature.name}` : " · aucun butin de foyer"}
                  {antreMult > 1 ? ` · butin d'antre ×${antreMult}` : ""}
                </p>
              </div>
              {targetFoyer && (
                <button
                  onClick={() => setTargetId(null)}
                  className="shrink-0 text-[10px] text-cell-teal/60 underline"
                >
                  viser le Bastion
                </button>
              )}
            </div>
            {!targetReachable && (
              <p className="text-[10px] text-red-400">
                Ce foyer n&apos;est plus assaillissable (déjà capturé, ou secteur refermé).
              </p>
            )}

            {/* Péril */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-cell-teal/50">Péril</p>
              {/* L'échelle affichée s'arrête toujours UN CRAN au-dessus du meilleur
                  franchi (cf. maxPeril) : au-delà de « Cataclysmique », les barreaux sont
                  déduits, pas écrits, et il y en a toujours un de plus. Le joueur ne voit
                  donc jamais le dernier — sans que rien ne l'oblige à monter, puisque
                  perdre une sortie ne coûte rien. */}
              <div className="flex flex-wrap gap-1">
                {perilLadder.map((p) => {
                  const locked = p.id < (perceeOpt?.forced_peril ?? 0);
                  const active = p.id === effPeril;
                  return (
                    <button
                      key={p.id}
                      disabled={locked}
                      onClick={() => setPeril(p.id)}
                      className={`rounded border px-2 py-1 text-[10px] transition active:translate-y-px ${
                        active
                          ? "border-cell-magenta bg-cell-magenta/20 text-cell-magenta"
                          : locked
                            ? "border-cell-teal/15 text-cell-teal/30"
                            : "border-cell-teal/30 text-cell-teal/70"
                      }`}
                    >
                      {p.name} ×{p.loot_mult}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-cell-teal/60">
                Ennemis PV ×{perilInfo.hp_mult} · dégâts ×{perilInfo.dmg_mult}
                {perilInfo.extra_bosses > 0 ? ` · +${perilInfo.extra_bosses} boss` : ""}
              </p>
            </div>

            {/* Préparatifs */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-cell-teal/50">
                Préparatifs (payés en énergie)
              </p>
              <div className="grid gap-1">
                {PREPARATIFS.map((p) => {
                  const on = preparatifIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePreparatif(p.id)}
                      className={`flex items-center gap-2 rounded border px-2 py-1 text-left transition active:translate-y-px ${
                        on
                          ? "border-cell-lime bg-cell-lime/10 text-cell-lime"
                          : "border-cell-teal/25 text-cell-teal/70"
                      }`}
                    >
                      <span className="text-sm leading-none">{p.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px]">{p.name}</span>
                        <span className="block text-[10px] opacity-70">{p.desc}</span>
                      </span>
                      <span className="shrink-0 text-[10px]">⚡{p.cost_energie}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Percée */}
            {forcedPerceeId ? (
              <p className={`text-[10px] ${perceeOk ? "text-cell-magenta" : "text-red-400"}`}>
                ☠ Un antre exige une Percée — tu en as {percees}.
              </p>
            ) : (
              percees > 0 && (
                <button
                  onClick={() => setWantPercee((v) => !v)}
                  className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left transition active:translate-y-px ${
                    wantPercee
                      ? "border-cell-magenta bg-cell-magenta/15 text-cell-magenta"
                      : "border-cell-teal/25 text-cell-teal/70"
                  }`}
                >
                  <span className="text-sm leading-none">⚡</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px]">Vague de Percée (1 Percée sur {percees})</span>
                    <span className="block text-[10px] opacity-70">
                      Palier +{bilanOptionDef("vague_percee")?.palier_bonus ?? 0}, Péril forcé, butin ×
                      {bilanOptionDef("vague_percee")?.loot_mult ?? 1} et{" "}
                      {bilanOptionDef("vague_percee")?.fragments ?? 0} fragments garantis.
                    </span>
                  </span>
                </button>
              )
            )}

            {/* Ce que ça coûte, ce que ça rapporte */}
            <div className="flex items-center justify-between gap-2 border-t border-cell-cyan/15 pt-2">
              <div className="text-[11px]">
                <span className={resources.energie >= avail.cost ? "text-cell-lime" : "text-red-400"}>
                  ⚡ {fmtInt(avail.cost)}
                </span>
                <span className="text-cell-teal/50"> / {fmtInt(Math.floor(resources.energie))}</span>
                <span className="text-cell-cyan"> · butin ×{lootMult.toFixed(2)}</span>
              </div>
              <PixelButton
                className="shrink-0 text-[10px]"
                disabled={!canLaunchSortie}
                onClick={() => {
                  cancelModes();
                  // Le palier est figé AVANT le lancement et transmis au moteur : c'est ce
                  // même nombre que `resolveSortie` relira sur `result.waveN`.
                  const palier = sortiePalier;
                  const mod = sortieMod;
                  if (!beginSortie(targetId, effPeril, preparatifIds, perceeOptionId ?? undefined)) return;
                  flightRef.current = "sortie";
                  setWantPercee(false);
                  setPreparatifIds([]);
                  playCue("wave_start");
                  sceneRef.current?.startBattle(palier, mod);
                }}
              >
                ⚔️ LANCER LA SORTIE
              </PixelButton>
            </div>
            {!canLaunchSortie && (
              <p className="text-[10px] text-cell-teal/60">
                {!garrisonOk
                  ? "Terrain vide : pose au moins une défense (ta réserve contient une tourelle de départ) avant de sortir."
                  : avail.reason === "quota"
                    ? `Quota du jour atteint (${avail.maxPerDay} sorties). Le compteur repart demain.`
                    : avail.reason === "energie"
                      ? `Il te manque ${fmtInt(avail.cost - Math.floor(resources.energie))} d'énergie — valide des habitudes.`
                      : avail.reason === "bataille"
                        ? "Une bataille est déjà engagée."
                        : !perceeOk
                          ? "Aucune Percée en stock : valide le Bilan du soir pour en gagner une."
                          : "Cible indisponible."}
              </p>
            )}

            <WavePreview waveN={sortiePalier} level={bastion.scoutLevel} mod={sortieMod} />
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
            // Deux résolutions incompatibles : une sortie ne touche NI au calendrier des
            // vagues NI aux pénalités de défaite, la vague planifiée fait les deux.
            const wasSortie = flightRef.current === "sortie";
            flightRef.current = null;
            if (wasSortie) finishSortie(result, survivingStructures);
            else finishBastionBattle(result, survivingStructures);
            // Le rapport que la résolution vient de pousser EST l'écran de fin : on le relit
            // plutôt que de recomposer le butin ici (une seule source de formulation).
            const report = useGame.getState().reports[0];
            setBanner({
              result,
              title:
                report?.title ??
                (result.won ? `🛡️ Vague ${result.waveN} repoussée !` : `🦠 Le Bastion a cédé`),
              lines: report?.lines ?? [],
            });
            vibrate(result.won ? 40 : 25);
            playCue(result.won ? "victory" : "defeat");
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
                {/* Le plafond porte sur TOUTE la réserve (placées comprises) et se compte
                    en PLACES : une négative n'en occupe aucune (cards.slotCost), donc le
                    nombre de têtes peut dépasser le plafond sans que rien ne déborde. */}
                <span>
                  {slotsUsed(cardAssignments.defense, collection)}/{effectiveReserveCap(useGame.getState())}
                  {" · "}
                  {reserveSpecies.length} libre{reserveSpecies.length > 1 ? "s" : ""}
                </span>
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
              {/* Les probabilités honnêtes (n°9) : les taux exacts, dérivés de la même
                  table que le tirage (jamais recopiés), et la pitié AFFICHÉE — une
                  garantie invisible ne rassure personne. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {recruitRarityRates().map((r) => (
                  <span key={r.id} className="text-[9px]" style={{ color: buildingRarityColor(r.id) }}>
                    {RARITY_LABEL[r.id as Rarity] ?? r.id} {r.pct} %
                  </span>
                ))}
              </div>
              <p className="text-[9px] text-cell-teal/55">
                🎯 Mythique garanti dans {recruitsUntilPity(bastion)} tirage
                {recruitsUntilPity(bastion) > 1 ? "s" : ""} au plus tard.
              </p>
            </Panel>

            {/* Emplacements de support (3, hors canvas) */}
            <Panel className="space-y-2 p-2">
              <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Support ({bastion.support.filter((s) => s).length}/{bastion.support.length})</div>
              <div className="flex gap-2">
                {bastion.support.map((s, i) => {
                  const def = s ? buildingDef(s.occupant) : null;
                  return (
                    /* La cellule passe de h-16 a min-h-[104px] pour loger un « retirer »
                       de 44 px de haut (piste 10 : le lien faisait ~11 px, la cible
                       tactile la plus petite de tout le jeu). */
                    <div key={i} className="flex min-h-[104px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border border-cell-teal/25 p-1 text-center">
                      {def ? (
                        <>
                          <span className="text-lg">{buildingIcon(def.id)}</span>
                          <span className="max-w-[70px] truncate text-[9px] text-cell-cyan">{def.name}</span>
                          <button
                            onClick={() => removeBastionSupportToReserve(i)}
                            aria-label={`Retirer ${def.name} du support`}
                            className="tap-h w-full text-[10px] text-cell-teal/60 underline"
                          >
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
                {/* Pas de « /max » ici, et c'est le sujet : ce niveau n'en a pas.
                    Afficher un dénominateur reviendrait à annoncer au joueur la fin de
                    sa progression, exactement ce qu'on vient de retirer du jeu. */}
                <div className="text-[10px] text-cell-teal/60">
                  Niv {bastion.slotBonusLevel} · +{Math.round((foundationsMult(bastion.slotBonusLevel) - 1) * 100)}% PV/dégâts (garnison entière)
                </div>
              </div>
              <PixelButton className="text-[10px]" disabled={(resources.combat ?? 0) < foundationsCost(bastion.slotBonusLevel)} onClick={() => buyBastionFoundations() && vibrate(20)}>
                +1 — <CombatCost amount={foundationsCost(bastion.slotBonusLevel)} have={resources.combat ?? 0} />
              </PixelButton>
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

            <div className="text-[10px] uppercase tracking-[0.25em] text-cell-teal/50">Catalogue (taux affichés au recrutement)</div>
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

  /* Empile par-dessus le panneau Bastion : le retour systeme ferme d'abord
     l'inspecteur, puis le panneau (jeton d'historique par overlay). */
  useOverlay(true, onClose);

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
          (cf. pb-nav sur le conteneur scrollable de BastionPanel) et comme BuildingSheet.tsx. */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-2 pb-16 sm:max-w-lg">
        <Panel variant="noyau" className="space-y-2 p-3" style={{ background: "rgba(5, 11, 20, 0.97)" }}>
          {body}
        </Panel>
      </div>
    </>
  );
}
