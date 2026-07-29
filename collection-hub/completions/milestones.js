// Milestones tab on the Completions page — a self-contained sibling engine
// to collections.js's completions grid, not a second data shape threaded
// through it. Deliberately as simple as cards.js's Trainers/Stadiums decks,
// minus everything those have that milestones don't: no owned/special
// toggle, no DLC, no filters/search/pagination. A milestone is just a name
// and an image.
const MILESTONES_JSON_FILE = "milestones-backup.json";
const MILESTONES_STORAGE_KEY = "milestones";
const MILESTONES_IMAGE_FOLDER = "milestones";

let milestoneItems = [];

const milestonesContainer = document.getElementById("milestones-container");

const milestoneModalOverlay = document.getElementById("milestone-modal-overlay");
const milestoneModalImage = document.getElementById("milestone-modal-image");
const milestoneModalName = document.getElementById("milestone-modal-name");
const milestoneNavLeft = document.getElementById("milestone-modal-nav-left");
const milestoneNavRight = document.getElementById("milestone-modal-nav-right");

// Not named imageZoomOverlay/zoomImage — collections.js, loaded just before
// this file on the same page, already declares top-level consts with those
// exact names for the same two shared DOM elements. Classic <script> tags
// share one global lexical scope, so a duplicate top-level const/let
// redeclaration would throw a SyntaxError and silently break this entire
// file. Different identifiers, same underlying elements (there's only one
// #image-zoom-overlay on the page).
const milestoneZoomOverlay = document.getElementById("image-zoom-overlay");
const milestoneZoomImage = document.getElementById("zoom-image");

// Site-wide admin identity (see ../admin-auth-core.js) — same dynamic import
// cards.js uses, since this file is a plain <script>, not a module. Only
// gates the Export button's GitHub auto-commit (see the export-milestones
// handler below) — Add/Edit/Delete/Import only ever touch this browser's
// own localStorage, exactly like cards.js. Named uniquely for the same
// redeclaration reason as above — collections.js already has its own
// top-level adminAuthReady.
const milestoneAdminAuthReady = import('../admin-auth-core.js');

function normalizeMilestoneName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getMilestoneImagePath(name) {
    return `${MILESTONES_IMAGE_FOLDER}/${normalizeMilestoneName(name)}.png`;
}

// Mirrors collections.js's markImageNotDownloaded()/clearImageNotDownloaded()
// — milestones.js keeps its own independent image pipeline, same as cards.js
// does for its decks. Named uniquely (not just an independent copy but a
// differently-named one) because function declarations at the top level of
// a classic <script> silently overwrite same-named ones from an
// earlier-loaded script sharing the same page (unlike const/let, which
// would throw) — harmless today since the bodies are identical, but a
// landmine if either version ever changes without the other.
function markMilestoneImageNotDownloaded(imgElement) {
    imgElement.removeAttribute("src");
    imgElement.classList.add("hidden");

    let label = imgElement.nextElementSibling;
    if (!label || !label.classList.contains("image-not-downloaded")) {
        label = document.createElement("div");
        label.classList.add("image-not-downloaded");
        label.textContent = "Image not downloaded";
        imgElement.insertAdjacentElement("afterend", label);
    }

    const computed = getComputedStyle(imgElement);
    label.style.width = computed.width;
    label.style.height = computed.height;
    label.classList.remove("hidden");
}

function clearMilestoneImageNotDownloaded(imgElement) {
    imgElement.classList.remove("hidden");

    const label = imgElement.nextElementSibling;
    if (label && label.classList.contains("image-not-downloaded")) {
        label.remove();
    }
}

function setMilestoneImage(imgElement, name) {
    clearMilestoneImageNotDownloaded(imgElement);

    imgElement.onerror = () => {
        if (!navigator.onLine) {
            markMilestoneImageNotDownloaded(imgElement);
        } else {
            imgElement.src = "";
        }
    };

    imgElement.src = getMilestoneImagePath(name);
}

// =========================
// LOAD
// =========================
function loadMilestones() {
    return fetch(MILESTONES_JSON_FILE).then(res => res.json()).then(sourceList => {

        const local = localStorage.getItem(MILESTONES_STORAGE_KEY);

        if (local) {
            try {
                milestoneItems = JSON.parse(local);

                // Same reconciliation as collections.js's own load: items
                // exported from another device/session exist in the source
                // JSON but never made it into this browser's local copy —
                // pull those in without touching anything locally-added
                // that hasn't been exported yet.
                const localNames = new Set(milestoneItems.map(i => i.name));
                sourceList.forEach(source => {
                    if (!localNames.has(source.name)) milestoneItems.push(source);
                });
            } catch {
                milestoneItems = sourceList;
            }
        } else {
            milestoneItems = sourceList;
        }

        if (typeof initUnsavedChangesSnapshot === "function") {
            initUnsavedChangesSnapshot(JSON.stringify(milestoneItems), MILESTONES_STORAGE_KEY);
        }

        renderMilestones();
    }).catch(err => {
        console.error("Failed to load milestones:", err);
        milestoneItems = [];
        renderMilestones();
    });
}

function saveMilestones() {
    const serialized = JSON.stringify(milestoneItems);
    localStorage.setItem(MILESTONES_STORAGE_KEY, serialized);
    if (typeof markDirty === "function") markDirty(serialized, MILESTONES_STORAGE_KEY);
}

// =========================
// RENDER
// =========================
function renderMilestones() {
    milestonesContainer.innerHTML = "";

    milestoneItems.forEach((item, index) => {
        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        const img = document.createElement("img");
        img.loading = "lazy";
        setMilestoneImage(img, item.name);
        card.appendChild(img);

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = item.name;
        card.appendChild(label);

        card.addEventListener("click", () => openMilestoneModal(index));

        milestonesContainer.appendChild(card);
    });
}

// =========================
// VIEW MODAL
// =========================
function openMilestoneModal(index) {
    const item = milestoneItems[index];
    if (!item) return;

    setMilestoneImage(milestoneModalImage, item.name);
    milestoneModalName.textContent = item.name;

    milestoneModalOverlay.classList.remove("hidden");
    milestoneModalOverlay.dataset.index = index;
}

function closeMilestoneModal() {
    milestoneModalOverlay.classList.add("hidden");
}

document.getElementById("milestone-modal-close").addEventListener("click", closeMilestoneModal);

milestoneModalOverlay.addEventListener("click", (e) => {
    if (e.target === milestoneModalOverlay) closeMilestoneModal();
});

function openAdjacentMilestone(offset) {
    const count = milestoneItems.length;
    if (count === 0) return;

    let index = Number(milestoneModalOverlay.dataset.index);
    if (Number.isNaN(index)) index = 0;

    let next = index + offset;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;

    openMilestoneModal(next);
}

milestoneNavLeft.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacentMilestone(-1);
});

milestoneNavRight.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacentMilestone(1);
});

document.addEventListener("keydown", (e) => {
    if (milestoneModalOverlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") openAdjacentMilestone(-1);
    if (e.key === "ArrowRight") openAdjacentMilestone(1);
    if (e.key === "Escape") closeMilestoneModal();
});

milestoneModalImage.addEventListener("click", () => {
    milestoneZoomImage.src = milestoneModalImage.src;
    milestoneZoomOverlay.classList.remove("hidden");
});

milestoneZoomOverlay.addEventListener("click", (e) => {
    if (e.target === milestoneZoomOverlay || e.target === milestoneZoomImage) {
        milestoneZoomOverlay.classList.add("hidden");
    }
});

// =========================
// ADD / EDIT
// =========================
const addMilestoneModal = document.getElementById("add-milestone-modal");
const milestoneTitleInput = document.getElementById("milestone-title");
const milestonePositionInput = document.getElementById("milestone-position");
const milestonePositionRow = document.getElementById("milestone-position-row");
const milestoneModalTitleText = document.getElementById("milestone-modal-title-text");
const milestoneErrorBox = document.getElementById("milestone-item-error");

document.getElementById("add-milestone").addEventListener("click", () => {
    addMilestoneModal.classList.remove("hidden");
    milestoneModalTitleText.textContent = "Add Milestone";
    delete addMilestoneModal.dataset.editIndex;

    milestoneTitleInput.value = "";
    milestonePositionInput.value = "";
    milestonePositionRow.hidden = false;
    milestoneErrorBox.classList.add("hidden");
});

document.getElementById("save-milestone").addEventListener("click", () => {
    const name = milestoneTitleInput.value.trim();

    if (!name) {
        milestoneErrorBox.textContent = "Please enter a name.";
        milestoneErrorBox.classList.remove("hidden");
        return;
    }

    milestoneErrorBox.classList.add("hidden");

    const editIndex = addMilestoneModal.dataset.editIndex;

    if (editIndex !== undefined && editIndex !== "") {
        milestoneItems[editIndex].name = name;
    } else {
        const posRaw = milestonePositionInput.value.trim();
        const pos = posRaw
            ? Math.max(0, Math.min(milestoneItems.length, parseInt(posRaw, 10) - 1))
            : milestoneItems.length;
        milestoneItems.splice(pos, 0, { name });
    }

    delete addMilestoneModal.dataset.editIndex;

    saveMilestones();
    renderMilestones();
    addMilestoneModal.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
    if (addMilestoneModal.classList.contains("hidden")) return;
    if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("save-milestone").click();
    }
});

document.getElementById("cancel-milestone").addEventListener("click", () => {
    addMilestoneModal.classList.add("hidden");
    milestoneErrorBox.classList.add("hidden");
});

document.getElementById("edit-milestone").addEventListener("click", () => {
    const index = milestoneModalOverlay.dataset.index;
    const item = milestoneItems[index];
    if (!item) return;

    milestoneTitleInput.value = item.name;
    milestonePositionRow.hidden = true;

    addMilestoneModal.dataset.editIndex = index;
    milestoneModalTitleText.textContent = "Edit Milestone";

    addMilestoneModal.classList.remove("hidden");
    closeMilestoneModal();
});

document.getElementById("delete-milestone").addEventListener("click", () => {
    const index = milestoneModalOverlay.dataset.index;
    if (index === undefined) return;

    milestoneItems.splice(index, 1);
    saveMilestones();
    renderMilestones();
    closeMilestoneModal();
});

// =========================
// IMPORT / EXPORT
// =========================
document.getElementById("import-milestones-button").addEventListener("click", () => {
    document.getElementById("import-milestones").click();
});

document.getElementById("import-milestones").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);

            if (!Array.isArray(imported)) {
                alert("Invalid backup format");
                return;
            }

            milestoneItems = imported;
            saveMilestones();
            renderMilestones();

            alert(`Imported ${milestoneItems.length} milestones`);
        } catch (err) {
            console.error(err);
            alert("Failed to import backup");
        }
    };

    reader.readAsText(file);
    e.target.value = "";
});

document.getElementById("export-milestones").addEventListener("click", async () => {
    const data = JSON.stringify(milestoneItems, null, 2);
    const snapshotData = JSON.stringify(milestoneItems);
    const { getAdminIdToken } = await milestoneAdminAuthReady;
    const idToken = await getAdminIdToken();

    if (idToken) {
        try {
            const res = await fetch("https://orange-bar-b027.harrycummins.workers.dev/export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    filename: MILESTONES_JSON_FILE,
                    content: data
                })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                if (typeof markSaved === "function") markSaved(snapshotData, MILESTONES_STORAGE_KEY);
                alert(`✅ ${MILESTONES_JSON_FILE} committed to GitHub automatically.`);
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

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = MILESTONES_JSON_FILE;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof markSaved === "function") markSaved(snapshotData, MILESTONES_STORAGE_KEY);
});

// =========================
// TAB SWITCHING
// =========================
const completionsView = document.getElementById("completions-view");
const milestonesView = document.getElementById("milestones-view");
const tabCompletionsBtn = document.getElementById("tab-completions-btn");
const tabMilestonesBtn = document.getElementById("tab-milestones-btn");

let milestonesLoaded = false;

tabCompletionsBtn.addEventListener("click", () => {
    if (!completionsView.classList.contains("hidden")) return;

    completionsView.classList.remove("hidden");
    milestonesView.classList.add("hidden");
    tabCompletionsBtn.classList.add("deck-tab-active");
    tabMilestonesBtn.classList.remove("deck-tab-active");
});

tabMilestonesBtn.addEventListener("click", () => {
    if (!milestonesView.classList.contains("hidden")) return;

    milestonesView.classList.remove("hidden");
    completionsView.classList.add("hidden");
    tabMilestonesBtn.classList.add("deck-tab-active");
    tabCompletionsBtn.classList.remove("deck-tab-active");

    // Loaded lazily, on first switch to the tab, rather than always at page
    // load — most visits to Completions never open Milestones, so this
    // avoids an extra fetch() and localStorage merge nobody asked for.
    if (!milestonesLoaded) {
        milestonesLoaded = true;
        loadMilestones();
    }
});
