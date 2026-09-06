// ---------------------------
// EXPORT TO GITHUB — shared by every collection-hub export button (Pokédex,
// Shiny Hunts, Cards, Sleeves, Pop Figures, Steelbooks, Pins, Milestones).
// Tries the GitHub auto-commit first via the Cloudflare Worker, falling
// back to a manual download only if that didn't verify+commit. The Worker
// itself compares the incoming content against what's already on GitHub
// before committing, so a file whose data hasn't actually changed comes
// back as { unchanged: true } rather than as a failure.
//
// Auth is deliberately the caller's problem, not this file's — every page
// that uses this already resolves its own admin ID token first (each under
// its own locally-scoped adminAuthReady-style variable, at whatever relative
// depth its own admin-auth-core.js import needs, and completions.html loads
// two such callers — collections.js and milestones.js — on the same page,
// which is why they don't even share one variable name). Piling a second,
// globally-named token resolver in here would collide with those rather
// than replace them.
// ---------------------------
async function exportJsonFile(filename, json, trackerKey, snapshotData, idToken) {

    if (idToken) {
        try {
            const res = await fetch("https://orange-bar-b027.harrycummins.workers.dev/export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${idToken}`
                },
                body: JSON.stringify({ filename, content: json })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                if (typeof markSaved === "function") markSaved(snapshotData, trackerKey);
                if (typeof updateExportGlow === "function") updateExportGlow();
                showExportToast(filename);
                return;
            }

            // Not a failure — the Worker just had nothing to commit, since
            // this file's data hasn't actually changed since the last
            // export.
            if (result.verified && result.unchanged) {
                if (typeof markSaved === "function") markSaved(snapshotData, trackerKey);
                if (typeof updateExportGlow === "function") updateExportGlow();
                return;
            }

            if (result.verified && !result.committed) {
                console.error("GitHub commit failed:", result.error);
                alert("Verified, but GitHub commit failed — falling back to manual download. Check console.");
            }

        } catch (err) {
            console.error("Export sync failed:", err);
        }
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof markSaved === "function") markSaved(snapshotData, trackerKey);
    if (typeof updateExportGlow === "function") updateExportGlow();
}

// A blocking alert() for every successful export got old fast — this is a
// small self-dismissing toast instead. Only one lives on the page at a
// time: exporting both a dex and its hunts back to back (see pokedexes.js)
// just restarts the same toast's timer with the new filename rather than
// stacking a second one underneath it.
let exportToastTimer = null;

function showExportToast(filename) {

    let toast = document.getElementById("export-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "export-toast";
        toast.innerHTML = `
            <div class="export-toast-line">Successfully committed</div>
            <div class="export-toast-filename"></div>
            <div class="export-toast-line">to GitHub</div>
        `;
        document.body.appendChild(toast);
    }

    toast.querySelector(".export-toast-filename").textContent = `${filename} ✅`;

    // Forces the fade-in transition to replay even if a toast is already
    // showing (e.g. the pokedex + shiny-hunts exports landing seconds
    // apart) — toggling the class off and immediately back on with no
    // reflow in between would just no-op.
    toast.classList.remove("visible");
    void toast.offsetWidth;
    toast.classList.add("visible");

    clearTimeout(exportToastTimer);
    exportToastTimer = setTimeout(() => {
        toast.classList.remove("visible");
    }, 3000);
}
