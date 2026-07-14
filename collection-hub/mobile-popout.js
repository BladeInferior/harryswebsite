// Shared mobile pop-out: relocates real, already-functional controls (filter
// buttons, dex progress bars, etc.) into a floating panel below a toggle
// button on narrow screens, instead of hiding them or building a separate
// read-only summary. Elements move back to their original desktop position
// if the window grows back past the mobile breakpoint. A page can create
// more than one independent pop-out (e.g. one for filters, one for progress).
//
// Returns a `sync()` function — call it again whenever the tracked element
// might have been recreated (e.g. after rebuilding a filter container on a
// deck switch) so a freshly-created node gets relocated too.
// Panels share one page's worth of narrow screen width, so opening one
// closes any others already open instead of letting them stack on top of
// each other.
const _allMobilePopoutPanels = [];

// Keeps the page behind a panel from scrolling while it's open — without
// this, a touch-drag on the (fixed-position, translucent) panel could also
// scroll the page underneath it, which felt broken on mobile.
//
// Plain `overflow: hidden` on <body> doesn't reliably block touch-scroll on
// iOS Safari (it still rubber-bands through). Repositioning <body> with
// position:fixed does block it, but pulls body out of layout — since <html>
// has no background of its own, that flashed white and the reflow on every
// toggle was slow. touch-action:none blocks touch-driven scrolling directly
// at the input level instead, with no layout/position change at all.
function _updateBodyScrollLock() {
    const anyOpen = _allMobilePopoutPanels.some(p => p.classList.contains("open"));
    document.body.classList.toggle("popout-scroll-lock", anyOpen);
}

function createMobilePopout({ toggleId, icon, top, right = 16, heading, elementIds }) {

    const toggleBtn = document.createElement("div");
    toggleBtn.id = toggleId;
    toggleBtn.classList.add("mobile-popout-toggle");
    toggleBtn.textContent = icon;
    toggleBtn.style.top = `${top}px`;
    toggleBtn.style.right = `${right}px`;
    document.body.appendChild(toggleBtn);

    const panel = document.createElement("div");
    panel.classList.add("mobile-popout-panel");
    panel.style.top = `${top + 54}px`;
    panel.innerHTML = `<h4>${heading}</h4><div class="mobile-popout-list"></div>`;
    document.body.appendChild(panel);

    _allMobilePopoutPanels.push(panel);

    const listEl = panel.querySelector(".mobile-popout-list");

    toggleBtn.addEventListener("click", () => {
        const opening = !panel.classList.contains("open");
        _allMobilePopoutPanels.forEach(p => {
            if (p !== panel) p.classList.remove("open");
        });
        panel.classList.toggle("open", opening);
        _updateBodyScrollLock();
    });

    document.addEventListener("click", (e) => {
        if (!panel.classList.contains("open")) return;
        if (panel.contains(e.target) || toggleBtn.contains(e.target)) return;
        panel.classList.remove("open");
        _updateBodyScrollLock();
    });

    const mobileQuery = window.matchMedia("(max-width: 768px)");
    const homes = new Map();

    function sync() {
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            if (mobileQuery.matches) {
                if (el.parentNode !== listEl) {
                    homes.set(id, { parent: el.parentNode, nextSibling: el.nextSibling });
                    el.style.width = "";
                    listEl.appendChild(el);
                }
            } else if (el.parentNode === listEl) {
                const home = homes.get(id);
                if (home) home.parent.insertBefore(el, home.nextSibling);
            }
        });

        // Growing back past the mobile breakpoint hides the panel via CSS
        // regardless of its .open state — without this, the scroll lock
        // it left behind would strand the desktop page unscrollable.
        if (!mobileQuery.matches && panel.classList.contains("open")) {
            panel.classList.remove("open");
            _updateBodyScrollLock();
        }
    }

    mobileQuery.addEventListener("change", sync);
    sync();

    return sync;
}
