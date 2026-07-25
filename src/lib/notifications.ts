/* Rappels (piste 2 du diagnostic UX).
 *
 *  Le constat du diagnostic : « Rien. sw.js ne gère que le cache d'assets. »
 *  Un jeu d'attente qui ne sait pas rappeler que l'attente est finie perd son
 *  joueur exactement au moment où il avait quelque chose à lui montrer.
 *
 *  ---------------------------------------------------------------------------
 *  Pourquoi cette architecture et pas « une petite route serveur »
 *  ---------------------------------------------------------------------------
 *  Le diagnostic suggérait « une petite route serveur ou l'API showTrigger ».
 *  Aucune des deux n'est livrable aujourd'hui :
 *
 *   - le vrai push (Web Push + VAPID) suppose un serveur qui connaisse l'état
 *     de la partie. Or la partie vit dans le localStorage du téléphone : il n'y
 *     a pas de serveur, et la sync cloud Firebase attend encore trois actions
 *     manuelles (cf. JOURNAL). Écrire un backend push pour un jeu solo hors
 *     ligne serait une infrastructure entière au service de quatre rappels ;
 *   - `Notification.showTrigger` (TimestampTrigger) n'a jamais dépassé
 *     l'origin trial Chrome et n'existe sur aucun navigateur en production.
 *
 *  On assume donc trois couches honnêtes, de la plus fiable à la plus large :
 *
 *   1. SONDAGE CÔTÉ PAGE (`poll_seconds`) — tant que l'onglet vit (au premier
 *      plan ou en arrière-plan récent), c'est lui qui déclenche. Couvre le cas
 *      de très loin le plus fréquent : le joueur a laissé l'app ouverte.
 *   2. `periodicsync` DANS LE SERVICE WORKER — le système réveille le SW toutes
 *      les quelques heures quand la PWA est installée (Chromium/Android). Le SW
 *      ne peut pas lire le localStorage : la page lui laisse donc le planning
 *      dans IndexedDB, que le SW relit au réveil.
 *   3. `push` — les gestionnaires sont écrits et branchés. Le jour où un serveur
 *      existe, il n'y a rien à changer côté client.
 *
 *  Aucune couche ne ment au joueur : les Réglages annoncent des rappels, pas des
 *  alarmes à la seconde près.
 *
 *  ---------------------------------------------------------------------------
 *  Règle du projet
 *  ---------------------------------------------------------------------------
 *  Aucun nombre de réglage ni aucun texte visible ici : tout vient de
 *  src/data/notifications_config.json. Ce module ne fait que l'interpréter. */
"use client";

import rawConfig from "@/data/notifications_config.json";
import { getBuildingConfig } from "@/lib/game/economy";
import { fmtDurationShort } from "@/lib/game/format";
import { dayKey } from "@/lib/game/habits";
import type { GameState } from "@/lib/game/types";

/* ------------------------------------------------------------------ config */

/** Ce que fait une catégorie quand son heure tombe en heures calmes. */
export type QuietPolicy = "defer" | "skip" | "ignore";

export interface NotifCategory {
  id: string;
  label: string;
  hint: string;
  default_on: boolean;
  default_hour?: number;
  default_minute?: number;
  lead_h?: number;
  quiet: QuietPolicy;
  panel: string | null;
  title: string;
  body: string;
}

interface NotifConfig {
  schedule: {
    horizon_h: number;
    poll_seconds: number;
    stale_after_h: number;
    fired_history: number;
    suppress_when_visible: boolean;
    periodic_sync_tag: string;
    periodic_sync_min_interval_h: number;
  };
  quiet_hours: { start_h: number; end_h: number };
  permission: {
    ask_after_first_build: boolean;
    max_asks: number;
    reask_after_days: number;
    prompt_title: string;
    prompt_body: string;
    prompt_accept: string;
    prompt_decline: string;
    prompt_granted: string;
    prompt_denied: string;
    settings_title: string;
    settings_hint: string;
    settings_blocked: string;
    settings_ask: string;
    settings_hour_label: string;
  };
  categories: NotifCategory[];
}

export const NOTIF = rawConfig as unknown as NotifConfig;
export const NOTIF_CATEGORIES: ReadonlyArray<NotifCategory> = NOTIF.categories;

export function notifCategory(id: string): NotifCategory | null {
  return NOTIF.categories.find((c) => c.id === id) ?? null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/* ----------------------------------------------------------- préférences */

/** Préférences de rappel. Volontairement SÉPARÉES de `prefs.ts` : `PrefToggle`
 *  y est typé `keyof Prefs` avec des valeurs booléennes, et y glisser une heure
 *  (nombre) ou un compteur de demandes casserait ce typage pour tout le monde. */
export interface NotifPrefs {
  /** Opt-in par catégorie (clé = id de catégorie). */
  on: Record<string, boolean>;
  /** Heure locale du rappel d'habitudes, choisie par le joueur. */
  hour: number;
  minute: number;
  /** Nombre de fois où NOUS avons proposé (le prompt natif, lui, ne se joue qu'une fois). */
  asks: number;
  lastAskAt: number;
}

const PREFS_KEY = "evolve2_notifs";

export function defaultNotifPrefs(): NotifPrefs {
  const habits = notifCategory("habitudes");
  const on: Record<string, boolean> = {};
  for (const c of NOTIF.categories) on[c.id] = c.default_on;
  return {
    on,
    hour: habits?.default_hour ?? 20,
    minute: habits?.default_minute ?? 0,
    asks: 0,
    lastAskAt: 0,
  };
}

export function getNotifPrefs(): NotifPrefs {
  const base = defaultNotifPrefs();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<NotifPrefs>;
    return {
      on: { ...base.on, ...(saved.on ?? {}) },
      hour: typeof saved.hour === "number" ? saved.hour : base.hour,
      minute: typeof saved.minute === "number" ? saved.minute : base.minute,
      asks: typeof saved.asks === "number" ? saved.asks : 0,
      lastAskAt: typeof saved.lastAskAt === "number" ? saved.lastAskAt : 0,
    };
  } catch {
    return base;
  }
}

export function setNotifPrefs(patch: Partial<NotifPrefs>): NotifPrefs {
  const next = { ...getNotifPrefs(), ...patch };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* stockage plein ou refusé : les rappels dégradent, le jeu non */
    }
  }
  notifyPrefsChanged();
  return next;
}

/* Les Réglages et le planificateur vivent dans deux arbres différents : un
   petit bus évite de faire redescendre un callback à travers /play. */
type PrefsListener = () => void;
const prefsListeners = new Set<PrefsListener>();

export function onNotifPrefsChange(cb: PrefsListener): () => void {
  prefsListeners.add(cb);
  return () => prefsListeners.delete(cb);
}

function notifyPrefsChanged() {
  snapshot = null;
  for (const cb of prefsListeners) cb();
}

/* ------------------------------------------------- source externe React */

/** Ce que l'interface a besoin de savoir : l'autorisation du navigateur et les
 *  préférences du joueur. Les deux vivent HORS de React (permission système,
 *  localStorage) — d'où une vraie source externe lue par `useSyncExternalStore`
 *  plutôt qu'un `useState` amorcé dans un effet. Ce n'est pas une coquetterie :
 *  amorcer dans un effet, c'est un `setState` synchrone dans un corps d'effet
 *  (interdit par `react-hooks/set-state-in-effect`), et lire la permission
 *  pendant le rendu ferait diverger l'hydratation, la permission n'existant pas
 *  côté serveur. */
export interface NotifSnapshot {
  state: NotifState;
  prefs: NotifPrefs;
}

let snapshot: NotifSnapshot | null = null;

/** Instantané stable : la même référence tant que rien n'a changé, sinon React
 *  rerendrait en boucle. */
export function getNotifSnapshot(): NotifSnapshot {
  if (!snapshot) snapshot = { state: notifState(), prefs: getNotifPrefs() };
  return snapshot;
}

/** Instantané du rendu serveur — constant, donc jamais responsable d'une
 *  divergence d'hydratation. « unsupported » masque toute l'interface : c'est
 *  la vérité sur un serveur. */
const SERVER_SNAPSHOT: NotifSnapshot = { state: "unsupported", prefs: defaultNotifPrefs() };

export function getNotifServerSnapshot(): NotifSnapshot {
  return SERVER_SNAPSHOT;
}

export function subscribeNotifStore(cb: () => void): () => void {
  const off = onNotifPrefsChange(cb);
  if (typeof document === "undefined") return off;
  /* Le joueur peut débloquer les notifications depuis les réglages du
     navigateur, sans repasser par nous : au retour dans l'onglet, on relit. */
  const onVisible = () => {
    if (document.visibilityState === "visible") notifyPrefsChanged();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    off();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/* ------------------------------------------------------- heures calmes */

/** Vrai si l'horodatage tombe dans le créneau silencieux (qui enjambe minuit). */
export function inQuietHours(at: number, cfg = NOTIF.quiet_hours): boolean {
  const h = new Date(at).getHours();
  return cfg.start_h > cfg.end_h
    ? h >= cfg.start_h || h < cfg.end_h
    : h >= cfg.start_h && h < cfg.end_h;
}

/** Repousse au prochain `end_h` local (fin du créneau silencieux). */
function deferPastQuiet(at: number, cfg = NOTIF.quiet_hours): number {
  const d = new Date(at);
  if (d.getHours() >= cfg.start_h && cfg.start_h > cfg.end_h) d.setDate(d.getDate() + 1);
  d.setHours(cfg.end_h, 0, 0, 0);
  return d.getTime();
}

/** Applique la politique d'heures calmes de la catégorie. `null` = abandon. */
function applyQuiet(at: number, quiet: QuietPolicy): number | null {
  if (quiet === "ignore" || !inQuietHours(at)) return at;
  return quiet === "defer" ? deferPastQuiet(at) : null;
}

/* ------------------------------------------------------------- planning */

/** Un rappel daté, prêt à être affiché. Sérialisable : il transite par IndexedDB
 *  jusqu'au service worker, qui n'a accès ni au store ni au localStorage. */
export interface ScheduledNote {
  /** Identifiant stable — sert à ne pas sonner deux fois pour le même fait. */
  id: string;
  category: string;
  at: number;
  title: string;
  body: string;
  /** Panneau à ouvrir au clic (`?panel=…`), ou null pour la base. */
  panel: string | null;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Le planning complet des rappels à venir, dans l'ordre chronologique.
 *
 *  Fonction PURE : elle ne lit ni l'horloge ni le stockage, tout arrive en
 *  paramètre. C'est ce qui la rend testable hors navigateur — et c'est le seul
 *  endroit où les quatre déclencheurs du diagnostic sont décrits. */
export function computeSchedule(
  state: GameState,
  prefs: NotifPrefs,
  now: number,
): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  const horizon = now + NOTIF.schedule.horizon_h * HOUR_MS;

  const push = (cat: NotifCategory, at: number, id: string, vars: Record<string, string>) => {
    const when = applyQuiet(at, cat.quiet);
    if (when === null || when <= now || when > horizon) return;
    out.push({
      id,
      category: cat.id,
      at: when,
      title: fill(cat.title, vars),
      body: fill(cat.body, vars),
      panel: cat.panel,
    });
  };

  /* 1. Rappel d'habitudes — le seul qui serve directement le pilier n°1.
        Il ne part QUE si la journée n'a encore aucune habitude validée : la
        meilleure façon de se faire couper est de rappeler à quelqu'un de faire
        ce qu'il vient de faire. Les jours suivants sont planifiés d'avance mais
        recalculés à chaque ouverture — valider aujourd'hui retire aussitôt le
        rappel du planning miroir lu par le service worker. */
  const habits = notifCategory("habitudes");
  if (habits && prefs.on[habits.id]) {
    for (let d = 0; d * DAY_MS <= horizon - now + DAY_MS; d++) {
      const day = new Date(now + d * DAY_MS);
      day.setHours(prefs.hour, prefs.minute, 0, 0);
      const at = day.getTime();
      if (at <= now) continue;
      const key = dayKey(at);
      const entry = state.habits.days[key];
      if (entry && entry.validatedCount > 0) continue;
      push(habits, at, `hab:${key}`, {});
    }
  }

  /* 2. Chantier terminé — « aujourd'hui l'événement le plus invisible du jeu » :
        un chantier de 40 h s'achevait sans que rien ne le dise à un absent.
        L'identifiant ignore volontairement `endsAt` : racheter des heures en
        énergie (piste 4) déplace la date sans créer un second rappel. */
  const chantier = notifCategory("chantier");
  if (chantier && prefs.on[chantier.id]) {
    for (const task of state.buildQueue) {
      push(chantier, task.endsAt, `bld:${task.buildingId}:${task.targetLevel}`, {
        batiment: getBuildingConfig(task.buildingId).name,
        niveau: String(task.targetLevel),
      });
    }
  }

  /* 3. Vague imminente — la bannière WaveWarning ne s'affiche que dans les 12
        dernières heures ET seulement application ouverte. */
  const vague = notifCategory("vague");
  if (vague && prefs.on[vague.id] && state.nextAttackAt > 0) {
    const lead = (vague.lead_h ?? 0) * HOUR_MS;
    push(vague, state.nextAttackAt - lead, `wav:${state.nextAttackAt}`, {
      dans: fmtDurationShort(lead),
    });
  }

  /* 4. Décision qui expire — le seul contenu réellement périssable du jeu. */
  const evenement = notifCategory("evenement");
  if (evenement && prefs.on[evenement.id] && state.pendingEvent) {
    const lead = (evenement.lead_h ?? 0) * HOUR_MS;
    const exp = state.pendingEvent.expiresAt;
    push(evenement, exp - lead, `evt:${exp}`, { restant: fmtDurationShort(lead) });
  }

  return out.sort((a, b) => a.at - b.at);
}

/** Les rappels dus maintenant, périmés écartés.
 *
 *  `stale_after_h` évite le pire scénario d'un planning en différé : le
 *  navigateur se réveille au bout de trois jours et déverse d'un coup une pile
 *  de rappels dont plus aucun n'est vrai. */
export function dueNotes(
  notes: ScheduledNote[],
  fired: ReadonlyArray<string>,
  now: number,
): ScheduledNote[] {
  const seen = new Set(fired);
  const stale = NOTIF.schedule.stale_after_h * HOUR_MS;
  return notes.filter((n) => !seen.has(n.id) && n.at <= now && now - n.at <= stale);
}

/* --------------------------------------------------- miroir IndexedDB */

const DB_NAME = "evolve2-notif";
const DB_STORE = "kv";
const KEY_SCHEDULE = "schedule";
const KEY_FIRED = "fired";
const KEY_PARAMS = "params";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    /* Navigation privée Firefox, quota refusé… : pas de miroir, le sondage
       côté page continue de fonctionner. */
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* --------------------------------------------------------- permission */

export type NotifState = "unsupported" | "default" | "granted" | "denied";

export function notifState(): NotifState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifState;
}

/** Faut-il proposer NOTRE demande maison ?
 *
 *  Le prompt natif ne se joue qu'une fois par installation : le brûler au
 *  premier lancement, sur un joueur qui n'a encore rien à recevoir, c'est un
 *  « Bloquer » définitif. On attend donc la première fin de chantier — le
 *  moment exact où le joueur vient de comprendre ce qu'il aurait pu rater. */
export function shouldOfferOptIn(now: number, snap = getNotifSnapshot()): boolean {
  const prefs = snap.prefs;
  if (!NOTIF.permission.ask_after_first_build) return false;
  if (snap.state !== "default") return false;
  if (prefs.asks >= NOTIF.permission.max_asks) return false;
  if (prefs.asks > 0 && now - prefs.lastAskAt < NOTIF.permission.reask_after_days * DAY_MS) {
    return false;
  }
  return true;
}

export function recordOptInAsk(now: number): void {
  const prefs = getNotifPrefs();
  setNotifPrefs({ asks: prefs.asks + 1, lastAskAt: now });
}

/** Déclenche le prompt natif. À n'appeler que depuis un geste du joueur. */
export async function requestNotifPermission(): Promise<NotifState> {
  if (notifState() === "unsupported") return "unsupported";
  try {
    const res = await Notification.requestPermission();
    if (res === "granted") void registerPeriodicSync();
    return res as NotifState;
  } catch {
    return notifState();
  } finally {
    notifyPrefsChanged(); // l'autorisation a bougé : l'interface doit le voir
  }
}

/* ------------------------------------------------------------ affichage */

/** Affiche un rappel. Passe par le service worker quand il y en a un (seul
 *  moyen d'avoir un `notificationclick` qui rouvre l'app), sinon retombe sur
 *  `new Notification` — ce qui couvre le mode développement, où le SW n'est
 *  volontairement pas enregistré. */
async function showNote(note: ScheduledNote): Promise<boolean> {
  if (notifState() !== "granted") return false;
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: note.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: note.id,
    data: { panel: note.panel },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(note.title, opts);
      return true;
    }
  } catch {
    /* on tente la voie directe ci-dessous */
  }
  try {
    new Notification(note.title, opts);
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------- planificateur */

let timer: ReturnType<typeof setInterval> | null = null;
let cleanup: (() => void) | null = null;
let firedCache: string[] = [];
let lastMirror = "";

async function loadFired(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  firedCache = (await idbGet<string[]>(db, KEY_FIRED)) ?? [];
  db.close();
}

async function saveFired(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await idbPut(db, KEY_FIRED, firedCache);
  db.close();
}

/** Dépose le planning là où le service worker saura le relire.
 *
 *  Il y va aussi les deux seuls réglages dont le SW a besoin : `sw.js` est un
 *  fichier statique de public/, il ne peut pas importer le JSON de config, et
 *  recopier `stale_after_h` en dur dedans créerait exactement la deuxième
 *  source de vérité que le projet s'interdit. */
async function mirrorSchedule(notes: ScheduledNote[]): Promise<void> {
  const json = JSON.stringify(notes);
  if (json === lastMirror) return; // rien n'a bougé : pas de transaction inutile
  lastMirror = json;
  const db = await openDb();
  if (!db) return;
  await idbPut(db, KEY_SCHEDULE, notes);
  await idbPut(db, KEY_PARAMS, {
    staleAfterMs: NOTIF.schedule.stale_after_h * HOUR_MS,
    firedHistory: NOTIF.schedule.fired_history,
    icon: "/icons/icon-192.png",
  });
  db.close();
}

/** Un tour de planificateur : recalcule, dépose le miroir, sonne ce qui est dû. */
async function tickScheduler(read: () => GameState | null, now: number): Promise<void> {
  const state = read();
  if (!state) return;
  const prefs = getNotifPrefs();
  const notes = computeSchedule(state, prefs, now);
  await mirrorSchedule(notes);

  if (notifState() !== "granted") return;

  /* Le joueur regarde l'écran : l'information est déjà à l'écran (modale de fin
     de chantier, bannière de vague, modale d'événement). Une notification par
     dessus serait du bruit — on la marque tirée sans la montrer. */
  const visible =
    NOTIF.schedule.suppress_when_visible &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible";

  const due = dueNotes(notes, firedCache, now);
  if (!due.length) return;

  for (const note of due) {
    if (!visible) await showNote(note);
    firedCache.push(note.id);
  }
  if (firedCache.length > NOTIF.schedule.fired_history) {
    firedCache = firedCache.slice(-NOTIF.schedule.fired_history);
  }
  await saveFired();
}

/** Démarre le sondage côté page. Renvoie de quoi l'arrêter. */
export function startNotificationScheduler(read: () => GameState | null): () => void {
  if (typeof window === "undefined") return () => {};
  if (timer) return stopNotificationScheduler;

  const run = () => void tickScheduler(read, Date.now());
  void loadFired().then(run);
  timer = setInterval(run, NOTIF.schedule.poll_seconds * 1000);

  /* Revenir au premier plan après une longue mise en veille doit rattraper
     immédiatement, sans attendre le prochain battement d'une minute. */
  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", onVisible);
  const offPrefs = onNotifPrefsChange(run);

  cleanup = () => {
    document.removeEventListener("visibilitychange", onVisible);
    offPrefs();
  };
  return stopNotificationScheduler;
}

export function stopNotificationScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  cleanup?.();
  cleanup = null;
}

/** Demande au système de réveiller le service worker périodiquement. Silencieux
 *  et sans conséquence là où l'API n'existe pas (iOS, Firefox, desktop non
 *  installé) : les couches 1 et 3 restent en place. */
export async function registerPeriodicSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    const periodic = (reg as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (tag: string, opts: { minInterval: number }) => Promise<void>;
      };
    }).periodicSync;
    if (!periodic) return;
    const status = await navigator.permissions
      ?.query({ name: "periodic-background-sync" as PermissionName })
      .catch(() => null);
    if (status && status.state !== "granted") return;
    await periodic.register(NOTIF.schedule.periodic_sync_tag, {
      minInterval: NOTIF.schedule.periodic_sync_min_interval_h * HOUR_MS,
    });
  } catch {
    /* non supporté : rien à réparer */
  }
}

/* ------------------------------------------- ouverture par notification */

/** Panneau demandé par un clic sur notification.
 *
 *  Deux chemins arrivent ici et un seul abonnement les absorbe : le message
 *  posté par le service worker (application déjà ouverte) et le `?panel=` de
 *  l'URL (application lancée par le clic). Le paramètre est retiré aussitôt —
 *  sinon un rechargement rouvrirait le panneau des jours plus tard.
 *
 *  La livraison de l'URL passe par une micro-tâche : appeler l'abonné en
 *  synchrone reviendrait à faire un setState pendant le corps d'un effet, ce
 *  que la règle `react-hooks/set-state-in-effect` du projet interdit. */
export function subscribeNotificationOpen(cb: (panel: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; panel?: string | null } | null;
    if (data?.type === "evolve-notif-open") cb(data.panel ?? null);
  };
  navigator.serviceWorker?.addEventListener("message", onMessage);

  const url = new URL(window.location.href);
  const panel = url.searchParams.get("panel");
  if (panel !== null) {
    url.searchParams.delete("panel");
    window.history.replaceState(window.history.state, "", url.toString());
    queueMicrotask(() => cb(panel || null));
  }

  return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
}
