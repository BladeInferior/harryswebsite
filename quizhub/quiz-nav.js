// Loaded by every quiz-hub page — mirrors collection-hub/collection-nav.js's
// approach: fetch the shared navbar, then inject this section's sub-links
// before the site-level link group (Collection Hub / Quiz Hub / Github Repo)
// so every page shares one nav instead of each page duplicating its own copy
// of this script.
fetch('../navbar.html')
    .then(res => res.text())
    .then(data => {
        document.getElementById('navbar').innerHTML = data;

        const nav = document.querySelector('.site-nav');
        nav.classList.add('quiz-theme');

        const basePath =
            window.location.hostname === "bladeinferior.github.io"
                ? "/harryswebsite/"
                : "/";

        document.querySelectorAll('#navbar [data-page]').forEach(link => {
            link.href = basePath + link.dataset.page;
        });

        const subPages = [
            { label: "Join Quiz", page: "quizhub/join.html" },
            { label: "Quiz Builder", page: "quizhub/builder.html" },
            { label: "Manage Quiz", page: "quizhub/manage-quizzes.html" },
            { label: "Stats", page: "quizhub/stats.html" },
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
