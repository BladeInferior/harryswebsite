// This file itself always lives at collection-hub/collection-nav.js, but the
// pages loading it don't all sit at the same depth any more — collectionhub.html
// is still directly in collection-hub/, while every other page now lives one
// folder deeper (e.g. collection-hub/cards/cards.html). fetch() and
// serviceWorker.register() both resolve a relative URL against the CALLING
// PAGE, not this script's own location, so a plain relative path here would
// only be correct for whichever depth happened to be tested first. Anchoring
// explicitly to this script's own URL (document.currentScript.src) keeps it
// correct regardless of which page — or which depth — loaded it.
const COLLECTION_NAV_SCRIPT_URL = document.currentScript.src;

// Registered here (not per-page) since every collection-hub page loads this
// file — one registration covers offline support for all of them. Scope
// defaults to sw.js's own directory, i.e. everything under collection-hub/,
// which is exactly what sw.js needs to intercept.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('sw.js', COLLECTION_NAV_SCRIPT_URL))
        .catch(err => console.error('Service worker registration failed:', err));
}

fetch(new URL('../navbar.html', COLLECTION_NAV_SCRIPT_URL))
    .then(res => res.text())
    .then(data => {
        document.getElementById('navbar').innerHTML = data;

        const nav = document.querySelector('.site-nav');
        nav.classList.add('collection-theme');

        const basePath =
            window.location.hostname === "bladeinferior.github.io"
                ? "/harryswebsite/"
                : "/";

        document.querySelectorAll('#navbar [data-page]').forEach(link => {
            link.href = basePath + link.dataset.page;
        });

        const subPages = [
            { label: "Pokédex", page: "collection-hub/pokedexes/pokedexes.html" },
            { label: "Sleeves", page: "collection-hub/sleeves/sleeves.html" },
            { label: "Cards", page: "collection-hub/cards/cards.html" },
            { label: "Steelbooks", page: "collection-hub/steelbooks/steelbooks.html" },
            { label: "Completions", page: "collection-hub/completions/completions.html" },
            { label: "Pop Figures", page: "collection-hub/popfigures/popfigures.html" },
            { label: "Pins", page: "collection-hub/pins/pins.html" },
        ];

        const linksContainer = nav.querySelector('.site-nav-links');

        // Sub-links go before the whole site-level group (Collection Hub,
        // Quiz Hub, Github Repo), which always starts with Collection Hub.
        const groupStart = Array.from(linksContainer.querySelectorAll('a'))
            .find(a => a.dataset.page === "collection-hub/collectionhub.html");

        subPages.forEach(({ label, page }) => {
            const a = document.createElement('a');
            a.textContent = label;
            a.href = basePath + page;

            if (window.location.pathname.endsWith(page.split('/').pop())) {
                a.classList.add('active-link');
            }

            groupStart.insertAdjacentElement('beforebegin', a);
        });

        // Marks the boundary between this hub's own links and the
        // site-level group that follows.
        const divider = document.createElement('span');
        divider.className = 'nav-divider';
        groupStart.insertAdjacentElement('beforebegin', divider);

        if (window.location.pathname.endsWith('collectionhub.html')) {
            groupStart.classList.add('active-link');
        }

        // Mobile dropdown toggle
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'nav-toggle';
        toggleBtn.textContent = '☰';
        toggleBtn.setAttribute('aria-label', 'Toggle navigation menu');

        nav.insertBefore(toggleBtn, linksContainer);

        toggleBtn.addEventListener('click', () => {
            linksContainer.classList.toggle('open');
            toggleBtn.textContent = linksContainer.classList.contains('open') ? '✕' : '☰';
        });

        // Close the dropdown if a link is tapped (mobile UX nicety)
        linksContainer.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                linksContainer.classList.remove('open');
                toggleBtn.textContent = '☰';
            });
        });
    });

