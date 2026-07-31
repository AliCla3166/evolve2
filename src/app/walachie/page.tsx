/* WALACHIE — le second mode de l'application (30/07/2026).

   Clicker d'évolution à la Cell to Singularity, transposé dans l'univers de
   Walachie (exoplanète, réalisme scientifique, Walachiens à grande mâchoire
   gardiens du vivant). Complètement séparé du jeu principal : propre store,
   propre sauvegarde, propre onglet — le seul pont est la LECTURE des
   habitudes réelles (Bilan du soir, série) qui donnent des bonus ici.

   Direction artistique volontairement distincte du mode Cellule : palette
   violet #b98cff / magenta #ff5cdb / émeraude #4af6b2 sur nuit violette. */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EvolutionTree } from "@/components/game/EvolutionTree";
import { WalachieScene } from "@/components/game/WalachieScene";
import { hydrateActiveSlot } from "@/lib/game/store";
import { fmtDurationShort } from "@/lib/game/format";
import { installAudio, playCue } from "@/lib/audio";
import {
  clickValue,
  fmtSeve,
  offlineCapMs,
  habitBridge,
  metaCost,
  prodPerSec,
  renaissanceEclats,
  renaissanceReady,
  shinyAvailableIds,
} from "@/lib/game/walachie/engine";
import { eventDef, nodeDef, WMETA } from "@/lib/game/walachie/config";
import { hydrateWalachie, useWalachie } from "@/lib/game/walachie/store";
import { useGame } from "@/lib/game/store";

type SheetId = "evolution" | "pantheon" | null;
type BuyQty = 1 | 10 | "max";

export default function WalachiePage() {
  const hasHydrated = useWalachie((s) => s.hasHydrated);
  const seve = useWalachie((s) => s.seve);
  const lastTick = useWalachie((s) => s.lastTick);
  const eclats = useWalachie((s) => s.eclats);
  const cycles = useWalachie((s) => s.cycles);
  const erasUnlocked = useWalachie((s) => s.erasUnlocked);
  const nodesOwned = useWalachie((s) => s.nodes);
  const activeEvent = useWalachie((s) => s.activeEvent);
  const lastReturn = useWalachie((s) => s.lastReturn);
  const mainHydrated = useGame((s) => s.hasHydrated);

  const [sheet, setSheet] = useState<SheetId>(null);
  const [qty, setQty] = useState<BuyQty>(1);
  const [armRenaissance, setArmRenaissance] = useState(false);

  /* Hydratation des DEUX sauvegardes (la principale ne sert qu'au pont bonus),
     puis tick à la seconde — le rattrapage hors ligne est le premier tick. */
  useEffect(() => {
    hydrateActiveSlot();
    hydrateWalachie();
  }, []);
  useEffect(() => {
    if (!hasHydrated) return;
    useWalachie.getState().tick(Date.now());
    const id = window.setInterval(() => useWalachie.getState().tick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasHydrated]);

  /* Design sonore (piste 8) : monté seulement sur /play jusqu'ici — Walachie
     n'avait aucun retour audio alors que c'est le mode le plus tactile du jeu
     (refonte DA 31/07, piste Phase 2 n13). `installAudio()` pose le même
     écouteur délégué (repère de tap sur tout bouton réel) ; les gestes qui ne
     passent pas par un <button> (pulsation/créature brillante sur le canvas,
     ouverture des feuilles) ont leur propre `playCue` explicite ci-dessous. */
  useEffect(() => installAudio(), []);

  /** Ouvre/ferme une feuille (ÉVOLUTION ou PANTHÉON) avec le même repère
   *  sonore panel_open/panel_close que le mode Cellule (play/page.tsx). */
  const toggleSheet = (id: Exclude<SheetId, null>) => {
    setSheet((cur) => {
      const next = cur === id ? null : id;
      playCue(next === null ? "panel_close" : "panel_open");
      return next;
    });
  };
  const closeSheet = () => {
    setSheet(null);
    setArmRenaissance(false);
    playCue("panel_close");
  };

  /* Toutes les valeurs dérivées se calculent à l'heure du store (lastTick),
     jamais à Date.now() pendant le rendu. */
  const derived = useMemo(() => {
    if (!hasHydrated) return null;
    const s = useWalachie.getState();
    const bridge = habitBridge(mainHydrated ? useGame.getState() : null, lastTick);
    return {
      bridge,
      prod: prodPerSec(s, bridge, lastTick),
      click: clickValue(s, bridge, lastTick),
      shinyIds: shinyAvailableIds(s),
    };
    // nodesOwned/eclats/cycles participent au recalcul via leurs abonnements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, mainHydrated, lastTick, nodesOwned, seve, eclats, cycles, activeEvent]);

  if (!hasHydrated || !derived) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-walachie-bg2 text-sm text-walachie-violet">
        Walachie s&apos;éveille…
      </main>
    );
  }

  const { bridge, prod, click, shinyIds } = derived;
  const evDef = activeEvent ? eventDef(activeEvent.id) : undefined;
  const evLeft = activeEvent ? Math.max(0, activeEvent.endsAt - lastTick) : 0;

  return (
    <main className="relative h-dvh overflow-hidden bg-walachie-bg2">
      {/* L'écosystème plein écran : glisser pour explorer, taper pour pulser
          (ou taper une créature brillante pour la faire exploser en paillettes). */}
      <div className="absolute inset-0">
        <WalachieScene
          onPulse={() => {
            const gained = useWalachie.getState().doPulse(Date.now());
            playCue("walachie_pulse");
            return `+${fmtSeve(gained)}`;
          }}
          shinyIds={shinyIds}
          onTapShiny={(id) => {
            const gained = useWalachie.getState().doClaimShiny(id);
            if (gained <= 0) return null;
            playCue("collect");
            return `✦ +${fmtSeve(gained)} !`;
          }}
        />
      </div>

      {/* ---- HUD haut ---- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="pointer-events-auto rounded border border-walachie-violet/40 bg-walachie-bg2/80 px-2 py-1 text-xs text-walachie-violet"
          >
            ← EVOLVE
          </Link>
          <span className="font-pixel text-xs uppercase tracking-[0.4em] text-walachie-magenta/80">Walachie</span>
          <span className="rounded border border-walachie-violet/30 bg-walachie-bg2/80 px-2 py-1 text-[10px] text-walachie-violet/80">
            Cycle {cycles + 1}
          </span>
        </div>
        <div className="mx-auto rounded-xl border border-walachie-emeraude/30 bg-walachie-bg2/85 px-4 py-2 text-center shadow-[0_0_24px_rgba(74,246,178,0.15)]">
          <div className="text-2xl font-bold text-walachie-emeraude" style={{ textShadow: "0 0 14px rgba(74,246,178,0.5)" }}>
            {fmtSeve(seve)} <span className="text-sm font-normal text-walachie-emeraude/70">sève</span>
          </div>
          <div className="text-[11px] text-walachie-violet/80">
            {fmtSeve(prod)}/s · pulsation +{fmtSeve(click)}
          </div>
        </div>
        {/* Badges de bonus (pont habitudes + événement) */}
        <div className="mx-auto flex flex-wrap justify-center gap-1">
          {bridge.bilanDone && (
            <span className="rounded-full border border-walachie-emeraude/40 bg-walachie-bg2/80 px-2 py-0.5 text-[10px] text-walachie-emeraude">
              Bilan validé · sève ×1,5
            </span>
          )}
          {bridge.streak > 0 && (
            <span className="rounded-full border border-walachie-violet/40 bg-walachie-bg2/80 px-2 py-0.5 text-[10px] text-walachie-violet">
              Série {bridge.streak} j · +{Math.round((bridge.streakMult - 1) * 100)} %
            </span>
          )}
          {bridge.clickMult > 1 && (
            <span className="rounded-full border border-walachie-magenta/40 bg-walachie-bg2/80 px-2 py-0.5 text-[10px] text-walachie-magenta">
              Journée tenue · pulsation ×{bridge.clickMult}
            </span>
          )}
          {evDef && evLeft > 0 && (
            <span className="animate-pulse rounded-full border border-walachie-magenta/60 bg-[#2a0f2e]/90 px-2 py-0.5 text-[10px] text-walachie-magenta">
              ✦ {evDef.nom} · {fmtDurationShort(evLeft)}
            </span>
          )}
          {shinyIds.length > 0 && (
            <span className="animate-pulse rounded-full border border-[#ffe896]/70 bg-[#2a220f]/90 px-2 py-0.5 text-[10px] text-[#ffe896]">
              ✦ {shinyIds.length === 1 ? (nodeDef(shinyIds[0])?.nom ?? "Créature") : `${shinyIds.length} créatures`}{" "}
              brillante{shinyIds.length > 1 ? "s" : ""} prête{shinyIds.length > 1 ? "s" : ""} · tape-la dans
              l&apos;écosystème
            </span>
          )}
        </div>
      </div>

      {/* ---- Barre d'actions bas ---- */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          onClick={() => toggleSheet("evolution")}
          className="rounded-lg border border-walachie-emeraude/50 bg-walachie-bg2/90 px-5 py-2.5 text-xs tracking-widest text-walachie-emeraude"
        >
          ÉVOLUTION
        </button>
        <button
          onClick={() => toggleSheet("pantheon")}
          className="rounded-lg border border-walachie-magenta/50 bg-walachie-bg2/90 px-5 py-2.5 text-xs tracking-widest text-walachie-magenta"
        >
          PANTHÉON {renaissanceReady(useWalachie.getState()) ? "✦" : ""}
        </button>
      </div>

      {/* ---- Feuille ÉVOLUTION ---- */}
      {sheet === "evolution" && (
        <div className="absolute inset-x-0 bottom-0 top-[38%] flex flex-col rounded-t-2xl border-t border-walachie-emeraude/30 bg-walachie-bg/97 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="font-pixel text-xs uppercase tracking-widest text-walachie-emeraude">Arbre de l&apos;évolution</span>
            <div className="flex items-center gap-1">
              {([1, 10, "max"] as BuyQty[]).map((q) => (
                <button
                  key={String(q)}
                  onClick={() => setQty(q)}
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    qty === q
                      ? "border-walachie-emeraude bg-walachie-emeraude/15 text-walachie-emeraude"
                      : "border-walachie-violet/30 text-walachie-violet/70"
                  }`}
                >
                  ×{q === "max" ? "MAX" : q}
                </button>
              ))}
              <button onClick={closeSheet} className="ml-2 px-2 text-sm text-walachie-violet/70">
                ✕
              </button>
            </div>
          </div>
          <EvolutionTree erasUnlocked={erasUnlocked} qty={qty} />
        </div>
      )}

      {/* ---- Feuille PANTHÉON (Renaissance + héritages) ---- */}
      {sheet === "pantheon" && (
        <PantheonSheet onClose={closeSheet} armed={armRenaissance} setArmed={setArmRenaissance} />
      )}

      {/* ---- Retour hors ligne ---- */}
      {lastReturn && lastReturn.gained > 1 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-walachie-emeraude/40 bg-walachie-bg p-5 text-center">
            <div className="text-sm uppercase tracking-widest text-walachie-emeraude">Walachie a vécu sans toi</div>
            <div className="mt-3 text-2xl font-bold text-walachie-emeraude">+{fmtSeve(lastReturn.gained)} sève</div>
            {lastReturn.retourGift > 0 && (
              <div className="mt-1 text-xs text-walachie-magenta">
                ✦ Cadeau de retour : +{fmtSeve(lastReturn.retourGift)}
              </div>
            )}
            {lastReturn.cappedMs > 0 && (
              <div className="mt-1 text-[10px] text-walachie-violet/60">
                Le monde a dormi au bout de {fmtDurationShort(offlineCapMs(useWalachie.getState()))} — le Rêve profond (Panthéon) prolonge sa veille.
              </div>
            )}
            <button
              onClick={() => useWalachie.getState().clearReturn()}
              className="mt-4 rounded-lg border border-walachie-emeraude px-6 py-2 text-xs tracking-widest text-walachie-emeraude"
            >
              REPRENDRE
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- Panthéon : Renaissance, Éclats, héritages, journal ---------- */

function PantheonSheet({
  onClose,
  armed,
  setArmed,
}: {
  onClose: () => void;
  armed: boolean;
  setArmed: (v: boolean) => void;
}) {
  const eclats = useWalachie((s) => s.eclats);
  const cycles = useWalachie((s) => s.cycles);
  const seveAllTime = useWalachie((s) => s.seveAllTime);
  const pulsations = useWalachie((s) => s.pulsations);
  const meta = useWalachie((s) => s.meta);
  const eventLog = useWalachie((s) => s.eventLog);
  const nodes = useWalachie((s) => s.nodes);

  const s = useWalachie.getState();
  const ready = renaissanceReady(s);
  const gain = renaissanceEclats(s);
  void nodes;

  return (
    <div className="absolute inset-x-0 bottom-0 top-[30%] flex flex-col rounded-t-2xl border-t border-walachie-magenta/30 bg-walachie-bg/97 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="font-pixel text-xs uppercase tracking-widest text-walachie-magenta">Panthéon</span>
        <button onClick={onClose} className="px-2 text-sm text-walachie-violet/70">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="rounded-xl border border-walachie-magenta/30 bg-walachie-bg2/60 p-3 text-center">
          <div className="text-lg font-bold text-walachie-magenta">✦ {eclats} Éclats de Conscience</div>
          <div className="text-[11px] text-walachie-violet/70">
            {cycles} Renaissance{cycles > 1 ? "s" : ""} · sève de toutes les vies : {fmtSeve(seveAllTime)} · {pulsations} pulsations
          </div>
        </div>

        {/* Renaissance */}
        <div className="mt-3 rounded-xl border border-walachie-violet/20 p-3">
          <div className="text-sm text-[#eae2ff]">Renaissance</div>
          {ready ? (
            <>
              <p className="mt-1 text-[11px] leading-4 text-walachie-violet/80">
                La Divinité rêve un monde neuf. Walachie recommence à la protoplanète — tu gardes tes
                Éclats, tes héritages, et chaque cycle accompli accélère la sève de +25 %.
              </p>
              <div className="mt-2 text-center text-sm text-walachie-magenta">Gain : +{gain} ✦</div>
              {!armed ? (
                <button
                  onClick={() => setArmed(true)}
                  className="mt-2 w-full rounded-lg border border-walachie-magenta py-2 text-xs tracking-widest text-walachie-magenta"
                >
                  RENAÎTRE
                </button>
              ) : (
                <button
                  onClick={() => {
                    useWalachie.getState().doRenaissance(Date.now());
                    playCue("victory");
                    setArmed(false);
                    onClose();
                  }}
                  className="mt-2 w-full animate-pulse rounded-lg border-2 border-walachie-magenta bg-walachie-magenta/10 py-2 text-xs tracking-widest text-walachie-magenta"
                >
                  CONFIRMER LA RENAISSANCE (+{gain} ✦)
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-[11px] leading-4 text-walachie-violet/60">
              Atteins la Divinité de Walachie pour pouvoir renaître et gagner des Éclats de
              Conscience — la monnaie des héritages permanents. Ce n&apos;est qu&apos;une marche :
              rien n&apos;oblige à renaître, Walachie continue d&apos;essaimer bien au-delà si tu
              préfères poursuivre le cycle en cours.
            </p>
          )}
        </div>

        {/* Héritages permanents */}
        <div className="mt-3">
          <div className="px-1 text-xs uppercase tracking-widest text-walachie-violet">Héritages</div>
          <div className="mt-1 flex flex-col gap-1.5">
            {WMETA.map((m) => {
              const lvl = meta[m.id] ?? 0;
              const cost = metaCost(s, m.id);
              const can = eclats >= cost;
              const desc = m.desc
                .replace("{pct}", `${Math.round(m.valeur * 100)} %`)
                .replace("{h}", String(m.valeur));
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-xl border border-walachie-violet/15 bg-walachie-bg2/60 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-[#eae2ff]">
                      {m.nom} {lvl > 0 && <span className="text-[11px] text-walachie-magenta">niv. {lvl}</span>}
                    </div>
                    <div className="text-[10px] leading-4 text-walachie-violet/60">{desc}</div>
                  </div>
                  <button
                    onClick={() => useWalachie.getState().doBuyMeta(m.id)}
                    disabled={!can}
                    className={`rounded-lg border px-3 py-2 text-[11px] ${
                      can ? "border-walachie-magenta text-walachie-magenta" : "border-walachie-violet/20 text-walachie-violet/40"
                    }`}
                  >
                    {cost} ✦
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Journal des moments spontanés */}
        {eventLog.length > 0 && (
          <div className="mt-3">
            <div className="px-1 text-xs uppercase tracking-widest text-walachie-violet">Moments spontanés</div>
            <div className="mt-1 flex flex-col gap-1">
              {eventLog.map((e, i) => {
                const def = eventDef(e.id);
                return (
                  <div key={i} className="rounded-lg border border-walachie-violet/10 bg-walachie-bg2/50 px-2 py-1 text-[11px] text-walachie-violet/80">
                    ✦ {def ? def.nom : "Cadeau de retour"}
                    {e.seve > 0 && <span className="text-walachie-emeraude"> · +{fmtSeve(e.seve)}</span>}
                    {def && <div className="text-[10px] text-walachie-violet/50">{def.desc}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <p className="mt-4 text-center text-[10px] leading-4 text-walachie-violet/40">
          Le Bilan du soir et ta série d&apos;habitudes (mode Cellule) bénissent Walachie : rien n&apos;est
          jamais retiré, tenir tes journées ne fait qu&apos;accélérer le monde.
        </p>
      </div>
    </div>
  );
}
