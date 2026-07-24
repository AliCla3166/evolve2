/* Préférences LOCALES à l'appareil (hors sauvegarde de jeu, hors sync cloud) :
   la vibration est un choix de device, pas une donnée de partie. */
"use client";

const KEY = "evolve2_prefs";

export interface Prefs {
  vibrations: boolean;
}

const DEFAULTS: Prefs = { vibrations: true };

export function getPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  const next = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(next));
}

/** Vibration légère (no-op si non supporté — iOS — ou désactivée). */
export function vibrate(pattern: number | number[]): void {
  try {
    if (!getPrefs().vibrations) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* jamais bloquant */
  }
}

export const GAME_VERSION = "2.0.0";
