let savedDexData = {};
let shinyEditModeFlag = false;
let gameFilterState = {};
let allPokemon = [];
let cardMap = new Map();
let currentPokemon = null;
let activeDexEdit = null;
let pageSize = 30;
let currentPage = 1;
let pageMode = false; 

const dexTypes = [
    { key: "masterDex", label: "MasterDex" },
    { key: "shinyDex", label: "Shiny Dex" },
    { key: "tradeDex", label: "Trade Dex" },
    { key: "wonderTradeDex", label: "Wonder Trade Dex" },
    { key: "pogoDex", label: "PoGo Dex" },
    { key: "cherishDex", label: "Cherish Dex" }
];


function saveData() {
    localStorage.setItem("dexData", JSON.stringify(savedDexData));
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
    dexList.forEach(entry => {

        const key = normalizeName(entry.name);

        savedDexData[key] = {
            masterDex: !!entry.masterDex,
            tradeDex: !!entry.tradeDex,
            wonderTradeDex: !!entry.wonderTradeDex,
            pogoDex: !!entry.pogoDex,
            cherishDex: !!entry.cherishDex,

            shinyDex: !!entry.shinyDex,

            shinyDexData: {
                red: !!entry.shinyDexData?.red,
                blue: !!entry.shinyDexData?.blue,
                yellow: !!entry.shinyDexData?.yellow
            }
        };
    });

    createPokemonCards(allPokemon);
    createProgressUI();
    createFilterButtons();

    updateProgress();
    updateCardHighlights();

    updateModeUI();
});



function imageName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function toggleShinyDex(pokemonKey) {

    const data = savedDexData[pokemonKey] || {};

    const newState = !data.shinyDex;
    data.shinyDex = newState;

    // if turning OFF shiny, wipe variants
    if (!newState) {
        data.shinyDexData = {
            red: false,
            blue: false,
            yellow: false
        };
    } else {
        // ensure structure exists when turning ON
        if (!data.shinyDexData) {
            data.shinyDexData = {
                red: false,
                blue: false,
                yellow: false
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


// ---------------------------
// CREATE POKÉMON CARDS (ONLY ONCE)
// ---------------------------
function createPokemonCards(pokemonList) {

    boxContainer.innerHTML = "";
    cardMap.clear();

    pokemonList.forEach((pokemon) => {

        const name = pokemon.name;

        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        card.innerHTML = `
            <img loading="lazy" src="sprites/pokemon_sprites/${imageName(name)}.png">
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
                    modalImage.src = `sprites/pokemon_sprites/${imageName(name)}.png`;

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

            modalImage.src = `sprites/pokemon_sprites/${imageName(name)}.png`;
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

function applyFilters() {

    const query = searchInput.value.toLowerCase();

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);

        const pokemonData = allPokemon.find(p => normalizeName(p.name) === key);

        const games = pokemonData?.games || [];

        const matchesSearch =
            imageName(name).includes(query);

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

        if (matchesSearch && matchesGame) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}


// ---------------------------
// CLOSE MODAL
// ---------------------------
modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
        modalOverlay.classList.add("hidden");
    }
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
            red: false,
            blue: false,
            yellow: false
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

clearBtn.addEventListener("click", () => {

    searchInput.value = "";
    applyFilters("");
});


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

    boxContainer.classList.toggle(
        "shiny-edit-layout",
        activeDexEdit === "shinyDex"
    );

    updateProgress();          
    updateCardHighlights();
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

        const bar = document.querySelector(`[data-dex="${dex.key}"]`);
        if (!bar) return;

        bar.classList.toggle("active-filter", activeDexEdit === dex.key);

        bar.querySelector(".progress-fill").style.width = percent + "%";
        bar.querySelector(".percent").textContent = percent + "%";
        bar.querySelector(".dex-stats").textContent =
            `${caught} / ${total} caught`;
    });
}

function updateCardHighlights() {

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);
        const data = savedDexData[key] || {};

        // -----------------------------
        // MAIN DEXES
        // -----------------------------
        const master = !!data.masterDex;
        const trade = !!data.tradeDex;
        const wonder = !!data.wonderTradeDex;
        const pogo = !!data.pogoDex;
        const shinyEnabled = data.shinyDex === true;

        if (!shinyEnabled) {
            // treat all variants as false automatically
        }

        const shiny = {
            red: !!data.shinyDexData?.red,
            blue: !!data.shinyDexData?.blue,
            yellow: !!data.shinyDexData?.yellow
        };

        const red = shiny.red;
        const blue = shiny.blue;
        const yellow = shiny.yellow;

        // -----------------------------
        // CHECK STATES
        // -----------------------------

        const mainComplete =
            master &&
            trade &&
            wonder &&
            pogo &&
            shinyEnabled;

        const fullComplete =
            mainComplete &&
            red &&
            blue &&
            yellow;

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

        // -----------------------------
        // GREEN (ALL COMPLETE INCLUDING VARIANTS)
        // -----------------------------
        if (fullComplete) {
            card.classList.add("complete-green");
            return;
        }

        // -----------------------------
        // BLUE (MAIN COMPLETE ONLY)
        // -----------------------------
        if (mainComplete) {
            card.classList.add("complete-blue");
        }
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
            updateGameButtonHighlight();
        });

        const row = document.createElement("div");
        row.classList.add("filter-row");

        row.appendChild(includeBtn);
        row.appendChild(excludeBtn);

        container.appendChild(row);
    });

    // -----------------------------
    // RESET BUTTON
    // -----------------------------
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Filters";
    resetBtn.classList.add("game-filter-btn");

    resetBtn.addEventListener("click", () => {

        gameFilterState = {};
        searchInput.value = "";

        activeDexEdit = null;
        shinyEditModeFlag = false;

        pageMode = false;
        currentPage = 1;

        boxContainer.classList.remove("shiny-edit-layout");

        applyFilters();
        updateGameButtonHighlight();
        updateCardHighlights();
        updateProgress();
        updateModeUI(); 
    });

    container.appendChild(resetBtn);
}

function updateGameButtonHighlight() {

    document.querySelectorAll(".game-filter-btn").forEach(btn => {

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

document.getElementById("page-mode").addEventListener("click", () => {

    pageMode = true;
    currentPage = 1;

    applyPagination();
    updateModeUI();
});

document.getElementById("list-mode").addEventListener("click", () => {

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

function updateModeUI() {

    const pageBtn = document.getElementById("page-mode");
    const listBtn = document.getElementById("list-mode");
    const pagination = document.getElementById("pagination-controls");

    pageBtn.classList.toggle("active-mode", pageMode === true);
    listBtn.classList.toggle("active-mode", pageMode === false);

    pagination.classList.toggle("hidden", pageMode === false);
}

document.getElementById("export-pokedex").addEventListener("click", () => {

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
                red: !!data.shinyDexData?.red,
                blue: !!data.shinyDexData?.blue,
                yellow: !!data.shinyDexData?.yellow
            }
        };
    });

    const json = JSON.stringify(exportData, null, 2);

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `pokedex-backup-${new Date().toISOString().slice(0,10)}.json`;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
                        red: !!entry.shinyDexData?.red,
                        blue: !!entry.shinyDexData?.blue,
                        yellow: !!entry.shinyDexData?.yellow
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