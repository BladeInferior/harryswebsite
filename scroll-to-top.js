// Mobile-only "return to top" button, shared across every page on the site.
// Self-contained (injects its own styles) so adding it anywhere is just one
// <script> tag, rather than a script + stylesheet pair on every page.
(function () {
    const style = document.createElement("style");
    style.textContent = `
        /* Same dark circle everywhere, but the arrow (and hover border)
           picks up whichever hub the visitor is currently on via
           --hub-accent — each *-nav.js (or index.html's inline nav script
           for the homepage) sets that custom property on :root the moment
           it knows its theme. Falls back to collection-hub's own green in
           case something loads before that's set. */
        #scroll-to-top-btn {
            display: none;
            position: fixed;
            top: 70px;
            left: 12px;
            z-index: 3400;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #1c1f26;
            border: 1px solid #2f3542;
            color: var(--hub-accent, #86efac);
            font-size: 18px;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            transition: border-color .15s ease, background .15s ease;
        }

        /* Scoped to devices with a real hover-capable pointer (a mouse) —
           without this, tapping the button on a touchscreen leaves it stuck
           looking "hovered" until something else is tapped, since there's
           no pointer to actually leave the element afterward. */
        @media (hover: hover) and (pointer: fine) {
            #scroll-to-top-btn:hover {
                border-color: var(--hub-accent, #86efac);
                background: rgba(255,255,255,.08);
            }
        }

        #scroll-to-top-btn.visible {
            display: flex;
        }

        @media (min-width: 769px) {
            #scroll-to-top-btn.visible {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.id = "scroll-to-top-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Scroll to top");
    btn.textContent = "↑";
    document.body.appendChild(btn);

    btn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Shows once scrolled past the page's own "← Back" button, so it never
    // appears while that's already in view — falls back to a flat scroll
    // distance on pages that don't have one (e.g. the homepage).
    function getThreshold() {
        const backBtn = document.querySelector(".back-button");
        if (backBtn) {
            return backBtn.getBoundingClientRect().bottom + window.scrollY;
        }
        return 300;
    }

    let threshold = getThreshold();

    function updateVisibility() {
        btn.classList.toggle("visible", window.scrollY > threshold);
    }

    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", () => {
        threshold = getThreshold();
        updateVisibility();
    });

    updateVisibility();
})();
