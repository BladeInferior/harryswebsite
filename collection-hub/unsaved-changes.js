// Shared "you have unsaved changes" guard, loaded on every collection-hub
// page. Each page's own script (collections.js / cards.js / pokedexes.js /
// milestones.js):
//   - calls initUnsavedChangesSnapshot(JSON.stringify(<its data>), storageKey)
//     once, right after its initial data load finishes, to record the
//     baseline.
//   - calls markDirty(JSON.stringify(<its data>), storageKey) wherever it
//     mutates that data. This is a real diff against the last saved/loaded
//     snapshot, not just a "something happened" flag — so e.g. toggling a
//     checkbox on and then back off again correctly leaves
//     hasUnsavedChanges false, since the serialized state matches the
//     snapshot again.
//   - calls markSaved(JSON.stringify(<its data>), storageKey) once an Export
//     completes, which also becomes the new baseline for future markDirty()
//     calls.
//
// storageKey is optional — pass the localStorage key this dataset mirrors
// (e.g. COLLECTION.storageKey, or "dexData") so "Leave anyway" can restore
// localStorage to its pristine pre-edit state before navigating away. Pages
// that never write their data to localStorage (e.g. cards.js) can omit it —
// a navigation away already discards their in-memory edits with nothing to
// revert. storageKey also doubles as the tracker's identity: most pages
// only ever have one dataset, so omitting it just tracks a single implicit
// "default" dataset exactly as before — but completions.html has two at
// once (its own item list, storageKey "completions", plus its Milestones
// tab, storageKey "milestones"), each needing independent dirty-tracking so
// editing one doesn't get diffed against the other's snapshot, and "Leave
// anyway" restores both correctly.
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
const trackers = new Map(); // trackerId -> { snapshot, storageKey, dirty }

function getTracker(storageKey) {
    const trackerId = storageKey || "default";
    let tracker = trackers.get(trackerId);
    if (!tracker) {
        tracker = { snapshot: null, storageKey: storageKey || null, dirty: false };
        trackers.set(trackerId, tracker);
    }
    return tracker;
}

function recomputeGlobalDirty() {
    hasUnsavedChanges = [...trackers.values()].some(t => t.dirty);
}

// Establishes the "nothing to save yet" baseline for one dataset.
// Deliberately taken after localStorage has already been merged into the
// page's in-memory data (not against the raw fetched backup JSON) — edits
// from a previous, unexported session are treated as the normal starting
// point for this session, not as changes that need re-flagging the moment
// the page loads.
function initUnsavedChangesSnapshot(stateJSON, storageKey) {
    const tracker = getTracker(storageKey);
    tracker.snapshot = stateJSON;
    tracker.dirty = false;
    recomputeGlobalDirty();
}

function markDirty(stateJSON, storageKey) {
    const tracker = getTracker(storageKey);
    if (tracker.snapshot === null || stateJSON === undefined) {
        // No baseline (or caller didn't pass one) to diff against — fall
        // back to the conservative "assume dirty" behavior.
        tracker.dirty = true;
    } else {
        tracker.dirty = stateJSON !== tracker.snapshot;
    }
    recomputeGlobalDirty();
}

function markSaved(stateJSON, storageKey) {
    const tracker = getTracker(storageKey);
    tracker.dirty = false;
    if (stateJSON !== undefined) tracker.snapshot = stateJSON;
    recomputeGlobalDirty();
}

// Read-only lookups for pages that want to reflect a tracker's state in
// their own UI (e.g. an export button glow, or a "what changed" list) —
// exposed instead of reaching into the trackers Map's internals directly.
function isTrackerDirty(storageKey) {
    const tracker = trackers.get(storageKey || "default");
    return tracker ? tracker.dirty : false;
}

function getTrackerSnapshot(storageKey) {
    const tracker = trackers.get(storageKey || "default");
    return tracker ? tracker.snapshot : null;
}

// Clears every tracker at once — used by "Leave anyway" below, since
// abandoning the page means abandoning every dataset it was tracking, not
// just whichever one happened to be passed to the last markDirty() call.
function markAllSaved() {
    trackers.forEach(t => { t.dirty = false; });
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

        // Discard the in-progress edits rather than leaving them sitting in
        // localStorage — saveItems()/saveData() write on every edit, well
        // before this leave/stay decision, so without this the "unsaved"
        // changes the user just chose to abandon would still be there the
        // next time this page loads. Every tracker gets restored, not just
        // whichever one is currently dirty.
        trackers.forEach(t => {
            if (t.storageKey && t.snapshot !== null) {
                localStorage.setItem(t.storageKey, t.snapshot);
            }
        });

        markAllSaved(); // already confirmed — don't also trigger the native beforeunload prompt
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
