// Mirrors collection-hub/collection-nav.js and quizhub/quiz-nav.js — fetch
// the shared navbar, then inject this section's sub-links before the
// site-level link group (Collection Hub / Quiz Hub / Movie Hub / Admin Hub /
// Github Repo) so every page shares one nav instead of each page
// duplicating it.

// This file itself always lives at movie-hub/movie-nav.js, but the pages
// loading it don't all sit at the same depth — moviehub.html is directly in
// movie-hub/, while wheel.html lives one folder deeper (movie-hub/wheel/).
// fetch() resolves a relative URL against the CALLING PAGE, not this
// script's own location, so anchoring explicitly to this script's own URL
// (document.currentScript.src) keeps it correct regardless of which page —
// or which depth — loaded it.
const MOVIE_NAV_SCRIPT_URL = document.currentScript.src;

// Forces every page load to always reflect what's actually deployed rather
// than a stale browser-cached copy — see ../sw-nocache.js.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw-nocache.js', MOVIE_NAV_SCRIPT_URL))
        .catch(err => console.error('Service worker registration failed:', err));
}

fetch(new URL('../navbar.html', MOVIE_NAV_SCRIPT_URL))
    .then(res => res.text())
    .then(data => {
        document.getElementById('navbar').innerHTML = data;

        const nav = document.querySelector('.site-nav');
        nav.classList.add('movie-theme');

        const basePath =
            window.location.hostname === "bladeinferior.github.io"
                ? "/harryswebsite/"
                : "/";

        document.querySelectorAll('#navbar [data-page]').forEach(link => {
            link.href = basePath + link.dataset.page;
        });

        const subPages = [
            { label: "Spin the Wheel", page: "movie-hub/wheel/wheel.html" },
        ];

        const linksContainer = nav.querySelector('.site-nav-links');

        // Sub-links go before the whole site-level group (Collection Hub,
        // Quiz Hub, Movie Hub, Admin Hub, Github Repo), which always starts
        // with Collection Hub.
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

        const hubLink = Array.from(linksContainer.querySelectorAll('a'))
            .find(a => a.dataset.page === "movie-hub/moviehub.html");

        if (window.location.pathname.endsWith('moviehub.html')) {
            hubLink.classList.add('active-link');
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
