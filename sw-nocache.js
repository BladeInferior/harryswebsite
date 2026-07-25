// Registered from quizhub/quiz-nav.js, adminhub/admin-nav.js, and index.html
// — runs entirely in the visitor's own browser (no server, no cost, no
// usage limits; not related to the Cloudflare Worker used for GitHub
// export). Its only job is making sure a normal page load always reflects
// whatever's actually deployed, without ever needing a hard refresh.
//
// No offline support, no precaching, nothing stored in Cache Storage —
// unlike collection-hub/sw.js (which deliberately keeps a shell + runtime
// cache so collections stay browsable offline), these pages don't need
// that. This just forces every same-origin GET request to bypass the
// browser's own HTTP cache and re-validate with the server every time.
//
// Since a service worker's script file living at the site root defaults to
// scope "/" (covering the whole site), this quietly takes over any page
// collection-hub/sw.js doesn't already claim more specifically — the more
// specific scope always wins, so collection-hub keeps its own offline-
// capable behavior unchanged.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request, { cache: 'no-cache' }).catch(() => fetch(request))
    );
});
