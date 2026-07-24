/* Événement à choix (Phase 5) — modal bloquante douce : le joueur tranche,
   ou l'événement expirera de lui-même (choice_expiry_h). */
"use client";

import { Panel, PixelButton } from "@/components/ui/Pixel";
import { fmtDuration } from "@/lib/game/format";
import { MILITARY } from "@/lib/game/military";
import { useGame } from "@/lib/game/store";

export function EventModal() {
  const pending = useGame((s) => s.pendingEvent);
  const now = useGame((s) => s.lastTick);
  const chooseEventOption = useGame((s) => s.chooseEventOption);

  if (!pending) return null;
  const ev = MILITARY.events.pool.find((e) => e.id === pending.eventId);
  if (!ev?.options) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <Panel
        variant="noyau"
        className="w-full max-w-sm p-4"
        style={{ background: "rgba(5, 11, 20, 0.96)" }}
      >
        <div className="mb-1 text-center text-2xl">{ev.icon}</div>
        <h2 className="text-center text-sm uppercase tracking-[0.3em] text-cell-magenta">
          {ev.name}
        </h2>
        <p className="mt-2 text-center text-xs leading-relaxed text-cell-cyan">
          {ev.prompt}
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          {ev.options.map((opt, i) => (
            <PixelButton
              key={i}
              className="w-full text-[11px]"
              onClick={() => chooseEventOption(i)}
            >
              {opt.label.toUpperCase()}
            </PixelButton>
          ))}
        </div>
        <p className="mt-3 text-center text-[10px] text-cell-teal/50">
          Sans réponse, elle dérive au loin dans {fmtDuration(pending.expiresAt - now)}.
        </p>
      </Panel>
    </div>
  );
}
