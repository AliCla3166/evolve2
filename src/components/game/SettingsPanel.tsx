/* Réglages (Phase 8) — vibrations, repères sonores (piste 8), export/import de
   sauvegarde (transfert manuel entre appareils tant que la sync cloud n'est pas
   activée), nouvelle partie, à propos. */
"use client";

import { useState } from "react";
import { Panel, PixelButton, Switch } from "@/components/ui/Pixel";
import { CodexPanel } from "@/components/game/CodexPanel";
import { DevPanel } from "@/components/game/DevPanel";
import { NotifSettings } from "@/components/game/NotifSettings";
import { SlotSwitch } from "@/components/game/SlotSwitch";
import { cloudConfigured } from "@/lib/cloud/firebase";
import { freshGameState } from "@/lib/game/economy";
import { exportSave, useGame } from "@/lib/game/store";
import { GAME_VERSION, getPrefs, setPref, type Prefs } from "@/lib/prefs";
import { playCue, syncAudioPrefs, unlockAudio } from "@/lib/audio";
import type { GameState } from "@/lib/game/types";

/** Ligne de préférence locale (vibrations / sons / ambiance). Le dessin de
 *  l'interrupteur lui-même vit dans `Switch` (Pixel.tsx) depuis l'étape 9 : les
 *  rappels ont leur propre stockage et ne peuvent pas passer par `keyof Prefs`,
 *  mais les deux doivent rester rigoureusement identiques à l'œil. */
function PrefToggle({
  pref,
  title,
  hint,
  onChange,
}: {
  pref: keyof Prefs;
  title: string;
  hint: string;
  onChange?: (value: boolean) => void;
}) {
  const [on, setOn] = useState(() => getPrefs()[pref]);
  return (
    <Panel className="flex items-center justify-between gap-3 p-3">
      <div>
        <div className="text-xs text-cell-cyan">{title}</div>
        <div className="text-[11px] text-cell-teal/60">{hint}</div>
      </div>
      <Switch
        on={on}
        label={title}
        onToggle={() => {
          const next = !on;
          setPref(pref, next);
          setOn(next);
          onChange?.(next);
        }}
      />
    </Panel>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const adoptSave = useGame((s) => s.adoptSave);
  const activeSlot = useGame((s) => s.activeSlot);
  const [exported, setExported] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [codexOpen, setCodexOpen] = useState(false);

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
      <div className="mx-auto max-w-md space-y-3 pb-nav pt-safe px-2 sm:max-w-lg">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-base uppercase tracking-[0.3em] text-cell-cyan">
            Réglages
          </h1>
          <button onClick={onClose} aria-label="Fermer" className="px-3 py-2 text-base text-cell-teal/70 hover:text-cell-cyan">
            ✕
          </button>
        </div>

        {/* Le Codex (amélioration n°6) : l'aide À LA DEMANDE — le jeu invente une
            vingtaine de termes, un joueur qui rate une explication contextuelle
            doit pouvoir la retrouver ici. */}
        <Panel className="p-3">
          <button
            onClick={() => setCodexOpen(true)}
            className="pixel-btn w-full px-3 py-2 text-xs text-cell-cyan"
          >
            📖 CODEX — tous les mots du jeu, expliqués
          </button>
        </Panel>

        {/* Slot de sauvegarde : perso / dev */}
        <Panel className="flex flex-col items-center gap-2 p-3">
          <div className="text-xs text-cell-cyan">Partie active</div>
          <SlotSwitch compact />
        </Panel>

        {/* Mode développeur : uniquement dans le slot dev */}
        {activeSlot === "dev" && <DevPanel />}

        {/* Retour sensoriel — vibrations et son (piste 8 du diagnostic UX) */}
        <PrefToggle
          pref="vibrations"
          title="Vibrations légères"
          hint="Constructions, prises, mues (si ton appareil le permet)."
        />
        <PrefToggle
          pref="sons"
          title="Repères sonores"
          hint="Taps, chantiers, prises, vagues. Synthétisés : aucun téléchargement."
          onChange={(on) => {
            syncAudioPrefs();
            /* Une écoute immédiate à l'activation : sans elle, le joueur bascule
               l'interrupteur et n'entend rien jusqu'à sa prochaine action. */
            if (on) {
              unlockAudio();
              playCue("build_done");
            }
          }}
        />
        <PrefToggle
          pref="ambiance"
          title="Nappe d'ambiance"
          hint="Fond sous-marin très discret, coupé par défaut."
          onChange={() => syncAudioPrefs()}
        />

        {/* Rappels (piste 2) — masqué si le navigateur ne sait pas notifier */}
        <NotifSettings />

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

        {codexOpen && <CodexPanel onClose={() => setCodexOpen(false)} />}

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
