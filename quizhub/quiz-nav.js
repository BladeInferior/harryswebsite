// Loaded by every quiz-hub page — mirrors collection-hub/collection-nav.js's
// approach: fetch the shared navbar, then inject this section's sub-links
// before the site-level link group (Collection Hub / Quiz Hub / Github Repo)
// so every page shares one nav instead of each page duplicating its own copy
// of this script.

// This file itself always lives at quizhub/quiz-nav.js, but the pages loading
// it don't all sit at the same depth — quizhub.html is still directly in
// quizhub/, while every other page now lives one folder deeper (e.g.
// quizhub/join/join.html). fetch() and serviceWorker.register() both resolve
// a relative URL against the CALLING PAGE, not this script's own location, so
// a plain relative path here would only be correct for whichever depth
// happened to be tested first. Anchoring explicitly to this script's own URL
// (document.currentScript.src) keeps it correct regardless of which page —
// or which depth — loaded it.
const QUIZ_NAV_SCRIPT_URL = document.currentScript.src;

// Forces every page load to always reflect what's actually deployed rather
// than a stale browser-cached copy — see ../sw-nocache.js.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw-nocache.js', QUIZ_NAV_SCRIPT_URL))
        .catch(err => console.error('Service worker registration failed:', err));
}

fetch(new URL('../navbar.html', QUIZ_NAV_SCRIPT_URL))
    .then(res => res.text())
    .then(data => {
        document.getElementById('navbar').innerHTML = data;

        const nav = document.querySelector('.site-nav');
        nav.classList.add('quiz-theme');

        // Single source of truth for "this hub's colour" — anything site-wide
        // that wants to theme itself per-hub (e.g. scroll-to-top.js's arrow)
        // reads this instead of hardcoding its own copy of the hex value.
        // Matches .site-nav.quiz-theme's own colour in ../navbar.css.
        document.documentElement.style.setProperty('--hub-accent', '#a855f7');

        const basePath =
            window.location.hostname === "bladeinferior.github.io"
                ? "/harryswebsite/"
                : "/";

        document.querySelectorAll('#navbar [data-page]').forEach(link => {
            link.href = basePath + link.dataset.page;
        });

        const subPages = [
            { label: "Join Quiz", page: "quizhub/join/join.html" },
            { label: "Quiz Builder", page: "quizhub/builder/builder.html" },
            { label: "Manage Quiz", page: "quizhub/manage-quizzes/manage-quizzes.html" },
            { label: "Stats", page: "quizhub/stats/stats.html" },
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

        const hubLink = Array.from(linksContainer.querySelectorAll('a'))
            .find(a => a.dataset.page === "quizhub/quizhub.html");

        if (window.location.pathname.endsWith('quizhub.html')) {
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
