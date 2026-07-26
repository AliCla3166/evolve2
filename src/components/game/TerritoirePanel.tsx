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
   le Bastion choisit le Péril et les Préparatifs — une décision par écran.

   Les EXPÉDITIONS, elles, se lancent bien ici (PLAN_DERIVE §3.7) : elles ont quitté
   le Noyau pour les quatre « relais du jour » posés en haut de la carte. On choisit
   son relais sur la carte, on compose l'escouade dans la fiche, et on regarde
   l'escouade avancer le long de son trajet jusqu'à son retour. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { resourceName, stateProductionPerHour, stateStorageCap } from "@/lib/game/economy";
import { fmtDuration, fmtInt, fmtRate } from "@/lib/game/format";
import {
  cardArt,
  cardLevel,
  cardPowerRec,
  creatureRecolteBonus,
  crewMultOf,
  foyerCrewMult,
  speciesConfig,
} from "@/lib/game/cards";
import {
  availableUnits,
  cardExpeditionBonus,
  dailyOffers,
  destinationName,
  expeditionDurationH,
  MILITARY,
  successChance,
  unitConfig,
  UNIT_IDS,
} from "@/lib/game/military";
import { useGame } from "@/lib/game/store";
import { RELAIS_PREFIX, TerritoireScene } from "@/components/game/TerritoireScene";
import {
  abimeLoot,
  ALL_FOYERS,
  assaultPalier,
  cacheLoot,
  crewedSpecies,
  crewOf,
  crewSlots,
  devCost,
  devLevel,
  devLootMult,
  devSoftCap,
  foyerDef,
  foyerIncomePerHour,
  guaranteedDestIds,
  isCaptured,
  isDeepDev,
  isReconquest,
  natureDef,
  nextSectorUnlock,
  reconquestCount,
  reconquestLoot,
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
import type { ResourceId, UnitId } from "@/lib/game/types";

const EMPTY_SQUAD: Record<UnitId, number> = { garde: 0, sonde: 0, phage: 0 };

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

function Stepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
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

/* ---------- Fiche d'un relais : composer et envoyer une expédition ---------- */

function RelaisCard({ destId }: { destId: string }) {
  const expeditions = useGame((s) => s.expeditions);
  const territoire = useGame((s) => s.territoire);
  const now = useGame((s) => s.lastTick);
  const send = useGame((s) => s.sendExpedition);

  const [squad, setSquad] = useState<Record<UnitId, number>>(EMPTY_SQUAD);

  // Les offres du jour sont dérivées, jamais stockées : on les recalcule ici comme
  // la carte le fait, et l'index dans la liste est ce que `sendExpedition` attend.
  const state = useGame.getState();
  const offers = dailyOffers(state, now);
  const index = offers.findIndex((o) => o.destId === destId);
  const offer = index >= 0 ? offers[index] : null;
  const avail = availableUnits(state);
  const cardBonus = cardExpeditionBonus(state);
  const inFlight = expeditions.find((e) => e.destId === destId) ?? null;
  const slotsFree = MILITARY.expeditions.max_concurrent - expeditions.length;
  const squadSize = UNIT_IDS.reduce((s, u) => s + squad[u], 0);

  if (!offer) return null;
  const chance = successChance(offer, squad, cardBonus);
  const guaranteed = guaranteedDestIds(territoire).includes(destId);

  return (
    <Panel variant="noyau" className="p-3" style={{ background: "rgba(5, 11, 20, 0.92)" }}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none">🧭</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm tracking-wide text-cell-cyan">{offer.destName}</div>
          <div className="text-[11px] text-cell-teal/70">
            Relais du jour · rang {offer.tier} · {expeditionDurationH(state, offer.durationH)} h
            aller-retour
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cell-cyan/15 pt-2 text-[11px] text-cell-teal/70">
        <span>risque {Math.round(offer.risk * 100)} %</span>
        <span>difficulté {offer.difficulty}</span>
        <span className="flex items-center gap-1">
          {offer.rewards.map((r) => (
            <ResIcon key={r} res={r as ResourceId} />
          ))}
        </span>
      </div>
      {guaranteed && (
        <p className="mt-1 text-[11px] text-cell-lime/80">
          ✓ Site d&apos;expédition capturé — ce relais est proposé tous les jours.
        </p>
      )}

      {inFlight ? (
        <div className="mt-2 space-y-0.5 border-t border-cell-cyan/15 pt-2 text-[11px]">
          <p className="text-cell-lime">
            Escouade en mer — retour dans {fmtDuration(Math.max(0, inFlight.endsAt - now))}
          </p>
          <p className="text-cell-teal/60">
            {UNIT_IDS.filter((u) => inFlight.squad[u] > 0)
              .map((u) => `${inFlight.squad[u]}× ${unitConfig(u).name}`)
              .join(" · ")}
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-2 border-t border-cell-cyan/15 pt-2">
          {UNIT_IDS.map((u) => (
            <div key={u} className="flex items-center justify-between text-[11px]">
              <span className="text-cell-teal/80">
                {unitConfig(u).icon} {unitConfig(u).name}
                <span className="text-cell-teal/50"> · {avail[u]} dispo</span>
              </span>
              <Stepper
                value={squad[u]}
                max={avail[u]}
                onChange={(v) => setSquad({ ...squad, [u]: v })}
              />
            </div>
          ))}
          {(cardBonus.exp > 0 || cardBonus.atk > 0) && (
            <p className="text-[10px] text-cell-teal/60">
              🃏 Cartes assignées : +{cardBonus.exp} exploration · +{cardBonus.atk} assaut
            </p>
          )}
          <div className="flex items-center justify-between">
            <span
              className={`text-xs ${chance >= 0.7 ? "text-cell-lime" : chance >= 0.4 ? "text-cell-teal" : "text-red-400"}`}
            >
              Succès estimé : {Math.round(chance * 100)} %
            </span>
            <PixelButton
              className="!min-w-[100px] !px-3 text-[10px]"
              disabled={squadSize <= 0 || slotsFree <= 0}
              onClick={() => {
                if (send(index, squad)) setSquad(EMPTY_SQUAD);
              }}
            >
              ENVOYER
            </PixelButton>
          </div>
          {slotsFree <= 0 && (
            <p className="text-[10px] text-cell-teal/50">
              Toutes tes escouades sont déjà en mer.
            </p>
          )}
          {UNIT_IDS.every((u) => avail[u] === 0) && (
            <p className="text-[10px] text-cell-teal/50">
              Aucune unité disponible — recrute au Noyau, sur la fiche du bâtiment.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ---------- L'équipage de récolte d'un gisement (étape B) ----------

   La boucle qu'on ferme ici, et qui manquait : on pêche une créature, on la POSTE
   sur un gisement pris, elle y travaille en boucle à l'écran, et le gisement rend
   davantage. La pêche cessait jusqu'ici d'avoir un effet visible une fois la carte
   collectionnée — elle alimente désormais directement le revenu de la carte. */

function CrewSection({ foyer }: { foyer: FoyerDef }) {
  const territoire = useGame((s) => s.territoire);
  const collection = useGame((s) => s.collection);
  const assignments = useGame((s) => s.cardAssignments);
  const toggle = useGame((s) => s.toggleCrew);
  const [picking, setPicking] = useState(false);

  const crew = crewOf(territoire, foyer.id);
  const slots = crewSlots(territoire, foyer.id);
  const mult = foyerCrewMult({ collection, territoire }, foyer.id);

  // Une créature ne tient qu'un poste : on masque celles déjà en défense, en
  // expédition, ou postées sur un autre gisement (le store refuserait de toute façon).
  const busy = new Set<string>([
    ...assignments.defense,
    ...assignments.expedition,
    ...crewedSpecies(territoire),
  ]);
  const libres = Object.keys(collection)
    .filter((id) => !busy.has(id) && speciesConfig(id))
    .sort((a, b) => cardPowerRec(b, collection[b]) - cardPowerRec(a, collection[a]));

  return (
    <div className="mt-2 space-y-1.5 border-t border-cell-cyan/15 pt-2">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-cell-cyan">
          ⛏️ Équipage — {crew.length}/{slots} poste{slots > 1 ? "s" : ""}
        </span>
        <span className={mult > 1 ? "text-cell-lime" : "text-cell-teal/50"}>
          rendement ×{mult.toFixed(2).replace(".", ",")}
        </span>
      </div>

      {/* Les postes : une créature au travail, ou une place vide qui attend */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: slots }, (_, i) => {
          const id = crew[i];
          const entry = id ? collection[id] : undefined;
          if (!id || !entry) {
            return (
              <button
                key={`vide-${i}`}
                onClick={() => setPicking(true)}
                aria-label="Poster une créature à ce gisement"
                className="flex h-[38px] w-[38px] items-center justify-center rounded border border-dashed border-cell-cyan/30 text-sm text-cell-cyan/40 active:translate-y-px"
              >
                +
              </button>
            );
          }
          return (
            <button
              key={id}
              onClick={() => toggle(foyer.id, id)}
              title={`${speciesConfig(id)?.name} — retirer du gisement`}
              aria-label={`Retirer ${speciesConfig(id)?.name} du gisement`}
              className="relative h-[38px] w-[38px] overflow-hidden rounded border border-cell-lime/50 active:translate-y-px"
            >
              <img
                src={cardArt(id)}
                alt=""
                width={38}
                height={38}
                className="pixelated h-full w-full object-cover"
                draggable={false}
              />
              <span className="absolute inset-x-0 bottom-0 bg-abyss/80 text-center text-[8px] leading-[10px] text-cell-lime">
                +{Math.round(creatureRecolteBonus(id, entry) * 100)} %
              </span>
            </button>
          );
        })}
      </div>

      {crew.length < slots && !picking && libres.length > 0 && (
        <button
          onClick={() => setPicking(true)}
          className="text-[10px] text-cell-cyan/70 underline underline-offset-2"
        >
          Poster une créature ({libres.length} disponible{libres.length > 1 ? "s" : ""})
        </button>
      )}
      {crew.length < slots && libres.length === 0 && (
        <p className="text-[10px] text-cell-teal/50">
          Aucune créature libre — pêche à La Mare, ou libère une carte de la défense.
        </p>
      )}
      {crew.length >= slots && (
        <p className="text-[10px] text-cell-teal/50">
          Gisement au complet. Développe-le pour ouvrir un poste de plus.
        </p>
      )}

      {picking && crew.length < slots && (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-cell-cyan/20 p-1.5">
          {libres.map((id) => {
            const sp = speciesConfig(id);
            const entry = collection[id];
            if (!sp) return null;
            return (
              <button
                key={id}
                onClick={() => {
                  if (toggle(foyer.id, id)) setPicking(false);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left active:translate-y-px"
              >
                <img
                  src={cardArt(id)}
                  alt=""
                  width={26}
                  height={26}
                  className="pixelated rounded"
                  draggable={false}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                  {sp.name}
                  <span className="text-cell-teal/50"> nv{cardLevel(entry.count)}</span>
                </span>
                <span className="shrink-0 text-[10px] text-cell-lime">
                  +{Math.round(creatureRecolteBonus(id, entry) * 100)} %
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
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
  const collection = useGame((s) => s.collection);
  const palier = useGame((s) => s.waveCount);
  const percees = useGame((s) => s.bilan.percees);
  const develop = useGame((s) => s.developFoyer);
  const postes = useGame((s) => s.postes);
  const fauneLevel = useGame((s) => s.fauneLevel);

  // stateProductionPerHour alloue un nouvel objet : on le calcule APRÈS sélection,
  // jamais dans un sélecteur Zustand (cf. le piège corrigé dans Hud.tsx).
  const prod = stateProductionPerHour({ buildings, territoire, postes, collection, fauneLevel });
  const crewMult = crewMultOf({ collection, territoire });

  const nat = natureDef(foyer.nature);
  const taken = isCaptured(territoire, foyer.id);
  const sector = SECTORS.find((s) => s.foyers.some((f) => f.id === foyer.id));
  const open = sector ? sectorUnlocked(sector, palier) : false;
  // Plus rien ne « termine » un foyer (étape D) : seule l'ouverture du secteur décide.
  const free = open;
  const target = assaultPalier(foyer, palier, territoire);
  const needsPercee = Boolean(nat.requires_percee);
  const dev = devLevel(territoire, foyer.id);
  // Le devis se lit en part de RÉSERVE (cf. territoire.devCost) : c'est le plafond
  // de stockage qu'on lui passe, pas la production. Même source que le store.
  const cost = taken ? devCost(foyer, dev, stateStorageCap({ buildings, territoire })) : null;
  /* ÉTAPE D — un foyer pris n'est jamais fini : il se reprend, plus haut.
     `reprises` compte les reconquêtes DÉJÀ menées ; le butin affiché est celui de
     la prochaine, donc indexé sur `reprises` telle qu'elle sera après la victoire. */
  const reprise = isReconquest(territoire, foyer);
  const reprises = reconquestCount(territoire, foyer.id);
  const repriseLoot = reprise
    ? reconquestLoot(foyer, target, dev, reprises + 1, prod)
    : null;
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
            {taken && (reprises > 0 ? ` · ${reprises}e reconquête` : " · capturé")}
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
                  +{fmtRate(foyerIncomePerHour(territoire, foyer, prod, crewMult))}/h ·
                  développement {dev}
                  {dev < devSoftCap() && `/${devSoftCap()}`}
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
            {/* ÉTAPE D — passé les paliers calibrés, le développement continue sans
                fin. Il n'augmente plus le rendement horaire (borné pour protéger le
                calibrage 90 jours) mais gonfle le butin de chaque reconquête. Le
                joueur doit le lire ici, sinon les niveaux profonds paraissent vides. */}
            {taken && isDeepDev(dev) && (
              <p className="text-cell-magenta/85">
                ⛏ Veine profonde · butin de reconquête ×
                {devLootMult(dev).toFixed(2).replace(".", ",")}
              </p>
            )}
            {taken && dev === devSoftCap() && (
              <p className="text-cell-teal/60">
                Paliers calibrés atteints — au-delà, chaque niveau creuse la veine et
                enrichit le butin de reconquête.
              </p>
            )}
          </>
        )}
        {foyer.nature === "gisement" && taken && <CrewSection foyer={foyer} />}

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
            🧭 {taken ? "Relais acquis" : "Une fois pris"} : {destinationName(foyer.dest_id)} est
            proposé <em>chaque jour</em> parmi les quatre relais, en haut de la carte.
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
              {reprise ? "↻ RECONQUÉRIR" : "⚔️ ASSAILLIR"} — PALIER {target}
            </PixelButton>
            {/* ÉTAPE D — le foyer reste à nous ; le reprendre plus haut ne rend pas
                le vestige une seconde fois (territoireBonus compte une CAPTURE, pas
                des passages), il paie en butin. Il faut le dire, sinon le joueur
                croit risquer sa conquête. */}
            {reprise && repriseLoot && (
              <div className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-cell-teal/70">
                <p className="text-center">
                  Le foyer reste tien — tu le redéfies plus haut, pour le butin.
                </p>
                <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
                  {Object.entries(repriseLoot.resources).map(([res, amount]) => (
                    <span key={res} className="flex items-center gap-1">
                      <ResIcon res={res as ResourceId} />
                      {fmtInt(amount ?? 0)}
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <ResIcon res="combat" />
                    {fmtInt(repriseLoot.combat)}
                  </span>
                  {repriseLoot.fragments > 0 && <span>🧬 {repriseLoot.fragments}</span>}
                </p>
              </div>
            )}
            {needsPercee && (
              <p className="mt-1 text-center text-[10px] text-cell-teal/60">
                Un antre coûte une Percée — tu en as {percees}.
              </p>
            )}
          </>
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
  const collection = useGame((s) => s.collection);
  const palier = useGame((s) => s.waveCount);
  const expeditions = useGame((s) => s.expeditions);
  const now = useGame((s) => s.lastTick);
  const setSector = useGame((s) => s.setTerritoireSector);
  const markOffersSeen = useGame((s) => s.markNoyauSeen);
  const postes = useGame((s) => s.postes);
  const fauneLevel = useGame((s) => s.fauneLevel);

  const [selected, setSelected] = useState<string | null>(null);

  /* Le signal « les relais du jour ont changé » (les quatre destinations sont tirées
     à partir de dayKey, elles tournent à minuit sans que rien ne le dise) s'éteint
     ici depuis que les expéditions ont quitté le Noyau. Le champ persisté garde son
     nom d'origine, `noyauSeenDay` : renommer un champ de sauvegarde coûterait une
     migration pour un simple confort de lecture. */
  useEffect(() => {
    markOffersSeen();
  }, [markOffersSeen]);

  // Secteur affiché : le dernier consulté, à condition qu'il soit encore ouvert.
  const stored = SECTORS.find((s) => s.id === territoire.lastSectorId);
  const sector = stored && sectorUnlocked(stored, palier) ? stored : SECTORS[0];

  const prod = stateProductionPerHour({ buildings, territoire, postes, collection, fauneLevel });
  const income = territoireIncomePerHour(territoire, prod, crewMultOf({ collection, territoire }));
  const incomeRows = (Object.keys(income) as ResourceId[]).filter((r) => (income[r] ?? 0) > 0);
  // Un gisement rapporte un POURCENTAGE de la production de base : tant que la base
  // ne produit pas la ressource, le gisement est bien pris mais rend zéro. Il faut
  // le dire, sinon le message « aucun gisement capturé » ment au joueur.
  const gisementsPris = ALL_FOYERS.filter(
    (f) => f.nature === "gisement" && isCaptured(territoire, f.id),
  ).length;
  const bonuses = territoireBonus(territoire);
  const bonusRows = (Object.keys(bonuses) as TerritoireBonusId[]).filter(
    (id) => (bonuses[id] ?? 0) > 0,
  );
  const progress = territoireProgress(territoire, palier);
  const nextSector = nextSectorUnlock(palier);
  // Une même sélection sert deux fiches : un id préfixé désigne un relais du jour,
  // tout le reste désigne un foyer de secteur (cf. RELAIS_PREFIX dans la scène).
  const relaisDestId = selected?.startsWith(RELAIS_PREFIX)
    ? selected.slice(RELAIS_PREFIX.length)
    : null;
  const foyer = selected && !relaisDestId ? foyerDef(selected) : null;

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

        {/* Fiche du relais ou du foyer sélectionné, ou invitation à en choisir un */}
        {relaisDestId ? (
          <RelaisCard key={relaisDestId} destId={relaisDestId} />
        ) : foyer ? (
          <FoyerCard foyer={foyer} onAssault={onAssault} />
        ) : (
          <p className="px-2 text-center text-[11px] text-cell-teal/50">
            Touche un foyer pour voir ce qu&apos;il cache, ou un relais ⚓ en haut de la carte
            pour envoyer une expédition.
          </p>
        )}

        {/* Escouades en mer — la contrepartie chiffrée des trajets animés sur la carte */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">
          Expéditions ({expeditions.length}/{MILITARY.expeditions.max_concurrent})
        </h2>
        <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
          {expeditions.length === 0 ? (
            <p className="text-[11px] text-cell-teal/50">
              Aucune escouade en mer. Les quatre relais changent chaque jour à minuit.
            </p>
          ) : (
            <div className="space-y-1.5">
              {expeditions.map((exp) => {
                const total = Math.max(1, exp.endsAt - exp.startedAt);
                const prog = Math.min(1, Math.max(0, (now - exp.startedAt) / total));
                return (
                  <div key={exp.id} className="space-y-0.5">
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="text-cell-cyan">🧭 {exp.destName}</span>
                      <span className="text-cell-lime">
                        retour dans {fmtDuration(Math.max(0, exp.endsAt - now))}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-cell-cyan/10">
                      <div
                        className="h-full rounded-full bg-cell-cyan/70"
                        style={{ width: `${Math.round(prog * 100)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-cell-teal/60">
                      {UNIT_IDS.filter((u) => exp.squad[u] > 0)
                        .map((u) => `${exp.squad[u]}× ${unitConfig(u).name}`)
                        .join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Ce que le territoire rapporte déjà */}
        <h2 className="pt-1 text-xs uppercase tracking-[0.3em] text-cell-cyan">Revenu du territoire</h2>
        <Panel variant="tooltip" className="px-3 py-2" style={{ background: "rgba(5, 11, 20, 0.75)" }}>
          {incomeRows.length === 0 ? (
            <p className="text-[11px] text-cell-teal/50">
              {gisementsPris === 0
                ? "Aucun gisement capturé — la carte ne rapporte encore rien."
                : `${gisementsPris} gisement${gisementsPris > 1 ? "s" : ""} pris, mais la base ne produit pas encore leurs ressources : un gisement rend un pourcentage de ta production. Construis et améliore, la carte suivra.`}
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
