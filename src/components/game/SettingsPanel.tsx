/* Réglages (Phase 8) — vibrations, export/import de sauvegarde (transfert
   manuel entre appareils tant que la sync cloud n'est pas activée),
   nouvelle partie, à propos. */
"use client";

import { useState } from "react";
import { Panel, PixelButton } from "@/components/ui/Pixel";
import { cloudConfigured } from "@/lib/cloud/firebase";
import { freshGameState } from "@/lib/game/economy";
import { exportSave, useGame } from "@/lib/game/store";
import { GAME_VERSION, getPrefs, setPref } from "@/lib/prefs";
import type { GameState } from "@/lib/game/types";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const adoptSave = useGame((s) => s.adoptSave);
  const [vib, setVib] = useState(() => getPrefs().vibrations);
  const [exported, setExported] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetStep, setResetStep] = useState(0);

  const doExport = () => {
    setExported(JSON.stringify(exportSave()));
    setCopied(false);
  };

  const doCopy = async () => {
    if (!exported) return;
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
    } catch {
      /* le joueur peut copier à la main depuis la zone de texte */
    }
  };

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText) as GameState;
      if (
        typeof parsed !== "object" || parsed === null ||
        typeof parsed.saveVersion !== "number" ||
        typeof parsed.resources !== "object" ||
        typeof parsed.buildings !== "object"
      ) {
        setImportMsg("❌ Ce texte ne ressemble pas à une sauvegarde EVOLVE.");
        return;
      }
      adoptSave(parsed);
      setImportMsg("✅ Sauvegarde chargée ! Ta cellule est là.");
      setImportText("");
    } catch {
      setImportMsg("❌ JSON invalide — copie bien la sauvegarde en entier.");
    }
  };

  const doReset = () => {
    if (resetStep < 2) {
      setResetStep(resetStep + 1);
      return;
    }
    adoptSave(freshGameState(Date.now()));
    setResetStep(0);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-abyss/95 backdrop-blur-sm">
      <div className="mx-auto max-w-md space-y-3 px-2 pb-24 pt-3 sm:max-w-lg">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-base uppercase tracking-[0.3em] text-cell-cyan">
            Réglages
          </h1>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Vibrations */}
        <Panel className="flex items-center justify-between p-3">
          <div>
            <div className="text-xs text-cell-cyan">Vibrations légères</div>
            <div className="text-[11px] text-cell-teal/60">
              Constructions, prises, mues (si ton appareil le permet).
            </div>
          </div>
          <button
            role="switch"
            aria-checked={vib}
            onClick={() => {
              setPref("vibrations", !vib);
              setVib(!vib);
            }}
            className={`h-7 w-12 rounded-full border transition ${
              vib ? "border-cell-lime bg-cell-lime/30" : "border-cell-teal/40 bg-abyss"
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-cell-cyan transition ${vib ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </Panel>

        {/* Sauvegarde */}
        <Panel className="space-y-2 p-3">
          <div className="text-xs text-cell-cyan">Sauvegarde</div>
          <p className="text-[11px] leading-relaxed text-cell-teal/60">
            {cloudConfigured
              ? "La sync cloud est active — l'export reste utile comme copie de secours."
              : "En attendant la sync cloud : exporte ici, colle sur ton autre appareil."}
          </p>
          <div className="flex flex-wrap gap-2">
            <PixelButton className="!py-1 text-[10px]" onClick={doExport}>
              EXPORTER
            </PixelButton>
            {exported && (
              <PixelButton className="!py-1 text-[10px]" onClick={doCopy}>
                {copied ? "✅ COPIÉE" : "COPIER"}
              </PixelButton>
            )}
          </div>
          {exported && (
            <textarea
              readOnly
              value={exported}
              rows={3}
              className="w-full rounded-md border border-cell-cyan/30 bg-abyss p-2 text-[10px] text-cell-teal"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          <div className="space-y-1 border-t border-cell-cyan/10 pt-2">
            <textarea
              placeholder="Colle ici une sauvegarde exportée…"
              value={importText}
              rows={3}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full rounded-md border border-cell-cyan/30 bg-abyss p-2 text-[10px] text-cell-teal"
            />
            <div className="flex items-center gap-2">
              <PixelButton className="!py-1 text-[10px]" disabled={!importText.trim()} onClick={doImport}>
                IMPORTER
              </PixelButton>
              <span className="text-[10px] text-cell-teal/60">Remplace la partie actuelle.</span>
            </div>
            {importMsg && <p className="text-[11px] text-cell-cyan">{importMsg}</p>}
          </div>
        </Panel>

        {/* Nouvelle partie */}
        <Panel className="flex items-center justify-between gap-3 p-3">
          <div>
            <div className="text-xs text-red-400">Nouvelle partie</div>
            <div className="text-[11px] text-cell-teal/60">
              Efface tout : bâtiments, cartes, habitudes, rapports.
            </div>
          </div>
          <PixelButton
            className="!min-w-[130px] !py-1 text-[10px] !text-red-400"
            onClick={doReset}
          >
            {resetStep === 0 ? "RÉINITIALISER" : resetStep === 1 ? "SÛR ?" : "VRAIMENT SÛR ?"}
          </PixelButton>
        </Panel>

        {/* À propos */}
        <Panel className="p-3 text-center">
          <div className="text-xs tracking-[0.3em] text-cell-cyan">EVOLVE v{GAME_VERSION}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-cell-teal/60">
            Âge 1 — Cellule · De la cellule au divin, financé par tes bonnes
            habitudes du réel. Pixel art généré via PixelLab, moteur Next.js.
          </p>
        </Panel>
      </div>
    </div>
  );
}
