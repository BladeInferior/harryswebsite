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
// CSS overflow/touch-action toggling turned out not to be reliable enough
// on its own (depends on the browser correctly treating <html>/<body> as
// the actual scroll root, which varies). This intercepts touchmove directly
// instead: any touch that didn't start inside the open panel gets its
// default scroll behavior cancelled outright, regardless of what element
// the browser thinks owns the scroll. Touches starting inside the panel are
// left alone so its own internal overflow-y:auto scrolling still works.
function _updateBodyScrollLock() {
    const anyOpen = _allMobilePopoutPanels.some(p => p.classList.contains("open"));
    document.documentElement.classList.toggle("popout-scroll-lock", anyOpen);
}

function _handleTouchMove(e) {
    const openPanel = _allMobilePopoutPanels.find(p => p.classList.contains("open"));
    if (openPanel && !openPanel.contains(e.target)) {
        e.preventDefault();
    }
}

// { passive: false } is required — browsers default touch listeners to
// passive (for scroll-performance reasons), which silently ignores
// preventDefault() unless explicitly opted out of.
document.addEventListener("touchmove", _handleTouchMove, { passive: false });

// Small arrow left of the search bar / mini-menu buttons that hides or shows
// all of them (mobile only; CSS hides the arrow itself on desktop). State is
// remembered per browser.
function _ensureMobileBarArrow() {
    if (document.getElementById("mobile-bar-arrow")) return;

    const arrow = document.createElement("div");
    arrow.id = "mobile-bar-arrow";
    document.body.appendChild(arrow);

    const root = document.documentElement;
    const apply = hidden => {
        root.classList.toggle("mobile-bar-hidden", hidden);
        arrow.textContent = hidden ? "◀" : "▶"; // ◀ = pull the bar back out, ▶ = tuck it away
        arrow.setAttribute("aria-label", hidden ? "Show search and menus" : "Hide search and menus");
        if (hidden) {
            _allMobilePopoutPanels.forEach(p => p.classList.remove("open"));
            _updateBodyScrollLock();
        }
        try { localStorage.setItem("mobileBarHidden", hidden ? "1" : "0"); } catch (e) {}
    };

    // Park the arrow against the search bar's left edge (it moves with the
    // bar if its width changes, e.g. when the page's controls re-lay-out).
    const place = () => {
        const bar = document.getElementById("search-wrapper");
        if (!bar || root.classList.contains("mobile-bar-hidden")) { arrow.style.right = ""; return; }
        const r = bar.getBoundingClientRect();
        arrow.style.right = r.width ? `${window.innerWidth - r.left + 6}px` : "";
    };
    const barEl = document.getElementById("search-wrapper");
    if (barEl && typeof ResizeObserver === "function") new ResizeObserver(place).observe(barEl);
    window.addEventListener("resize", place);

    let saved = false;
    try { saved = localStorage.getItem("mobileBarHidden") === "1"; } catch (e) {}
    apply(saved);
    place();
    arrow.addEventListener("click", () => setTimeout(place, 0));

    arrow.addEventListener("click", () => apply(!root.classList.contains("mobile-bar-hidden")));
}

function createMobilePopout({ toggleId, icon, top, right = 12, heading, elementIds }) {

    _ensureMobileBarArrow();

    const toggleBtn = document.createElement("div");
    toggleBtn.id = toggleId;
    toggleBtn.classList.add("mobile-popout-toggle");
    toggleBtn.textContent = icon;
    toggleBtn.style.top = `${top}px`;
    toggleBtn.style.right = `${right}px`;
    document.body.appendChild(toggleBtn);

    const panel = document.createElement("div");
    panel.classList.add("mobile-popout-panel");
    panel.style.top = `${top + 44}px`;
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
