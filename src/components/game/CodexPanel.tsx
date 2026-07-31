/* LE CODEX (26/07/2026, amélioration n°6, troisième volet) — l'écran d'aide qui
   n'existait pas. Le jeu invente une vingtaine de termes et n'offrait aucun moyen
   de retrouver une explication ratée : les cartes d'ouverture d'onglet et les
   fiches de bâtiment expliquent AU BON MOMENT, le Codex explique À LA DEMANDE.

   Tout le contenu vit dans src/data/codex_config.json (purement descriptif,
   aucun chiffre d'équilibrage). Ce composant ne fait que lister — ouvert depuis
   les Réglages, par-dessus eux (même patron d'empilement que SlotInspector). */
"use client";

import rawCodex from "@/data/codex_config.json";
import { Panel } from "@/components/ui/Pixel";
import { useOverlay } from "@/lib/overlay";

interface CodexTerm {
  term: string;
  icon: string;
  desc: string;
}

interface CodexGroup {
  id: string;
  name: string;
  icon: string;
  terms: CodexTerm[];
}

const CODEX = (rawCodex as unknown as { groups: CodexGroup[] }).groups;

export function CodexPanel({ onClose }: { onClose: () => void }) {
  /* Empilé par-dessus les Réglages : le retour système ferme d'abord le Codex,
     puis les Réglages (jeton d'historique par overlay). */
  const dialogRef = useOverlay<HTMLDivElement>(true, onClose);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-40 overflow-y-auto bg-abyss/97 backdrop-blur-sm outline-none"
    >
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-lg">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            📖
          </span>
          <div className="flex-1">
            <h1 className="font-pixel text-base uppercase tracking-[0.3em] text-cell-cyan">Codex</h1>
            <p className="text-[11px] text-cell-teal/60">
              Tous les mots du jeu, expliqués en deux phrases.
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

        {CODEX.map((group) => (
          <Panel key={group.id} variant="membrane" className="space-y-2 p-3">
            <h2 className="text-[11px] uppercase tracking-[0.25em] text-cell-cyan/80">
              {group.icon} {group.name}
            </h2>
            <dl className="space-y-2">
              {group.terms.map((t) => (
                <div key={t.term} className="flex items-start gap-2">
                  <span className="shrink-0 pt-0.5 text-sm" aria-hidden>
                    {t.icon}
                  </span>
                  <div className="min-w-0">
                    <dt className="text-[12px] text-cell-cyan">{t.term}</dt>
                    <dd className="text-[11px] leading-4 text-cell-teal/70">{t.desc}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </Panel>
        ))}
      </div>
    </div>
  );
}
