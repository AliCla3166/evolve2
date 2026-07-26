/* Les postes de travail d'un organe (26/07) — le pendant, côté base, de l'équipage
   de récolte de La Dérive (cf. CrewSection dans TerritoirePanel.tsx).

   On pêche une créature, on la POSTE dans un organe producteur, elle y travaille,
   l'organe produit davantage, et elle gagne un niveau de travail qui n'a pas de
   plafond. C'est ce qui donne enfin une raison de collectionner les 62 espèces :
   les places sont rares et chaque espèce a une affinité avec une ressource.

   Section autonome plutôt que du code inline dans BuildingSheet : la même vue devra
   s'ouvrir depuis La Mare (« où travaille cette carte ? ») sans être dupliquée.

   Tout le tuning vit dans economy_config.json -> postes ; ce fichier n'écrit aucun
   nombre d'équilibrage, il ne fait que rendre ce que le moteur calcule. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import {
  cardArt,
  cardLevel,
  cardPowerRec,
  fitInSlots,
  isCardPlayable,
  isFreeSlotCard,
  slotsUsed,
  speciesAffinity,
  speciesConfig,
} from "@/lib/game/cards";
import {
  acceptsPostes,
  buildingPosteMult,
  buildingProductionPerHour,
  posteOf,
  posteResource,
  posteSlots,
  resourceName,
  workLevel,
  workXpForLevel,
  workerBonus,
} from "@/lib/game/economy";
import { fmtRate } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import { crewedSpecies } from "@/lib/game/territoire";
import type { BuildingId, ResourceId } from "@/lib/game/types";

/** Apport d'une ouvrière, en pourcentage lisible. Le multiplicateur de l'organe est
 *  saturant : cette valeur est une CONTRIBUTION, pas un gain direct — même vocabulaire
 *  que sur les gisements, où le joueur lit déjà « +18 % » par créature postée. */
function pct(bonus: number): string {
  return `+${Math.round(bonus * 100)} %`;
}

/* ---------- L'ancienneté d'une ouvrière ----------

   Ce composant est le SEUL de l'application à s'abonner à `fauneXp`, et c'est
   délibéré : ce champ est réécrit à chaque tick (1 s), donc tout ce qui le lit se
   re-rend une fois par seconde. Ici c'est exactement l'effet voulu — on veut voir
   la barre avancer — et le sélecteur est un SCALAIRE (`s.fauneXp[id]`), donc le
   réveil s'arrête à cette ligne de quelques nœuds. Les vues de production, elles,
   ne lisent que `fauneLevel`, qui ne bouge qu'aux paliers. */
function WorkerRow({ speciesId, resource }: { speciesId: string; resource: ResourceId | null }) {
  const xp = useGame((s) => s.fauneXp[speciesId] ?? 0);
  const collection = useGame((s) => s.collection);
  const fauneLevel = useGame((s) => s.fauneLevel);

  const sp = speciesConfig(speciesId);
  const entry = collection[speciesId];
  if (!sp || !entry) return null;

  const level = workLevel(xp);
  const floor = workXpForLevel(level);
  const ceil = workXpForLevel(level + 1);
  const frac = ceil > floor ? Math.max(0, Math.min(1, (xp - floor) / (ceil - floor))) : 0;
  const affinity = speciesAffinity(speciesId);
  const matches = affinity !== null && affinity === resource;

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[10px] text-white/80">
        {sp.name}
        {matches && <span className="text-cell-lime"> ✦</span>}
      </span>
      {/* Piste sobre + remplissage : on n'annonce JAMAIS un dernier niveau, seulement
          le prochain. La courbe est polynomiale, il y en a toujours un de plus. */}
      <span
        className="relative h-[6px] w-20 shrink-0 overflow-hidden rounded-full"
        style={{ background: "rgba(5, 11, 20, 0.85)", border: "1px solid rgba(109,246,255,0.18)" }}
        role="img"
        aria-label={`${sp.name} — travail niveau ${level}, ${Math.round(frac * 100)} % vers le niveau ${level + 1}`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${frac * 100}%`, background: "var(--lime)" }}
        />
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-cell-cyan/80">nv {level}</span>
      <span className="shrink-0 text-[10px] tabular-nums text-cell-lime/90">
        {pct(workerBonus({ collection, fauneLevel }, speciesId, resource))}
      </span>
    </div>
  );
}

/* ---------- La section ---------- */

export function PostesSection({ id }: { id: BuildingId }) {
  const buildings = useGame((s) => s.buildings);
  const postes = useGame((s) => s.postes);
  const collection = useGame((s) => s.collection);
  const fauneLevel = useGame((s) => s.fauneLevel);
  const territoire = useGame((s) => s.territoire);
  const assignments = useGame((s) => s.cardAssignments);
  const togglePoste = useGame((s) => s.togglePoste);
  const [picking, setPicking] = useState(false);

  const level = buildings[id] ?? 0;
  const slots = posteSlots(id, level);
  // Un organe non producteur, ou pas encore bâti, n'a rien à montrer : la section
  // disparaît d'elle-même plutôt que d'obliger chaque appelant à connaître la règle.
  if (!acceptsPostes(id) || slots <= 0) return null;

  const res = posteResource(id);
  const crew = posteOf({ postes }, id);
  const view = { buildings, postes, collection, fauneLevel };
  const mult = buildingPosteMult(view, id);
  const base = res ? (buildingProductionPerHour(id, level)[res] ?? 0) : 0;

  // Une créature ne tient qu'UN emploi : on masque celles déjà en défense, en
  // expédition, postées sur un gisement de La Dérive ou dans un autre organe.
  // (Le store refuserait de toute façon — mais proposer un choix impossible est
  // une fausse promesse, et c'est l'écran qui doit l'éviter.)
  const busy = new Set<string>([
    ...assignments.defense,
    ...assignments.expedition,
    ...crewedSpecies(territoire),
  ]);
  for (const [bid, list] of Object.entries(postes)) {
    if (bid === id || !list) continue;
    for (const sid of list) busy.add(sid);
  }
  // Même verrou que sur les gisements : une espèce tenue à un seul exemplaire ne
  // travaille pas encore (cf. cards.isCardPlayable). On la retire de la liste et on
  // dit combien sont dans ce cas, plutôt que de laisser croire à une collection vide.
  const candidates = Object.keys(collection).filter(
    (sid) => !busy.has(sid) && !crew.includes(sid) && speciesConfig(sid),
  );
  const verrouillees = candidates.filter((sid) => !isCardPlayable(collection[sid])).length;
  const jouables = candidates
    .filter((sid) => isCardPlayable(collection[sid]))
    .sort(
      (a, b) =>
        workerBonus(view, b, res) - workerBonus(view, a, res) ||
        cardPowerRec(b, collection[b]) - cardPowerRec(a, collection[a]),
    );
  /* Comme sur les gisements : on compte les PLACES, pas les têtes. Une négative
     n'occupe aucune place (cards.slotCost), donc un organe au complet en accepte
     encore — et posteBonus les paiera toutes (economy.posteBonus → fitInSlots). */
  const used = slotsUsed(crew, collection);
  const full = used >= slots;
  const libres = full ? jouables.filter((sid) => isFreeSlotCard(collection[sid])) : jouables;

  return (
    <div className="space-y-1.5 border-t border-cell-cyan/15 pt-2">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-cell-cyan">
          ⚙️ Postes de travail — {used}/{slots}
          {crew.length > used && ` (+${crew.length - used} sans place)`}
        </span>
        <span className={mult > 1 ? "text-cell-lime" : "text-cell-teal/50"}>
          rendement ×{mult.toFixed(2).replace(".", ",")}
        </span>
      </div>

      {/* Ce que ça donne VRAIMENT, en unités de jeu et pas en pourcentage abstrait. */}
      {res && base > 0 && (
        <div className="text-[10px] text-cell-teal/70">
          {fmtRate(base)}/h → <span className="text-cell-lime">{fmtRate(base * mult)}/h</span>{" "}
          {resourceName(res)}
        </div>
      )}

      {/* Les places : d'abord TOUTES les ouvrières (une négative peut porter l'effectif
          au-delà du nombre de places), puis les places libres qui attendent. */}
      <div className="flex flex-wrap gap-1.5">
        {crew.map((sid) => {
          const entry = collection[sid];
          if (!entry) return null;
          const sp = speciesConfig(sid);
          const gratuite = isFreeSlotCard(entry);
          return (
            <button
              key={sid}
              onClick={() => togglePoste(id, sid)}
              title={`${sp?.name ?? sid}${gratuite ? " (n'occupe aucune place)" : ""} — retirer du poste`}
              aria-label={`Retirer ${sp?.name ?? sid} de cet organe`}
              className={`relative h-[38px] w-[38px] overflow-hidden rounded border active:translate-y-px ${
                gratuite ? "border-cell-magenta/70" : "border-cell-lime/50"
              }`}
            >
              <img
                src={cardArt(sid)}
                alt=""
                width={38}
                height={38}
                className="pixelated h-full w-full object-cover"
                draggable={false}
              />
              <span className="absolute inset-x-0 bottom-0 bg-abyss/80 text-center text-[8px] leading-[10px] text-cell-lime">
                {pct(workerBonus(view, sid, res))}
              </span>
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, slots - used) }, (_, i) => (
          <button
            key={`vide-${i}`}
            onClick={() => setPicking(true)}
            aria-label="Poster une créature dans cet organe"
            className="flex h-[38px] w-[38px] items-center justify-center rounded border border-dashed border-cell-cyan/30 text-sm text-cell-cyan/40 active:translate-y-px"
          >
            +
          </button>
        ))}
      </div>

      {/* L'ancienneté, une ligne par ouvrière — la seule chose ici qui bouge en direct */}
      {crew.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {fitInSlots(crew, collection, slots).map((sid) => (
            <WorkerRow key={sid} speciesId={sid} resource={res} />
          ))}
        </div>
      )}

      {!picking && libres.length > 0 && (
        <button
          onClick={() => setPicking(true)}
          className="text-[10px] text-cell-cyan/70 underline underline-offset-2"
        >
          {full ? "Ajouter une ouvrière sans place" : "Poster une créature"} ({libres.length}{" "}
          disponible{libres.length > 1 ? "s" : ""})
        </button>
      )}
      {!full && libres.length === 0 && (
        <p className="text-[10px] text-cell-teal/50">
          Aucune créature libre — pêche à La Mare, ou libère une carte de la défense.
        </p>
      )}
      {!full && verrouillees > 0 && (
        <p className="text-[10px] text-cell-teal/50">
          🔒 {verrouillees} espèce{verrouillees > 1 ? "s" : ""}{" "}
          verrouillée{verrouillees > 1 ? "s" : ""} — il en faut une 2ᵉ prise pour avoir le
          droit de la mettre au travail.
        </p>
      )}
      {full && (
        <p className="text-[10px] text-cell-teal/50">
          Organe au complet. Améliore-le pour ouvrir une place de plus — ou poste une
          créature négative, qui n&apos;occupe aucune place.
        </p>
      )}

      {picking && libres.length > 0 && (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-cell-cyan/20 p-1.5">
          {libres.map((sid) => {
            const sp = speciesConfig(sid);
            const entry = collection[sid];
            if (!sp) return null;
            const affinity = speciesAffinity(sid);
            const matches = affinity !== null && affinity === res;
            return (
              <button
                key={sid}
                onClick={() => {
                  if (togglePoste(id, sid)) setPicking(false);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left active:translate-y-px"
              >
                <img
                  src={cardArt(sid)}
                  alt=""
                  width={26}
                  height={26}
                  className="pixelated rounded"
                  draggable={false}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                  {sp.name}
                  <span className="text-cell-teal/50"> nv{cardLevel(entry.count)}</span>
                  {/* L'affinité est un BONUS, jamais un péage : n'importe quelle espèce
                      peut tenir n'importe quel poste, celle-ci s'y trouve juste mieux. */}
                  {matches && affinity && (
                    <span className="text-cell-lime"> ✦ {resourceName(affinity)}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-cell-lime">
                  {pct(workerBonus(view, sid, res))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
