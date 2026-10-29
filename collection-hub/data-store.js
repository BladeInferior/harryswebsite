// ---------------------------
// DATA STORE — where every collection-hub dataset (what used to be the
// *-backup.json files) now lives: Firestore collection `collectionData`,
// public read, owner-only write (rules are set in the Firebase console, see
// CLAUDE.md). Classic script, exposes window.DataStore plus the old
// exportJsonFile() entry point so every page's Export button is unchanged.
//
// Each dataset is stored as a JSON *string* (`json` field), not as nested
// Firestore fields: Firestore forbids arrays of arrays and restricts field
// names, and the data is only ever read/written whole anyway. A string over
// ~200k chars is split across extra docs `<name>__1`, `<name>__2`… (a doc is
// capped at 1 MiB); the head doc `<name>` holds part 0 and `parts`.
//
// Offline is VIEW-ONLY and works logged out: every successful load is copied
// to IndexedDB, and if the server can't be reached (offline, slow, SDK
// unreachable) the last copy is served instead, and the sign-in widget's
// status dot turns red and says when that copy was saved. The
// Firebase SDK is imported dynamically inside try/catch on purpose — it comes
// from gstatic (the service worker only caches same-origin files), so the
// page must never depend on it loading.
//
// During migration, a dataset not yet in Firestore falls back to the static
// file next to the page (`fallbackUrl`); remove that once the old JSON files
// are deleted.
// ---------------------------
(function () {

    const SCRIPT_URL = document.currentScript.src;
    const FIRESTORE_SDK = "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
    const COLLECTION = "collectionData";
    const CHUNK_CHARS = 200000;      // ≤ ~800 KB even if every char is 4 bytes
    const IDB_NAME = "collection-hub-data";
    const IDB_STORE = "datasets";

    // "sleeves-backup.json" → "sleeves"; a bare name passes through.
    function nameFromFile(file) {
        return String(file).replace(/^.*\//, "").replace(/-backup\.json$/, "").replace(/\.json$/, "");
    }

    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timed out")), ms);
            promise.then(v => { clearTimeout(timer); resolve(v); },
                         e => { clearTimeout(timer); reject(e); });
        });
    }

    // ---------- local copy (IndexedDB) ----------
    function openIdb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbGet(name) {
        try {
            const db = await openIdb();
            return await new Promise((resolve, reject) => {
                const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(name);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch { return null; }
    }

    async function idbPut(name, record) {
        try {
            const db = await openIdb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, "readwrite");
                tx.objectStore(IDB_STORE).put(record, name);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { console.warn("DataStore: couldn't keep a local copy of", name, e); }
    }

    // ---------- Firebase (loaded lazily, never required) ----------
    let firebasePromise = null;
    function firebase() {
        if (!firebasePromise) {
            firebasePromise = Promise.all([
                import(new URL("../firebase-config.js", SCRIPT_URL).href),
                import(FIRESTORE_SDK)
            ]).then(([config, fs]) => ({ db: config.db, auth: config.auth, ...fs }));
        }
        return firebasePromise;
    }

    // Resolves null when the dataset isn't in Firestore yet.
    async function readFromServer(name) {
        const f = await firebase();
        const head = await f.getDoc(f.doc(f.db, COLLECTION, name));
        if (!head.exists()) return null;

        const h = head.data();
        let json = h.json;
        if (h.parts > 1) {
            const rest = await Promise.all(Array.from({ length: h.parts - 1 }, (_, i) =>
                f.getDoc(f.doc(f.db, COLLECTION, `${name}__${i + 1}`))));
            rest.forEach(snap => {
                if (!snap.exists()) throw new Error(`${name}: missing a stored part`);
                json += snap.data().json;
            });
        }
        return JSON.parse(json);
    }

    // ---------- "what am I looking at" badge ----------
    // source: "server" (live), "offline-copy" (last copy saved on this
    // device), "file" (the old static JSON). Only the last two show a badge.
    const sources = {};

    function formatWhen(ms) {
        return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    // The status itself is drawn by the sign-in widget (admin-auth.js) — a
    // glowing green/red dot beside the Sign in/out button — so this just
    // publishes what it needs: DataStore.status plus a "datastore-status"
    // event whenever it changes.
    function updateBadge() {
        const stale = Object.values(sources).filter(s => s.source !== "server");
        const copies = stale.filter(s => s.source === "offline-copy");

        window.DataStore.status = {
            stale: stale.length > 0,
            savedAt: copies.length ? Math.min(...copies.map(s => s.savedAt)) : null,
            savedAtText: copies.length ? formatWhen(Math.min(...copies.map(s => s.savedAt))) : null
        };
        window.dispatchEvent(new CustomEvent("datastore-status"));
    }

    // ---------- public API ----------
    async function load(file, fallbackUrl) {
        const name = nameFromFile(file);
        const cached = await idbGet(name);
        let serverSaidMissing = false;

        if (navigator.onLine !== false) {
            try {
                const data = await withTimeout(readFromServer(name), cached ? 4000 : 10000);
                if (data !== null) {
                    sources[name] = { source: "server" };
                    idbPut(name, { data, savedAt: Date.now() });
                    updateBadge();
                    return data;
                }
                serverSaidMissing = true;
            } catch (e) {
                console.warn(`DataStore: couldn't reach the database for ${name}`, e);
            }
        }

        if (cached && !serverSaidMissing) {
            sources[name] = { source: "offline-copy", savedAt: cached.savedAt };
            updateBadge();
            return cached.data;
        }

        if (fallbackUrl) {
            const data = await fetch(fallbackUrl).then(res => res.json());
            // The static file is only "current" before a dataset is migrated.
            sources[name] = serverSaidMissing ? { source: "server" } : { source: "file" };
            updateBadge();
            return data;
        }

        throw new Error(`No data available for ${name}`);
    }

    // Owner only — Firestore rejects anyone else, this just needs a user.
    async function save(file, data) {
        const name = nameFromFile(file);
        const f = await firebase();
        await f.auth.authStateReady();
        if (!f.auth.currentUser) throw new Error("Not signed in as admin");

        const json = JSON.stringify(data);
        const parts = [];
        for (let i = 0; i < json.length; i += CHUNK_CHARS) parts.push(json.slice(i, i + CHUNK_CHARS));
        if (!parts.length) parts.push("");

        const batch = f.writeBatch(f.db);
        parts.forEach((part, i) => {
            batch.set(
                f.doc(f.db, COLLECTION, i === 0 ? name : `${name}__${i}`),
                i === 0 ? { json: part, parts: parts.length, updatedAt: Date.now() } : { json: part }
            );
        });
        await batch.commit();

        idbPut(name, { data, savedAt: Date.now() });
    }

    // ---------- viewer mode ----------
    // Editing needs: signed in as the admin, online, and live data (not a
    // saved offline copy). Anything else is view-only: body.viewer-mode hides
    // every Import/Export/Add/Edit/Delete control (style.css) and the save
    // functions bail out. Starts on, so nothing flashes before sign-in is
    // known; offline the auth module can't even load, which also lands here.
    let adminSignedIn = false;

    function applyViewerMode() {
        const canEdit = adminSignedIn && navigator.onLine !== false && !window.DataStore.status.stale;
        document.body.classList.toggle("viewer-mode", !canEdit);
        window.dispatchEvent(new CustomEvent("viewer-mode-change"));
    }

    window.isViewerMode = () => document.body.classList.contains("viewer-mode");
    document.body.classList.add("viewer-mode");
    window.addEventListener("online", applyViewerMode);
    window.addEventListener("offline", applyViewerMode);
    window.addEventListener("datastore-status", applyViewerMode);

    import(new URL("../admin-auth-core.js", SCRIPT_URL).href)
        .then(core => core.onAdminStateChange(isAdmin => { adminSignedIn = !!isAdmin; applyViewerMode(); }))
        .catch(() => { /* offline / SDK unreachable — stays view-only */ });

    // Every dataset the Collection Hub keeps (used by backup/restore).
    const DATASETS = [
        "pokedex", "shiny-hunts", "sleeves", "steelbooks", "pins", "popfigures",
        "completions", "milestones", "cards-pokemon", "cards-trainers",
        "cards-pokeballs", "cards-stadiums", "cards-rampardos"
    ];

    window.DataStore = { load, save, nameFromFile, DATASETS, status: { stale: false, savedAt: null, savedAtText: null } };

    // ---------- Export button entry point ----------
    // Same signature the old GitHub exporter had, so every page's Export
    // handler is untouched. `idToken` is ignored — Firestore's own auth
    // carries the identity now.
    window.exportJsonFile = async function exportJsonFile(filename, json, trackerKey, snapshotData) {
        try {
            await withTimeout(save(filename, JSON.parse(json)), 20000);

            // The database now genuinely holds this content — record it as
            // this device's reconciliation baseline (see unsaved-changes.js).
            if (typeof markSaved === "function") markSaved(snapshotData, trackerKey);
            if (typeof setRemoteBaseline === "function") setRemoteBaseline(trackerKey, JSON.parse(snapshotData));
            if (typeof updateExportGlow === "function") updateExportGlow();
            showExportToast(filename);
        } catch (err) {
            console.error("Export failed:", err);
            alert(`Couldn't save ${filename} to the database (${err.message}). This device's changes are NOT saved there yet — they're still here, so try Export again once you're online and signed in as admin.`);
        }
    };

    // A blocking alert() for every successful export got old fast — this is a
    // small self-dismissing toast instead. Only one lives on the page at a
    // time: exporting both a dex and its hunts back to back (see pokedexes.js)
    // just restarts the same toast's timer with the new filename.
    let exportToastTimer = null;

    window.showExportToast = function showExportToast(filename) {
        let toast = document.getElementById("export-toast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "export-toast";
            toast.innerHTML = `
                <div class="export-toast-line">Successfully saved</div>
                <div class="export-toast-filename"></div>
                <div class="export-toast-line">to the database</div>
            `;
            document.body.appendChild(toast);
        }

        toast.querySelector(".export-toast-filename").textContent = `${filename} ✅`;

        // Forces the fade-in transition to replay even if a toast is already
        // showing.
        toast.classList.remove("visible");
        void toast.offsetWidth;
        toast.classList.add("visible");

        clearTimeout(exportToastTimer);
        exportToastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
    };
})();
