/* Création de personnage (Phase 4) — les 20 portraits, aperçu en grand,
   nom d'organisme (avec suggestion), naissance dans l'océan. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { CardFrame, Panel, PixelButton } from "@/components/ui/Pixel";
import { useGame } from "@/lib/game/store";

export const PORTRAIT_IDS = [
  "abyssal", "meduse", "crustace", "larve", "cephalopode",
  "predateur", "symbiote", "spore", "lanterne", "amibe",
  "trilobite", "hydre", "ver", "diatomee", "embryon",
  "radiolaire", "planaire", "colonie", "archee", "germe",
] as const;

/** Noms d'espèce affichés sous l'aperçu (fiction de la charte). */
const PORTRAIT_NAMES: Record<string, string> = {
  abyssal: "L'Abyssal aux mille yeux",
  meduse: "Méduse à voiles lumineux",
  crustace: "Crustacé cristallin",
  larve: "Larve stellaire",
  cephalopode: "Céphalopode rêveur",
  predateur: "Prédateur cilié",
  symbiote: "Symbiote double",
  spore: "Spore éveillée",
  lanterne: "Poisson-lanterne ancestral",
  amibe: "Amibe royale",
  trilobite: "Trilobite chromé",
  hydre: "Hydre naissante",
  ver: "Ver bioluminescent",
  diatomee: "Diatomée-joyau",
  embryon: "Embryon cosmique",
  radiolaire: "Radiolaire architecte",
  planaire: "Planaire aux deux visages",
  colonie: "Colonie-visage",
  archee: "Archée des failles",
  germe: "Germe divin",
};

/** Suggestions de noms (bouton 🎲 — pur confort, aucune valeur de gameplay). */
const NAME_POOL = [
  "Lumen", "Protozoa", "Abyssal", "Cyanea", "Primordia", "Vitalis",
  "Okeanos", "Mitose", "Nucleon", "Symbia", "Bathyal", "Aurore",
];

export function portraitSrc(id: string) {
  return `/assets/portraits/age01_cell_portrait_${id}_v001.png`;
}

export function ProfileCreate() {
  const createProfile = useGame((s) => s.createProfile);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dice, setDice] = useState(0);

  const ready = portrait !== null && name.trim().length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Panel
        variant="noyau"
        className="w-full max-w-md p-4"
        style={{ background: "rgba(5, 11, 20, 0.92)" }}
      >
        <h1 className="mb-1 text-center text-base uppercase tracking-[0.3em] text-cell-cyan">
          Crée ton organisme
        </h1>
        <p className="mb-4 text-center text-[11px] text-cell-teal/60">
          Choisis la forme de vie qui portera ton évolution.
        </p>

        {/* Aperçu de l'élu */}
        <div className="mb-4 flex min-h-[150px] items-center justify-center gap-4">
          {portrait ? (
            <>
              <CardFrame rarity="commune">
                <img
                  src={portraitSrc(portrait)}
                  alt={portrait}
                  className="pixelated h-full w-full object-contain"
                  draggable={false}
                />
              </CardFrame>
              <div className="max-w-[150px] text-left">
                <div className="text-sm leading-snug text-cell-cyan">
                  {PORTRAIT_NAMES[portrait] ?? portrait}
                </div>
                <div className="mt-1 text-[11px] text-cell-teal/60">
                  Espèce fondatrice de ta lignée.
                </div>
              </div>
            </>
          ) : (
            <p className="animate-pulse text-[11px] tracking-widest text-cell-teal/50">
              — TOUCHE UN PORTRAIT CI-DESSOUS —
            </p>
          )}
        </div>

        <div className="mb-4 grid grid-cols-5 gap-2">
          {PORTRAIT_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setPortrait(id)}
              title={PORTRAIT_NAMES[id] ?? id}
              className={`overflow-hidden rounded-md border transition ${
                portrait === id
                  ? "scale-105 border-cell-cyan shadow-[0_0_10px_rgba(109,246,255,0.6)]"
                  : "border-cell-cyan/20 opacity-80 hover:opacity-100"
              }`}
            >
              <img
                src={portraitSrc(id)}
                alt={PORTRAIT_NAMES[id] ?? id}
                className="pixelated h-full w-full"
                draggable={false}
              />
            </button>
          ))}
        </div>

        <label className="mb-4 block text-[11px] uppercase tracking-widest text-cell-teal/80">
          Nom de l&apos;organisme
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={name}
              maxLength={24}
              placeholder="Ex. Lumen, Protozoa, Abyssal…"
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-cell-cyan/40 bg-abyss px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-cell-cyan"
            />
            <button
              type="button"
              aria-label="Suggérer un nom"
              title="Suggérer un nom"
              onClick={() => {
                setName(NAME_POOL[dice % NAME_POOL.length]);
                setDice((d) => d + 1);
              }}
              className="shrink-0 rounded-md border border-cell-cyan/40 px-3 text-base hover:border-cell-cyan"
            >
              🎲
            </button>
          </div>
        </label>

        <div className="text-center">
          <PixelButton
            disabled={!ready}
            onClick={() => portrait && createProfile(portrait, name)}
          >
            NAÎTRE DANS L&apos;OCÉAN
          </PixelButton>
        </div>
      </Panel>
    </div>
  );
}
