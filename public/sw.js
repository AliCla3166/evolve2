/* Service worker EVOLVE v3 — volontairement MINIMAL et sans risque :
   - cache-first UNIQUEMENT sur /assets/ et /icons/ (pixel art immuable) ;
   - tout le reste (pages, chunks JS/CSS) passe au réseau : un déploiement
     Vercel n'est jamais masqué par un cache périmé ;
   - depuis l'étape 9 : les rappels (piste 2 du diagnostic UX).
   Le jeu lui-même fonctionne hors ligne via localStorage (rattrapage au tick).

   AUCUN texte de rappel ni aucun réglage n'est écrit ici. Un service worker est
   un fichier statique de public/ : il ne peut pas importer le JSON de config du
   projet. Recopier des libellés ou des délais dedans créerait une deuxième
   source de vérité qui divergerait au premier ajustement. Il ne fait donc que
   RELIRE ce que la page a déposé dans IndexedDB (src/lib/notifications.ts). */
const CACHE = "evolve2-assets-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isImmutableAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"));
  if (!isImmutableAsset || event.request.method !== "GET") return; // réseau normal

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }),
  );
});

/* ==========================================================================
   Rappels (piste 2 du diagnostic UX)
   ========================================================================== */

const DB_NAME = "evolve2-notif";
const DB_STORE = "kv";

function openDb() {
  return new Promise((resolve) => {
    let req;
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
  });
}

function idbGet(db, key) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch {
      resolve();
    }
  });
}

/** Une fenêtre du jeu est-elle visible ? Si oui, l'information est déjà à
    l'écran (modale de chantier, bannière de vague) : on se tait. */
async function aClientIsVisible() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.some((c) => c.visibilityState === "visible");
}

/** Cœur du réveil périodique : relit le planning déposé par la page et sonne
    ce qui est dû. Sans planning ni paramètres en base, il n'y a rien à faire —
    aucune valeur de repli en dur, volontairement. */
async function fireDueNotes() {
  const db = await openDb();
  if (!db) return;
  const [notes, params, firedRaw] = await Promise.all([
    idbGet(db, "schedule"),
    idbGet(db, "params"),
    idbGet(db, "fired"),
  ]);
  if (!Array.isArray(notes) || !params) return db.close();

  const now = Date.now();
  const fired = Array.isArray(firedRaw) ? firedRaw : [];
  const seen = new Set(fired);
  /* `staleAfterMs` : au réveil d'un navigateur endormi trois jours, on ne
     déverse pas une pile de rappels dont plus aucun n'est vrai. */
  const due = notes.filter(
    (n) => n && !seen.has(n.id) && n.at <= now && now - n.at <= params.staleAfterMs,
  );
  if (!due.length) return db.close();

  const quiet = await aClientIsVisible();
  for (const note of due) {
    if (!quiet) {
      await self.registration.showNotification(note.title, {
        body: note.body,
        icon: params.icon,
        badge: params.icon,
        tag: note.id,
        data: { panel: note.panel ?? null },
      });
    }
    fired.push(note.id);
  }
  await idbPut(db, "fired", fired.slice(-params.firedHistory));
  db.close();
}

/* Réveil offert par le système aux PWA installées (Chromium/Android). Ailleurs
   l'événement n'arrive jamais : le sondage côté page prend le relais.
   L'étiquette est un identifiant de protocole entre ce fichier et la page :
   elle doit rester identique a `schedule.periodic_sync_tag` du JSON de config. */
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "evolve-rappels") event.waitUntil(fireDueNotes());
});

/* Le jour où un serveur push existera, il n'y aura rien à changer côté client :
   soit il envoie une charge utile complète, soit il se contente de réveiller le
   worker, qui retombe alors sur le planning local. */
self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || !payload.title) {
    event.waitUntil(fireDueNotes());
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? "",
      icon: payload.icon ?? "/icons/icon-192.png",
      badge: payload.icon ?? "/icons/icon-192.png",
      tag: payload.tag,
      data: { panel: payload.panel ?? null },
    }),
  );
});

/* Un rappel qui ouvre la base au lieu du panneau concerné rate sa cible : on
   route vers le panneau. Application déjà ouverte -> on la ramène au premier
   plan et on lui poste le panneau (pas de rechargement, la partie en cours est
   préservée). Application fermée -> on l'ouvre sur /play?panel=… */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const panel = (event.notification.data && event.notification.data.panel) || null;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = list.find((c) => c.url.includes("/play"));
      if (open) {
        await open.focus();
        open.postMessage({ type: "evolve-notif-open", panel });
        return;
      }
      const url = panel ? `/play?panel=${encodeURIComponent(panel)}` : "/play";
      await self.clients.openWindow(url);
    })(),
  );
});
