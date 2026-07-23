/* Création de profil simple (Phase 2) — choix d'un portrait + nom d'organisme.
   L'écran de création soigné arrive en Phase 4. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { useGame } from "@/lib/game/store";

export const PORTRAIT_IDS = [
  "abyssal", "meduse", "crustace", "larve", "cephalopode",
  "predateur", "symbiote", "spore", "lanterne", "amibe",
  "trilobite", "hydre", "ver", "diatomee", "embryon",
  "radiolaire", "planaire", "colonie", "archee", "germe",
] as const;

export function portraitSrc(id: string) {
  return `/assets/portraits/age01_cell_portrait_${id}_v001.png`;
}

export function ProfileCreate() {
  const createProfile = useGame((s) => s.createProfile);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [name, setName] = useState("");

  const ready = portrait !== null && name.trim().length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Panel variant="noyau" className="w-full max-w-md p-4">
        <h1 className="mb-1 text-center text-sm uppercase tracking-[0.3em] text-cell-cyan">
          Crée ton organisme
        </h1>
        <p className="mb-4 text-center text-[10px] text-cell-teal/60">
          Choisis la forme de vie qui portera ton évolution.
        </p>

        <div className="mb-4 grid grid-cols-5 gap-2">
          {PORTRAIT_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setPortrait(id)}
              title={id}
              className={`overflow-hidden rounded-md border transition ${
                portrait === id
                  ? "scale-105 border-cell-cyan shadow-[0_0_10px_rgba(109,246,255,0.6)]"
                  : "border-cell-cyan/20 opacity-80 hover:opacity-100"
              }`}
            >
              <img
                src={portraitSrc(id)}
                alt={id}
                className="pixelated h-full w-full"
                draggable={false}
              />
            </button>
          ))}
        </div>

        <label className="mb-4 block text-[10px] uppercase tracking-widest text-cell-teal/80">
          Nom de l&apos;organisme
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder="Ex. Lumen, Protozoa, Abyssal…"
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-cell-cyan/40 bg-abyss px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-cell-cyan"
          />
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
