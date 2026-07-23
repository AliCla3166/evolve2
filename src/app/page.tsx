/* eslint-disable @next/next/no-img-element */
import { PixelButton } from "@/components/ui/Pixel";

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
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
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

      <h1
        className="text-5xl font-bold tracking-[0.35em] text-cell-cyan sm:text-7xl"
        style={{ textShadow: "0 0 24px rgba(109,246,255,0.5)" }}
      >
        EVOLVE
      </h1>
      <p className="text-sm uppercase tracking-[0.5em] text-cell-teal/80">
        Âge 1 — Cellule
      </p>

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

      <PixelButton href="/play" className="px-10 py-3 text-sm">
        COMMENCER
      </PixelButton>

      <span className="rounded-full border border-cell-cyan/30 px-4 py-1 text-xs tracking-widest text-cell-cyan/60">
        Phase 2 — moteur de jeu · jouable
      </span>
    </main>
  );
}
