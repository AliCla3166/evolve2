/* Service worker EVOLVE v2 — volontairement MINIMAL et sans risque :
   - cache-first UNIQUEMENT sur /assets/ et /icons/ (pixel art immuable) ;
   - tout le reste (pages, chunks JS/CSS) passe au réseau : un déploiement
     Vercel n'est jamais masqué par un cache périmé.
   Le jeu lui-même fonctionne hors ligne via localStorage (rattrapage au tick). */
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
