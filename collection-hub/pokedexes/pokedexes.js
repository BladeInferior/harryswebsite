let savedDexData = {};
let shinyEditModeFlag = false;
let pogoShinyModeFlag = false;
let pogoShinyFilter = null; // null | true (Shiny) | false (Not Shiny) — PoGo Dex only, replaces the S&S game filter row
let todoFilterActive = false; // Trade Dex / Wonder Trade Dex / PoGo Dex / Shiny Dex only — show only pokemon on that dex's to-do list
let todoFindActive = false; // stepping through todoQueue one page at a time
let todoQueue = []; // pokemon (from allPokemon) currently on the to-do list, in dex order
let todoQueuePos = 0;
let todoPendingDone = new Set(); // keys clicked while Find is active — not committed until Find ends
let todoPendingShiny = new Set(); // subset of todoPendingDone marked shiny (PoGo Dex only, see pogoShinyModeFlag) — not committed until Find ends
let gameFilterState = {};
let allPokemon = [];
let evolutionFamilies = {}; // name -> array of other pokemon names in the same evolution line, from evolutionFamilies.json
let cardMap = new Map();
let currentPokemon = null;
let activeDexEdit = null;
let missingDexFilter = null; // null | true (Missing) | false (Not Missing)
let pageSize = 30;
let currentPage = 1;
let pageMode = false; 
let selectedGeneration = null;
let tagFilters = {};
let selectedTypes = []; // lowercase type names selected in the type-filter popup
let typeFilterMode = "any"; // "any" (OR match) | "only" (exact match, max 2 types)
let shinyHunts = []; // Shiny Dex only — archive of { id, name, encounters } hunt records
let huntsModeActive = false;
let pokemonCountLabel = null;
let selectedCompletionFilter = null; // 'blue' | 'gold' | 'green' | null — clicking a #dex-key swatch
let completionFilterMode = "exclusive"; // "exclusive" (exact tier only) | "all" (that tier and every tier above it) — the #dex-key-mode-toggle checkbox
const COMPLETION_TIER_RANK = { blue: 0, gold: 1, green: 2 };
let constraintFilters = {}; // { correctStage: true, notLuxuryBall: true, ... } — Has/Missing pairs for the 4 shiny constraints
let constraintFilterMode = "and"; // "or" (matches any active constraint) | "and" (must match every active constraint) — the OR/AND slider atop the Constraints dropdown

// Which generation's native region each mainline game is set in — e.g.
// Legends Z-A (plza) takes place in Kalos, so its native generation is 6.
// Used only by the Original Region constraint (see matchesConstraints):
// with that constraint on and one of these games included in the game
// filter, a pokemon also has to be from that game's native generation,
// since "caught in its original region" is only possible there for
// pokemon that actually belong to that region.
const GAME_NATIVE_GENERATION = {
    swsh: 8,   // Sword & Shield — Galar
    bdsp: 4,   // Brilliant Diamond & Shining Pearl — Sinnoh
    pla: 4,    // Legends Arceus — Hisui, treated as Sinnoh's dex
    scvi: 9,   // Scarlet & Violet — Paldea
    plza: 6,   // Legends Z-A — Kalos
    wiwa: 10   // Winds & Waves
};

// Site-wide admin identity (see ../admin-auth-core.js) — dynamic import
// since this file is a plain <script>, not a module. Replaces the old
// "paste a secret into localStorage via devtools" (exportAuthKey) approach
// with just being signed in as the owner's Google account (bottom-right
// widget from admin-auth.js), which works the same on any device.
const adminAuthReady = import('../../admin-auth-core.js');

const dexTypes = [
    { key: "masterDex", label: "MasterDex" },
    { key: "shinyDex", label: "Shiny Dex" },
    { key: "tradeDex", label: "Trade Dex" },
    { key: "wonderTradeDex", label: "Wonder Trade Dex" },
    { key: "pogoDex", label: "PoGo Dex" },
    { key: "cherishDex", label: "Cherish Dex" }
];

// Trade Dex, Wonder Trade Dex, PoGo Dex, and Shiny Dex each get their own
// to-do list — no other dex has a matching persisted field, so this returns
// null for the rest.
function todoFieldFor(dexKey) {
    if (dexKey === "tradeDex") return "tradeDexTodo";
    if (dexKey === "wonderTradeDex") return "wonderTradeDexTodo";
    if (dexKey === "pogoDex") return "pogoDexTodo";
    if (dexKey === "shinyDex") return "shinyDexTodo";
    return null;
}


function saveData() {
    const serialized = JSON.stringify(savedDexData);
    localStorage.setItem("dexData", serialized);
    if (typeof markDirty === "function") markDirty(serialized, "dexData");
    updateProgress();
    updateCardHighlights();
    updateExportGlow();
}

// Shiny hunts are a separate archive, not part of savedDexData — its own
// localStorage key/tracker, but the same Export button commits both (see
// the export-pokedex handler) so one Export always covers everything.
function saveHunts() {
    const serialized = JSON.stringify(shinyHunts);
    localStorage.setItem("shinyHunts", serialized);
    if (typeof markDirty === "function") markDirty(serialized, "shinyHunts");
    updateExportGlow();
}

// Lights up Export Pokémon, and reveals the Changes button next to it,
// whenever there's something not yet exported — both cleared the moment
// markSaved() runs (GitHub commit or manual download, see the
// export-pokedex handler below). Changes has nothing useful to show once
// everything's exported, so it disappears rather than opening onto an
// empty "No unsaved changes" modal.
function updateExportGlow() {
    const btn = document.getElementById("export-pokedex");
    const changesBtn = document.getElementById("pokedex-changes-btn");

    const dirty = typeof isTrackerDirty === "function"
        ? (isTrackerDirty("dexData") || isTrackerDirty("shinyHunts"))
        : false;

    if (btn) btn.classList.toggle("has-unsaved-changes", dirty);
    if (changesBtn) changesBtn.classList.toggle("hidden", !dirty);
}

// #search-evolutions-row and #import-export-controls sit fixed directly
// under #search-wrapper (and each other), stacked in that order, and are
// meant to span exactly as wide as #search-wrapper — but #search-wrapper has
// no fixed width of its own (it shrinks to fit the search input/clear icon),
// so there's no CSS value to just copy, and #search-evolutions-row's own
// rendered height is what determines how far down #import-export-controls
// needs to sit. Measuring and copying it here keeps all three in sync even
// if the search row's content ever changes. The two lower rows start hidden
// (.width-sync-pending, in style.css) precisely so this can run whenever it
// runs — even late, at the bottom of the page load — without ever being
// visible in their pre-sync (full viewport width / wrong top) state.
function syncSearchControlsLayout() {
    const searchWrapper = document.getElementById("search-wrapper");
    const evolutionsRow = document.getElementById("search-evolutions-row");
    const importExport = document.getElementById("import-export-controls");
    if (!searchWrapper || !importExport) return;

    const width = searchWrapper.offsetWidth;
    const gap = 10;
    let nextTop = searchWrapper.getBoundingClientRect().bottom + gap;

    if (evolutionsRow) {
        evolutionsRow.style.width = `${width}px`;
        evolutionsRow.style.top = `${nextTop}px`;
        evolutionsRow.classList.remove("width-sync-pending");

        nextTop = evolutionsRow.getBoundingClientRect().bottom + gap;
    }

    importExport.style.width = `${width}px`;
    importExport.style.top = `${nextTop}px`;
    importExport.classList.remove("width-sync-pending");
}

syncSearchControlsLayout();

let syncSearchControlsLayoutResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(syncSearchControlsLayoutResizeTimer);
    syncSearchControlsLayoutResizeTimer = setTimeout(syncSearchControlsLayout, 150);
});

Promise.all([
    fetch("../fullPokemonList.json").then(res => res.json()),
    fetch("../pokedex-backup.json").then(res => res.json()),
    fetch("../shiny-hunts-backup.json").then(res => res.json()),
    fetch("../evolutionFamilies.json").then(res => res.json())
])
.then(([pokemonList, dexList, huntsList, evolutionFamiliesData]) => {

    allPokemon = pokemonList;
    evolutionFamilies = evolutionFamiliesData;

    // convert exported array into your existing format
    const sourceDexData = {};

    dexList.forEach(entry => {

        const key = normalizeName(entry.name);

        sourceDexData[key] = {
            masterDex: !!entry.masterDex,
            tradeDex: !!entry.tradeDex,
            wonderTradeDex: !!entry.wonderTradeDex,
            pogoDex: !!entry.pogoDex,
            pogoShiny: !!entry.pogoShiny,
            cherishDex: !!entry.cherishDex,

            tradeDexTodo: !!entry.tradeDexTodo,
            wonderTradeDexTodo: !!entry.wonderTradeDexTodo,
            pogoDexTodo: !!entry.pogoDexTodo,

            shinyDex: !!entry.shinyDex,
            shinyDexTodo: !!entry.shinyDexTodo,

            shinyDexData: {
                correctStage: !!entry.shinyDexData?.correctStage,
                originalRegion: !!entry.shinyDexData?.originalRegion,
                luxuryBall: !!entry.shinyDexData?.luxuryBall,
                alpha: !!entry.shinyDexData?.alpha,
                notInDex: !!entry.shinyDexData?.notInDex
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
                if (!(key in savedDexData)) {
                    savedDexData[key] = sourceDexData[key];
                    return;
                }

                // pogoShiny/tradeDexTodo/wonderTradeDexTodo/pogoDexTodo/
                // shinyDexTodo were added after this pokemon's local record
                // was first saved — default them in place so the
                // unsaved-changes snapshot already includes them, instead of
                // the first toggle silently adding the key and still reading
                // as "unsaved" even after toggling it back off.
                if (!("pogoShiny" in savedDexData[key])) savedDexData[key].pogoShiny = false;
                if (!("tradeDexTodo" in savedDexData[key])) savedDexData[key].tradeDexTodo = false;
                if (!("wonderTradeDexTodo" in savedDexData[key])) savedDexData[key].wonderTradeDexTodo = false;
                if (!("pogoDexTodo" in savedDexData[key])) savedDexData[key].pogoDexTodo = false;
                if (!("shinyDexTodo" in savedDexData[key])) savedDexData[key].shinyDexTodo = false;

                // Same reasoning, one level down — shinyDexData.notInDex and
                // shinyDexData.alpha were added after some local records'
                // shinyDexData sub-object already existed.
                if (savedDexData[key].shinyDexData && !("notInDex" in savedDexData[key].shinyDexData)) {
                    savedDexData[key].shinyDexData.notInDex = false;
                }
                if (savedDexData[key].shinyDexData && !("alpha" in savedDexData[key].shinyDexData)) {
                    savedDexData[key].shinyDexData.alpha = false;
                }
            });
        } catch {
            savedDexData = sourceDexData;
        }
    } else {
        savedDexData = sourceDexData;
    }

    // Shiny hunts archive — an independent flat list, not keyed per-pokemon
    // like savedDexData, so no field-by-field reconciliation is needed: local
    // wins outright if present (it's always the full list), otherwise fall
    // back to whatever's in the backup.
    const localHuntsRaw = localStorage.getItem("shinyHunts");

    if (localHuntsRaw) {
        try {
            shinyHunts = JSON.parse(localHuntsRaw);
        } catch {
            shinyHunts = huntsList;
        }
    } else {
        shinyHunts = huntsList;
    }

    if (typeof initUnsavedChangesSnapshot === "function") {
        initUnsavedChangesSnapshot(JSON.stringify(savedDexData), "dexData");
        initUnsavedChangesSnapshot(JSON.stringify(shinyHunts), "shinyHunts");
    }

    createPokemonCards(allPokemon);
    createProgressUI();
    createFilterButtons();
    equalizePokemonNameSizes();

    updateProgress();
    updateCardHighlights();
    updateMissingButtonHighlight();
    updateTypeFilterHighlight();
    updatePogoShinyModeButtonUI();
    updatePogoFilterRowVisibility();
    updateConstraintFilterRowVisibility();
    updatePogoShinyFilterHighlight();
    updateTodoButtonUI();
    updateHuntsButtonUI();
    updateExportGlow();

    updateModeUI();
});

// Some names (mostly Hisuian/Galarian/Alolan compounds — "Hisuian Sneasel"
// vs "Hisuian Voltorb") are just long enough to wrap onto a second line at
// the card's normal font-size while most names fit on one, making that
// card's row taller than its neighbours (grid rows auto-size to their
// tallest item) and throwing off the otherwise-even card grid. Every name
// that doesn't fit at the base size gets shrunk just enough to fit on one
// line — each one individually as large as it can be, rather than every
// long name sharing one size sized to the single worst case.
//
// The right size for a given name is found by shrinking in small steps and
// re-measuring it FOR REAL at each candidate size, rather than measuring
// once at the base size and computing one ratio to extrapolate from: font
// rendering/hinting doesn't always scale perfectly linearly, so a
// computed-not-verified size can still land back on the wrap boundary.
//
// "Fits" also requires a few px of headroom rather than fitting exactly:
// the probe measuring this (an isolated, off-grid element — see below) and
// the live card can round fractional pixel widths slightly differently, and
// with zero margin that was enough for one particular name ("Hisuian
// Avalugg") to read as "fits" here while still visibly wrapping in the grid.
//
// Measuring by forcing white-space: nowrap on the live grid cells themselves
// doesn't work: #box-container's columns are 1fr with the default implicit
// min-width: auto, so each column sizes to the widest cell IT contains
// across every row. Forcing every name nowrap at once inflates a whole
// column to fit the longest name anywhere in it, which then inflates
// scrollWidth for every other (often much shorter) name sharing that
// column — that's what was shrinking short names like Virizion, measuring
// them against a neighbour's width instead of their own. Measuring against
// an isolated probe element that lives outside #box-container sidesteps
// this entirely: it can't influence, or be influenced by, grid track sizing.
function equalizePokemonNameSizes() {

    const nameEls = [];
    cardMap.forEach(card => {
        const nameEl = card.querySelector(".pokemon-name");
        if (nameEl) nameEls.push(nameEl);
    });

    if (nameEls.length === 0) return;

    nameEls.forEach(el => {
        el.style.fontSize = "";
    });

    const style = getComputedStyle(nameEls[0]);
    const baseFontSize = parseFloat(style.fontSize);
    const availableWidth = nameEls[0].clientWidth;
    if (!availableWidth) return;

    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontWeight = style.fontWeight;
    probe.style.letterSpacing = style.letterSpacing;
    document.body.appendChild(probe);

    const FIT_MARGIN = 3;
    const fits = (fontSize, text) => {
        probe.style.fontSize = `${fontSize}px`;
        probe.textContent = text;
        return probe.offsetWidth <= availableWidth - FIT_MARGIN;
    };

    // Below this, text would be unreadably small — a name may still wrap
    // rather than shrink past this, but that's a better outcome than
    // illegibility.
    const minFontSize = baseFontSize * 0.7;

    cardMap.forEach((card, name) => {

        const nameEl = card.querySelector(".pokemon-name");
        if (!nameEl) return;

        if (fits(baseFontSize, name)) return;

        let fontSize = baseFontSize;
        while (fontSize > minFontSize && !fits(fontSize, name)) {
            fontSize -= 0.25;
        }
        fontSize = Math.max(fontSize, minFontSize);

        nameEl.style.fontSize = `${fontSize.toFixed(2)}px`;
    });

    probe.remove();
}

// The card grid's column count/width changes at the mobile breakpoint (and
// with any future responsive tweak), which changes how much width each name
// actually has to work with — recompute rather than let it go stale.
let equalizeNameSizesResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(equalizeNameSizesResizeTimer);
    equalizeNameSizesResizeTimer = setTimeout(equalizePokemonNameSizes, 150);
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
        ? `../sprites/pokemon_shiny_sprites/${fileName}`
        : `../sprites/pokemon_sprites/${fileName}`;
}

function shouldShowShinyCardSprites() {
    return activeDexEdit === "shinyDex";
}

// A card renders with its shiny sprite either while Shiny Dex edit mode
// forces every card shiny (shouldShowShinyCardSprites), or while viewing the
// PoGo Dex specifically, for pokemon individually marked shiny there
// (pogoShiny). That flag is PoGo-Dex-only — it must NOT make the sprite
// shiny while viewing any other dex (or no dex selected at all).
function useShinySpriteFor(key) {
    if (shouldShowShinyCardSprites()) return true;
    return activeDexEdit === "pogoDex" && !!savedDexData[key]?.pogoShiny;
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
            luxuryBall: false,
            alpha: false,
            notInDex: false
        };
    } else {
        // ensure structure exists when turning ON
        if (!data.shinyDexData) {
            data.shinyDexData = {
                correctStage: false,
                originalRegion: false,
                luxuryBall: false,
                alpha: false,
                notInDex: false
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
        const cardKey = normalizeName(name);

        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        card.innerHTML = `
            <div class="not-in-dex-badge">*</div>
            <img loading="lazy" src="${getPokemonSpritePath(name, useShinySpriteFor(cardKey))}">
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
                // TRADE/WONDER TRADE/POGO TO-DO FILTER ACTIVE → CLICK REMOVES
                // Once the To Do filter is narrowing the grid down to just
                // that dex's list, clicking an item there means "done with
                // this one" — take it off the list AND mark it caught on the
                // dex itself, instead of the normal add/remove-from-dex click.
                //
                // While Find is running, the whole page is shown unfiltered
                // (not just the queued pokemon) for context, but only cards
                // still actually on the to-do list are clickable — everything
                // else on the page is inert. A click here only marks it
                // pending — the actual update waits until Find finishes (see
                // commitTodoPending, called from resetTodoFind) so the
                // in-progress queue doesn't shift out from under you mid-cycle.
                //
                // PoGo Dex only: Shiny Mode (pogo-shiny-mode-btn) stays
                // available the whole time, including mid-Find — toggling it
                // on before clicking (selecting) a pokemon marks that pick
                // shiny at the same time it's marked caught, instead of
                // requiring a separate pass afterwards.
                // -----------------------------
                const todoField = todoFieldFor(activeDexEdit);
                if (todoField && todoFilterActive) {

                    const wantsShiny = activeDexEdit === "pogoDex" && pogoShinyModeFlag;

                    if (todoFindActive) {

                        if (!pokemonData[todoField]) return;

                        if (todoPendingDone.has(key)) {
                            todoPendingDone.delete(key);
                            if (todoPendingShiny.has(key)) {
                                todoPendingShiny.delete(key);
                                const img = card.querySelector("img");
                                if (img) img.src = getPokemonSpritePath(name, false);
                            }
                            card.classList.remove("todo-pending-done", "todo-pending-shiny");
                            return;
                        }

                        todoPendingDone.add(key);
                        card.classList.add("todo-pending-done");

                        if (wantsShiny) {
                            todoPendingShiny.add(key);
                            card.classList.add("todo-pending-shiny");
                            const img = card.querySelector("img");
                            if (img) img.src = getPokemonSpritePath(name, true);
                        }

                        // Advance to the next open item once the card's own
                        // "select me → done" transition (see .todo-pending-done
                        // in style.css) has actually played, instead of
                        // jumping the page out from under the click.
                        card.addEventListener("transitionend", () => {
                            advanceTodoFind(key);
                        }, { once: true });

                        return;
                    }

                    pokemonData[activeDexEdit] = true;
                    pokemonData[todoField] = false;
                    if (wantsShiny) pokemonData.pogoShiny = true;
                    savedDexData[key] = pokemonData;
                    saveData();

                    applyFilters();
                    if (pageMode) applyPagination();

                    return;
                }

                // -----------------------------
                // POGO DEX SHINY MODE → TOGGLE SHINY, FLIP THE SPRITE
                // Clicking a pokemon already in the PoGo Dex flips its shiny
                // flag and swaps the card's sprite to match — that's the only
                // feedback needed, no modal. Clicking one that isn't caught
                // yet does nothing (turn Shiny Mode off to get back to
                // normal add/remove).
                // -----------------------------
                if (activeDexEdit === "pogoDex" && pogoShinyModeFlag) {

                    if (!pokemonData.pogoDex) return;

                    pokemonData.pogoShiny = !pokemonData.pogoShiny;
                    savedDexData[key] = pokemonData;
                    saveData();

                    return;
                }

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
// POGO DEX SHINY MODE BUTTON (lives in #page-controls, PoGo Dex only)
// ---------------------------
function updatePogoShinyModeButtonUI() {

    const btn = document.getElementById("pogo-shiny-mode-btn");
    if (!btn) return;

    const isPogoEdit = activeDexEdit === "pogoDex";

    btn.classList.toggle("hidden", !isPogoEdit);
    btn.classList.toggle("active-mode", pogoShinyModeFlag);
}

document.getElementById("pogo-shiny-mode-btn").addEventListener("click", () => {

    if (activeDexEdit !== "pogoDex") return;

    pogoShinyModeFlag = !pogoShinyModeFlag;

    updatePogoShinyModeButtonUI();
});


// ---------------------------
// TO DO LIST (lives in #page-controls, Trade Dex / Wonder Trade Dex / PoGo Dex / Shiny Dex only)
// ---------------------------
function updateTodoButtonUI() {

    const filterBtn = document.getElementById("todo-filter-btn");
    const addBtn = document.getElementById("todo-add-btn");
    const findBtn = document.getElementById("todo-find-btn");
    if (!filterBtn || !addBtn || !findBtn) return;

    const isTodoDex = !!todoFieldFor(activeDexEdit);

    filterBtn.classList.toggle("hidden", !isTodoDex);
    filterBtn.classList.toggle("active-mode", todoFilterActive);

    // Add and Find only show up once To Do itself has been clicked — no
    // point offering either before the list is actually in view.
    addBtn.classList.toggle("hidden", !isTodoDex || !todoFilterActive);
    findBtn.classList.toggle("hidden", !isTodoDex || !todoFilterActive);
    findBtn.classList.toggle("active-mode", todoFindActive);
}

function clearTodoFindHighlight() {
    document.querySelectorAll(".pokemon-card.todo-find-highlight").forEach(card => {
        card.classList.remove("todo-find-highlight");
    });
}

function clearTodoPendingMarks() {
    document.querySelectorAll(".pokemon-card.todo-pending-done, .pokemon-card.todo-pending-shiny").forEach(card => {
        card.classList.remove("todo-pending-done", "todo-pending-shiny");
    });
}

// Applies every pokemon clicked during this Find session — marks each
// caught on the dex and off the to-do list (and, for any picked while
// Shiny Mode was on, shiny too) — in one go, then saves once.
function commitTodoPending() {

    if (todoPendingDone.size === 0) return;

    const field = todoFieldFor(activeDexEdit);

    if (field) {
        todoPendingDone.forEach(key => {
            const data = savedDexData[key] || {};
            data[activeDexEdit] = true;
            data[field] = false;
            if (todoPendingShiny.has(key)) data.pogoShiny = true;
            savedDexData[key] = data;
        });
        saveData();
    }

    todoPendingDone.clear();
    todoPendingShiny.clear();
}

// Drops out of Find navigation, committing any pending picks first. Doesn't
// touch todoFilterActive/pageMode itself — callers decide what view to land
// on afterwards.
function resetTodoFind() {
    commitTodoPending();
    todoFindActive = false;
    todoQueue = [];
    todoQueuePos = 0;
    clearTodoFindHighlight();
    clearTodoPendingMarks();
}

// Jumps to whichever page holds the pokemon currently at todoQueuePos, and
// highlights its card so it's easy to spot among the rest of that page.
// applyPagination() sets page-display to the real page number — Find is
// genuine Page Mode (see updateModeUI), so that's what should show here too,
// not queue position.
function showTodoQueuePage() {

    const pokemon = todoQueue[todoQueuePos];
    if (!pokemon) return;

    const index = allPokemon.indexOf(pokemon);
    currentPage = Math.floor(index / pageSize) + 1;

    applyPagination();
    clearTodoFindHighlight();

    const card = cardMap.get(pokemon.name);
    if (card) card.classList.add("todo-find-highlight");
}

// Called once a to-do pokemon's "done" transition finishes (see the card
// click handler). Only steps the pointer/page forward when the item just
// finished was actually the current target — clicking some other to-do
// pokemon that happens to share the page is marked done in place without
// moving anything, and gets skipped over automatically whenever the pointer
// reaches it later.
function advanceTodoFind(justCompletedKey) {

    const currentTarget = todoQueue[todoQueuePos];
    if (!currentTarget || normalizeName(currentTarget.name) !== justCompletedKey) return;

    do {
        todoQueuePos++;
    } while (
        todoQueuePos < todoQueue.length &&
        todoPendingDone.has(normalizeName(todoQueue[todoQueuePos].name))
    );

    if (todoQueuePos >= todoQueue.length) {
        exitTodoFind();
        return;
    }

    showTodoQueuePage();
}

function enterTodoFind() {

    const field = todoFieldFor(activeDexEdit);
    if (!field) return;

    const queue = allPokemon.filter(p => !!savedDexData[normalizeName(p.name)]?.[field]);

    if (queue.length === 0) {
        document.getElementById("todo-empty-modal").classList.remove("hidden");
        return;
    }

    todoQueue = queue;
    todoQueuePos = 0;
    todoFindActive = true;
    pageMode = true;

    showTodoQueuePage();
    updateModeUI();
    updateTodoButtonUI();
}

// Back to the filtered to-do list itself (list mode, todoFilterActive stays
// on) — reached either by wrapping past the last queue item, or manually.
function exitTodoFind() {

    resetTodoFind();
    pageMode = false;

    applyFilters();
    updateModeUI();
    updateTodoButtonUI();
}

// Entering Todo mode clears every other filter (not just hides them — see
// updateModeUI, which also disables the controls going forward) so the list
// it shows is always exactly that dex's to-do items, nothing narrowed
// further and nothing left silently armed for whenever you leave.
function clearNonTodoFilters() {

    gameFilterState = {};
    selectedGeneration = null;
    tagFilters = {};
    constraintFilters = {};
    constraintFilterMode = "and";
    searchInput.value = "";
    missingDexFilter = null;
    selectedCompletionFilter = null;
    completionFilterMode = "exclusive";
    selectedTypes = [];
    typeFilterMode = "any";

    document.querySelectorAll("#dex-key .dex-key-item[data-key-color]").forEach(el => {
        el.classList.remove("active");
    });

    if (dexKeyModeToggle) dexKeyModeToggle.textContent = "Exclusively";

    updateGameButtonHighlight();
    updateGenerationButtonHighlight();
    updateTagButtonHighlight();
    updateConstraintButtonHighlight();
    updateMissingButtonHighlight();
    updateTypeFilterHighlight();
}

document.getElementById("todo-filter-btn").addEventListener("click", () => {

    if (!todoFieldFor(activeDexEdit)) return;

    todoFilterActive = !todoFilterActive;

    if (todoFilterActive) {
        // To Do is its own mode — not Page Mode, not List Mode (see
        // updateModeUI) — and nothing else filters on top of it.
        pageMode = false;
        clearNonTodoFilters();

        // Shiny Dex only: Hunts is its own separate archive view (a
        // different grid entirely, not filtered by anything below) — can't
        // show alongside a to-do list of the normal per-pokemon grid.
        if (huntsModeActive) {
            huntsModeActive = false;
            updateHuntsButtonUI();
        }
    } else if (todoFindActive) {
        resetTodoFind();
        pageMode = false;
    }

    applyFilters();
    scrollResultsToTop();
    updateModeUI();
    updateTodoButtonUI();
});

document.getElementById("todo-find-btn").addEventListener("click", () => {

    if (!todoFieldFor(activeDexEdit) || !todoFilterActive) return;

    if (todoFindActive) {
        exitTodoFind();
    } else {
        enterTodoFind();
    }
});

const todoModal = document.getElementById("todo-modal");
const todoModalTitle = document.getElementById("todo-modal-title");
const todoModalInput = document.getElementById("todo-modal-input");
const todoModalSubmit = document.getElementById("todo-modal-submit");
const todoModalClose = document.getElementById("todo-modal-close");

document.getElementById("todo-add-btn").addEventListener("click", () => {

    const dex = dexTypes.find(d => d.key === activeDexEdit);
    if (!dex || !todoFieldFor(activeDexEdit)) return;

    todoModalTitle.textContent = `Add To ${dex.label} To Do List`;
    todoModalInput.value = "";
    todoModal.classList.remove("hidden");
    todoModalInput.focus();
});

todoModalSubmit.addEventListener("click", () => {

    const field = todoFieldFor(activeDexEdit);
    if (!field) return;

    const keys = todoModalInput.value
        .split(",")
        .map(n => normalizeName(n))
        .filter(n => n.length > 0);

    keys.forEach(key => {
        const data = savedDexData[key] || {};
        data[field] = true;
        savedDexData[key] = data;
    });

    saveData();
    applyFilters();
    if (pageMode) applyPagination();

    todoModal.classList.add("hidden");
});

todoModalInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    todoModalSubmit.click();
});

todoModalClose.addEventListener("click", () => {
    todoModal.classList.add("hidden");
});

todoModal.addEventListener("click", (e) => {
    if (e.target === todoModal) todoModal.classList.add("hidden");
});

// =========================
// SHINY HUNTS (Shiny Dex only)
// An archive of shiny hunts and their total encounter counts — unlike the
// To Do list above, entries here aren't drawn from allPokemon and don't get
// "completed": they're free-form records (name + encounters) added, edited,
// and deleted through their own modals, closer to milestones.js's pattern
// than to anything else on this page.
// =========================
// crypto.randomUUID() needs a secure context (HTTPS/localhost) — fine for
// the deployed site, but not guaranteed if this page is ever opened directly
// as a file:// URL, so this falls back to something still unique enough.
function generateHuntId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `hunt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function updateHuntsButtonUI() {

    const huntsBtn = document.getElementById("hunts-mode-btn");
    const addBtn = document.getElementById("hunts-add-btn");
    if (!huntsBtn || !addBtn) return;

    const isShinyDex = activeDexEdit === "shinyDex";

    huntsBtn.classList.toggle("hidden", !isShinyDex);
    huntsBtn.classList.toggle("active-mode", huntsModeActive);

    // Add only shows up once the Hunts tab itself is open — no point
    // offering it before the list is actually in view.
    addBtn.classList.toggle("hidden", !isShinyDex || !huntsModeActive);
}

// Active hunts first, finished ones after — stable within each group, so
// otherwise unrelated hunts don't get reshuffled by an edit/reorder.
function getSortedHunts() {
    return [...shinyHunts].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
}

function huntResetsLabel(hunt) {
    return hunt.completed ? `Total Resets: ${hunt.encounters}` : `Resets So Far: ${hunt.encounters}`;
}

function renderHunts() {

    const container = document.getElementById("hunts-container");
    if (!container) return;

    container.innerHTML = "";

    getSortedHunts().forEach(hunt => {
        const card = document.createElement("div");
        card.classList.add("pokemon-card", "hunt-card");
        card.classList.toggle("hunt-completed", !!hunt.completed);

        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = getPokemonSpritePath(hunt.name, true);
        img.onerror = () => { img.style.visibility = "hidden"; };
        card.appendChild(img);

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = hunt.name;
        card.appendChild(label);

        const encounters = document.createElement("div");
        encounters.classList.add("hunt-encounters");
        encounters.textContent = huntResetsLabel(hunt);
        card.appendChild(encounters);

        card.addEventListener("click", () => openHuntModal(hunt.id));

        container.appendChild(card);
    });

    applyHuntsSearch();
}

// Search stays live while browsing Hunts (see applyFilters()'s early
// branch) — narrows #hunts-container's own cards by name instead of
// cardMap's, since hunts aren't part of allPokemon/cardMap at all.
function applyHuntsSearch() {

    const query = searchInput.value.trim().toLowerCase();

    document.querySelectorAll("#hunts-container .hunt-card").forEach(card => {
        const name = card.querySelector(".pokemon-name")?.textContent.toLowerCase() || "";
        card.style.display = !query || name.includes(query) ? "block" : "none";
    });
}

document.getElementById("hunts-mode-btn").addEventListener("click", () => {

    if (activeDexEdit !== "shinyDex") return;

    huntsModeActive = !huntsModeActive;

    if (huntsModeActive) {
        // Same reasoning as the todo-filter-btn handler's mirror of this —
        // the two views can't coexist, so opening one closes the other.
        if (todoFilterActive) {
            todoFilterActive = false;
            if (todoFindActive) {
                resetTodoFind();
                pageMode = false;
            }
            updateTodoButtonUI();
        }

        renderHunts();
        // Stale count from whatever filters were active before switching
        // over — meaningless once #box-container itself is hidden.
        if (pokemonCountLabel) pokemonCountLabel.style.display = "none";
    } else {
        applyFilters();
    }

    updateHuntsButtonUI();
    updateModeUI();
});

// -------------------------
// VIEW MODAL
// -------------------------
const huntModalOverlay = document.getElementById("hunt-modal-overlay");
const huntModalImage = document.getElementById("hunt-modal-image");
const huntModalName = document.getElementById("hunt-modal-name");
const huntModalEncounters = document.getElementById("hunt-modal-encounters");
const huntNavLeft = document.getElementById("hunt-modal-nav-left");
const huntNavRight = document.getElementById("hunt-modal-nav-right");

function openHuntModal(id) {
    const hunt = shinyHunts.find(h => h.id === id);
    if (!hunt) return;

    huntModalImage.src = getPokemonSpritePath(hunt.name, true);
    huntModalName.textContent = hunt.name;
    huntModalEncounters.textContent = huntResetsLabel(hunt);

    huntModalOverlay.classList.remove("hidden");
    huntModalOverlay.dataset.id = id;
}

function closeHuntModal() {
    huntModalOverlay.classList.add("hidden");
}

document.getElementById("hunt-modal-close").addEventListener("click", closeHuntModal);

huntModalOverlay.addEventListener("click", (e) => {
    if (e.target === huntModalOverlay) closeHuntModal();
});

function openAdjacentHunt(offset) {
    // Same order as renderHunts() (active first, then finished) so prev/next
    // steps through the cards in the order they're actually shown on screen.
    const ordered = getSortedHunts();
    const count = ordered.length;
    if (count === 0) return;

    let index = ordered.findIndex(h => h.id === huntModalOverlay.dataset.id);
    if (index === -1) index = 0;

    let next = index + offset;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;

    openHuntModal(ordered[next].id);
}

huntNavLeft.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacentHunt(-1);
});

huntNavRight.addEventListener("click", (e) => {
    e.stopPropagation();
    openAdjacentHunt(1);
});

document.addEventListener("keydown", (e) => {
    if (huntModalOverlay.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") openAdjacentHunt(-1);
    if (e.key === "ArrowRight") openAdjacentHunt(1);
    if (e.key === "Escape") closeHuntModal();
});

// -------------------------
// ADD / EDIT
// -------------------------
const addHuntModal = document.getElementById("add-hunt-modal");
const huntNameInput = document.getElementById("hunt-name-input");
const huntCompletedInput = document.getElementById("hunt-completed-input");
const huntEncountersInput = document.getElementById("hunt-encounters-input");
const huntResetsLabelText = document.getElementById("hunt-resets-label-text");
const huntModalTitleText = document.getElementById("hunt-modal-title-text");
const huntErrorBox = document.getElementById("hunt-item-error");

function updateHuntResetsLabelText() {
    huntResetsLabelText.textContent = huntCompletedInput.checked ? "Total Resets" : "Resets So Far";
}

huntCompletedInput.addEventListener("change", updateHuntResetsLabelText);

document.getElementById("hunts-add-btn").addEventListener("click", () => {

    addHuntModal.classList.remove("hidden");
    huntModalTitleText.textContent = "Add Hunt";
    delete addHuntModal.dataset.editId;

    huntNameInput.value = "";
    huntCompletedInput.checked = false;
    huntEncountersInput.value = "";
    updateHuntResetsLabelText();
    huntErrorBox.classList.add("hidden");
    huntNameInput.focus();
});

document.getElementById("save-hunt").addEventListener("click", () => {

    const name = huntNameInput.value.trim();
    const completed = huntCompletedInput.checked;
    const resetsRaw = huntEncountersInput.value.trim();

    if (!name) {
        huntErrorBox.textContent = "Please enter a Pokémon name.";
        huntErrorBox.classList.remove("hidden");
        return;
    }

    // Free text, not just a number — "?", "Unknown", "500+", whatever's
    // actually known about the hunt, stored and displayed exactly as typed.
    if (!resetsRaw) {
        huntErrorBox.textContent = "Please enter a reset count.";
        huntErrorBox.classList.remove("hidden");
        return;
    }
    const encounters = resetsRaw;

    huntErrorBox.classList.add("hidden");

    const editId = addHuntModal.dataset.editId;

    if (editId) {
        const hunt = shinyHunts.find(h => h.id === editId);
        if (hunt) {
            hunt.name = name;
            hunt.completed = completed;
            hunt.encounters = encounters;
        }
    } else {
        shinyHunts.push({ id: generateHuntId(), name, completed, encounters });
    }

    delete addHuntModal.dataset.editId;

    saveHunts();
    renderHunts();
    addHuntModal.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
    if (addHuntModal.classList.contains("hidden")) return;
    if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("save-hunt").click();
    }
});

document.getElementById("cancel-hunt").addEventListener("click", () => {
    addHuntModal.classList.add("hidden");
    huntErrorBox.classList.add("hidden");
});

document.getElementById("edit-hunt").addEventListener("click", () => {

    const id = huntModalOverlay.dataset.id;
    const hunt = shinyHunts.find(h => h.id === id);
    if (!hunt) return;

    huntNameInput.value = hunt.name;
    huntCompletedInput.checked = !!hunt.completed;
    huntEncountersInput.value = hunt.encounters;
    updateHuntResetsLabelText();
    huntErrorBox.classList.add("hidden");

    addHuntModal.dataset.editId = id;
    huntModalTitleText.textContent = "Edit Hunt";

    addHuntModal.classList.remove("hidden");
    closeHuntModal();
});

document.getElementById("delete-hunt").addEventListener("click", () => {

    const id = huntModalOverlay.dataset.id;
    if (!id) return;

    shinyHunts = shinyHunts.filter(h => h.id !== id);
    saveHunts();
    renderHunts();
    closeHuntModal();
});

const todoEmptyModal = document.getElementById("todo-empty-modal");

document.getElementById("todo-empty-modal-close").addEventListener("click", () => {
    todoEmptyModal.classList.add("hidden");
});

document.getElementById("todo-empty-modal-ok").addEventListener("click", () => {
    todoEmptyModal.classList.add("hidden");
});

todoEmptyModal.addEventListener("click", (e) => {
    if (e.target === todoEmptyModal) todoEmptyModal.classList.add("hidden");
});


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

    // Hunts is its own archive, not a filtered view of allPokemon — search
    // still works there (unlike every other filter, which just greys out),
    // but it narrows #hunts-container's own cards instead.
    if (huntsModeActive) {
        applyHuntsSearch();
        return;
    }

    const query = searchInput.value.toLowerCase();

    // A comma separates independent search terms rather than being part of
    // one literal term — "pikachu, charmander" matches either name, not the
    // (nonexistent) pokemon literally named "pikachu, charmander".
    const searchTerms = query
        ? query.split(",").map(term => term.trim()).filter(term => term.length > 0)
        : [];

    // With "Include evolutions" ticked, a query that name-matches a pokemon
    // also pulls in every other stage in its evolution line (e.g. "pikac"
    // matches Pikachu directly, then this set adds Raichu and Pichu too) —
    // computed once per applyFilters() call rather than per-card, since it
    // needs the full set of direct name matches before it can expand them.
    // With multiple comma-separated terms, each term expands its own family
    // independently (e.g. "pikachu, charmander" also pulls in Raichu/Pichu
    // *and* Charmeleon/Charizard).
    const evolutionExpandedNames = (() => {
        if (searchTerms.length === 0 || !searchEvolutionsToggle.checked) return null;

        const expanded = new Set();
        allPokemon.forEach(p => {
            if (searchTerms.some(term => imageName(p.name).includes(term))) {
                (evolutionFamilies[p.name] || []).forEach(familyName => expanded.add(familyName));
            }
        });
        return expanded;
    })();

    // Original Region constraint (see matchesConstraints below) narrows by
    // generation once a game with a known native region is included in the
    // game filter — e.g. selecting Legends Z-A restricts Original Region to
    // Gen 6, since that's the only generation that could actually be "caught
    // in its original region" while playing a Kalos-set game.
    const originalRegionGenerations = new Set(
        Object.entries(gameFilterState)
            .filter(([, mode]) => mode === "include")
            .map(([game]) => GAME_NATIVE_GENERATION[game])
            .filter(gen => gen !== undefined)
    );

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

            // "*" is a shortcut, not a literal search term — shows every
            // pokemon flagged "Not in dex" from the shiny variant modal,
            // instead of trying to name/type-match the character itself
            // (which would otherwise just match nothing). Only meaningful
            // while viewing the Shiny Dex itself.
            if (query === "*") {
                return activeDexEdit === "shinyDex" && !!(savedDexData[key]?.shinyDexData?.notInDex);
            }

            const nameMatch = searchTerms.some(term => imageName(name).includes(term));
            const typeMatch = searchTerms.some(term => types.some(t => t.includes(term)));
            const evolutionMatch = evolutionExpandedNames?.has(name) ?? false;

            return nameMatch || typeMatch || evolutionMatch;
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

        // Shiny constraint Has/Missing pairs (Correct Stage, Original
        // Region, Luxury Ball, Alpha) — see constraintFilters and the
        // "SHINY CONSTRAINTS" section of createFilterButtons().
        const matchesConstraints = (() => {

            const activeKeys = Object.keys(constraintFilters);
            if (activeKeys.length === 0) return true;

            const s = savedDexData[key]?.shinyDexData || {};

            // Both Original Region and Not Original Region only make sense
            // for pokemon that are actually obtainable in the selected game
            // in the first place (e.g. hunting in Legends Z-A, a Kanto
            // pokemon can't be "not caught in its original region" there —
            // it can't be caught there at all), so the generation gate
            // applies to both, not just the positive case.
            const matchesOriginalRegionGeneration = originalRegionGenerations.size === 0 || originalRegionGenerations.has(generation);

            const matchesKey = (filterKey) => {
                if (filterKey === "correctStage") return !!s.correctStage;
                if (filterKey === "notCorrectStage") return !s.correctStage;
                if (filterKey === "originalRegion") return !!s.originalRegion && matchesOriginalRegionGeneration;
                if (filterKey === "notOriginalRegion") return !s.originalRegion && matchesOriginalRegionGeneration;
                if (filterKey === "luxuryBall") return !!s.luxuryBall;
                if (filterKey === "notLuxuryBall") return !s.luxuryBall;
                if (filterKey === "alpha") return !!s.alpha;
                if (filterKey === "notAlpha") return !s.alpha;
                return true;
            };

            return constraintFilterMode === "or"
                ? activeKeys.some(matchesKey)
                : activeKeys.every(matchesKey);

        })();

        // #dex-key swatch filter — Exclusively (default): only pokemon at
        // that exact completion tier. All: that tier and every tier above it
        // (e.g. clicking "All 5 dexes" also shows the gold/green tiers,
        // since they're strictly more complete than blue). See
        // COMPLETION_TIER_RANK and #dex-key-mode-toggle.
        const matchesCompletion = (() => {

            if (selectedCompletionFilter === null) return true;

            const color = getCompletionColor(name);

            if (completionFilterMode === "all") {
                if (color === null) return false;
                return COMPLETION_TIER_RANK[color] >= COMPLETION_TIER_RANK[selectedCompletionFilter];
            }

            return color === selectedCompletionFilter;
        })();

        // PoGo Dex only — replaces the S&S game filter there (see
        // updatePogoFilterRowVisibility). A no-op outside PoGo Dex edit mode.
        const matchesPogoShiny = (() => {

            if (activeDexEdit !== "pogoDex") return true;
            if (pogoShinyFilter === null) return true;

            const isShiny = !!(savedDexData[key] || {}).pogoShiny;

            return pogoShinyFilter === true ? isShiny : !isShiny;
        })();

        // Trade Dex / Wonder Trade Dex / PoGo Dex / Shiny Dex only, and only
        // while their To Do filter is toggled on — narrows the grid to just
        // that dex's list.
        const matchesTodo = (() => {

            const field = todoFieldFor(activeDexEdit);
            if (!field || !todoFilterActive) return true;

            return !!(savedDexData[key] || {})[field];
        })();

        // Type-filter popup: "any" mode matches a pokemon with at least one
        // of the selected types; "only" mode matches only pokemon whose full
        // type set is exactly the selected types (e.g. selecting just
        // Electric shows pure Electric-types only, not Electric/Steel etc.).
        const matchesType = (() => {

            if (selectedTypes.length === 0) return true;

            if (typeFilterMode === "only") {
                if (types.length !== selectedTypes.length) return false;
                return selectedTypes.every(t => types.includes(t));
            }

            return selectedTypes.some(t => types.includes(t));
        })();

        if (matchesSearch && matchesGame && matchesGeneration && matchesTags && matchesMissing && matchesCompletion && matchesPogoShiny && matchesTodo && matchesType && matchesConstraints) {
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
            luxuryBall: false,
            alpha: false
        };
    }

    // update ONLY data
    pokemonData.shinyDexData[type] = !pokemonData.shinyDexData[type];

    savedDexData[currentPokemon] = pokemonData;

    saveData();

    renderModalState(currentPokemon);
});

// A real checkbox (not one of the .variant icon-dots above, and not gated
// behind that delegated click handler) — lives in shinyDexData alongside the
// other variants so it rides along with the same export/import/changes-diff
// plumbing, but it's just a note ("I don't actually have this banked
// anymore"), not a completion trait, so getCompletionColor() deliberately
// ignores it. Drives the small "*" badge on the card (see
// updateCardHighlights) and the "*" search shortcut (see applyFilters).
document.getElementById("not-in-dex-checkbox").addEventListener("change", (e) => {

    if (!currentPokemon) return;

    const pokemonData = savedDexData[currentPokemon] || {};

    if (!pokemonData.shinyDex) {
        e.target.checked = false;
        return;
    }

    if (!pokemonData.shinyDexData) {
        pokemonData.shinyDexData = {
            correctStage: false,
            originalRegion: false,
            luxuryBall: false,
            alpha: false,
            notInDex: false
        };
    }

    pokemonData.shinyDexData.notInDex = e.target.checked;

    savedDexData[currentPokemon] = pokemonData;

    saveData();
});


// ---------------------------
// SEARCH
// ---------------------------
const searchInput = document.getElementById("search");

searchInput.addEventListener("input", (e) => {
    applyFilters(e.target.value);
});

const searchEvolutionsToggle = document.getElementById("search-evolutions-toggle");

searchEvolutionsToggle.addEventListener("change", () => {
    applyFilters();
});

const clearBtn = document.getElementById("clear-search");
let missingFilterBtn = null;
let notMissingFilterBtn = null;
let pogoShinyFilterYesBtn = null;
let pogoShinyFilterNoBtn = null;

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

function updatePogoShinyFilterHighlight() {
    if (!pogoShinyFilterYesBtn || !pogoShinyFilterNoBtn) return;

    pogoShinyFilterYesBtn.classList.toggle("game-filter-active", pogoShinyFilter === true);
    pogoShinyFilterNoBtn.classList.toggle("game-filter-active", pogoShinyFilter === false);
}

// Swaps the Shiny/Not Shiny row in for Sword & Shield's while PoGo Dex is
// being edited, and back when it isn't — see createFilterButtons() for why
// they share a DOM slot instead of each having their own.
function updatePogoFilterRowVisibility() {
    const swshRow = document.getElementById("swsh-filter-row");
    const pogoShinyRow = document.getElementById("pogo-shiny-filter-row");
    if (!swshRow || !pogoShinyRow) return;

    const isPogoEdit = activeDexEdit === "pogoDex";
    swshRow.classList.toggle("hidden", isPogoEdit);
    pogoShinyRow.classList.toggle("hidden", !isPogoEdit);
}

// The Constraints dropdown (Correct Stage/Original Region/Luxury Ball/Alpha)
// only means anything against Shiny Dex data — hidden for every other dex.
function updateConstraintFilterRowVisibility() {
    const wrapper = document.getElementById("constraint-filter-wrapper");
    if (!wrapper) return;

    wrapper.classList.toggle("hidden", activeDexEdit !== "shinyDex");
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

    // Shiny Mode only makes sense while PoGo Dex itself is being edited —
    // leaving it (switching to another dex, or turning edit mode off
    // entirely) resets the flag so re-entering PoGo Dex edit always starts
    // in normal add/remove mode.
    if (activeDexEdit !== "pogoDex") {
        pogoShinyModeFlag = false;

        if (pogoShinyFilter !== null) {
            pogoShinyFilter = null;
        }
    } else {
        // The Shiny/Not Shiny filter row replaces Sword & Shield's while
        // editing PoGo Dex — clear any leftover S&S filter so it doesn't
        // keep silently narrowing results once its row is no longer shown.
        delete gameFilterState.swsh;
    }
    updatePogoShinyModeButtonUI();
    updatePogoFilterRowVisibility();
    updatePogoShinyFilterHighlight();

    // The To Do list is per-dex (Trade Dex vs Wonder Trade Dex) — leaving
    // either one, same as Shiny Mode above, resets the filter (and any
    // in-progress Find) so re-entering starts unfiltered rather than
    // silently carrying over.
    if (!todoFieldFor(activeDexEdit)) {
        todoFilterActive = false;
        if (todoFindActive) {
            resetTodoFind();
            pageMode = false;
        }
    }
    updateTodoButtonUI();

    // Hunts only makes sense while Shiny Dex itself is being edited —
    // leaving it, same as To Do above, drops back to the normal grid so
    // re-entering Shiny Dex always starts there rather than silently
    // carrying the archive view over.
    if (activeDexEdit !== "shinyDex") {
        huntsModeActive = false;
    }
    updateHuntsButtonUI();

    // Constraints (Correct Stage/Original Region/Luxury Ball/Alpha) only
    // apply to Shiny Dex data — leaving it clears any active constraint
    // filter/mode so they don't stay silently armed (and hidden) once their
    // row is gone from other dexes' filter sidebar.
    if (activeDexEdit !== "shinyDex") {
        constraintFilters = {};
        constraintFilterMode = "and";
    }
    updateConstraintFilterRowVisibility();
    updateConstraintButtonHighlight();

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

// null | "blue" (all 5 dexes) | "gold" (all 5 dexes + Correct Stage/Original
// Region/Luxury Ball) | "green" (all 5 dexes + all 4 shiny constraints,
// including Alpha) — shared by updateCardHighlights() (drives the card
// border colour) and applyFilters()'s completion filter (driven by clicking
// a #dex-key swatch), so the two can never drift out of sync with each other.
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
    const alpha = !!data.shinyDexData?.alpha;

    const mainComplete = master && trade && wonder && pogo && shinyEnabled;
    const midComplete = mainComplete && correctStage && originalRegion && luxuryBall;
    const fullComplete = midComplete && alpha;

    if (fullComplete) return "green";
    if (midComplete) return "gold";
    if (mainComplete) return "blue";
    return null;
}

function updateCardHighlights() {

    cardMap.forEach((card, name) => {

        const key = normalizeName(name);
        const data = savedDexData[key] || {};

        // -----------------------------
        // SPRITE (shiny only while viewing the PoGo Dex, or in Shiny Dex edit mode)
        // -----------------------------
        const img = card.querySelector("img");
        if (img) img.src = getPokemonSpritePath(name, useShinySpriteFor(key));

        // -----------------------------
        // RESET CLASSES
        // -----------------------------
        card.classList.remove("active-dex", "complete-blue", "complete-gold", "complete-green");

        // -----------------------------
        // "NOT IN DEX" BADGE — a note on a shiny already owned (see the
        // checkbox in the shiny variant modal). Only shown while viewing the
        // Shiny Dex itself, so this runs before the early return below.
        // -----------------------------
        card.classList.toggle("shiny-not-in-dex", activeDexEdit === "shinyDex" && !!data.shinyDexData?.notInDex);

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

    const notInDexToggle = document.getElementById("not-in-dex-toggle");
    const notInDexCheckbox = document.getElementById("not-in-dex-checkbox");

    if (notInDexToggle && notInDexCheckbox) {
        notInDexToggle.classList.toggle("hidden", !isShinyEdit);
        notInDexToggle.classList.toggle("disabled", !data.shinyDex);
        notInDexCheckbox.checked = !!data.shinyDexData?.notInDex;
    }
}

function createFilterButtons() {

    const container = document.getElementById("game-filter-container");

    // -----------------------------
    // TYPES (toggle + dropdown that overlays the rest of the filters below
    // it rather than pushing them down or living in a separate panel —
    // sits as the very first row so it's in the same place open or closed)
    // -----------------------------
    const TYPE_LIST = [
        "normal", "fire", "water", "electric", "grass", "ice",
        "fighting", "poison", "ground", "flying", "psychic", "bug",
        "rock", "ghost", "dragon", "dark", "steel", "fairy"
    ];

    const typeFilterWrapper = document.createElement("div");
    typeFilterWrapper.classList.add("type-filter-wrapper");

    const typeFilterToggle = document.createElement("button");
    typeFilterToggle.type = "button";
    typeFilterToggle.id = "type-filter-toggle";
    typeFilterToggle.classList.add("game-filter-btn");
    typeFilterToggle.textContent = "Types ▾";

    typeFilterToggle.addEventListener("click", () => {
        const opening = !typeFilterWrapper.classList.contains("open");
        typeFilterWrapper.classList.toggle("open", opening);
        updateTypeFilterHighlight();

        // #game-filter-container now scrolls internally (see its own
        // max-height comment in style.css), which clips anything absolutely
        // positioned inside it — position: fixed instead, placed here via
        // JS off the toggle's actual on-screen position, escapes that
        // clipping so the dropdown still overlays the rows below it.
        if (opening) {
            const rect = typeFilterToggle.getBoundingClientRect();
            typeFilterPanel.style.top = `${rect.bottom + 6}px`;
            typeFilterPanel.style.left = `${rect.left}px`;
            typeFilterPanel.style.width = `${rect.width}px`;
        }
    });

    const typeFilterPanel = document.createElement("div");
    typeFilterPanel.classList.add("type-filter-panel");

    const typeModeRow = document.createElement("div");
    typeModeRow.classList.add("type-filter-mode-row");

    [
        { mode: "any", label: "Any" },
        { mode: "only", label: "Only" }
    ].forEach(({ mode, label }) => {

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.classList.add("type-filter-mode-btn");
        btn.dataset.mode = mode;

        btn.addEventListener("click", () => {
            typeFilterMode = mode;

            // "Only" is an exact-match filter capped at two types — trim
            // down to the two most-recently-picked if more were selected
            // while in "Any" mode.
            if (typeFilterMode === "only" && selectedTypes.length > 2) {
                selectedTypes = selectedTypes.slice(-2);
            }

            applyFilters();
            scrollResultsToTop();
            updateTypeFilterHighlight();
        });

        typeModeRow.appendChild(btn);
    });

    typeFilterPanel.appendChild(typeModeRow);

    const typeGrid = document.createElement("div");
    typeGrid.classList.add("type-filter-grid");

    TYPE_LIST.forEach(type => {

        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("type-filter-btn");
        btn.dataset.type = type;
        const label = type.charAt(0).toUpperCase() + type.slice(1);
        btn.title = label;

        const icon = document.createElement("img");
        icon.src = `../icons/types/${type}.png`;
        icon.alt = label;
        icon.loading = "lazy";
        btn.appendChild(icon);

        btn.addEventListener("click", () => {
            const index = selectedTypes.indexOf(type);

            if (index !== -1) {
                selectedTypes.splice(index, 1);
            } else {
                selectedTypes.push(type);

                // "Only" mode exact-matches at most two types — a third
                // click bumps out the oldest selection rather than stacking.
                if (typeFilterMode === "only" && selectedTypes.length > 2) {
                    selectedTypes.shift();
                }
            }

            applyFilters();
            scrollResultsToTop();
            updateTypeFilterHighlight();
        });

        typeGrid.appendChild(btn);
    });

    typeFilterPanel.appendChild(typeGrid);

    const typeFilterClearBtn = document.createElement("button");
    typeFilterClearBtn.type = "button";
    typeFilterClearBtn.textContent = "Clear Types";
    typeFilterClearBtn.classList.add("game-filter-btn", "type-filter-clear-btn");

    typeFilterClearBtn.addEventListener("click", () => {
        selectedTypes = [];
        applyFilters();
        scrollResultsToTop();
        updateTypeFilterHighlight();
    });

    typeFilterPanel.appendChild(typeFilterClearBtn);

    typeFilterWrapper.appendChild(typeFilterToggle);
    typeFilterWrapper.appendChild(typeFilterPanel);
    container.appendChild(typeFilterWrapper);

    // Closing on outside click needs to check the live wrapper, not just the
    // panel, since the toggle button itself sits outside the panel.
    document.addEventListener("click", (e) => {
        if (!typeFilterWrapper.classList.contains("open")) return;
        if (typeFilterWrapper.contains(e.target)) return;
        typeFilterWrapper.classList.remove("open");
        updateTypeFilterHighlight();
    });

    // -----------------------------
    // SHINY CONSTRAINTS (toggle + dropdown, same overlay pattern as Types
    // above) — Has/Missing pairs for Correct Stage, Original Region, Luxury
    // Ball, Alpha. Collapsed into a dropdown rather than 4 flat rows so it
    // doesn't push the game/tag/generation rows below out of the sidebar's
    // scroll view. See matchesConstraints in applyFilters() and
    // getCompletionColor() for the gold/green completion tiers built from
    // the same four fields.
    // -----------------------------
    const oppositeConstraint = {
        correctStage: "notCorrectStage",
        notCorrectStage: "correctStage",
        originalRegion: "notOriginalRegion",
        notOriginalRegion: "originalRegion",
        luxuryBall: "notLuxuryBall",
        notLuxuryBall: "luxuryBall",
        alpha: "notAlpha",
        notAlpha: "alpha"
    };

    const constraintPairs = [
        { yesKey: "correctStage", yesLabel: "Correct Stage", noKey: "notCorrectStage", noLabel: "Not Correct Stage" },
        { yesKey: "originalRegion", yesLabel: "Original Region", noKey: "notOriginalRegion", noLabel: "Not Original Region" },
        { yesKey: "luxuryBall", yesLabel: "Luxury Ball", noKey: "notLuxuryBall", noLabel: "Not Luxury Ball" },
        { yesKey: "alpha", yesLabel: "Alpha", noKey: "notAlpha", noLabel: "Not Alpha" }
    ];

    const constraintFilterWrapper = document.createElement("div");
    constraintFilterWrapper.id = "constraint-filter-wrapper";
    constraintFilterWrapper.classList.add("type-filter-wrapper");

    const constraintFilterToggle = document.createElement("button");
    constraintFilterToggle.type = "button";
    constraintFilterToggle.id = "constraint-filter-toggle";
    constraintFilterToggle.classList.add("game-filter-btn");
    constraintFilterToggle.textContent = "Constraints ▾";

    constraintFilterToggle.addEventListener("click", () => {
        const opening = !constraintFilterWrapper.classList.contains("open");
        constraintFilterWrapper.classList.toggle("open", opening);
        updateConstraintButtonHighlight();

        if (opening) {
            const rect = constraintFilterToggle.getBoundingClientRect();
            constraintFilterPanel.style.top = `${rect.bottom + 6}px`;
            constraintFilterPanel.style.left = `${rect.left}px`;
            constraintFilterPanel.style.width = `${rect.width}px`;
        }
    });

    const constraintFilterPanel = document.createElement("div");
    constraintFilterPanel.classList.add("type-filter-panel");

    // OR/AND mode slider — OR shows any pokemon matching at least one active
    // constraint, AND (default, matches the old always-AND behavior) only
    // shows pokemon matching every active constraint. The whole track is one
    // click target that flips the mode; see matchesConstraints() above for
    // where the mode is actually applied.
    const constraintModeSlider = document.createElement("div");
    constraintModeSlider.classList.add("constraint-mode-slider");
    constraintModeSlider.dataset.mode = constraintFilterMode;

    const constraintModeThumb = document.createElement("div");
    constraintModeThumb.classList.add("constraint-mode-slider-thumb");
    constraintModeSlider.appendChild(constraintModeThumb);

    ["or", "and"].forEach(mode => {
        const label = document.createElement("span");
        label.classList.add("constraint-mode-slider-label");
        label.dataset.mode = mode;
        label.textContent = mode.toUpperCase();
        constraintModeSlider.appendChild(label);
    });

    constraintModeSlider.addEventListener("click", () => {
        constraintFilterMode = constraintFilterMode === "or" ? "and" : "or";
        constraintModeSlider.dataset.mode = constraintFilterMode;

        applyFilters();
        scrollResultsToTop();
    });

    constraintFilterPanel.appendChild(constraintModeSlider);

    constraintPairs.forEach(pair => {
        const row = document.createElement("div");
        row.classList.add("filter-row");

        [
            { key: pair.yesKey, label: pair.yesLabel, mode: "include" },
            { key: pair.noKey, label: pair.noLabel, mode: "exclude" }
        ].forEach(constraint => {
            const btn = document.createElement("button");
            const icon = constraint.mode === "include" ? "✔" : "✖";
            btn.textContent = `${constraint.label} ${icon}`;
            btn.classList.add("game-filter-btn", constraint.mode === "include" ? "include-btn" : "exclude-btn", "constraint-filter-btn");
            btn.dataset.constraint = constraint.key;

            btn.addEventListener("click", () => {
                const opposite = oppositeConstraint[constraint.key];

                if (constraintFilters[constraint.key]) {
                    delete constraintFilters[constraint.key];
                } else {
                    delete constraintFilters[opposite];
                    constraintFilters[constraint.key] = true;
                }

                applyFilters();
                scrollResultsToTop();
                updateConstraintButtonHighlight();
            });

            row.appendChild(btn);
        });

        constraintFilterPanel.appendChild(row);
    });

    const constraintFilterClearBtn = document.createElement("button");
    constraintFilterClearBtn.type = "button";
    constraintFilterClearBtn.textContent = "Clear Constraints";
    constraintFilterClearBtn.classList.add("game-filter-btn", "type-filter-clear-btn");

    constraintFilterClearBtn.addEventListener("click", () => {
        constraintFilters = {};
        constraintFilterMode = "and";
        applyFilters();
        scrollResultsToTop();
        updateConstraintButtonHighlight();
    });

    constraintFilterPanel.appendChild(constraintFilterClearBtn);

    constraintFilterWrapper.appendChild(constraintFilterToggle);
    constraintFilterWrapper.appendChild(constraintFilterPanel);
    container.appendChild(constraintFilterWrapper);

    document.addEventListener("click", (e) => {
        if (!constraintFilterWrapper.classList.contains("open")) return;
        if (constraintFilterWrapper.contains(e.target)) return;
        constraintFilterWrapper.classList.remove("open");
        updateConstraintButtonHighlight();
    });

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
        if (game.key === "swsh") row.id = "swsh-filter-row";

        row.appendChild(includeBtn);
        row.appendChild(excludeBtn);

        container.appendChild(row);

        // The Shiny/Not Shiny filter sits directly after Sword & Shield's
        // row in the DOM and swaps visibility with it while PoGo Dex is
        // being edited (see updatePogoFilterRowVisibility) — S&S is
        // meaningless there, and PoGo doesn't have per-game filters of its
        // own, so this reuses that slot instead of adding a new one.
        if (game.key === "swsh") {

            const pogoShinyRow = document.createElement("div");
            pogoShinyRow.id = "pogo-shiny-filter-row";
            pogoShinyRow.classList.add("filter-row", "hidden");

            pogoShinyFilterYesBtn = document.createElement("button");
            pogoShinyFilterYesBtn.textContent = "Shiny ✔";
            pogoShinyFilterYesBtn.classList.add("game-filter-btn", "include-btn");

            pogoShinyFilterYesBtn.addEventListener("click", () => {
                pogoShinyFilter = pogoShinyFilter === true ? null : true;
                applyFilters();
                scrollResultsToTop();
                updatePogoShinyFilterHighlight();
                if (pageMode) applyPagination();
            });

            pogoShinyFilterNoBtn = document.createElement("button");
            pogoShinyFilterNoBtn.textContent = "Not Shiny ✖";
            pogoShinyFilterNoBtn.classList.add("game-filter-btn", "exclude-btn");

            pogoShinyFilterNoBtn.addEventListener("click", () => {
                pogoShinyFilter = pogoShinyFilter === false ? null : false;
                applyFilters();
                scrollResultsToTop();
                updatePogoShinyFilterHighlight();
                if (pageMode) applyPagination();
            });

            pogoShinyRow.appendChild(pogoShinyFilterYesBtn);
            pogoShinyRow.appendChild(pogoShinyFilterNoBtn);

            container.appendChild(pogoShinyRow);
        }
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
        constraintFilters = {};
        constraintFilterMode = "and";
        searchInput.value = "";
        missingDexFilter = null;
        selectedCompletionFilter = null;
        completionFilterMode = "exclusive";
        selectedTypes = [];
        typeFilterMode = "any";

        if (dexKeyModeToggle) dexKeyModeToggle.textContent = "Exclusively";

        activeDexEdit = null;
        shinyEditModeFlag = false;
        pogoShinyModeFlag = false;
        pogoShinyFilter = null;
        todoFilterActive = false;
        resetTodoFind();
        huntsModeActive = false;

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
        updateConstraintButtonHighlight();
        updateMissingButtonHighlight();
        updateTypeFilterHighlight();
        updateCardHighlights();
        updateProgress();
        updateModeUI();
        updatePogoShinyModeButtonUI();
        updatePogoFilterRowVisibility();
        updateConstraintFilterRowVisibility();
        updatePogoShinyFilterHighlight();
        updateTodoButtonUI();
        updateHuntsButtonUI();
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

    // Page Mode always shows a plain unfiltered slice (see applyPagination),
    // so any count carried over from before entering it (e.g. from a to-do
    // list that was showing right before Page Mode/List Mode was clicked)
    // would be stale and never get recomputed, since Page Mode's pagination
    // doesn't run the filter criteria this count is based on.
    if (pageMode) {
        pokemonCountLabel.style.display = "none";
        return;
    }

    const hasActiveFilters = (
        Object.keys(gameFilterState).length > 0 ||
        selectedGeneration !== null ||
        Object.keys(tagFilters).length > 0 ||
        Object.keys(constraintFilters).length > 0 ||
        missingDexFilter !== null ||
        selectedCompletionFilter !== null ||
        searchInput.value.trim() !== "" ||
        todoFilterActive ||
        selectedTypes.length > 0
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

function updateConstraintButtonHighlight() {

    const modeSlider = document.querySelector(".constraint-mode-slider");
    if (modeSlider) modeSlider.dataset.mode = constraintFilterMode;

    document.querySelectorAll(".constraint-filter-btn").forEach(btn => {
        const constraint = btn.dataset.constraint;
        const isActive = !!constraintFilters[constraint];

        btn.classList.toggle("game-filter-active", isActive);
    });

    const count = Object.keys(constraintFilters).length;

    const toggle = document.getElementById("constraint-filter-toggle");
    if (!toggle) return;

    const isOpen = toggle.closest(".type-filter-wrapper")?.classList.contains("open");
    const arrow = isOpen ? "◂" : "▾";

    toggle.classList.toggle("game-filter-active", count > 0);
    toggle.textContent = count > 0 ? `Constraints (${count}) ${arrow}` : `Constraints ${arrow}`;
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

function updateTypeFilterHighlight() {

    document.querySelectorAll(".type-filter-mode-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === typeFilterMode);
    });

    document.querySelectorAll(".type-filter-btn").forEach(btn => {
        btn.classList.toggle("active", selectedTypes.includes(btn.dataset.type));
    });

    const toggle = document.getElementById("type-filter-toggle");
    if (!toggle) return;

    const isOpen = toggle.closest(".type-filter-wrapper")?.classList.contains("open");
    const arrow = isOpen ? "◂" : "▾";

    toggle.classList.toggle("game-filter-active", selectedTypes.length > 0);
    toggle.textContent = selectedTypes.length > 0
        ? `Types (${selectedTypes.length}) ${arrow}`
        : `Types ${arrow}`;
}

// Exclusively (default) vs All — see matchesCompletion in applyFilters() for
// what this actually changes about the #dex-key swatch filter below.
const dexKeyModeToggle = document.getElementById("dex-key-mode-toggle");

if (dexKeyModeToggle) {
    dexKeyModeToggle.addEventListener("click", () => {
        completionFilterMode = completionFilterMode === "all" ? "exclusive" : "all";
        dexKeyModeToggle.textContent = completionFilterMode === "all" ? "All" : "Exclusively";

        applyFilters();
        scrollResultsToTop();
        if (pageMode) applyPagination();
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

    const wasHuntsMode = huntsModeActive;
    if (wasHuntsMode) {
        huntsModeActive = false;
        updateHuntsButtonUI();
    }

    if (pageMode) {
        // Already paginated — the only way this button does anything is to
        // drop out of Find navigation back into a plain, unfiltered page.
        if (todoFindActive) {
            resetTodoFind();
            todoFilterActive = false;
            updateTodoButtonUI();
            updateModeUI();
        } else if (wasHuntsMode) {
            updateModeUI();
        }
        return;
    }

    // Page Mode always shows a plain unfiltered slice (see applyPagination),
    // so the to-do filter can't do anything useful there — leaving it on
    // would just look broken once every filter button greys out.
    if (todoFilterActive) {
        todoFilterActive = false;
        resetTodoFind();
        updateTodoButtonUI();
    }

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

    if (!pageMode && !todoFilterActive && !huntsModeActive) return;

    pageMode = false;
    todoFilterActive = false;
    resetTodoFind();
    updateTodoButtonUI();

    huntsModeActive = false;
    updateHuntsButtonUI();

    // show everything
    document.querySelectorAll(".pokemon-card").forEach(card => {
        card.style.display = "block";
    });

    updatePokemonCount();
    updateModeUI();
});

// Plain page navigation — Find no longer hijacks these (advancing through
// the to-do queue now happens by clicking the to-do pokemon itself, see
// advanceTodoFind), so these just browse pages like normal Page Mode,
// leaving Find's target and highlight wherever they are.
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

// -----------------------------
// PAGE JUMP — click the page number to type a page and jump straight to it
// -----------------------------
const pageDisplay = document.getElementById("page-display");
const pageJumpInput = document.getElementById("page-jump-input");

function getMaxPage() {
    const cards = document.querySelectorAll(".pokemon-card");
    return Math.max(1, Math.ceil(cards.length / pageSize));
}

function openPageJumpInput() {
    pageJumpInput.value = currentPage;
    pageDisplay.classList.add("hidden");
    pageJumpInput.classList.remove("hidden");
    pageJumpInput.focus();
    pageJumpInput.select();
}

function closePageJumpInput(commit) {

    if (commit) {
        const value = parseInt(pageJumpInput.value, 10);
        if (!Number.isNaN(value)) {
            currentPage = Math.min(Math.max(value, 1), getMaxPage());
            applyPagination();
        }
    }

    pageJumpInput.classList.add("hidden");
    pageDisplay.classList.remove("hidden");
}

pageDisplay.addEventListener("click", openPageJumpInput);

pageJumpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        closePageJumpInput(true);
    } else if (e.key === "Escape") {
        e.preventDefault();
        closePageJumpInput(false);
    }
});

pageJumpInput.addEventListener("blur", () => closePageJumpInput(true));

function applyPagination() {

    const cards = document.querySelectorAll(".pokemon-card");

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    cards.forEach((card, index) => {

        const visible = index >= start && index < end;
        card.style.display = visible ? "block" : "none";

        // Some browsers (Safari in particular) key loading="lazy" off of
        // scroll events rather than genuinely re-checking intersection
        // whenever a card flips from display:none to display:block —
        // landing directly on a page via Find (a jump, not a scroll) can
        // leave a card's image stuck permanently unrequested even though
        // it's now on screen. Pagination already limits what's visible to
        // pageSize cards at a time, so there's no bandwidth reason to keep
        // a just-revealed image lazy — upgrading it to eager the moment its
        // card becomes visible forces the browser to actually fetch it.
        if (visible) {
            const img = card.querySelector("img");
            if (img && img.loading === "lazy" && !img.complete) {
                img.loading = "eager";
            }
        }

    });

    document.getElementById("page-display").textContent = currentPage;
    updatePokemonCount();
}

function updateCardImages() {
    cardMap.forEach((card, name) => {
        const img = card.querySelector("img");
        if (!img) return;
        img.src = getPokemonSpritePath(name, useShinySpriteFor(normalizeName(name)));
    });
}

function updateModeUI() {

    const pageBtn = document.getElementById("page-mode");
    const listBtn = document.getElementById("list-mode");
    const pagination = document.getElementById("pagination-controls");

    // Browsing the to-do list itself (filter on, Find not running) is its
    // own mode — neither List nor Page Mode, so neither button reads as
    // active while it's showing. Find still rides on real Page Mode
    // (todoFindActive forces pageMode = true) since it's genuinely paging
    // through the full grid one page at a time, not a filtered list.
    const inTodoMode = todoFilterActive && !todoFindActive;

    // Hunts is its own mode too, same as To Do — neither Page nor List Mode
    // should read as active while it's showing (see the mutual-exclusivity
    // resets in the hunts-mode-btn/todo-filter-btn handlers: entering Hunts
    // doesn't touch pageMode, so without this a Page-Mode-then-Hunts switch
    // would leave Page Mode looking highlighted the whole time Hunts is up).
    pageBtn.classList.toggle("active-mode", pageMode === true && !huntsModeActive);
    listBtn.classList.toggle("active-mode", pageMode === false && !inTodoMode && !huntsModeActive);

    pagination.classList.toggle("hidden", pageMode === false || huntsModeActive);

    document.body.classList.toggle("page-mode", pageMode);
    document.body.classList.toggle("list-mode", !pageMode && !inTodoMode);
    document.body.classList.toggle("todo-mode", inTodoMode);
    document.body.classList.toggle("hunts-mode", huntsModeActive);

    // Hunts is an archive of custom entries, not a view onto allPokemon —
    // swap just the per-pokemon card grid out for its own grid. Filters,
    // search, and the dex progress list all stay put (filters just grey out
    // below, same as they do for pageMode/todoMode) — nothing about the rest
    // of the page's chrome disappears, and clicking a different dex's Edit
    // button still works normally to leave Hunts and start editing it.
    boxContainer.classList.toggle("hidden", huntsModeActive);
    document.getElementById("hunts-container")?.classList.toggle("hidden", !huntsModeActive);

    // Disabling is applied per row rather than on the whole container —
    // opacity on a parent bleeds through to children regardless of their own
    // opacity, so the only way to keep the generation rows visually active
    // while everything else greys out is to never put the class on their
    // shared ancestor in the first place. Generation rows are identified by
    // containing a Gen N button (the "Missing"/"Not Missing" pair shares the
    // same .generation-filter-row layout class but has no [data-gen] button).
    // Todo mode disables every row, generation included — there's no
    // dex-wide filtering left to do once it's narrowed to a to-do list. Hunts
    // mode disables every row too — none of them apply to the hunts archive.
    const filterContainer = document.getElementById("game-filter-container");
    if (filterContainer) {
        Array.from(filterContainer.children).forEach(child => {
            const isGenerationRow = !!child.querySelector("[data-gen]");
            child.classList.toggle("filters-disabled", inTodoMode || huntsModeActive || (pageMode && !isGenerationRow));
        });
    }

    // Search and the completion-swatch filter live outside
    // #game-filter-container, so they need their own disabling here.
    const searchWrapper = document.getElementById("search-wrapper");
    if (searchWrapper) searchWrapper.classList.toggle("filters-disabled", inTodoMode);

    const dexKey = document.getElementById("dex-key");
    if (dexKey) dexKey.classList.toggle("filters-disabled", inTodoMode || huntsModeActive || pageMode);

    // Include Evolutions modifies search, but unlike search itself it's
    // dead weight the moment Hunts mode's plain name-only applyHuntsSearch()
    // takes over (see the huntsModeActive branch atop applyFilters) — so it
    // greys out alongside every other filter rather than following
    // #search-wrapper's narrower inTodoMode-only rule.
    const evolutionsRow = document.getElementById("search-evolutions-row");
    if (evolutionsRow) evolutionsRow.classList.toggle("filters-disabled", inTodoMode || huntsModeActive || pageMode);

    updateCardImages();
}

// Shared by both files the Export button commits (pokedex-backup.json and
// shiny-hunts-backup.json) — tries the GitHub auto-commit first, falling
// back to a manual download only if that didn't verify+commit. Each file
// marks its own tracker saved independently, so exporting one doesn't
// silently clear the unsaved-changes glow for the other if only it failed.
async function exportJsonFile(filename, json, trackerKey, snapshotData) {

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
                body: JSON.stringify({ filename, content: json })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                if (typeof markSaved === "function") markSaved(snapshotData, trackerKey);
                updateExportGlow();
                alert(`✅ ${filename} committed to GitHub automatically.`);
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
    updateExportGlow();
}

// Guards against a double export — the button stays clickable while the
// fetch to the Cloudflare Worker is in flight, so a second click (or an
// impatient double-click before the first request resolves) would
// otherwise fire this whole handler again and commit/download everything
// twice.
let exportInProgress = false;

document.getElementById("export-pokedex").addEventListener("click", async () => {

    if (exportInProgress) return;
    exportInProgress = true;

    try {

    const exportData = Object.entries(savedDexData).map(([name, data]) => {

        return {
            name,
            masterDex: !!data.masterDex,
            tradeDex: !!data.tradeDex,
            wonderTradeDex: !!data.wonderTradeDex,
            pogoDex: !!data.pogoDex,
            pogoShiny: !!data.pogoShiny,
            cherishDex: !!data.cherishDex,

            tradeDexTodo: !!data.tradeDexTodo,
            wonderTradeDexTodo: !!data.wonderTradeDexTodo,
            pogoDexTodo: !!data.pogoDexTodo,

            shinyDex: !!data.shinyDex,
            shinyDexTodo: !!data.shinyDexTodo,
            shinyDexData: {
                correctStage: !!data.shinyDexData?.correctStage,
                originalRegion: !!data.shinyDexData?.originalRegion,
                luxuryBall: !!data.shinyDexData?.luxuryBall,
                alpha: !!data.shinyDexData?.alpha,
                notInDex: !!data.shinyDexData?.notInDex
            }
        };
    });

    await exportJsonFile(
        "pokedex-backup.json",
        JSON.stringify(exportData, null, 2),
        "dexData",
        // Matches saveData()'s format (JSON.stringify(savedDexData), not the
        // reshaped exportData array) — the snapshot markDirty() diffs
        // against has to be serialized the same way every time it's set.
        JSON.stringify(savedDexData)
    );

    const huntsExportData = shinyHunts.map(hunt => ({
        id: hunt.id,
        name: hunt.name,
        completed: !!hunt.completed,
        encounters: hunt.encounters
    }));

    await exportJsonFile(
        "shiny-hunts-backup.json",
        JSON.stringify(huntsExportData, null, 2),
        "shinyHunts",
        JSON.stringify(shinyHunts)
    );

    } finally {
        exportInProgress = false;
    }
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
                    pogoShiny: !!entry.pogoShiny,
                    cherishDex: !!entry.cherishDex,

                    tradeDexTodo: !!entry.tradeDexTodo,
                    wonderTradeDexTodo: !!entry.wonderTradeDexTodo,
                    pogoDexTodo: !!entry.pogoDexTodo,

                    shinyDex: !!entry.shinyDex,
                    shinyDexTodo: !!entry.shinyDexTodo,

                    shinyDexData: {
                        correctStage: !!entry.shinyDexData?.correctStage,
                        originalRegion: !!entry.shinyDexData?.originalRegion,
                        luxuryBall: !!entry.shinyDexData?.luxuryBall,
                        alpha: !!entry.shinyDexData?.alpha,
                        notInDex: !!entry.shinyDexData?.notInDex
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
// UNSAVED CHANGES LIST
// =========================
const POKEDEX_CHANGE_FIELD_LABELS = {
    masterDex: "MasterDex",
    tradeDex: "Trade Dex",
    wonderTradeDex: "Wonder Trade Dex",
    pogoDex: "PoGo Dex",
    pogoShiny: "PoGo Shiny",
    cherishDex: "Cherish Dex",
    shinyDex: "Shiny Dex",
    tradeDexTodo: "Trade Dex To Do",
    wonderTradeDexTodo: "Wonder Trade Dex To Do",
    pogoDexTodo: "PoGo Dex To Do",
    shinyDexTodo: "Shiny Dex To Do"
};

const POKEDEX_CHANGE_VARIANT_LABELS = {
    correctStage: "Correct Stage",
    originalRegion: "Original Region",
    luxuryBall: "Luxury Ball",
    alpha: "Alpha",
    notInDex: "Not In Dex"
};

// Diffs one pokemon's before/after records into a list of "+Field"/"-Field"
// strings — either side can be missing entirely (treated as all-false).
function describePokemonChanges(before, after) {

    const parts = [];

    Object.keys(POKEDEX_CHANGE_FIELD_LABELS).forEach(field => {
        const was = !!before?.[field];
        const is = !!after?.[field];
        if (was === is) return;
        parts.push(`${is ? "+" : "-"}${POKEDEX_CHANGE_FIELD_LABELS[field]}`);
    });

    Object.keys(POKEDEX_CHANGE_VARIANT_LABELS).forEach(variant => {
        const was = !!before?.shinyDexData?.[variant];
        const is = !!after?.shinyDexData?.[variant];
        if (was === is) return;
        parts.push(`${is ? "+" : "-"}${POKEDEX_CHANGE_VARIANT_LABELS[variant]}`);
    });

    return parts;
}

// Everything that's changed since the last markSaved() (export) — diffs the
// tracker's snapshot baseline against the live in-memory savedDexData.
function getPokedexChanges() {

    const snapshotRaw = typeof getTrackerSnapshot === "function" ? getTrackerSnapshot("dexData") : null;
    const before = snapshotRaw ? JSON.parse(snapshotRaw) : {};
    const after = savedDexData;

    const nameByKey = new Map(allPokemon.map(p => [normalizeName(p.name), p.name]));
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    const changes = [];

    keys.forEach(key => {
        const parts = describePokemonChanges(before[key], after[key]);
        if (parts.length === 0) return;

        changes.push({ name: nameByKey.get(key) || key, parts });
    });

    changes.sort((a, b) => a.name.localeCompare(b.name));

    return changes;
}

// Shiny hunts are a separate tracker ("shinyHunts", see saveHunts()) — diffed
// by id (added/edited/removed) rather than by field, since a hunt is just a
// name + encounter count, not a bag of toggles.
function getHuntsChanges() {

    const snapshotRaw = typeof getTrackerSnapshot === "function" ? getTrackerSnapshot("shinyHunts") : null;
    const before = snapshotRaw ? JSON.parse(snapshotRaw) : [];
    const after = shinyHunts;

    const beforeById = new Map(before.map(h => [h.id, h]));
    const afterById = new Map(after.map(h => [h.id, h]));

    const changes = [];

    afterById.forEach((hunt, id) => {
        const prev = beforeById.get(id);

        if (!prev) {
            changes.push({ name: hunt.name, parts: [`+Hunt added (${hunt.encounters} resets, ${hunt.completed ? "finished" : "active"})`] });
        } else if (prev.name !== hunt.name || prev.encounters !== hunt.encounters || !!prev.completed !== !!hunt.completed) {
            changes.push({ name: hunt.name, parts: [`Hunt edited: ${prev.encounters} → ${hunt.encounters} resets${!!prev.completed !== !!hunt.completed ? `, now ${hunt.completed ? "finished" : "active"}` : ""}`] });
        }
    });

    beforeById.forEach((hunt, id) => {
        if (!afterById.has(id)) {
            changes.push({ name: hunt.name, parts: ["-Hunt removed"] });
        }
    });

    return changes;
}

const pokedexChangesBtn = document.getElementById("pokedex-changes-btn");
const pokedexChangesModal = document.getElementById("pokedex-changes-modal");
const pokedexChangesModalBody = document.getElementById("pokedex-changes-modal-body");
const pokedexChangesModalClose = document.getElementById("pokedex-changes-modal-close");

function renderPokedexChanges() {

    const changes = [...getPokedexChanges(), ...getHuntsChanges()]
        .sort((a, b) => a.name.localeCompare(b.name));

    if (changes.length === 0) {
        pokedexChangesModalBody.innerHTML = `<div class="stats-row"><span>No unsaved changes.</span></div>`;
        return;
    }

    pokedexChangesModalBody.innerHTML = changes.map(change => `
        <div class="stats-row">
            <span>${change.name}</span>
            <span class="stats-value">${change.parts.join(", ")}</span>
        </div>
    `).join("");
}

pokedexChangesBtn.addEventListener("click", () => {
    renderPokedexChanges();
    pokedexChangesModal.classList.remove("hidden");
});

pokedexChangesModalClose.addEventListener("click", () => {
    pokedexChangesModal.classList.add("hidden");
});

pokedexChangesModal.addEventListener("click", (e) => {
    if (e.target === pokedexChangesModal) pokedexChangesModal.classList.add("hidden");
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
    let alpha = 0;
    let mid = 0;
    let perfect = 0;

    allPokemon.forEach(pokemon => {

        const data = savedDexData[normalizeName(pokemon.name)];
        if (!data || !data.shinyDex) return;

        shinyTotal++;

        const s = data.shinyDexData || {};
        if (s.correctStage) correctStage++;
        if (s.originalRegion) originalRegion++;
        if (s.luxuryBall) luxuryBall++;
        if (s.alpha) alpha++;
        if (s.correctStage && s.originalRegion && s.luxuryBall) mid++;
        if (s.correctStage && s.originalRegion && s.luxuryBall && s.alpha) perfect++;
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
            <div class="stats-row"><span>Alpha</span><span class="stats-value">${alpha} / ${shinyTotal}</span></div>
        </div>

        <div class="stats-section">
            <h3>Perfect Shinies</h3>
            <div class="stats-row"><span>Main 3 Constraints</span><span class="stats-value">${mid} / ${shinyTotal}</span></div>
            <div class="stats-row"><span>All 4 Constraints</span><span class="stats-value">${perfect} / ${shinyTotal}</span></div>
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
    elementIds: ["dex-key", "stats-btn", "progress-container"]
});