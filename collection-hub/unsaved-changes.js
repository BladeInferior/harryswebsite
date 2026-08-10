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

        // Download links (e.g. the export button's synthetic <a download>
        // it builds and .click()s to save a blob) don't navigate away from
        // the page either — without this, that programmatic click event
        // bubbles up to this same-document listener and gets caught here,
        // popping the modal instead of letting the file download.
        if (link.hasAttribute("download")) return;

        const href = link.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

        e.preventDefault();
        e.stopPropagation();

        pendingHref = link.href;
        overlay.classList.remove("hidden");

    }, true);
});
