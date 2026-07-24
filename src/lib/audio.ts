/* Design sonore (piste 8 du diagnostic UX).
 *
 * Le jeu n'avait AUCUN son. C'était l'écart le plus visible entre sa qualité
 * visuelle et sa qualité perçue — un jeu muet est lu comme un prototype.
 *
 * Parti pris : zéro échantillon audio. Tout est synthétisé en WebAudio à
 * partir de `audio_config.json`, qui décrit chaque repère comme une pile de
 * couches (oscillateur ou bruit filtré, avec enveloppe). Le diagnostic notait
 * lui-même que « le coût est dans les samples » : en synthétisant on supprime
 * le pipeline d'assets, le poids de bundle, le préchargement et les licences,
 * et la palette organique demandée (bulles, membranes, pulsations) se prête
 * particulièrement bien à quelques oscillateurs et un bruit passé au filtre.
 *
 * Ce module n'écrit AUCUNE valeur de réglage : il ne fait qu'interpréter le
 * catalogue, conformément à la règle du projet (tout le tuning en JSON).
 *
 * Contraintes de plateforme prises en compte :
 *   - iOS n'autorise la création/reprise d'un AudioContext que dans un geste
 *     utilisateur : `unlockAudio()` est appelé depuis le tout premier
 *     `pointerdown` capté par `installAudio()`, avant tout autre traitement ;
 *   - WebAudio seul (aucun élément <audio>) reste soumis à l'interrupteur
 *     silencieux d'iOS — c'est le comportement attendu, on n'ajoute rien ;
 *   - le contexte est suspendu quand l'onglet passe en arrière-plan, pour ne
 *     pas garder un oscillateur vivant en tâche de fond sur mobile ;
 *   - toute la surface publique est enveloppée : une exception audio ne doit
 *     jamais pouvoir casser une action de jeu. */
"use client";

import RAW from "@/data/audio_config.json";
import { getPrefs } from "./prefs";

/* ------------------------------------------------------------------ types */

interface AudioFilter {
  type: BiquadFilterType;
  freq: number;
  to_freq?: number;
  q?: number;
}

interface AudioLayer {
  type: "tone" | "noise";
  wave?: OscillatorType;
  freq?: number;
  to_freq?: number;
  detune?: number;
  start?: number;
  dur: number;
  gain: number;
  attack?: number;
  release?: number;
  filter?: AudioFilter;
}

interface AudioCue {
  throttle_ms?: number;
  transpose_semitones?: number;
  layers: AudioLayer[];
}

interface AmbienceConfig {
  gain: number;
  fade_ms: number;
  drone: { wave: OscillatorType; freq: number; gain: number; detune?: number }[];
  filter: AudioFilter;
  lfo: { freq: number; depth: number };
  bubble_cue: string;
  bubble_steps: number;
  bubble_min_ms: number;
  bubble_max_ms: number;
}

interface AudioConfig {
  master_gain: number;
  max_voices: number;
  reveal_by_rarity: string[];
  cues: Record<string, AudioCue>;
  ambience: AmbienceConfig;
}

/* Le JSON porte des commentaires `$comment` et des littéraux `string` là où
   WebAudio attend des unions (`OscillatorType`, `BiquadFilterType`) : une
   assertion unique ici vaut mieux que des casts dispersés à l'usage. */
export const AUDIO = RAW as unknown as AudioConfig;

export type CueId = string;

/** Repère de révélation correspondant à une rareté (0-5). */
export function revealCue(rarity: number): CueId {
  const table = AUDIO.reveal_by_rarity;
  return table[Math.min(Math.max(rarity, 0), table.length - 1)];
}

/* ------------------------------------------------------------ contexte */

type CtxCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let voices = 0;
const lastAt: Record<string, number> = {};

function ctor(): CtxCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Le contexte n'est créé qu'à la demande, et jamais côté serveur. */
function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const C = ctor();
  if (!C) return null;
  try {
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = AUDIO.master_gain;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Bruit blanc décodé UNE fois puis rejoué en boucle par toutes les couches. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  /* Bruit décoratif, hors logique de jeu : `Math.random` est ici sans
     conséquence sur la reproductibilité d'une partie (à la différence du PRNG
     seedé de military.ts, qui reste la règle pour tout ce qui est simulé). */
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Débloque le contexte audio. À appeler dans un geste utilisateur (iOS). */
export function unlockAudio(): void {
  try {
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") void c.resume();
    // La nappe demandée avant le premier geste n'a pas pu démarrer : c'est ici
    // qu'elle prend enfin, une fois le contexte réellement autorisé.
    if (wantAmbience && !amb && getPrefs().sons) startAmbience();
  } catch {
    /* jamais bloquant */
  }
}

/* ---------------------------------------------------------- restitution */

const MIN_GAIN = 0.0001; // exponentialRamp interdit la valeur zéro

function playLayer(c: AudioContext, dest: AudioNode, L: AudioLayer, t0: number, mul: number): void {
  const start = t0 + (L.start ?? 0);
  const dur = Math.max(L.dur, 0.01);
  const end = start + dur;
  const atk = Math.min(L.attack ?? 0.008, dur * 0.5);
  const rel = Math.min(L.release ?? dur * 0.6, dur - atk);

  const g = c.createGain();
  g.gain.setValueAtTime(MIN_GAIN, start);
  g.gain.linearRampToValueAtTime(L.gain, start + atk);
  g.gain.setValueAtTime(L.gain, Math.max(start + atk, end - rel));
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, end);

  let src: OscillatorNode | AudioBufferSourceNode;
  if (L.type === "noise") {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    s.loop = true;
    src = s;
  } else {
    const o = c.createOscillator();
    o.type = L.wave ?? "sine";
    const f = (L.freq ?? 440) * mul;
    o.frequency.setValueAtTime(f, start);
    if (L.to_freq !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, L.to_freq * mul), end);
    if (L.detune !== undefined) o.detune.setValueAtTime(L.detune, start);
    src = o;
  }

  if (L.filter) {
    const bq = c.createBiquadFilter();
    bq.type = L.filter.type;
    bq.frequency.setValueAtTime(Math.max(1, L.filter.freq), start);
    if (L.filter.to_freq !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(1, L.filter.to_freq), end);
    if (L.filter.q !== undefined) bq.Q.setValueAtTime(L.filter.q, start);
    src.connect(bq);
    bq.connect(g);
  } else {
    src.connect(g);
  }
  g.connect(dest);

  voices++;
  src.onended = () => {
    voices = Math.max(0, voices - 1);
    try {
      g.disconnect();
    } catch {
      /* déjà détaché */
    }
  };
  src.start(start);
  src.stop(end + 0.02);
}

/**
 * Joue un repère du catalogue.
 * @param id   clé de `cues` dans audio_config.json
 * @param step nombre de crans de transposition (voir `transpose_semitones`)
 */
export function playCue(id: CueId, step = 0): void {
  try {
    if (!getPrefs().sons) return;
    const cue = AUDIO.cues[id];
    if (!cue) return;

    const c = ensure();
    if (!c || !master) return;
    if (c.state === "suspended") void c.resume();

    const now = performance.now();
    const gate = cue.throttle_ms ?? 0;
    if (gate > 0 && now - (lastAt[id] ?? -Infinity) < gate) return;
    lastAt[id] = now;

    if (voices + cue.layers.length > AUDIO.max_voices) return;

    const semis = (cue.transpose_semitones ?? 0) * step;
    const mul = semis === 0 ? 1 : Math.pow(2, semis / 12);
    const t0 = c.currentTime + 0.005; // marge : planifier dans le passé claque
    for (const L of cue.layers) playLayer(c, master, L, t0, mul);
  } catch {
    /* le son ne doit jamais empêcher une action de jeu */
  }
}

/* ------------------------------------------------------------ ambiance */

interface Ambience {
  out: GainNode;
  nodes: (OscillatorNode | BiquadFilterNode | GainNode)[];
  timer: ReturnType<typeof setTimeout> | null;
}
let amb: Ambience | null = null;
/* Souhait du joueur, distinct de l'état réel : la nappe peut être demandée
   avant que le contexte n'existe (on ne crée jamais d'AudioContext hors geste
   utilisateur — inutile, et refusé par iOS). */
let wantAmbience = false;

function stopAmbience(): void {
  if (!amb || !ctx) return;
  const a = amb;
  amb = null;
  if (a.timer) clearTimeout(a.timer);
  const t = ctx.currentTime;
  const fade = AUDIO.ambience.fade_ms / 1000;
  try {
    a.out.gain.cancelScheduledValues(t);
    a.out.gain.setValueAtTime(Math.max(a.out.gain.value, MIN_GAIN), t);
    a.out.gain.exponentialRampToValueAtTime(MIN_GAIN, t + fade);
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    for (const n of a.nodes) {
      try {
        if ("stop" in n) n.stop();
        n.disconnect();
      } catch {
        /* déjà arrêté */
      }
    }
    try {
      a.out.disconnect();
    } catch {
      /* ignore */
    }
  }, AUDIO.ambience.fade_ms + 60);
}

function startAmbience(): void {
  const c = ctx; // jamais `ensure()` ici : cf. `wantAmbience`
  if (!c || !master || amb) return;
  const A = AUDIO.ambience;

  const out = c.createGain();
  const t = c.currentTime;
  out.gain.setValueAtTime(MIN_GAIN, t);
  out.gain.exponentialRampToValueAtTime(A.gain, t + A.fade_ms / 1000);

  const bq = c.createBiquadFilter();
  bq.type = A.filter.type;
  bq.frequency.value = A.filter.freq;
  if (A.filter.q !== undefined) bq.Q.value = A.filter.q;
  bq.connect(out);
  out.connect(master);

  const nodes: (OscillatorNode | BiquadFilterNode | GainNode)[] = [bq];
  for (const d of A.drone) {
    const o = c.createOscillator();
    o.type = d.wave;
    o.frequency.value = d.freq;
    if (d.detune !== undefined) o.detune.value = d.detune;
    const g = c.createGain();
    g.gain.value = d.gain;
    o.connect(g);
    g.connect(bq);
    o.start();
    nodes.push(o, g);
  }

  /* Respiration lente : le LFO module le gain de sortie, ce qui suffit à
     empêcher l'oreille de figer la nappe en bourdonnement. */
  const lfo = c.createOscillator();
  lfo.frequency.value = A.lfo.freq;
  const lfoGain = c.createGain();
  lfoGain.gain.value = A.gain * A.lfo.depth;
  lfo.connect(lfoGain);
  lfoGain.connect(out.gain);
  lfo.start();
  nodes.push(lfo, lfoGain);

  amb = { out, nodes, timer: null };

  const schedule = () => {
    if (!amb) return;
    const span = A.bubble_max_ms - A.bubble_min_ms;
    amb.timer = setTimeout(() => {
      if (!amb) return;
      playCue(A.bubble_cue, Math.floor(Math.random() * A.bubble_steps));
      schedule();
    }, A.bubble_min_ms + Math.random() * span);
  };
  schedule();
}

/** Active ou coupe la nappe d'ambiance (coupée par défaut). */
export function setAmbience(on: boolean): void {
  try {
    wantAmbience = on;
    if (on && getPrefs().sons) startAmbience();
    else stopAmbience();
  } catch {
    /* jamais bloquant */
  }
}

/** À appeler quand les préférences audio changent, pour appliquer tout de suite. */
export function syncAudioPrefs(): void {
  const p = getPrefs();
  setAmbience(p.sons && p.ambiance);
}

/* --------------------------------------------------------- installation */

/** Sélecteur des éléments qui « sonnent » au tap. Un seul écouteur délégué
 *  couvre les ~40 boutons du jeu sans toucher un seul composant. */
const TAPPABLE = "button, a[href], [role='switch'], [role='button']";

/**
 * Installe l'audio pour toute la session de jeu :
 *   - déblocage du contexte au premier geste (contrainte iOS) ;
 *   - repère de tap sur n'importe quel bouton, par délégation ;
 *   - suspension du contexte quand l'onglet passe en arrière-plan ;
 *   - démarrage de la nappe d'ambiance si elle est activée.
 * Renvoie la fonction de désinstallation (à rendre depuis un `useEffect`).
 */
export function installAudio(): () => void {
  const onDown = (e: Event) => {
    unlockAudio();
    const target = e.target;
    if (!(target instanceof Element)) return;
    const el = target.closest(TAPPABLE);
    if (!el) return;
    if (el instanceof HTMLButtonElement && el.disabled) return;
    if (el.getAttribute("aria-disabled") === "true") return;
    playCue("ui_tap");
  };

  const onVisibility = () => {
    if (!ctx) return;
    try {
      if (document.visibilityState === "hidden") void ctx.suspend();
      else if (getPrefs().sons) void ctx.resume();
    } catch {
      /* ignore */
    }
  };

  // En capture : le repère part même si un handler appelle stopPropagation.
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("visibilitychange", onVisibility);
  syncAudioPrefs();

  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("visibilitychange", onVisibility);
    stopAmbience();
  };
}
