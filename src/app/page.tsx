/* Écran titre (Phase 4) — logo, océan primordial, plancton, Noyau pulsant.
   Lit la sauvegarde locale : nouveau joueur -> COMMENCER, sinon CONTINUER
   avec l'aperçu de l'organisme. Sync cloud : à venir (Firebase, décision actée). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { PixelButton } from "@/components/ui/Pixel";
import { CloudStatus } from "@/components/game/CloudStatus";
import { portraitSrc } from "@/components/game/ProfileCreate";
import { SlotSwitch } from "@/components/game/SlotSwitch";
import { hydrateActiveSlot, useGame } from "@/lib/game/store";

const PLANKTON = [
  { left: "8%", size: 3, dur: 26, delay: 0 },
  { left: "22%", size: 2, dur: 34, delay: 6 },
  { left: "37%", size: 4, dur: 22, delay: 12 },
  { left: "55%", size: 2, dur: 30, delay: 3 },
  { left: "68%", size: 3, dur: 27, delay: 15 },
  { left: "81%", size: 2, dur: 36, delay: 9 },
  { left: "92%", size: 3, dur: 24, delay: 18 },
];

export default function Home() {
  const hasHydrated = useGame((s) => s.hasHydrated);
  const profile = useGame((s) => s.profile);

  useEffect(() => {
    hydrateActiveSlot();
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-7 px-6 text-center">
      {/* Plancton dérivant */}
      {PLANKTON.map((p, i) => (
        <span
          key={i}
          className="plankton pointer-events-none absolute bottom-0 rounded-full bg-cell-cyan/60"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <div>
        <h1
          className="font-pixel text-5xl font-bold tracking-[0.35em] text-cell-cyan sm:text-7xl"
          style={{
            textShadow:
              "0 0 24px rgba(109,246,255,0.55), 0 0 80px rgba(109,246,255,0.25)",
          }}
        >
          EVOLVE
        </h1>
        <p className="mt-3 text-sm uppercase tracking-[0.5em] text-cell-teal/80">
          Âge 1 — Cellule
        </p>
      </div>

      <img
        src="/assets/buildings/noyau/niveau3.png"
        alt="Noyau primordial"
        width={192}
        height={192}
        className="pixelated cell-pulse select-none"
        draggable={false}
      />

      <p className="max-w-md text-sm leading-6 text-cell-teal/70">
        Tes bonnes habitudes du réel financent une civilisation qui évolue de la
        cellule au divin.
      </p>

      {hasHydrated && <SlotSwitch />}

      {!hasHydrated ? (
        <div className="h-[76px]" aria-hidden /* réserve l'espace des boutons */ />
      ) : profile ? (
        <div className="flex flex-col items-center gap-2">
          <PixelButton href="/play" className="px-10 py-3 text-sm">
            CONTINUER
          </PixelButton>
          <span className="flex items-center gap-2 text-xs text-cell-teal/80">
            <img
              src={portraitSrc(profile.portraitId)}
              alt=""
              width={22}
              height={22}
              className="pixelated rounded border border-cell-cyan/40"
              draggable={false}
            />
            {profile.nomOrganisme}
            {" — ta cellule t'attend"}
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <PixelButton href="/play" className="px-10 py-3 text-sm">
            COMMENCER
          </PixelButton>
          <span className="text-[11px] text-cell-teal/50">
            Première vie : tu choisiras ton organisme.
          </span>
        </div>
      )}

      {/* Le second mode de l'application : Walachie (30/07/2026). Sauvegarde et
          onglet totalement séparés — seul le pont des habitudes les relie.
          Un vrai PixelButton teinté violet (refonte DA 31/07, piste Phase 2
          n16) plutôt qu'un `<Link>` ad hoc : même poids visuel et même retour
          tactile (hover/pressed) que CONTINUER — un monde à part entière,
          pas une extension mineure sans état pressé. */}
      {hasHydrated && (
        <div className="flex flex-col items-center gap-1">
          <PixelButton
            href="/walachie"
            className="px-8 py-2.5 text-xs tracking-widest text-walachie-violet"
            style={
              {
                "--btn-border": "rgba(185, 140, 255, 0.5)",
                "--btn-glow": "rgba(185, 140, 255, 0.35)",
                "--btn-border-hover": "var(--walachie-violet)",
              } as CSSProperties
            }
          >
            ✦ WALACHIE
          </PixelButton>
          <span className="text-[10px] text-walachie-violet/60">
            L&apos;autre monde : une exoplanète à faire évoluer, du magma au divin.
          </span>
        </div>
      )}

      {/* Connexion Google / statut de sync (local si non configuré) */}
      {hasHydrated && <CloudStatus />}
    </main>
  );
}
