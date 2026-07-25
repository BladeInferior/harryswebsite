let savedDexData = {};
let shinyEditModeFlag = false;
let gameFilterState = {};
let allPokemon = [];
let cardMap = new Map();
let currentPokemon = null;
let activeDexEdit = null;
let missingDexFilter = null; // null | true (Missing) | false (Not Missing)
let pageSize = 30;
let currentPage = 1;
let pageMode = false; 
let selectedGeneration = null;
let tagFilters = {};
let pokemonCountLabel = null;
let selectedCompletionFilter = null; // 'blue' | 'green' | null — clicking a #dex-key swatch

// Site-wide admin identity (see ../admin-auth-core.js) — dynamic import
// since this file is a plain <script>, not a module. Replaces the old
// "paste a secret into localStorage via devtools" (exportAuthKey) approach
// with just being signed in as the owner's Google account (bottom-right
// widget from admin-auth.js), which works the same on any device.
const adminAuthReady = import('../admin-auth-core.js');

const dexTypes = [
    { key: "masterDex", label: "MasterDex" },
    { key: "shinyDex", label: "Shiny Dex" },
    { key: "tradeDex", label: "Trade Dex" },
    { key: "wonderTradeDex", label: "Wonder Trade Dex" },
    { key: "pogoDex", label: "PoGo Dex" },
    { key: "cherishDex", label: "Cherish Dex" }
];


function saveData() {
    const serialized = JSON.stringify(savedDexData);
    localStorage.setItem("dexData", serialized);
    if (typeof markDirty === "function") markDirty(serialized);
    updateProgress();
    updateCardHighlights();
}

Promise.all([
    fetch("fullPokemonList.json").then(res => res.json()),
    fetch("pokedex-backup.json").then(res => res.json())
])
.then(([pokemonList, dexList]) => {

    allPokemon = pokemonList;

    // convert exported array into your existing format
    const sourceDexData = {};

    dexList.forEach(entry => {

        const key = normalizeName(entry.name);

        sourceDexData[key] = {
            masterDex: !!entry.masterDex,
            tradeDex: !!entry.tradeDex,
            wonderTradeDex: !!entry.wonderTradeDex,
            pogoDex: !!entry.pogoDex,
            cherishDex: !!entry.cherishDex,

            shinyDex: !!entry.shinyDex,

            shinyDexData: {
                correctStage: !!entry.shinyDexData?.correctStage,
                originalRegion: !!entry.shinyDexData?.originalRegion,
                luxuryBall: !!entry.shinyDexData?.luxuryBall
            }
        };
    });

    // saveData() has always written every toggle to localStorage, but
    // nothing ever read it back on load — a refresh before exporting was
    // silently reverting to whatever pokedex-backup.json last had. Local
    // wins per-pokemon (it's always a full snapshot of the whole dex, so
    // it's at least as current as the backup for anything it covers);
    // entries only present in the backup (new pokemon, or synced from
    // another device) get pulled in without touching anything saved locally.
    const localRaw = localStorage.getItem("dexData");

    if (localRaw) {
        try {
            savedDexData = JSON.parse(localRaw);

            Object.keys(sourceDexData).forEach(key => {
                if (!(key in savedDexData)) savedDexData[key] = sourceDexData[key];
            });
        } catch {
            savedDexData = sourceDexData;
        }
    } else {
        savedDexData = sourceDexData;
    }

    if (typeof initUnsavedChangesSnapshot === "function") {
        initUnsavedChangesSnapshot(JSON.stringify(savedDexData));
    }

    createPokemonCards(allPokemon);
    createProgressUI();
    createFilterButtons();

    updateProgress();
    updateCardHighlights();
    updateMissingButtonHighlight();

    updateModeUI();
});



function imageName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

// Pokémon GO's region-locked pokemon — a completely different list from the
// core-games "Regional" tag in fullPokemonList.json (which flags Alolan/
// Galarian/etc. form variants). Only relevant while editing the PoGo Dex
// (see matchesTags() in applyFilters()), so the Regional/Not Regional filter
// checks this instead of the normal tag there.
const POGO_REGIONAL_NAMES = new Set([
    "farfetchd", "kangaskhan", "mrmime", "tauros", "heracross", "corsola",
    "volbeat", "illumise", "torkoal", "zangoose", "seviper", "lunatone",
    "solrock", "tropius", "relicanth", "pachirisu", "mimejr", "chatot",
    "carnivine", "uxie", "mesprit", "azelf", "pansage", "panpour", "pansear",
    "simipour", "simisage", "simisear", "throh", "sawk", "maractus",
    "sigilyph", "bouffalant", "heatmor", "durant", "hawlucha", "klefki",
    "comfey", "buzzwole", "pheromosa", "xurkitree", "kartana", "stakataka",
    "blacephalon", "stonjourner"
]);

function isPogoRegional(name) {
    return POGO_REGIONAL_NAMES.has(normalizeName(name));
}

function getPokemonSpritePath(name, useShiny = false) {
    const fileName = `${imageName(name)}.png`;
    return useShiny
        ? `sprites/pokemon_shiny_sprites/${fileName}`
        : `sprites/pokemon_sprites/${fileName}`;
}

function shouldShowShinyCardSprites() {
    return activeDexEdit === "shinyDex";
}

function toggleShinyDex(pokemonKey) {

    const data = savedDexData[pokemonKey] || {};

    const newState = !data.shinyDex;
    data.shinyDex = newState;

    // if turning OFF shiny, wipe variants
    if (!newState) {
        data.shinyDexData = {
            correctStage: false,
            originalRegion: false,
            luxuryBall: false
        };
    } else {
        // ensure structure exists when turning ON
        if (!data.shinyDexData) {
            data.shinyDexData = {
                correctStage: false,
                originalRegion: false,
                luxuryBall: false
            };
        }
    }

    savedDexData[pokemonKey] = data;

    saveData();

    return newState;
}

function normalizeName(name) {
    return imageName(name).replace(/[^a-z0-9]/g, "");
}

const boxContainer = document.getElementById("box-container");
const modalOverlay = document.getElementById("modal-overlay");
const modalImage = document.getElementById("modal-image");
const shinyOverlay = document.getElementById("shiny-overlay");
const shinyName = document.getElementById("shiny-modal-name");
const shinyImage = document.getElementById("shiny-modal-image");
const navLeft = document.getElementById("modal-nav-left");
const navRight = document.getElementById("modal-nav-right");


// ---------------------------
// CREATE POKÉMON CARDS
// ---------------------------
function createPokemonCards(pokemonList) {

    boxContainer.innerHTML = "";
    cardMap.clear();

    pokemonList.forEach((pokemon) => {

        const name = pokemon.name;

        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        card.innerHTML = `
            <img loading="lazy" src="${getPokemonSpritePath(name, shouldShowShinyCardSprites())}">
            <div class="pokemon-name">${name}</div>
            <div class="shiny-plus">➕</div>
        `;

        const plusBtn = card.querySelector(".shiny-plus");

        plusBtn.addEventListener("click", (e) => {

            e.preventDefault();
            e.stopPropagation();

            const key = normalizeName(name);

            toggleShinyDex(key);

            if (currentPokemon) {
                renderModalState(currentPokemon);
            }

            updateCardHighlights();
            updateProgress();
        });

        boxContainer.appendChild(card);
        cardMap.set(name, card);

        card.addEventListener("click", () => {

            const key = normalizeName(name);
            const pokemonData = savedDexData[key] || {};

            // =====================================================
            // EDIT MODE → SPECIAL SHINYDEX BEHAVIOUR
            // =====================================================
            if (activeDexEdit) {

                // -----------------------------
                // NORMAL DEX TOGGLES (master/trade/etc)
                // -----------------------------
                if (activeDexEdit !== "shinyDex") {

                    pokemonData[activeDexEdit] = !pokemonData[activeDexEdit];

                    savedDexData[key] = pokemonData;
                    saveData();

                    updateCardHighlights();
                    updateProgress();

                    return;
                }

                // -----------------------------
                // SHINYDEX MODE → OPEN VARIANT EDIT UI
                // -----------------------------

                if (activeDexEdit === "shinyDex") {

                    const pokemonData = savedDexData[key] || {};

                    const isAlreadySelected = !!pokemonData.shinyDex;

                    // -----------------------------
                    // CASE 1: NOT SHINY
                    // -----------------------------
                    if (!isAlreadySelected) {
                        return;
                    }

                    // -----------------------------
                    // CASE 2: ALREADY SHINY → OPEN MODAL ONLY
                    // -----------------------------
                    currentPokemon = key;

                    document.getElementById("modal-name").textContent = name;
                    modalImage.src = getPokemonSpritePath(name, true);

                    modalOverlay.classList.remove("hidden");
                    renderModalState(key);

                    return;
                }
            }

            // =====================================================
            // NORMAL MODE → OPEN MODAL
            // =====================================================
            currentPokemon = key;

            document.getElementById("modal-name").textContent = name;

            modalImage.src = getPokemonSpritePath(name, shouldShowShinyCardSprites());
            modalOverlay.classList.remove("hidden");

            renderModalState(currentPokemon);

            
        });
    });
}


// ---------------------------
// FILTER
// ---------------------------
function filterPokemon(value) {

    const query = value.toLowerCase();

    cardMap.forEach((card, name) => {

        if (imageName(name).includes(query)) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }

    });
}

function applyListFilter() {

    if (!activeListFilter) {
        cardMap.forEach(card => {
            card.style.display = "block";
        });
        return;
    }

    const allowed = pokemonFilters[activeListFilter];

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);

        if (allowed.includes(key)) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }

    });
}

// Called after a discrete filter toggle (tag/generation/game/missing/
// completion-color buttons, entering or leaving dex-edit mode) so the newly
// filtered results are visible immediately instead of leaving the page
// wherever it happened to be scrolled — e.g. clicking Legendary while
// scrolled halfway down, then unclicking it, used to strand the view there.
// Deliberately not used for the live search box: that's continuous
// refinement rather than a discrete on/off change, and the box already sits
// near the top of the page.
function scrollResultsToTop() {
    window.scrollTo({ top: 0, behavior: "instant" });
}

function applyFilters() {

    const query = searchInput.value.toLowerCase();

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);

        const pokemonData = allPokemon.find(p => normalizeName(p.name) === key);

        const games = pokemonData?.games || [];
        const generation = pokemonData?.generation;
        const types = (pokemonData?.type || "")
            .toLowerCase()
            .replace(/\s/g, "")      // remove spaces
            .split(",");            // turn into array

        const matchesSearch = (() => {

            if (!query) return true;

            const nameMatch = imageName(name).includes(query);
            const typeMatch = types.some(t => t.includes(query));

            return nameMatch || typeMatch;
        })();


        const matchesGame = (() => {

            const entries = Object.entries(gameFilterState);

            if (entries.length === 0) return true;

            return entries.every(([game, mode]) => {

                const hasGame = games.includes(game);

                if (mode === "include") return hasGame;
                if (mode === "exclude") return !hasGame;

                return true;
            });

        })();

        const matchesGeneration = (() => {

            if (selectedGeneration === null) return true;

            return generation === selectedGeneration;

        })();

        const matchesTags = (() => {

            const tagFilterKeys = Object.keys(tagFilters);
            if (tagFilterKeys.length === 0) return true;

            const pokemonTags = pokemonData?.tags || [];

            return tagFilterKeys.every(filterTag => {
                if (filterTag === "legendary") return pokemonTags.includes("Legendary");
                if (filterTag === "notLegendary") return !pokemonTags.includes("Legendary");
                if (filterTag === "mythical") return pokemonTags.includes("Mythical");
                if (filterTag === "notMythical") return !pokemonTags.includes("Mythical");
                if (filterTag === "regional") {
                    return activeDexEdit === "pogoDex"
                        ? isPogoRegional(name)
                        : pokemonTags.includes("Regional");
                }
                if (filterTag === "notRegional") {
                    return activeDexEdit === "pogoDex"
                        ? !isPogoRegional(name)
                        : !pokemonTags.includes("Regional");
                }
                return true;
            });

        })();

        const matchesMissing = (() => {

            if (missingDexFilter === null) return true;
            if (!activeDexEdit) return true;

            const data = savedDexData[key] || {};
            const hasIt = !!data[activeDexEdit];

            return missingDexFilter === true ? !hasIt : hasIt;
        })();

        // #dex-key swatch filter: only pokemon at that exact completion tier
        const matchesCompletion = (() => {

            if (selectedCompletionFilter === null) return true;

            return getCompletionColor(name) === selectedCompletionFilter;
        })();

        if (matchesSearch && matchesGame && matchesGeneration && matchesTags && matchesMissing && matchesCompletion) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });

    updatePokemonCount();
}


// ---------------------------
// CLOSE MODAL
// ---------------------------
modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
        modalOverlay.classList.add("hidden");
    }
});

const modalCloseBtn = document.getElementById("modal-close");
if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
    });
}


// ---------------------------
// MODAL NAVIGATION
// Cycles through whichever cards are actually visible right now (search,
// game/generation/tag filters, missing-dex filter all just toggle a
// card's display), not the full unfiltered Pokédex.
// ---------------------------
function getVisibleCardNames() {
    const names = [];
    cardMap.forEach((card, name) => {
        if (card.style.display !== "none") names.push(name);
    });
    return names;
}

function openAdjacentPokemon(offset) {
    if (!currentPokemon) return;

    const visibleNames = getVisibleCardNames();
    if (visibleNames.length === 0) return;

    let pos = visibleNames.findIndex(name => normalizeName(name) === currentPokemon);
    if (pos === -1) pos = 0;

    let nextPos = pos + offset;
    if (nextPos < 0) nextPos = visibleNames.length - 1;
    if (nextPos >= visibleNames.length) nextPos = 0;

    const name = visibleNames[nextPos];
    currentPokemon = normalizeName(name);

    document.getElementById("modal-name").textContent = name;
    modalImage.src = getPokemonSpritePath(name, shouldShowShinyCardSprites());

    renderModalState(currentPokemon);
}

if (navLeft) {
    navLeft.addEventListener("click", (e) => {
        e.stopPropagation();
        openAdjacentPokemon(-1);
    });
}

if (navRight) {
    navRight.addEventListener("click", (e) => {
        e.stopPropagation();
        openAdjacentPokemon(1);
    });
}

document.addEventListener("keydown", (e) => {
    if (modalOverlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") openAdjacentPokemon(-1);
    if (e.key === "ArrowRight") openAdjacentPokemon(1);
    if (e.key === "Escape") modalOverlay.classList.add("hidden");
});


// ---------------------------
// MAIN DEX TOGGLES
// ---------------------------
document.querySelectorAll(".dex-entry").forEach((entry) => {

    entry.addEventListener("click", () => {

        if (!currentPokemon) return;

        const dex = entry.dataset.dex;

        if (dex === "shinyDex") return;

        const pokemonData = savedDexData[currentPokemon] || {};

        pokemonData[dex] = !pokemonData[dex];

        savedDexData[currentPokemon] = pokemonData;
        saveData();

        renderModalState(currentPokemon);
        updateCardHighlights();
        updateProgress();
    });

});


// ---------------------------
// SHINY DEX TOGGLE
// ---------------------------
modalOverlay.addEventListener("click", (e) => {

    if (e.target.closest(".dex-progress")) return;

    const shinyEntry = e.target.closest('[data-dex="shinyDex"]');
    if (!shinyEntry) return;

    if (!currentPokemon) return;

    toggleShinyDex(currentPokemon);

    renderModalState(currentPokemon);
    updateCardHighlights();
    updateProgress();
});


// ---------------------------
// SHINY VARIANTS
// ---------------------------
modalOverlay.addEventListener("click", (e) => {

    const variant = e.target.closest(".variant");
    if (!variant) return;

    if (!currentPokemon) return;

    const pokemonData = savedDexData[currentPokemon] || {};

    if (!pokemonData.shinyDex) return;

    const type = variant.dataset.variant;

    if (!pokemonData.shinyDexData) {
        pokemonData.shinyDexData = {
            correctStage: false,
            originalRegion: false,
            luxuryBall: false
        };
    }

    // update ONLY data
    pokemonData.shinyDexData[type] = !pokemonData.shinyDexData[type];

    savedDexData[currentPokemon] = pokemonData;

    saveData();

    renderModalState(currentPokemon);
});


// ---------------------------
// SEARCH
// ---------------------------
const searchInput = document.getElementById("search");

searchInput.addEventListener("input", (e) => {
    applyFilters(e.target.value);
});

const clearBtn = document.getElementById("clear-search");
let missingFilterBtn = null;
let notMissingFilterBtn = null;

clearBtn.addEventListener("click", () => {

    searchInput.value = "";
    applyFilters("");
});

function updateMissingButtonHighlight() {
    if (!missingFilterBtn || !notMissingFilterBtn) return;

    missingFilterBtn.classList.toggle("game-filter-active", missingDexFilter === true);
    notMissingFilterBtn.classList.toggle("game-filter-active", missingDexFilter === false);

    // Both sides of the pair are meaningless without a dex actively being
    // edited (the filter is a no-op per matchesMissing), so grey them out
    // and block clicks until one is selected.
    const disabled = !activeDexEdit;
    missingFilterBtn.classList.toggle("filters-disabled", disabled);
    notMissingFilterBtn.classList.toggle("filters-disabled", disabled);

    // Mobile Safari occasionally doesn't repaint a class-driven style change
    // on an element sitting inside the filters popout's transformed/animated
    // container until something else forces a reflow — reading offsetHeight
    // forces one immediately, so the highlight updates the instant it's tapped
    // instead of only catching up once the popout itself repaints (e.g. on close).
    void missingFilterBtn.offsetHeight;
}


// ---------------------------
// PROGRESS UI
// ---------------------------
function createProgressUI() {

    const container = document.getElementById("progress-container");
    container.innerHTML = "";

    dexTypes.forEach(dex => {

        const el = document.createElement("div");
        el.classList.add("dex-progress");
        el.dataset.dex = dex.key;

        el.innerHTML = `
            <div class="dex-title">
                <span>${dex.label}</span>

                <div class="dex-controls">
                    <span class="percent">0%</span>
                    <button class="edit-btn">Edit</button>
                </div>
            </div>

            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>

            <div class="dex-stats">0 / 1025 caught</div>
        `;

        container.appendChild(el);
    });

}

document.addEventListener("click", (e) => {

    const btn = e.target.closest(".edit-btn");
    if (!btn) return;

    const dexBox = btn.closest(".dex-progress");
    const dexType = dexBox.dataset.dex;

    const previousDexEdit = activeDexEdit;

    if (activeDexEdit === dexType) {
        activeDexEdit = null;
        if (dexType === "shinyDex") {
            shinyEditModeFlag = false;
        }
    } else {
        activeDexEdit = dexType;
        if (dexType === "shinyDex") {
            shinyEditModeFlag = true;
        }
    }

    // Comparing against the resulting activeDexEdit (not just dexType)
    // matters for turning editing OFF: clicking the same dex again sets
    // activeDexEdit back to null, which is still a real change (e.g. it's
    // what flips the Regional filter on PoGo Dex back to its normal
    // definition) — comparing the old value against dexType alone missed
    // that case, since they're equal precisely when you're toggling off.
    const dexChanged = previousDexEdit !== activeDexEdit;

    if (dexChanged && missingDexFilter !== null) {
        missingDexFilter = null;
    }
    updateMissingButtonHighlight();

    boxContainer.classList.toggle(
        "shiny-edit-layout",
        activeDexEdit === "shinyDex"
    );

    updateModeUI();
    updateProgress();
    updateCardHighlights();
    if (dexChanged) {
        applyFilters();
        scrollResultsToTop();
        if (pageMode) {
            applyPagination();
        }

        // The open modal's state (active/inactive per dex-entry) is only
        // ever rendered for the dex that was active when it was opened —
        // switching which dex is being edited would leave it showing stale
        // data, so just close it instead.
        modalOverlay.classList.add("hidden");
    }
});


// ---------------------------
// PROGRESS CALC
// ---------------------------
function updateProgress() {
    

    const total = allPokemon.length || 1025;

    dexTypes.forEach(dex => {

        let caught = 0;

        allPokemon.forEach(pokemon => {

            const key = normalizeName(pokemon.name);
            const data = savedDexData[key];

            if (!data) return;

            if (dex.key === "shinyDex") {

                if (data.shinyDex) {
                    caught++;
                }

            } else {

                if (data[dex.key]) {
                    caught++;
                }
            }
        });

        const percent = Math.round((caught / total) * 100);

        const bar = document.querySelector(`.dex-progress[data-dex="${dex.key}"]`);
        if (!bar) return;

        bar.classList.toggle("active-filter", activeDexEdit === dex.key);

        bar.querySelector(".progress-fill").style.width = percent + "%";
        bar.querySelector(".percent").textContent = percent + "%";
        bar.querySelector(".dex-stats").textContent =
            `${caught} / ${total} caught`;
    });
}

// null | "blue" (all 5 dexes) | "green" (all 5 dexes + all shiny variants) —
// shared by updateCardHighlights() (drives the card border colour) and
// applyFilters()'s completion filter (driven by clicking a #dex-key swatch),
// so the two can never drift out of sync with each other.
function getCompletionColor(name) {

    const key = normalizeName(name);
    const data = savedDexData[key] || {};

    const master = !!data.masterDex;
    const trade = !!data.tradeDex;
    const wonder = !!data.wonderTradeDex;
    const pogo = !!data.pogoDex;
    const shinyEnabled = data.shinyDex === true;

    const correctStage = !!data.shinyDexData?.correctStage;
    const originalRegion = !!data.shinyDexData?.originalRegion;
    const luxuryBall = !!data.shinyDexData?.luxuryBall;

    const mainComplete = master && trade && wonder && pogo && shinyEnabled;
    const fullComplete = mainComplete && correctStage && originalRegion && luxuryBall;

    if (fullComplete) return "green";
    if (mainComplete) return "blue";
    return null;
}

function updateCardHighlights() {

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);
        const data = savedDexData[key] || {};

        // -----------------------------
        // RESET CLASSES
        // -----------------------------
        card.classList.remove("active-dex", "complete-blue", "complete-green");

        // -----------------------------
        // FILTER MODE (GOLD)
        // -----------------------------
        if (activeDexEdit) {

            let isActive = false;

            // special handling for shiny dex
            if (activeDexEdit === "shinyDex") {
                isActive = data.shinyDex === true;
            } else {
                isActive = !!data[activeDexEdit];
            }

            if (isActive) {
                card.classList.add("active-dex");
            }

            return;
        }

        const color = getCompletionColor(name);
        if (color) card.classList.add(`complete-${color}`);
    });
}

function renderModalState(pokemonKey) {

    modalOverlay.querySelectorAll(".variant").forEach(v => {
        v.classList.remove("active", "disabled");
    });

    const data = savedDexData[pokemonKey] || {};
    const isShinyEdit = shinyEditModeFlag;

    modalOverlay.classList.toggle("shiny-edit-layout", isShinyEdit);

    const dexEntries = modalOverlay.querySelectorAll(".dex-entry");

    dexEntries.forEach(entry => {

        const dex = entry.dataset.dex;

        entry.classList.toggle("hidden", isShinyEdit);
    });

    if (isShinyEdit === false) {
        document.querySelectorAll(".dex-entry").forEach((entry) => {

            const dex = entry.dataset.dex;

            const isActive = !!data[dex];

            entry.classList.toggle("active", isActive);
            entry.classList.toggle("inactive", !isActive);
        });
    }    

    modalOverlay.querySelectorAll(".variant").forEach(v => {

        const type = v.dataset.variant;

        const enabled = !!data.shinyDex;
        const value = data.shinyDexData?.[type];

        v.classList.toggle("disabled", !enabled);
        v.classList.toggle("active", !!value);
    });
}

function createFilterButtons() {

    const container = document.getElementById("game-filter-container");

    // -----------------------------
    // MISSING / NOT MISSING (half-width with/without pair)
    // -----------------------------
    const missingRow = document.createElement("div");
    missingRow.classList.add("generation-filter-row", "generation-filter-row--half");

    missingFilterBtn = document.createElement("button");
    missingFilterBtn.id = "missing-dex-filter";
    missingFilterBtn.textContent = "Missing ✔";
    missingFilterBtn.classList.add("generation-filter-btn", "include-btn");

    missingFilterBtn.addEventListener("click", () => {
        missingDexFilter = missingDexFilter === true ? null : true;
        applyFilters();
        scrollResultsToTop();
        updateMissingButtonHighlight();
    });

    missingRow.appendChild(missingFilterBtn);

    notMissingFilterBtn = document.createElement("button");
    notMissingFilterBtn.id = "not-missing-dex-filter";
    notMissingFilterBtn.textContent = "Not Missing ✖";
    notMissingFilterBtn.classList.add("generation-filter-btn", "exclude-btn");

    notMissingFilterBtn.addEventListener("click", () => {
        missingDexFilter = missingDexFilter === false ? null : false;
        applyFilters();
        scrollResultsToTop();
        updateMissingButtonHighlight();
    });

    missingRow.appendChild(notMissingFilterBtn);

    container.appendChild(missingRow);

    const games = [
        { key: "swsh", label: "Sword & Shield" },
        { key: "bdsp", label: "BDSP" },
        { key: "pla", label: "Legends Arceus" },
        { key: "scvi", label: "Scarlet & Violet" },
        { key: "plza", label: "Legends ZA" },
        { key: "wiwa", label: "Winds & Waves" }
    ];

    games.forEach(game => {

        // -----------------------------
        // INCLUDE BUTTON
        // -----------------------------
        const includeBtn = document.createElement("button");
        includeBtn.textContent = `${game.label} ✔`;
        includeBtn.classList.add("game-filter-btn", "include-btn");
        includeBtn.dataset.game = game.key;
        includeBtn.dataset.mode = "include";

        includeBtn.addEventListener("click", () => {

            if (gameFilterState[game.key] === "include") {
                delete gameFilterState[game.key];
            } else {
                gameFilterState[game.key] = "include";
            }

            applyFilters();
            scrollResultsToTop();
            updateGameButtonHighlight();
        });

        // -----------------------------
        // EXCLUDE BUTTON
        // -----------------------------
        const excludeBtn = document.createElement("button");
        excludeBtn.textContent = `${game.label} ✖`;
        excludeBtn.classList.add("game-filter-btn", "exclude-btn");
        excludeBtn.dataset.game = game.key;
        excludeBtn.dataset.mode = "exclude";

        excludeBtn.addEventListener("click", () => {

            if (gameFilterState[game.key] === "exclude") {
                delete gameFilterState[game.key];
            } else {
                gameFilterState[game.key] = "exclude";
            }

            applyFilters();
            scrollResultsToTop();
            updateGameButtonHighlight();
        });

        const row = document.createElement("div");
        row.classList.add("filter-row");

        row.appendChild(includeBtn);
        row.appendChild(excludeBtn);

        container.appendChild(row);
    });

    // -----------------------------
    // GENERATION FILTERS
    // -----------------------------

    // -----------------------------
    // TAG FILTERS (Legendary, Mythical, Regional)

    const oppositeTag = {
        legendary: "notLegendary",
        notLegendary: "legendary",
        mythical: "notMythical",
        notMythical: "mythical",
        regional: "notRegional",
        notRegional: "regional"
    };

    const tagPairs = [
        { yesKey: "legendary", yesLabel: "Legendary", noKey: "notLegendary", noLabel: "Not Legendary" },
        { yesKey: "mythical", yesLabel: "Mythical", noKey: "notMythical", noLabel: "Not Mythical" },
        { yesKey: "regional", yesLabel: "Regional", noKey: "notRegional", noLabel: "Not Regional" }
    ];

    tagPairs.forEach(pair => {
        const row = document.createElement("div");
        row.classList.add("filter-row");

        [
            { key: pair.yesKey, label: pair.yesLabel, mode: "include" },
            { key: pair.noKey, label: pair.noLabel, mode: "exclude" }
        ].forEach(tag => {
            const btn = document.createElement("button");
            const icon = tag.mode === "include" ? "✔" : "✖";
            btn.textContent = `${tag.label} ${icon}`;
            btn.classList.add("game-filter-btn", tag.mode === "include" ? "include-btn" : "exclude-btn", "tag-filter-btn");
            btn.dataset.tag = tag.key;

            btn.addEventListener("click", () => {
                const opposite = oppositeTag[tag.key];

                if (tagFilters[tag.key]) {
                    delete tagFilters[tag.key];
                } else {
                    delete tagFilters[opposite];
                    tagFilters[tag.key] = true;
                }

                applyFilters();
                scrollResultsToTop();
                updateTagButtonHighlight();
            });

            row.appendChild(btn);
        });

        container.appendChild(row);
    });

    const generationRow1 = document.createElement("div");
    generationRow1.classList.add("generation-filter-row");

    const generationRow2 = document.createElement("div");
    generationRow2.classList.add("generation-filter-row");

    const generationRow3 = document.createElement("div");
    generationRow3.classList.add("generation-filter-row", "generation-filter-row--half");

    for (let gen = 1; gen <= 10; gen++) {

        const btn = document.createElement("button");

        btn.textContent = `Gen ${gen}`;
        btn.classList.add("generation-filter-btn");
        btn.dataset.gen = gen;

        btn.addEventListener("click", () => {

            // Page mode already shows a full mixed page rather than a
            // filtered subset, so filtering down to one generation there
            // would fight with pagination. Jump to that generation's first
            // page instead — e.g. Gen 4 lands on the page where Turtwig
            // (the first Gen 4 entry in dex order) appears.
            if (pageMode) {

                const index = allPokemon.findIndex(p => p.generation === gen);
                if (index === -1) return;

                currentPage = Math.floor(index / pageSize) + 1;
                applyPagination();
                scrollResultsToTop();
                return;
            }

            if (selectedGeneration === gen) {
                selectedGeneration = null;
            } else {
                selectedGeneration = gen;
            }

            applyFilters();
            scrollResultsToTop();
            updateGenerationButtonHighlight();
        });

        if (gen <= 4) {
            generationRow1.appendChild(btn);
        } else if (gen <= 8) {
            generationRow2.appendChild(btn);
        } else {
            generationRow3.appendChild(btn);
        }
    }

    container.appendChild(generationRow1);
    container.appendChild(generationRow2);
    container.appendChild(generationRow3);

    // -----------------------------
    // RESET BUTTON
    // -----------------------------
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Filters";
    resetBtn.classList.add("game-filter-btn");

    resetBtn.addEventListener("click", () => {

        gameFilterState = {};
        selectedGeneration = null;
        tagFilters = {};
        searchInput.value = "";
        missingDexFilter = null;
        selectedCompletionFilter = null;

        activeDexEdit = null;
        shinyEditModeFlag = false;

        pageMode = false;
        currentPage = 1;

        boxContainer.classList.remove("shiny-edit-layout");

        document.querySelectorAll("#dex-key .dex-key-item[data-key-color]").forEach(el => {
            el.classList.remove("active");
        });

        applyFilters();
        scrollResultsToTop();
        updateGameButtonHighlight();
        updateGenerationButtonHighlight();
        updateTagButtonHighlight();
        updateMissingButtonHighlight();
        updateCardHighlights();
        updateProgress();
        updateModeUI();
    });

    container.appendChild(resetBtn);

    // Create Pokemon count label
    pokemonCountLabel = document.createElement("div");
    pokemonCountLabel.id = "item-count-label";
    pokemonCountLabel.style.display = "none";
    pokemonCountLabel.style.padding = "10px 0";
    pokemonCountLabel.style.textAlign = "center";
    pokemonCountLabel.style.color = "#aaa";
    pokemonCountLabel.style.fontSize = "14px";
    pokemonCountLabel.style.fontWeight = "500";
    document.body.appendChild(pokemonCountLabel);
}

function updatePokemonCount() {

    if (!pokemonCountLabel) return;

    const hasActiveFilters = (
        Object.keys(gameFilterState).length > 0 ||
        selectedGeneration !== null ||
        Object.keys(tagFilters).length > 0 ||
        missingDexFilter !== null ||
        selectedCompletionFilter !== null ||
        searchInput.value.trim() !== ""
    );

    if (!hasActiveFilters) {
        pokemonCountLabel.style.display = "none";
        return;
    }

    let count = 0;
    cardMap.forEach(card => {
        if (card.style.display !== "none") {
            count++;
        }
    });

    pokemonCountLabel.textContent = `Pokémon displayed: ${count}`;
    pokemonCountLabel.style.display = "block";
}

function updateGameButtonHighlight() {

    document.querySelectorAll(".game-filter-btn").forEach(btn => {

        if (!btn.dataset.game) return;

        const game = btn.dataset.game;
        const state = gameFilterState[game];

        btn.classList.remove("game-filter-active");

        if (!state) return;

        if (state === "include" && btn.textContent.includes("✔")) {
            btn.classList.add("game-filter-active");
        }

        if (state === "exclude" && btn.textContent.includes("✖")) {
            btn.classList.add("game-filter-active");
        }
    });
}

function updateTagButtonHighlight() {

    document.querySelectorAll(".tag-filter-btn").forEach(btn => {
        const tag = btn.dataset.tag;
        const isActive = !!tagFilters[tag];

        btn.classList.toggle("game-filter-active", isActive);
    });
}

function updateGenerationButtonHighlight() {

    document
        .querySelectorAll(".generation-filter-btn")
        .forEach(btn => {

            btn.classList.toggle(
                "active",
                Number(btn.dataset.gen) === selectedGeneration
            );
        });
}

// #dex-key swatches double as filter toggles — click blue/green to show only
// pokemon at that completion tier (see getCompletionColor()). Mutually
// exclusive: a pokemon can only ever be one or the other, so clicking the
// other swap swaps rather than stacking, and clicking the active one clears it.
document.querySelectorAll("#dex-key .dex-key-item[data-key-color]").forEach(item => {

    item.addEventListener("click", () => {

        const color = item.dataset.keyColor;
        selectedCompletionFilter = selectedCompletionFilter === color ? null : color;

        document.querySelectorAll("#dex-key .dex-key-item[data-key-color]").forEach(el => {
            el.classList.toggle("active", el.dataset.keyColor === selectedCompletionFilter);
        });

        applyFilters();
        scrollResultsToTop();
        if (pageMode) applyPagination();
    });
});

document.getElementById("page-mode").addEventListener("click", () => {

    if (pageMode) return;

    pageMode = true;
    currentPage = 1;

    // Generation buttons repurpose themselves into page-jump shortcuts in
    // page mode (see their click handler above) instead of acting as a
    // filter, so a highlight left over from list mode would look like an
    // active filter that isn't actually filtering anything.
    selectedGeneration = null;
    updateGenerationButtonHighlight();

    applyPagination();
    updateModeUI();
});

document.getElementById("list-mode").addEventListener("click", () => {

    if (!pageMode) return;

    pageMode = false;

    // show everything
    document.querySelectorAll(".pokemon-card").forEach(card => {
        card.style.display = "block";
    });

    updateModeUI();
});

document.getElementById("next-page").addEventListener("click", () => {

    const cards = document.querySelectorAll(".pokemon-card");
    const maxPage = Math.ceil(cards.length / pageSize);

    if (currentPage < maxPage) {
        currentPage++;
        applyPagination();
    }
});

document.getElementById("prev-page").addEventListener("click", () => {

    if (currentPage > 1) {
        currentPage--;
        applyPagination();
    }
});

function applyPagination() {

    const cards = document.querySelectorAll(".pokemon-card");

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    cards.forEach((card, index) => {

        if (index >= start && index < end) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }

    });

    document.getElementById("page-display").textContent = currentPage;
}

function updateCardImages() {
    const useShinySprites = shouldShowShinyCardSprites();

    cardMap.forEach((card, name) => {
        const img = card.querySelector("img");
        if (!img) return;
        img.src = getPokemonSpritePath(name, useShinySprites);
    });
}

function updateModeUI() {

    const pageBtn = document.getElementById("page-mode");
    const listBtn = document.getElementById("list-mode");
    const pagination = document.getElementById("pagination-controls");

    pageBtn.classList.toggle("active-mode", pageMode === true);
    listBtn.classList.toggle("active-mode", pageMode === false);

    pagination.classList.toggle("hidden", pageMode === false);

    document.body.classList.toggle("page-mode", pageMode);
    document.body.classList.toggle("list-mode", !pageMode);

    // Disabling is applied per row rather than on the whole container —
    // opacity on a parent bleeds through to children regardless of their own
    // opacity, so the only way to keep the generation rows visually active
    // while everything else greys out is to never put the class on their
    // shared ancestor in the first place. Generation rows are identified by
    // containing a Gen N button (the "Missing"/"Not Missing" pair shares the
    // same .generation-filter-row layout class but has no [data-gen] button).
    const filterContainer = document.getElementById("game-filter-container");
    if (filterContainer) {
        Array.from(filterContainer.children).forEach(child => {
            const isGenerationRow = !!child.querySelector("[data-gen]");
            child.classList.toggle("filters-disabled", pageMode && !isGenerationRow);
        });
    }

    updateCardImages();
}

document.getElementById("export-pokedex").addEventListener("click", async () => {

    const exportData = Object.entries(savedDexData).map(([name, data]) => {

        return {
            name,
            masterDex: !!data.masterDex,
            tradeDex: !!data.tradeDex,
            wonderTradeDex: !!data.wonderTradeDex,
            pogoDex: !!data.pogoDex,
            cherishDex: !!data.cherishDex,

            shinyDex: !!data.shinyDex,
            shinyDexData: {
                correctStage: !!data.shinyDexData?.correctStage,
                originalRegion: !!data.shinyDexData?.originalRegion,
                luxuryBall: !!data.shinyDexData?.luxuryBall
            }
        };
    });

    const json = JSON.stringify(exportData, null, 2);
    // Matches saveData()'s format (JSON.stringify(savedDexData), not the
    // reshaped exportData array) — the snapshot markDirty() diffs against
    // has to be serialized the same way every time it's set.
    const snapshotData = JSON.stringify(savedDexData);
    const { getAdminIdToken } = await adminAuthReady;
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
                    filename: "pokedex-backup.json",
                    content: json
                })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                if (typeof markSaved === "function") markSaved(snapshotData);
                alert("✅ pokedex-backup.json committed to GitHub automatically.");
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
    a.download = `pokedex-backup.json`;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof markSaved === "function") markSaved(snapshotData);
});

document.getElementById("import-button").addEventListener("click", () => {
    document.getElementById("import-pokedex").click();
});

document.getElementById("import-pokedex").addEventListener("change", (e) => {

    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {

        try {

            const importedDex = JSON.parse(event.target.result);

            if (!Array.isArray(importedDex)) {
                alert("Invalid Pokédex backup format");
                return;
            }

            importedDex.forEach(entry => {

                if (!entry.name) return;

                const key = normalizeName(entry.name);

                savedDexData[key] = {
                    masterDex: !!entry.masterDex,
                    tradeDex: !!entry.tradeDex,
                    wonderTradeDex: !!entry.wonderTradeDex,
                    pogoDex: !!entry.pogoDex,
                    cherishDex: !!entry.cherishDex,

                    shinyDex: !!entry.shinyDex,

                    shinyDexData: {
                        correctStage: !!entry.shinyDexData?.correctStage,
                        originalRegion: !!entry.shinyDexData?.originalRegion,
                        luxuryBall: !!entry.shinyDexData?.luxuryBall
                    }
                };
            });

            saveData();
            updateCardHighlights();
            updateProgress();

            alert(`Imported ${importedDex.length} Pokémon entries`);

        } catch (err) {

            console.error(err);
            alert("Failed to import Pokédex backup");
        }
    };

    reader.readAsText(file);
});

// =========================
// STATS MODAL
// =========================
const statsBtn = document.getElementById("stats-btn");
const statsModal = document.getElementById("stats-modal");
const statsModalBody = document.getElementById("stats-modal-body");
const statsModalClose = document.getElementById("stats-modal-close");

function renderStats() {

    const total = allPokemon.length;

    let dexRows = "";
    dexTypes.forEach(dex => {

        let caught = 0;

        allPokemon.forEach(pokemon => {
            const data = savedDexData[normalizeName(pokemon.name)];
            if (data && data[dex.key]) caught++;
        });

        dexRows += `<div class="stats-row"><span>${dex.label}</span><span class="stats-value">${caught} / ${total}</span></div>`;
    });

    let shinyTotal = 0;
    let correctStage = 0;
    let originalRegion = 0;
    let luxuryBall = 0;
    let perfect = 0;

    allPokemon.forEach(pokemon => {

        const data = savedDexData[normalizeName(pokemon.name)];
        if (!data || !data.shinyDex) return;

        shinyTotal++;

        const s = data.shinyDexData || {};
        if (s.correctStage) correctStage++;
        if (s.originalRegion) originalRegion++;
        if (s.luxuryBall) luxuryBall++;
        if (s.correctStage && s.originalRegion && s.luxuryBall) perfect++;
    });

    statsModalBody.innerHTML = `
        <div class="stats-section">
            <h3>Dex Progress</h3>
            ${dexRows}
        </div>

        <div class="stats-section">
            <h3>Shiny Sub-Constraints</h3>
            <div class="stats-row"><span>Correct Stage</span><span class="stats-value">${correctStage} / ${shinyTotal}</span></div>
            <div class="stats-row"><span>Original Region</span><span class="stats-value">${originalRegion} / ${shinyTotal}</span></div>
            <div class="stats-row"><span>Luxury Ball</span><span class="stats-value">${luxuryBall} / ${shinyTotal}</span></div>
        </div>

        <div class="stats-section">
            <h3>Perfect Shinies</h3>
            <div class="stats-row"><span>All 3 Constraints</span><span class="stats-value">${perfect} / ${shinyTotal}</span></div>
        </div>
    `;
}

if (statsBtn) {
    statsBtn.addEventListener("click", () => {
        renderStats();
        statsModal.classList.remove("hidden");
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
// MOBILE POP-OUTS
// Filters and dex progress each get their own pop-out on mobile — both
// #game-filter-container and #progress-container are otherwise hidden
// entirely on narrow screens.
// =========================
createMobilePopout({
    toggleId: "mobile-filter-toggle",
    icon: "⚙",
    top: 130,
    right: 16,
    heading: "Filters",
    elementIds: ["game-filter-container"]
});

createMobilePopout({
    toggleId: "mobile-progress-toggle",
    icon: "📊",
    top: 130,
    right: 72,
    heading: "Dex Progress",
    elementIds: ["dex-key", "progress-container"]
});