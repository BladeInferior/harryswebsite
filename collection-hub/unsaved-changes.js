// Shared "you have unsaved changes" guard, loaded on every collection-hub
// page. Each page's own script (collections.js / cards.js / pokedexes.js)
// calls markDirty() wherever it mutates local data and markSaved() once an
// Export completes — this file only owns the actual warning UI:
//   - tab close / refresh / typing a new URL: the browser's own native
//     dialog via beforeunload. Browsers hard-block custom text/styling here
//     on purpose (otherwise a site could hold the tab hostage), so this one
//     can't be themed to match the rest of the site.
//   - clicking a link on the page itself (nav bar, the collection sub-nav,
//     the "← Back" button): we're the ones triggering the navigation, so we
//     can show our own styled confirm modal instead.
let hasUnsavedChanges = false;

function markDirty() {
    hasUnsavedChanges = true;
}

function markSaved() {
    hasUnsavedChanges = false;
}

window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges) return;
    e.preventDefault();
    e.returnValue = "";
});

document.addEventListener("DOMContentLoaded", () => {

    const overlay = document.createElement("div");
    overlay.id = "unsaved-changes-overlay";
    overlay.className = "hidden";

    overlay.innerHTML = `
        <div class="unsaved-changes-box">
            <h3>Unsaved changes</h3>
            <p>You have changes that haven't been exported yet. Leaving now will lose them.</p>
            <div class="modal-buttons">
                <button id="unsaved-changes-stay">Stay</button>
                <button id="unsaved-changes-leave" class="danger">Leave anyway</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const leaveBtn = document.getElementById("unsaved-changes-leave");
    const stayBtn = document.getElementById("unsaved-changes-stay");

    let pendingHref = null;

    function closeModal() {
        overlay.classList.add("hidden");
        pendingHref = null;
    }

    stayBtn.addEventListener("click", closeModal);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
    });

    leaveBtn.addEventListener("click", () => {
        const href = pendingHref;
        markSaved(); // already confirmed — don't also trigger the native beforeunload prompt
        closeModal();
        if (href) window.location.href = href;
    });

    // Capture phase so this runs before any other click handler on the link
    // (e.g. the mobile nav's own "close dropdown on tap" listener) can act.
    document.addEventListener("click", (e) => {

        if (!hasUnsavedChanges) return;

        const link = e.target.closest("a[href]");
        if (!link) return;

        // New-tab links and modified clicks (ctrl/cmd/middle-click, which
        // open a new tab) don't lose this page's state, so leave them alone.
        if (link.target === "_blank") return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const href = link.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

        e.preventDefault();
        e.stopPropagation();

        pendingHref = link.href;
        overlay.classList.remove("hidden");

    }, true);
});
