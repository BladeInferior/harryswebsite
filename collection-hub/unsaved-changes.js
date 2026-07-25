// Shared "you have unsaved changes" guard, loaded on every collection-hub
// page. Each page's own script (collections.js / cards.js / pokedexes.js):
//   - calls initUnsavedChangesSnapshot(JSON.stringify(<its data>)) once,
//     right after its initial data load finishes, to record the baseline.
//   - calls markDirty(JSON.stringify(<its data>)) wherever it mutates that
//     data. This is a real diff against the last saved/loaded snapshot, not
//     just a "something happened" flag — so e.g. toggling a checkbox on and
//     then back off again correctly leaves hasUnsavedChanges false, since
//     the serialized state matches the snapshot again.
//   - calls markSaved(JSON.stringify(<its data>)) once an Export completes,
//     which also becomes the new baseline for future markDirty() calls.
//
// This file only owns the actual warning UI:
//   - tab close / refresh / typing a new URL: the browser's own native
//     dialog via beforeunload. Browsers hard-block custom text/styling here
//     on purpose (otherwise a site could hold the tab hostage), so this one
//     can't be themed to match the rest of the site.
//   - clicking a link on the page itself (nav bar, the collection sub-nav,
//     the "← Back" button): we're the ones triggering the navigation, so we
//     can show our own styled confirm modal instead.
let hasUnsavedChanges = false;
let lastSavedSnapshot = null;

// Establishes the "nothing to save yet" baseline. Deliberately taken after
// localStorage has already been merged into the page's in-memory data (not
// against the raw fetched backup JSON) — edits from a previous, unexported
// session are treated as the normal starting point for this session, not as
// changes that need re-flagging the moment the page loads.
function initUnsavedChangesSnapshot(stateJSON) {
    lastSavedSnapshot = stateJSON;
    hasUnsavedChanges = false;
}

function markDirty(stateJSON) {
    if (lastSavedSnapshot === null || stateJSON === undefined) {
        // No baseline (or caller didn't pass one) to diff against — fall
        // back to the conservative "assume dirty" behavior.
        hasUnsavedChanges = true;
        return;
    }
    hasUnsavedChanges = stateJSON !== lastSavedSnapshot;
}

function markSaved(stateJSON) {
    hasUnsavedChanges = false;
    if (stateJSON !== undefined) lastSavedSnapshot = stateJSON;
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
