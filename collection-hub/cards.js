const DECKS = [
    { key: "pokemon", label: "Pokémon", jsonFile: "cards-pokemon-backup.json", imageFolder: "cards/pokemon", spriteFolder: "sprites/pokemon_sprites", hasSpecial: true, hasDex: true, pageBlockRows: 4 },
    { key: "trainers", label: "Trainers", jsonFile: "cards-trainers-backup.json", imageFolder: "cards/trainers", hasSpecial: true, hasDex: false },
    { key: "pokeballs", label: "Poké Balls", jsonFile: "cards-pokeballs-backup.json", imageFolder: "cards/pokeballs", hasSpecial: true, hasDex: false },
    { key: "stadiums", label: "Stadiums", jsonFile: "cards-stadiums-backup.json", imageFolder: "cards/stadiums", hasSpecial: false, hasDex: false },
    { key: "rampardos", label: "Rampardos", jsonFile: "cards-rampardos-backup.json", imageFolder: "cards/rampardos", hasSpecial: false, hasDex: false }
];

let activeDeck = DECKS[0];
let items = [];

let pageMode = false;
let currentPage = 1;

let filterOwned = null;    // null | true | false
let filterSpecial = null;  // null | true | false
let filterGeneration = null;
let filterRecentSet = false;

let pokemonMasterList = null;
let pokemonMasterByName = null;

function normalizeCardName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const boxContainer = document.getElementById("box-container");
const deckTabs = document.getElementById("deck-tabs");

const pageBtn = document.getElementById("page-mode");
const listBtn = document.getElementById("list-mode");
const pagination = document.getElementById("pagination-controls");
const pageDisplay = document.getElementById("page-display");
const searchWrapper = document.getElementById("search-wrapper");

const modalTitle = document.getElementById("modal-title");
const itemModalTitle = document.getElementById("item-modal-title");
const modalOverlay = document.getElementById("modal-overlay");
const modalImage = document.getElementById("modal-image");
const navLeft = document.getElementById("modal-nav-left");
const navRight = document.getElementById("modal-nav-right");

const imageZoomOverlay = document.getElementById("image-zoom-overlay");
const zoomImage = document.getElementById("zoom-image");

modalImage.addEventListener("click", () => {
    zoomImage.src = modalImage.src;
    imageZoomOverlay.classList.remove("hidden");
});

imageZoomOverlay.addEventListener("click", (e) => {
    if (e.target === imageZoomOverlay || e.target === zoomImage) {
        imageZoomOverlay.classList.add("hidden");
    }
});

function getExportAuthKey() {
    return localStorage.getItem("exportAuthKey");
}

function getItemImagePath(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return { base, tryFormats: [".png"] };
}

function setItemImage(imgElement, name) {
    const { base, tryFormats } = getItemImagePath(name);
    let i = 0;

    imgElement.onerror = () => {
        i++;
        if (i < tryFormats.length) {
            imgElement.src = `${activeDeck.imageFolder}/${base}${tryFormats[i]}`;
        } else {
            imgElement.src = "";
        }
    };

    imgElement.src = `${activeDeck.imageFolder}/${base}${tryFormats[i]}`;
}

// Only owned + special Pokémon use a real card scan — unowned ones, and
// owned-but-not-special ones, show the Pokédex sprite instead. The .not-owned
// CSS class (grayscale) is only added for actually-unowned cards, so an
// owned non-special sprite still renders in full color.
function resolveItemImage(imgElement, item) {
    if (activeDeck.spriteFolder && (!item.owned || !item.special)) {
        const base = normalizeCardName(item.name);
        imgElement.onerror = null;
        imgElement.src = `${activeDeck.spriteFolder}/${base}.png`;
        return;
    }
    setItemImage(imgElement, item.name);
}

// =========================
// DECK SWITCHING
// =========================
async function loadDeck(key) {
    const deck = DECKS.find(d => d.key === key);
    if (!deck) return;

    activeDeck = deck;
    currentPage = 1;
    filterOwned = null;
    filterSpecial = null;
    filterGeneration = null;
    filterRecentSet = false;
    if (searchInput) searchInput.value = "";

    items = await fetch(deck.jsonFile).then(res => res.json());

    if (deck.key === "pokemon" && !pokemonMasterList) {
        pokemonMasterList = await fetch("fullPokemonList.json").then(res => res.json());
        // Joined by normalized name, not dex — dex numbers collide between base
        // and regional forms (e.g. Slowpoke / Galarian Slowpoke both use 0079).
        pokemonMasterByName = new Map(pokemonMasterList.map(p => [normalizeCardName(p.name), p]));
    }

    renderDeckTabs();
    pageMode = false;
    updateModeUI();
    renderItems();
    createCollectionFilters();
}

function renderDeckTabs() {
    if (!deckTabs) return;
    deckTabs.innerHTML = "";

    DECKS.forEach(deck => {
        const btn = document.createElement("button");
        btn.textContent = deck.label;
        btn.classList.add("deck-tab-btn");
        if (deck.key === activeDeck.key) btn.classList.add("deck-tab-active");
        btn.addEventListener("click", () => {
            if (deck.key !== activeDeck.key) loadDeck(deck.key);
        });
        deckTabs.appendChild(btn);
    });
}

// =========================
// FILTERS
// =========================
function createCollectionFilters() {
    const existing = document.getElementById("game-filter-container");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "game-filter-container";

    const ownedRow = document.createElement("div");
    ownedRow.classList.add("generation-filter-row", "generation-filter-row--half");

    const ownedBtn = document.createElement("button");
    ownedBtn.textContent = "Owned";
    ownedBtn.classList.add("generation-filter-btn", "include-btn");
    ownedBtn.addEventListener("click", () => {
        filterOwned = filterOwned === true ? null : true;
        refreshFilterButtons();
        filterItems(searchInput.value);
    });
    ownedRow.appendChild(ownedBtn);

    const notOwnedBtn = document.createElement("button");
    notOwnedBtn.textContent = "Not Owned";
    notOwnedBtn.classList.add("generation-filter-btn", "exclude-btn");
    notOwnedBtn.addEventListener("click", () => {
        filterOwned = filterOwned === false ? null : false;
        refreshFilterButtons();
        filterItems(searchInput.value);
    });
    ownedRow.appendChild(notOwnedBtn);

    container.appendChild(ownedRow);

    if (activeDeck.hasSpecial) {
        const specialRow = document.createElement("div");
        specialRow.classList.add("generation-filter-row", "generation-filter-row--half");

        const specialBtn = document.createElement("button");
        specialBtn.textContent = "Special";
        specialBtn.classList.add("generation-filter-btn", "include-btn");
        specialBtn.addEventListener("click", () => {
            filterSpecial = filterSpecial === true ? null : true;
            refreshFilterButtons();
            filterItems(searchInput.value);
        });
        specialRow.appendChild(specialBtn);

        const notSpecialBtn = document.createElement("button");
        notSpecialBtn.textContent = "Not Special";
        notSpecialBtn.classList.add("generation-filter-btn", "exclude-btn");
        notSpecialBtn.addEventListener("click", () => {
            filterSpecial = filterSpecial === false ? null : false;
            refreshFilterButtons();
            filterItems(searchInput.value);
        });
        specialRow.appendChild(notSpecialBtn);

        container.appendChild(specialRow);
    }

    if (activeDeck.key === "pokemon") {
        for (let g = 1; g <= 9; g += 2) {
            const genRow = document.createElement("div");
            genRow.classList.add("generation-filter-row", "generation-filter-row--half");

            [g, g + 1].forEach(genNum => {
                if (genNum > 9) return;

                const btn = document.createElement("button");
                btn.textContent = "Gen " + genNum;
                btn.classList.add("generation-filter-btn");
                btn.dataset.gen = String(genNum);
                btn.addEventListener("click", () => {
                    filterGeneration = filterGeneration === genNum ? null : genNum;
                    refreshFilterButtons();
                    filterItems(searchInput.value);
                });
                genRow.appendChild(btn);
            });

            container.appendChild(genRow);
        }
    }

    if (activeDeck.key === "pokemon" && typeof RECENT_SETS !== "undefined" && RECENT_SETS.length) {
        const recentSet = RECENT_SETS[0];

        const recentSetBtn = document.createElement("button");
        recentSetBtn.textContent = `Recent Set (${recentSet.name})`;
        recentSetBtn.classList.add("game-filter-btn", "recent-set-filter-btn");
        recentSetBtn.addEventListener("click", () => {
            filterRecentSet = !filterRecentSet;
            refreshFilterButtons();
            filterItems(searchInput.value);
        });
        container.appendChild(recentSetBtn);
    }

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Filters";
    resetBtn.classList.add("game-filter-btn");
    resetBtn.addEventListener("click", () => {
        filterOwned = null;
        filterSpecial = null;
        filterGeneration = null;
        filterRecentSet = false;
        refreshFilterButtons();
        filterItems(searchInput.value);
    });
    container.appendChild(resetBtn);

    const box = document.getElementById("box-container");
    if (box && box.parentNode) {
        box.parentNode.insertBefore(container, box.nextSibling);
    } else {
        document.body.appendChild(container);
    }

    refreshFilterButtons();
    updateFilterDisabledState();

    if (typeof syncMobileFilterPopout === "function") syncMobileFilterPopout();
}

function refreshFilterButtons() {
    const container = document.getElementById("game-filter-container");
    if (!container) return;

    container.querySelectorAll(".generation-filter-btn").forEach(btn => {
        btn.classList.remove("game-filter-active", "active");

        if (btn.textContent === "Owned" && filterOwned === true) btn.classList.add("game-filter-active");
        if (btn.textContent === "Not Owned" && filterOwned === false) btn.classList.add("game-filter-active");
        if (btn.textContent === "Special" && filterSpecial === true) btn.classList.add("game-filter-active");
        if (btn.textContent === "Not Special" && filterSpecial === false) btn.classList.add("game-filter-active");

        // Generation buttons use the plain "active" (gold) highlight, matching
        // pokedexes.js's updateGenerationButtonHighlight() convention — not
        // the green/red "game-filter-active" used by the include/exclude pairs.
        if (btn.dataset.gen && Number(btn.dataset.gen) === filterGeneration) btn.classList.add("active");
    });

    const recentSetBtn = container.querySelector(".recent-set-filter-btn");
    if (recentSetBtn) recentSetBtn.classList.toggle("game-filter-active", filterRecentSet);
}

// Page mode shows a fixed binder layout — filtering which cards appear would
// break the page numbering, so filters are reset and locked while it's active.
function updateFilterDisabledState() {
    const container = document.getElementById("game-filter-container");
    if (container) container.classList.toggle("filters-disabled", pageMode);
}

// =========================
// RENDER CARDS
// =========================
function renderItems() {
    boxContainer.innerHTML = "";

    const data = pageMode ? getPageModeOrder(items) : items;

    data.forEach(item => {
        if (item.empty) {
            const spacer = document.createElement("div");
            spacer.classList.add("pokemon-card", "empty-card");
            boxContainer.appendChild(spacer);
            return;
        }

        const card = document.createElement("div");
        card.classList.add("pokemon-card");
        if (!item.owned) card.classList.add("not-owned");
        card.dataset.itemIndex = items.indexOf(item);

        const img = document.createElement("img");
        img.loading = "lazy";
        resolveItemImage(img, item);
        card.appendChild(img);

        if (activeDeck.hasSpecial && item.special) {
            const badge = document.createElement("div");
            badge.classList.add("special-badge");
            badge.textContent = "★";
            card.appendChild(badge);
        }

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = item.name;
        card.appendChild(label);

        card.addEventListener("click", () => {
            openModal(items.indexOf(item));
        });

        boxContainer.appendChild(card);
    });

    applyPagination();
    filterItems(searchInput.value);
}

function openModal(index) {
    const item = items[index];

    resolveItemImage(modalImage, item);
    modalTitle.textContent = item.name;

    document.getElementById("modal-owned").textContent = item.owned ? "Yes" : "No";

    const specialRow = document.getElementById("modal-special-row");
    if (activeDeck.hasSpecial) {
        specialRow.hidden = false;
        document.getElementById("modal-special").textContent = item.special ? "Yes" : "No";
    } else {
        specialRow.hidden = true;
    }

    const dexRow = document.getElementById("modal-dex-row");
    if (activeDeck.hasDex) {
        dexRow.hidden = false;
        document.getElementById("modal-dex").textContent = "#" + item.dex;
    } else {
        dexRow.hidden = true;
    }

    modalOverlay.classList.remove("hidden");
    modalOverlay.dataset.index = index;
}

modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.add("hidden");
    }
});

// =========================
// MODE BUTTONS
// =========================
pageBtn.addEventListener("click", () => {
    pageMode = true;
    currentPage = 1;
    searchInput.value = "";
    filterOwned = null;
    filterSpecial = null;
    filterGeneration = null;
    filterRecentSet = false;
    refreshFilterButtons();
    updateFilterDisabledState();
    filterItems("");
    renderItems();
    applyPagination();
    updateModeUI();
});

listBtn.addEventListener("click", () => {
    pageMode = false;
    currentPage = 1;
    searchInput.value = "";
    updateFilterDisabledState();
    filterItems("");
    renderItems();
    updateModeUI();
});

// =========================
// PAGINATION
// =========================
document.getElementById("next-page").addEventListener("click", () => {
    const rows = activeDeck.pageBlockRows || 3;
    const firstPageSize = rows * 4;
    const laterPageSize = firstPageSize * 2;

    const remaining = Math.max(0, items.length - firstPageSize);
    const maxPage = items.length <= firstPageSize ? 1 : 1 + Math.ceil(remaining / laterPageSize);

    if (currentPage < maxPage) {
        currentPage++;
        renderItems();
        updateModeUI();
    }
});

document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage--;
        renderItems();
        updateModeUI();
    }
});

function applyPagination() {
    if (!pageMode) {
        document.querySelectorAll(".pokemon-card").forEach(card => {
            card.style.display = "block";
        });
        return;
    }
    pageDisplay.textContent = currentPage;
}

function updateModeUI() {
    pageBtn.classList.toggle("active-mode", pageMode === true);
    listBtn.classList.toggle("active-mode", pageMode === false);
    pagination.classList.toggle("hidden", pageMode === false);
    searchWrapper.classList.toggle("hidden", pageMode);
    document.body.classList.toggle("page-mode", pageMode);
    document.body.classList.toggle("list-mode", !pageMode);
    document.body.classList.toggle("first-page", pageMode && currentPage === 1);
}

// =========================
// ADD / EDIT ITEM
// =========================
const addModal = document.getElementById("add-item-modal");
const titleInput = document.getElementById("item-title");
const ownedInput = document.getElementById("item-owned");
const specialInput = document.getElementById("item-special");
const specialFieldRow = document.getElementById("item-special-row");
const positionInput = document.getElementById("item-position");
const positionFieldRow = document.getElementById("item-position-row");
const errorBox = document.getElementById("item-error");

document.getElementById("add-item").addEventListener("click", () => {
    addModal.classList.remove("hidden");
    itemModalTitle.textContent = "Add " + activeDeck.label.replace(/s$/, "");
    delete addModal.dataset.editIndex;

    titleInput.value = "";
    ownedInput.checked = false;
    specialInput.checked = false;
    positionInput.value = "";

    specialFieldRow.hidden = !activeDeck.hasSpecial;
    positionFieldRow.hidden = false;
});

document.getElementById("save-item").addEventListener("click", () => {
    const title = titleInput.value.trim();

    if (!title) {
        errorBox.textContent = "Please enter a name.";
        errorBox.classList.remove("hidden");
        return;
    }

    errorBox.classList.add("hidden");

    const editIndex = addModal.dataset.editIndex;

    const itemData = {
        name: title,
        owned: ownedInput.checked
    };

    if (activeDeck.hasSpecial) itemData.special = specialInput.checked;

    if (activeDeck.hasDex) {
        itemData.dex = (editIndex !== undefined && editIndex !== "") ? items[editIndex].dex : "";
    }

    if (editIndex !== undefined && editIndex !== "") {
        items[editIndex] = itemData;
    } else {
        const posRaw = positionInput.value.trim();
        const pos = posRaw ? Math.max(0, Math.min(items.length, parseInt(posRaw, 10) - 1)) : items.length;
        items.splice(pos, 0, itemData);
    }

    delete addModal.dataset.editIndex;

    renderItems();
    addModal.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
    if (addModal.classList.contains("hidden")) return;
    if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("save-item").click();
    }
});

document.getElementById("cancel-item").addEventListener("click", () => {
    addModal.classList.add("hidden");
    errorBox.classList.add("hidden");
});

document.getElementById("delete-item").addEventListener("click", () => {
    const index = modalOverlay.dataset.index;
    if (index === undefined) return;

    items.splice(index, 1);
    renderItems();
    modalOverlay.classList.add("hidden");
});

document.getElementById("edit-item").addEventListener("click", () => {
    const index = modalOverlay.dataset.index;
    const item = items[index];

    titleInput.value = item.name;
    ownedInput.checked = !!item.owned;
    specialInput.checked = !!item.special;

    specialFieldRow.hidden = !activeDeck.hasSpecial;
    positionFieldRow.hidden = true;

    addModal.dataset.editIndex = index;
    itemModalTitle.textContent = "Edit " + activeDeck.label.replace(/s$/, "");

    addModal.classList.remove("hidden");
    modalOverlay.classList.add("hidden");
});

document.getElementById("import-button").addEventListener("click", () => {
    document.getElementById("import-items").click();
});

document.getElementById("import-items").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
        try {
            const importedItems = JSON.parse(event.target.result);

            if (!Array.isArray(importedItems)) {
                alert("Invalid backup format");
                return;
            }

            items = importedItems;
            renderItems();

            alert(`Imported ${items.length} items`);
        } catch (err) {
            console.error(err);
            alert("Failed to import backup");
        }
    };

    reader.readAsText(file);
});

document.getElementById("export-items").addEventListener("click", async () => {
    const data = JSON.stringify(items, null, 2);
    const authKey = getExportAuthKey();

    if (authKey) {
        try {
            const res = await fetch("https://orange-bar-b027.harrycummins.workers.dev/export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Auth-Key": authKey
                },
                body: JSON.stringify({
                    filename: activeDeck.jsonFile,
                    content: data
                })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                alert(`✅ ${activeDeck.jsonFile} committed to GitHub automatically.`);
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
    a.download = activeDeck.jsonFile;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// =========================
// PAGE MODE LAYOUT
// =========================
function getPageModeOrder(items) {
    // Most decks use a 4x3 block (12 per page / 24 for a two-page spread),
    // matching the sleeves binder layout. Pokémon uses a 4x4 block instead
    // (16 / 32) — set per-deck via pageBlockRows.
    const rows = activeDeck.pageBlockRows || 3;
    const blockSize = rows * 4;
    const firstPageSize = blockSize;
    const laterPageSize = blockSize * 2;

    let start, end;

    if (currentPage === 1) {
        start = 0;
        end = firstPageSize;
    } else {
        start = firstPageSize + ((currentPage - 2) * laterPageSize);
        end = start + laterPageSize;
    }

    const pageItems = items.slice(start, end);

    while (pageItems.length < laterPageSize) {
        pageItems.push({ empty: true });
    }

    const output = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 4; c++) {
            output.push(pageItems[r * 4 + c]);
        }
        for (let c = 0; c < 4; c++) {
            output.push(pageItems[blockSize + (r * 4 + c)]);
        }
    }

    return output;
}

// =========================
// SEARCH / FILTER
// =========================
const searchInput = document.getElementById("search");
const clearBtn = document.getElementById("clear-search");

searchInput.addEventListener("input", (e) => {
    filterItems(e.target.value);
});

clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    filterItems("");
});

function filterItems(query) {
    const q = (query || "").toLowerCase().trim();

    const recentSetNames = (filterRecentSet && typeof RECENT_SETS !== "undefined" && RECENT_SETS.length)
        ? new Set(RECENT_SETS[0].pokemon.map(normalizeCardName))
        : null;

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {
        const dataIndex = (card.dataset && card.dataset.itemIndex) ? Number(card.dataset.itemIndex) : index;
        const item = items[dataIndex];

        if (!item) {
            card.style.display = "none";
            return;
        }

        let match = item.name.toLowerCase().includes(q);

        if (filterOwned === true && !item.owned) match = false;
        if (filterOwned === false && item.owned) match = false;
        if (filterSpecial === true && !item.special) match = false;
        if (filterSpecial === false && item.special) match = false;

        if (activeDeck.key === "pokemon" && filterGeneration !== null) {
            const master = pokemonMasterByName ? pokemonMasterByName.get(normalizeCardName(item.name)) : null;
            if (!master || Number(master.generation) !== filterGeneration) match = false;
        }

        if (recentSetNames && !recentSetNames.has(normalizeCardName(item.name))) match = false;

        card.style.display = match ? "block" : "none";
    });

    updateItemCount();
}

// =========================
// ITEM COUNT LABEL
// Mirrors the Pokédex page's "displayed" indicator — shown only while a
// search/filter is actually narrowing the grid, on both desktop (fixed
// top-right) and mobile (CSS repositions it into a bottom pill).
// =========================
const itemCountLabel = document.createElement("div");
itemCountLabel.id = "item-count-label";
itemCountLabel.style.display = "none";
document.body.appendChild(itemCountLabel);

function updateItemCount() {

    const hasActiveFilters = (
        filterOwned !== null ||
        filterSpecial !== null ||
        filterGeneration !== null ||
        filterRecentSet ||
        searchInput.value.trim() !== ""
    );

    if (!hasActiveFilters) {
        itemCountLabel.style.display = "none";
        return;
    }

    let count = 0;
    document.querySelectorAll(".pokemon-card").forEach(card => {
        if (!card.classList.contains("empty-card") && card.style.display !== "none") count++;
    });

    itemCountLabel.textContent = `${activeDeck.label} displayed: ${count}`;
    itemCountLabel.style.display = "block";
}

// =========================
// MODAL NAVIGATION
// =========================
// Cycle through whichever cards are actually visible right now (filters,
// search, and page mode all just toggle a card's display), not the full
// unfiltered item list — so next/prev matches what's on screen.
function getVisibleItemIndexes() {
    return Array.from(document.querySelectorAll(".pokemon-card"))
        .filter(card => !card.classList.contains("empty-card") && card.style.display !== "none")
        .map(card => Number(card.dataset.itemIndex));
}

function openAdjacent(offset) {
    const current = Number(modalOverlay.dataset.index);
    if (isNaN(current)) return;

    const visible = getVisibleItemIndexes();
    if (visible.length === 0) return;

    let pos = visible.indexOf(current);
    if (pos === -1) pos = 0;

    let nextPos = pos + offset;
    if (nextPos < 0) nextPos = visible.length - 1;
    if (nextPos >= visible.length) nextPos = 0;

    openModal(visible[nextPos]);
}

navLeft.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacent(-1);
});

navRight.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacent(1);
});

document.addEventListener("keydown", (e) => {
    if (modalOverlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") openAdjacent(-1);
    if (e.key === "ArrowRight") openAdjacent(1);
    if (e.key === "Escape") modalOverlay.classList.add("hidden");
});

const modalCloseBtn = document.getElementById("modal-close");
if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
    });
}

// =========================
// MOBILE FILTER POP-OUT
// The filter sidebar (#game-filter-container) is fully rebuilt on every
// deck switch (see createCollectionFilters above), so syncMobileFilterPopout()
// is re-run there too, relocating whichever fresh container now exists.
// =========================
const syncMobileFilterPopout = createMobilePopout({
    toggleId: "mobile-filter-toggle",
    icon: "⚙",
    top: 130,
    heading: "Filters",
    elementIds: ["game-filter-container"]
});

// =========================
// STATS MODAL
// Fetches every deck's JSON fresh (not just the currently active deck) so
// the modal always covers all 5 decks regardless of which one is open.
// =========================
const statsBtn = document.getElementById("stats-btn");
const statsModal = document.getElementById("stats-modal");
const statsModalBody = document.getElementById("stats-modal-body");
const statsModalClose = document.getElementById("stats-modal-close");

async function renderStats() {

    const deckStats = await Promise.all(DECKS.map(async deck => {

        const deckItems = (await fetch(deck.jsonFile).then(res => res.json()))
            .filter(item => !item.empty);

        const total = deckItems.length;
        const owned = deckItems.filter(item => item.owned).length;
        const specialOwned = deckItems.filter(item => item.special && item.owned).length;

        return { ...deck, total, owned, specialOwned };
    }));

    statsModalBody.innerHTML = deckStats.map(deck => `
        <div class="stats-section">
            <h3>${deck.label}</h3>
            <div class="stats-row"><span>Owned</span><span class="stats-value">${deck.owned} / ${deck.total}</span></div>
            ${deck.hasSpecial ? `<div class="stats-row"><span>Special Owned</span><span class="stats-value">${deck.specialOwned} / ${deck.total}</span></div>` : ""}
        </div>
    `).join("");
}

if (statsBtn) {
    statsBtn.addEventListener("click", () => {
        statsModalBody.innerHTML = "<p>Loading…</p>";
        statsModal.classList.remove("hidden");
        renderStats();
    });
}

if (statsModalClose) {
    statsModalClose.addEventListener("click", () => {
        statsModal.classList.add("hidden");
    });
}

if (statsModal) {
    statsModal.addEventListener("click", (e) => {
        if (e.target === statsModal) statsModal.classList.add("hidden");
    });
}

// =========================
// INIT
// =========================
loadDeck(DECKS[0].key);
