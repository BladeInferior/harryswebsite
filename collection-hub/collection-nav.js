fetch('../navbar.html')
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
            { label: "Pokédex", page: "collection-hub/pokedexes.html" },
            { label: "Sleeves", page: "collection-hub/sleeves.html" },
            { label: "Cards", page: "collection-hub/cards.html" },
            { label: "Steelbooks", page: "collection-hub/steelbooks.html" },
            { label: "Completions", page: "collection-hub/completions.html" },
            { label: "Pop Figures", page: "collection-hub/popfigures.html" },
            { label: "Pins", page: "collection-hub/pins.html" },
        ];

        const linksContainer = nav.querySelector('.site-nav-links');
        const hubLink = Array.from(linksContainer.querySelectorAll('a'))
            .find(a => a.dataset.page === "collection-hub/collectionhub.html");

        let insertAfter = hubLink;

        subPages.forEach(({ label, page }) => {
            const a = document.createElement('a');
            a.textContent = label;
            a.href = basePath + page;

            if (window.location.pathname.endsWith(page.split('/').pop())) {
                a.classList.add('active-link');
            }

            insertAfter.insertAdjacentElement('afterend', a);
            insertAfter = a;
        });

        if (window.location.pathname.endsWith('collectionhub.html')) {
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

