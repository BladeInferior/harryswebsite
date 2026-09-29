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

// ---------------------------
// REMOTE-BASELINE RECONCILIATION
//
// A device's localStorage only changes when *that* device edits something —
// nothing here ever expires it. The old "local wins wholesale, only pull in
// entries missing from local entirely" merge (still the fallback below) was
// fine for one editor on one device, but the moment a second device opens
// with older data sitting in its localStorage, it silently reverts anything
// changed elsewhere the instant it next exports — whichever device exports
// last just overwrites the whole file with its own stale snapshot. This is
// a proper three-way merge instead: a field only survives on the local side
// if *this device* actually changed it since the last time it confirmed
// what the remote looked like (on load, or right after its own last
// export) — everything else defers to whatever's freshest on the remote.
//
// getRemoteBaseline/setRemoteBaseline persist that "last confirmed remote"
// snapshot per storageKey, separately from the live editing buffer at
// localStorage[storageKey] and from the in-memory dirty-flag snapshot above.
// ---------------------------

function getRemoteBaseline(storageKey) {
    const raw = localStorage.getItem(storageKey + "__remoteBaseline");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function setRemoteBaseline(storageKey, data) {
    try { localStorage.setItem(storageKey + "__remoteBaseline", JSON.stringify(data)); } catch {}
}

function fieldsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// One record's fields, reconciled: local's value survives only where it
// actually diverges from the baseline (a real unsynced edit); everywhere
// else the remote's (possibly newer) value wins — including fields that
// exist in remote but not in local at all, since merged starts as a full
// copy of remote. Recurses one level into plain-object sub-fields (e.g.
// shinyDexData) so a change buried in there doesn't mark the whole
// sub-object as dirty.
function reconcileRecord(local, baseline, remote) {
    if (!baseline) return local;
    const merged = { ...remote };
    Object.keys(local).forEach(key => {
        const lv = local[key], bv = baseline[key], rv = remote[key];
        if (lv && typeof lv === "object" && !Array.isArray(lv) && rv && typeof rv === "object") {
            merged[key] = reconcileRecord(lv, bv || {}, rv);
        } else if (!fieldsEqual(lv, bv)) {
            merged[key] = lv;
        }
    });
    return merged;
}

// dexData shape: { [pokemonKey]: {flags...} }. Returns null (caller should
// fall back to its own old local-wins behavior) when there's no baseline
// yet — e.g. the first load on a device after this reconciliation shipped.
function reconcileDict(localDict, remoteDict, storageKey) {
    const baseline = getRemoteBaseline(storageKey);
    if (!baseline) return null;

    const result = {};
    new Set([...Object.keys(remoteDict), ...Object.keys(localDict)]).forEach(id => {
        const remote = remoteDict[id], local = localDict[id], base = baseline[id];
        if (!local) { if (remote) result[id] = remote; return; }
        if (!remote) { result[id] = local; return; }
        result[id] = reconcileRecord(local, base, remote);
    });
    return result;
}

// Array-of-records shape, keyed by idField (e.g. shinyHunts' "id", a
// collection's title field, or milestones'/collections' "name"). Same
// null-means-fall-back contract as reconcileDict.
function reconcileList(localList, remoteList, storageKey, idField) {
    const baseline = getRemoteBaseline(storageKey);
    if (!baseline) return null;

    const byId = list => new Map(list.map(x => [x[idField], x]));
    const remoteById = byId(remoteList), localById = byId(localList), baseById = byId(baseline);

    const result = [];
    new Set([...remoteById.keys(), ...localById.keys()]).forEach(id => {
        const remote = remoteById.get(id), local = localById.get(id), base = baseById.get(id);

        if (!local) {
            // This device knew about it before (it's in the baseline) and
            // no longer does — a deletion made here, not yet exported.
            // Don't resurrect it just because the remote still has it.
            if (base) return;
            if (remote) result.push(remote);
            return;
        }

        if (!remote) {
            // Missing remotely. Unchanged since the last sync means someone
            // else deleted it there — follow suit. Otherwise this device
            // has a real pending edit to something deleted elsewhere; keep
            // it rather than silently losing that edit.
            if (base && fieldsEqual(local, base)) return;
            result.push(local);
            return;
        }

        result.push(base ? reconcileRecord(local, base, remote) : local);
    });
    return result;
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
