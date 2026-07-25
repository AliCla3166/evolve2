/* Journal des rapports (Phase 5) — expéditions, vagues de pathogènes, événements.
   Overlay plein écran ; l'ouverture marque tout comme lu. */
"use client";

import { useEffect } from "react";
import { Panel } from "@/components/ui/Pixel";
import { useGame } from "@/lib/game/store";

const TYPE_LABEL = {
  expedition: "Expédition",
  pathogene: "Pathogènes",
  evenement: "Événement",
  chantier: "Chantier",
} as const;

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReportsPanel({ onClose }: { onClose: () => void }) {
  const reports = useGame((s) => s.reports);
  const markReportsSeen = useGame((s) => s.markReportsSeen);

  // Ouvrir le journal = tout marquer lu.
  useEffect(() => {
    markReportsSeen();
  }, [markReportsSeen]);

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-2 pb-nav pt-safe px-2 sm:max-w-2xl">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-base uppercase tracking-[0.3em] text-cell-cyan">
            Rapports
          </h1>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan"
          >
            ✕
          </button>
        </div>

        {reports.length === 0 ? (
          <p className="pt-6 text-center text-xs text-cell-teal/50">
            Rien à signaler pour l&apos;instant. Les expéditions, vagues de
            pathogènes et événements s&apos;inscriront ici.
          </p>
        ) : (
          reports.map((r) => (
            <Panel
              key={r.id}
              variant="membrane"
              className="p-2"
              style={{ background: "rgba(5, 11, 20, 0.8)" }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    r.success === false ? "text-red-400" : "text-cell-cyan"
                  }`}
                >
                  {r.title}
                </span>
                <span className="shrink-0 text-[10px] text-cell-teal/50">
                  {TYPE_LABEL[r.type]} · {fmtTs(r.ts)}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {r.lines.map((line, i) => (
                  <li key={i} className="text-[11px] leading-snug text-cell-teal/80">
                    {line}
                  </li>
                ))}
              </ul>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
