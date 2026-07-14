// Offline support for Collection Hub. Registered from collection-nav.js,
// which every page in this folder loads, so scope naturally covers the
// whole collection-hub/ directory (plus ../navbar.css and ../navbar.html,
// the two shared assets outside it that every page also needs).
//
// Bump this on any change to SHELL_URLS or the caching strategy — it's
// what forces old clients to pick up the new service worker and re-run
// install() instead of serving a stale cache forever.
const CACHE_VERSION = 'collection-hub-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// The "app shell" — small enough to fetch upfront on install, so every
// page/dataset is browsable offline even if it was never actually visited
// while online. Images are NOT precached here (there are hundreds of them
// across every collection) — those get cached the first time each page
// renders them, via the runtime cache-first handler below.
const SHELL_URLS = [
    'manifest.json',
    'cards.html',
    'collectionhub.html',
    'pokedexes.html',
    'popfigures.html',
    'sleeves.html',
    'steelbooks.html',
    'pins.html',
    'completions.html',
    'collection-nav.js',
    'mobile-popout.js',
    'recent-set.js',
    'cards.js',
    'pokedexes.js',
    'collections.js',
    'style.css',
    '../navbar.css',
    '../navbar.html',
    'icons/app-icon.png',
    'cards-pokeballs-backup.json',
    'cards-pokemon-backup.json',
    'cards-rampardos-backup.json',
    'cards-stadiums-backup.json',
    'cards-trainers-backup.json',
    'completions-backup.json',
    'fullPokemonList.json',
    'pokedex-backup.json',
    'popfigures-backup.json',
    'sleeves-backup.json',
    'steelbooks-backup.json',
    'pins-backup.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => Promise.all(SHELL_URLS.map(url =>
                // Cached one at a time rather than cache.addAll(SHELL_URLS) —
                // addAll fails (and precaches nothing) if even one URL 404s,
                // and pins-backup.json doesn't exist on disk yet.
                cache.add(url).catch(err => console.warn(`Collection Hub SW: precache skipped for ${url}`, err))
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith('collection-hub-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Images are effectively immutable once uploaded, so cache-first keeps
    // repeat views instant and offline-capable. Everything else (HTML/JS/
    // CSS/JSON) is network-first, so an online visit always reflects the
    // latest exported data — the cached copy is only a fallback for when
    // the network request actually fails.
    event.respondWith(
        request.destination === 'image' ? cacheFirst(request) : networkFirst(request)
    );
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        // Every extension in an item's fallback chain (.png/.jpg/.webp)
        // passes through here — Response.error() reproduces a real network
        // failure so the <img>'s onerror handler advances to the next
        // extension exactly like it would online, instead of hanging.
        return Response.error();
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw err;
    }
}
