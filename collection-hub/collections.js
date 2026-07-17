let items = [];

let pageMode = false;
let currentPage = 1;
const boxContainer = document.getElementById("box-container");

const pageBtn = document.getElementById("page-mode");
const listBtn = document.getElementById("list-mode");
const pagination = document.getElementById("pagination-controls");
const pageDisplay = document.getElementById("page-display");
const searchWrapper = document.getElementById("search-wrapper");
const untaggedBtn = document.getElementById("untagged-filter");

const modalTitle = document.getElementById("modal-title");
const itemModalTitle = document.getElementById("item-modal-title");
const previewBtn = document.getElementById("preview-image-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalImage = document.getElementById("modal-image");
const navLeft = document.getElementById("modal-nav-left");
const navRight = document.getElementById("modal-nav-right");
const imagesInput = document.getElementById("item-images");
const imagePrevBtn = document.getElementById("image-prev");
const imageNextBtn = document.getElementById("image-next");
const toggleGlowBtn = document.getElementById("toggle-glow-image");
let useUnboxedImage = false;
let useGlowImage = false;

const dlcInput = document.getElementById("dlc-name");
const dlcError = document.getElementById("dlc-error");
const deleteDlcModal = document.getElementById("delete-dlc-modal");
const deleteDlcList = document.getElementById("delete-dlc-list");

let selectedDlcIndex = null;
let currentDeleteItem = null;

let currentImages = [];

// collection-specific filter state
let selectedNationality = null; // for sleeves: 'english','japanese','chinese' (mutually exclusive)
let filterHasDlc = null; // for completions: true = only show items with DLC tag
let selectedVariant = null; // for popfigures: variant name, lowercase (mutually exclusive)
let selectedFranchise = null; // for popfigures: franchise name (mutually exclusive)
let filterSigned = false; // for popfigures: true = only show items tagged "signed"
let filterMissingImage = false; // true = only show items whose image failed to load

// items (by reference) whose primary image failed to load under every
// extension in getItemImagePath()'s tryFormats list — populated by
// detectMissingImages() before the filter sidebar is built, so the
// "Missing Photos" button only ever appears when it would actually do
// something.
let missingImageItems = new Set();

// for popfigures: primary sort key, tie-broken by the remaining keys in
// POPFIGURE_SORT_PRIORITY order (franchise, then number, then alphabetical)
let popfigureSortKey = "franchise";
const POPFIGURE_SORT_PRIORITY = ["franchise", "number", "alphabetical"];

// for popfigures: the "signed" tag is the source of truth for the filter —
// the photo itself is optional (a tagged item just falls back to its normal
// box/unboxed image until the signed photo is actually added). When present,
// it's stored in the next images[] slot after the box/unboxed/glow shots —
// index 2 normally, or index 3 for the Glow variant since its glow shot
// already occupies index 2.
function isPopfigureGlow(item) {
    return (item[COLLECTION.fields.date] || "")
        .split(",")
        .map(v => v.trim().toLowerCase())
        .includes("glow");
}

function isSignedPop(item) {
    const tags = item[COLLECTION.fields.tags] || [];
    return Array.isArray(tags)
        ? tags.some(t => t.toLowerCase().trim() === "signed")
        : String(tags).toLowerCase().includes("signed");
}

function getSignedImageIndex(item) {
    return isPopfigureGlow(item) ? 3 : 2;
}

function hasSignedImage(item) {
    return !!(item.images && item.images[getSignedImageIndex(item)]);
}

const imageZoomOverlay = document.getElementById("image-zoom-overlay");
const zoomImage = document.getElementById("zoom-image");


Promise.all([
    fetch(COLLECTION.jsonFile).then(res => res.json())
])
.then(([itemList]) => {

    const local = localStorage.getItem(COLLECTION.storageKey);

    if (local) {
        try {
            items = JSON.parse(local);

            // Fields added to the source JSON after this browser's copy was
            // cached (e.g. "franchise") won't exist on the cached items —
            // backfill any such gaps from the source so they don't stay
            // permanently blank just because localStorage predates them.
            const titleKey = COLLECTION.fields.title;
            const sourceByTitle = new Map(itemList.map(i => [i[titleKey], i]));
            const localTitles = new Set(items.map(i => i[titleKey]));

            items.forEach(item => {
                const source = sourceByTitle.get(item[titleKey]);
                if (!source) return;

                Object.keys(source).forEach(key => {
                    if (item[key] === undefined || item[key] === "") {
                        item[key] = source[key];
                    }
                });
            });

            // Items exported from another device/session exist in the source
            // JSON but were never added to this browser's local copy — pull
            // those in too, without touching any locally-added item that
            // hasn't been exported yet (those simply won't be in itemList).
            itemList.forEach(source => {
                if (!localTitles.has(source[titleKey])) items.push(source);
            });
        } catch {
            items = itemList;
        }
    } else {
        items = itemList;
    }

    renderItems();

    pageMode = false;
    currentPage = 1;

    updateModeUI();

    // create page-specific visual filters (sleeves / completions)
    createCollectionFilters();

    // Runs in the background rather than being awaited above — the
    // untagged-filter/popfigure-controls relocation above needs to happen
    // immediately (otherwise they sit visible in their default in-flow
    // position, full page width, until this resolves). Once the scan is
    // done, add the Missing Photos button into the already-built sidebar.
    detectMissingImages().then(() => {
        if (missingImageItems.size > 0) addMissingPhotosButton();
    });

    document.querySelectorAll(".pokemon-card").forEach(card => {
        card.style.display = "block";
    });
});

modalImage.addEventListener("click", () => {
    zoomImage.src = modalImage.src;
    imageZoomOverlay.classList.remove("hidden");
});

function getExportAuthKey() {
    return localStorage.getItem("exportAuthKey");
}

function promptForAuthKey() {
    const key = prompt("Enter your export auth key:");
    if (key) {
        localStorage.setItem("exportAuthKey", key);
        alert("Key saved. This browser will now auto-export to GitHub.");
    }
    return key;
}

function getItemImagePath(name) {

    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    let tryFormats = [".jpg", ".png", ".webp"];

    if (COLLECTION.name === "popfigures" || COLLECTION.name === "cards") {
        tryFormats = [".png"];
    }

    return { base, tryFormats };
}

function setItemImage(imgElement, name) {

    const { base, tryFormats } = getItemImagePath(name);

    let i = 0;

    imgElement.onerror = () => {
        i++;
        if (i < tryFormats.length) {
            imgElement.src = `${COLLECTION.imageFolder}/${base}${tryFormats[i]}`;
        } else {
            imgElement.src = "";
        }
    };

    imgElement.src = `${COLLECTION.imageFolder}/${base}${tryFormats[i]}`;
}

// Every image name tied to an item, not just the default thumbnail — for
// popfigures/steelbooks that's box + unboxed (+ glow/signed variants where
// present), so an item still flags as "missing" even if only an alternate
// view's file is absent, not just the one shown by default.
function getItemImageNames(item) {
    if ((COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") && item.images?.length) {
        return item.images;
    }
    return [item[COLLECTION.fields.title]];
}

// Off-DOM existence check — tries the same extension fallback chain as
// setItemImage(), but independently of any rendered <img> so it isn't at
// the mercy of lazy-loading only checking cards currently on screen.
function imageExists(name) {
    return new Promise(resolve => {
        const { base, tryFormats } = getItemImagePath(name);
        let i = 0;
        const testImg = new Image();

        testImg.onload = () => resolve(true);
        testImg.onerror = () => {
            i++;
            if (i < tryFormats.length) {
                testImg.src = `${COLLECTION.imageFolder}/${base}${tryFormats[i]}`;
            } else {
                resolve(false);
            }
        };

        testImg.src = `${COLLECTION.imageFolder}/${base}${tryFormats[i]}`;
    });
}

async function detectMissingImages() {
    const flagged = await Promise.all(items.map(async item => {
        const results = await Promise.all(getItemImageNames(item).map(imageExists));
        return results.some(ok => !ok) ? item : null;
    }));

    missingImageItems = new Set(flagged.filter(Boolean));
}

// Added once detectMissingImages() resolves (after createCollectionFilters()
// has already built the sidebar) and only when something is actually
// missing — joins the same top section as untagged-filter/popfigure-controls.
function addMissingPhotosButton() {

    if (document.getElementById("missing-photos-filter")) return;

    const missingPhotosBtn = document.createElement("button");
    missingPhotosBtn.id = "missing-photos-filter";
    missingPhotosBtn.textContent = "Missing Photos";

    missingPhotosBtn.addEventListener("click", () => {
        filterMissingImage = missingPhotosBtn.classList.toggle("active");
        filterItems(searchInput.value);
    });

    const popfigureControls = document.getElementById("popfigure-controls");
    if (popfigureControls) {
        popfigureControls.appendChild(missingPhotosBtn);
        return;
    }

    const untaggedFilter = document.getElementById("untagged-filter");
    if (untaggedFilter) {
        untaggedFilter.insertAdjacentElement("afterend", missingPhotosBtn);
        return;
    }

    const container = document.getElementById("game-filter-container");
    if (container) container.insertBefore(missingPhotosBtn, container.firstChild);
}

function createCollectionFilters() {

    // avoid creating twice
    if (document.getElementById("game-filter-container")) return;

    const container = document.createElement("div");
    container.id = "game-filter-container";

    // The tag-toggle controls (untagged-filter, or the popfigure-controls
    // group) live as their own section at the very top of the sidebar,
    // ahead of the collection-specific filter rows below. This has to
    // happen synchronously, right here — the missing-photos scan below
    // takes a moment, and delaying this relocation until it resolves would
    // leave these controls sitting in their default in-flow position
    // (full page width) until then.
    const tagControls = document.getElementById("popfigure-controls") || document.getElementById("untagged-filter");
    if (tagControls) {
        tagControls.classList.remove("filter-relocating");
        container.appendChild(tagControls);

        const tagControlsDivider = document.createElement("div");
        tagControlsDivider.classList.add("sort-filter-divider");
        container.appendChild(tagControlsDivider);
    }

    // Only show filters per-collection/page
    if (COLLECTION.name === "sleeves") {

        const generationRow = document.createElement("div");
        generationRow.classList.add("generation-filter-row");

        ["ENG", "JPN", "CHN"].forEach(lang => {
            const btn = document.createElement("button");
            btn.textContent = lang;
            btn.classList.add("generation-filter-btn");
            btn.dataset.lang = lang.toLowerCase();

            // toggle state + visual with mutual exclusivity
            btn.addEventListener("click", () => {
                const key = btn.dataset.lang;

                // Clear all buttons' active class
                generationRow.querySelectorAll(".generation-filter-btn").forEach(b => {
                    b.classList.remove("game-filter-active");
                });

                if (selectedNationality === key) {
                    // Deselect if clicking the same button
                    selectedNationality = null;
                } else {
                    // Select this button
                    btn.classList.add("game-filter-active");
                    selectedNationality = key;
                }

                filterItems(searchInput.value);
            });

            generationRow.appendChild(btn);
        });

        container.appendChild(generationRow);

        ["Trainers", "Items", "Generations"].forEach(label => {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.classList.add("game-filter-btn", "placeholder-filter-btn");
            container.appendChild(btn);
        });
    }

    if (COLLECTION.name === "completions") {

        const generationRow = document.createElement("div");
        generationRow.classList.add("generation-filter-row");

        const hasDlcBtn = document.createElement("button");
        hasDlcBtn.textContent = "Has DLC";
        hasDlcBtn.classList.add("generation-filter-btn");
        hasDlcBtn.dataset.hasDlc = "1";

        hasDlcBtn.addEventListener("click", () => {
            const active = hasDlcBtn.classList.toggle("game-filter-active");
            filterHasDlc = active ? true : null;
            filterItems(searchInput.value);
        });

        generationRow.appendChild(hasDlcBtn);

        container.appendChild(generationRow);
    }

    if (COLLECTION.name === "popfigures") {

        const variantSet = new Set();
        const franchiseSet = new Set();

        items.forEach(item => {
            (item[COLLECTION.fields.date] || "")
                .split(",")
                .map(v => v.trim())
                .filter(Boolean)
                .forEach(v => variantSet.add(v));

            const franchise = item[COLLECTION.fields.custom];
            if (franchise) franchiseSet.add(franchise);
        });

        const variantRow = document.createElement("div");
        variantRow.classList.add("generation-filter-row");

        [...variantSet].sort().forEach(variant => {

            const btn = document.createElement("button");
            btn.textContent = variant;
            btn.classList.add("generation-filter-btn");
            btn.dataset.variant = variant.toLowerCase();

            btn.addEventListener("click", () => {
                const key = btn.dataset.variant;

                variantRow.querySelectorAll(".generation-filter-btn").forEach(b => {
                    b.classList.remove("game-filter-active");
                });

                if (selectedVariant === key) {
                    selectedVariant = null;
                } else {
                    btn.classList.add("game-filter-active");
                    selectedVariant = key;
                }

                if (toggleGlowBtn) {
                    const showGlowToggle = selectedVariant === "glow";
                    toggleGlowBtn.classList.toggle("hidden", !showGlowToggle);

                    if (!showGlowToggle && useGlowImage) {
                        useGlowImage = false;
                        toggleGlowBtn.classList.remove("active");
                        toggleGlowBtn.textContent = "Show Glowing";
                        renderItems();
                    }
                }

                filterItems(searchInput.value);
            });

            variantRow.appendChild(btn);
        });

        container.appendChild(variantRow);

        const franchiseSelect = document.createElement("select");
        franchiseSelect.id = "franchise-filter-select";
        franchiseSelect.classList.add("game-filter-select");

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All Franchises";
        franchiseSelect.appendChild(allOption);

        [...franchiseSet].sort().forEach(franchise => {
            const opt = document.createElement("option");
            opt.value = franchise;
            opt.textContent = franchise;
            franchiseSelect.appendChild(opt);
        });

        franchiseSelect.addEventListener("change", () => {
            selectedFranchise = franchiseSelect.value || null;
            filterItems(searchInput.value);
        });

        container.appendChild(franchiseSelect);

        // Sort options are a separate concern from the filters above
        // (they reorder everything rather than hide/show items), so they
        // get their own visually separated section.
        const sortDivider = document.createElement("div");
        sortDivider.classList.add("sort-filter-divider");
        container.appendChild(sortDivider);

        const sortLabel = document.createElement("div");
        sortLabel.classList.add("sort-filter-label");
        sortLabel.textContent = "Sort By";
        container.appendChild(sortLabel);

        const sortOptions = [
            { key: "franchise", label: "Franchise" },
            { key: "number", label: "Number" },
            { key: "alphabetical", label: "Alphabetical" }
        ];

        sortOptions.forEach(({ key, label }) => {

            const btn = document.createElement("button");
            btn.textContent = label;
            btn.classList.add("game-filter-btn", "sort-filter-btn");
            btn.dataset.sortKey = key;

            if (key === popfigureSortKey) btn.classList.add("game-filter-active");

            btn.addEventListener("click", () => {

                popfigureSortKey = key;

                container.querySelectorAll(".sort-filter-btn").forEach(b => {
                    b.classList.remove("game-filter-active");
                });
                btn.classList.add("game-filter-active");

                renderItems();
            });

            container.appendChild(btn);
        });
    }

    // RESET BUTTON
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Filters";
    resetBtn.classList.add("game-filter-btn");
    resetBtn.addEventListener("click", () => {
        // clear state
        selectedNationality = null;
        filterHasDlc = null;
        selectedVariant = null;
        selectedFranchise = null;
        filterSigned = false;
        filterMissingImage = false;

        // clear visuals (sort buttons are a separate concern and keep their highlight)
        container.querySelectorAll(".game-filter-active").forEach(el => {
            if (!el.classList.contains("sort-filter-btn")) {
                el.classList.remove("game-filter-active");
            }
        });

        const franchiseSelect = document.getElementById("franchise-filter-select");
        if (franchiseSelect) franchiseSelect.value = "";

        const signedBtn = document.getElementById("signed-filter");
        if (signedBtn) {
            signedBtn.classList.remove("active");
            signedBtn.textContent = "Signed";
        }

        const missingPhotosBtn = document.getElementById("missing-photos-filter");
        if (missingPhotosBtn) missingPhotosBtn.classList.remove("active");

        renderItems();
    });

    // attach reset button to container
    container.appendChild(resetBtn);

    const box = document.getElementById("box-container");

    // Size the sidebar before it ever enters the DOM so the first paint
    // already shows the narrow width — setting it only after insertion
    // (via adjustFilterSidebarWidth() below) would let the element briefly
    // render at its default 280px and then visibly transition down.
    if (box && !window.matchMedia("(max-width: 768px)").matches && !pageMode) {
        container.style.width = `${computeFilterSidebarWidth(box)}px`;
    }

    if (box && box.parentNode) {
        box.parentNode.insertBefore(container, box.nextSibling);
    } else {
        document.body.appendChild(container);
    }

    if (typeof syncMobileFilterPopout === "function") syncMobileFilterPopout();
    adjustFilterSidebarWidth();
}

function computeFilterSidebarWidth(box) {
    const maxWidth = 280;
    const minWidth = 130;
    const sidebarRightOffset = 20;
    const gapFromGrid = 16;

    const boxRight = box.getBoundingClientRect().right;
    const available = window.innerWidth - sidebarRightOffset - gapFromGrid - boxRight;

    return Math.max(minWidth, Math.min(maxWidth, available));
}

// Keep the item grid centered on the page; shrink the filter sidebar
// instead of shifting the grid when the two would otherwise overlap.
function adjustFilterSidebarWidth() {

    if (window.matchMedia("(max-width: 768px)").matches) return;

    // Page mode uses a narrower grid than list mode, which would otherwise
    // make the sidebar grow/shrink between modes — always size it for list
    // mode instead, and leave it untouched while in page mode.
    if (pageMode) return;

    const container = document.getElementById("game-filter-container");
    const box = document.getElementById("box-container");

    if (!container || !box) return;

    container.style.width = `${computeFilterSidebarWidth(box)}px`;
}

window.addEventListener("resize", adjustFilterSidebarWidth);

function getCurrentPageSize() {

    if (!pageMode) {
        return items.length;
    }

    return currentPage === 1 ? 12 : 24;
}

// =========================
// SAVE
// =========================
function saveItems() {
    localStorage.setItem(COLLECTION.storageKey, JSON.stringify(items));
    updateModeUI();
}

function hasAnyUntaggedItems() {
    return items.some(item => {
        const tags = item[COLLECTION.fields.tags];
        return !tags || (Array.isArray(tags) && tags.length === 0);
    });
}

// =========================
// RENDER CARDS
// =========================
function renderItems() {

    boxContainer.innerHTML = "";

    sortItemsByDate();

    const data = pageMode
        ? getPageModeOrder(items)
        : items;

    data.forEach((item, index) => {

        // ---------------------------------
        // EMPTY PLACEHOLDER CARD
        // ---------------------------------
        if (item.empty) {

            const spacer = document.createElement("div");
            spacer.classList.add("pokemon-card", "empty-card");

            boxContainer.appendChild(spacer);

            return;
        }

        // ---------------------------------
        // NORMAL CARD
        // ---------------------------------
        const card = document.createElement("div");
        card.classList.add("pokemon-card");
        card.dataset.itemIndex = items.indexOf(item);

        const img = document.createElement("img");
        img.loading = "lazy";
        if (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") {

            let imgName;
            if (COLLECTION.name === "popfigures" && filterSigned && isSignedPop(item) && hasSignedImage(item)) {
                imgName = item.images[getSignedImageIndex(item)];
            } else {
                imgName = (useGlowImage && item.images?.[2])
                    ? item.images[2]
                    : item.images?.[useUnboxedImage ? 1 : 0];
            }

            if (imgName) {
                setItemImage(img, imgName);
            } else {
                setItemImage(img, item[COLLECTION.fields.title]);
            }

        } else {
            setItemImage(img, item[COLLECTION.fields.title]);
        }

        card.appendChild(img);

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = item[COLLECTION.fields.title];
        card.appendChild(label);

        const dlcContainer = document.createElement("div");
        dlcContainer.classList.add("dlc-container");

        const dlcs = item.dlcs || [];

        dlcs.forEach(dlcName => {

            const dlcItem = items.find(i =>
                i[COLLECTION.fields.title] === dlcName
            );

            if (!dlcItem) return;

            const dlcImg = document.createElement("img");
            dlcImg.loading = "lazy";

            setItemImage(dlcImg, dlcItem[COLLECTION.fields.title]);

            dlcImg.classList.add("dlc-thumb");

            dlcContainer.appendChild(dlcImg);
        });

        card.appendChild(dlcContainer);

        card.addEventListener("click", () => {
            openModal(items.indexOf(item));
        });

        boxContainer.appendChild(card);
    });

    applyPagination();
    filterItems(searchInput.value);
    adjustFilterSidebarWidth();
}

/**function renderItems() {

    boxContainer.innerHTML = "";

    sortItemsByDate();

    const data = pageMode
        ? getPageModeOrder(items)
        : items;

    data.forEach((item, index) => {

        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        const img = document.createElement("img");
        setItemImage(img, item.name);

        card.appendChild(img);

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
} **/

function sortItemsByDate() {

    if (COLLECTION.name === "popfigures") {
        sortPopfigures();
        return;
    }

    items.sort((a, b) => {
        return parseDate(a[COLLECTION.fields.date]) -
       parseDate(b[COLLECTION.fields.date]);
    });
}

function getPopfigureNumber(item) {
    const title = item[COLLECTION.fields.title] || "";

    // Multi-figure box sets (e.g. "2 Pack Bullseye/Daredevil") lead with a
    // pack-count digit, not a real Pop number — treat them as 0 so they
    // always sort first numerically instead of interleaving with real numbers.
    if (/^\d+[\s-]*pack\b/i.test(title)) return 0;

    const match = title.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : Infinity;
}

function getPopfigureName(item) {
    return (item[COLLECTION.fields.title] || "").replace(/^\d+\.\s*/, "");
}

function comparePopfigures(key, a, b) {

    if (key === "franchise") {
        const fa = (a[COLLECTION.fields.custom] || "").toLowerCase();
        const fb = (b[COLLECTION.fields.custom] || "").toLowerCase();
        return fa.localeCompare(fb);
    }

    if (key === "number") {
        return getPopfigureNumber(a) - getPopfigureNumber(b);
    }

    if (key === "alphabetical") {
        return getPopfigureName(a).toLowerCase()
            .localeCompare(getPopfigureName(b).toLowerCase());
    }

    return 0;
}

function sortPopfigures() {

    const keyOrder = [
        popfigureSortKey,
        ...POPFIGURE_SORT_PRIORITY.filter(k => k !== popfigureSortKey)
    ];

    items.sort((a, b) => {
        for (const key of keyOrder) {
            const cmp = comparePopfigures(key, a, b);
            if (cmp !== 0) return cmp;
        }
        return 0;
    });
}

function parseDate(dateStr) {

    if (!dateStr) return 0;

    if (dateStr.includes("-")) {
        return new Date(dateStr).getTime();
    }

    if (dateStr.includes("/")) {
        const [d, m, y] = dateStr.split("/");
        return new Date(`${y}-${m}-${d}`).getTime();
    }

    return 0;
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return "No date";

    // already DD/MM/YYYY
    if (dateStr.includes("/")) return dateStr;

    // YYYY-MM-DD → DD/MM/YYYY
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
}

function openModal(index) {

    const item = items[index];

   currentImages = [];

    if (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") {

        currentImages = item.images || [];

        // Open on whichever image matches the grid's current boxed/unboxed
        // toggle (image 1 = boxed, image 2 = unboxed), so it stays in sync
        // when paging to the next/previous item too. The signed filter takes
        // priority so the modal opens on the same signed photo the card
        // itself was showing.
        currentImageIndex =
            (COLLECTION.name === "popfigures" && filterSigned && isSignedPop(item) && hasSignedImage(item))
                ? getSignedImageIndex(item)
                : (COLLECTION.name === "popfigures" && useUnboxedImage && currentImages.length > 1)
                    ? 1
                    : 0;

        if (currentImages.length > 0) {
            setItemImage(modalImage, currentImages[currentImageIndex]);

            modalTitle.textContent =
                `${item[COLLECTION.fields.title]} (${currentImageIndex + 1}/${currentImages.length})`;
        }
        else {
            setItemImage(modalImage, item[COLLECTION.fields.title]);
            modalTitle.textContent = item[COLLECTION.fields.title];
        }

        document.getElementById("image-prev").style.display =
            currentImages.length > 1 ? "block" : "none";

        document.getElementById("image-next").style.display =
            currentImages.length > 1 ? "block" : "none";
    }
    else {
        setItemImage(modalImage, item[COLLECTION.fields.title]);
        modalTitle.textContent = item[COLLECTION.fields.title];
    }

    if (COLLECTION.name === "popfigures") {
        document.getElementById("modal-date").textContent =
            item[COLLECTION.fields.date] || "";
    } else {
        document.getElementById("modal-date").textContent =
            formatDateDisplay(item[COLLECTION.fields.date]);
    }

    document.getElementById("modal-custom").textContent =
        item[COLLECTION.fields.custom] || "";

    document.getElementById("modal-tags").textContent =
        item[COLLECTION.fields.tags]?.join(", ") || "No tags";

    if (document.body.classList.contains("completions-page")) {

        let dlcContainer = document.getElementById("modal-dlcs");

        if (!dlcContainer) {

            dlcContainer = document.createElement("div");
            dlcContainer.id = "modal-dlcs";

            document.querySelector(".modal-right")
                .appendChild(dlcContainer);
        }

        dlcContainer.innerHTML = "";

        (item.dlcs || []).forEach(name => {

            const img = document.createElement("img");

            setItemImage(img, name);

            img.addEventListener("click", () => {

                zoomImage.src = img.src;
                imageZoomOverlay.classList.remove("hidden");
            });

            dlcContainer.appendChild(img);
        });
    }

    modalOverlay.classList.remove("hidden");

    modalOverlay.dataset.index = index;
}

modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.add("hidden");
    }
});

imageZoomOverlay.addEventListener("click", (e) => {
    if (e.target === imageZoomOverlay || e.target === zoomImage) {
        imageZoomOverlay.classList.add("hidden");
    }
});

// =========================
// MODE BUTTONS
// =========================
pageBtn.addEventListener("click", () => {

    if (pageMode) return;

    pageMode = true;
    currentPage = 1;

    searchInput.value = "";
    filterItems("");

    // Toggle the mode classes before rendering/measuring, so the grid is
    // already laid out with page-mode's CSS when adjustFilterSidebarWidth()
    // reads its width — otherwise it measures the stale (list-mode) layout.
    updateModeUI();
    renderItems();
    applyPagination();
});

listBtn.addEventListener("click", () => {

    if (!pageMode) return;

    pageMode = false;
    currentPage = 1;

    searchInput.value = "";
    filterItems("");

    updateModeUI();
    renderItems();
});

// =========================
// PAGINATION
// =========================
document.getElementById("next-page").addEventListener("click", () => {

    const remaining = Math.max(0, items.length - 12);

    const maxPage =
        items.length <= 12
            ? 1
            : 1 + Math.ceil(remaining / 24);

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

// =========================
// MODE UI
// =========================
function updateModeUI() {

    pageBtn.classList.toggle("active-mode", pageMode === true);
    listBtn.classList.toggle("active-mode", pageMode === false);

    pagination.classList.toggle("hidden", pageMode === false);

    searchWrapper.classList.toggle("hidden", pageMode);
    untaggedBtn.classList.toggle("hidden", pageMode || !hasAnyUntaggedItems());

    document.body.classList.toggle("page-mode", pageMode);
    document.body.classList.toggle("list-mode", !pageMode);
    document.body.classList.toggle(
        "first-page",
        pageMode && currentPage === 1
    );

    const filterContainer = document.getElementById("game-filter-container");
    if (filterContainer) filterContainer.classList.toggle("filters-disabled", pageMode);
}

// =========================
// ADD ITEM
// =========================
const addModal = document.getElementById("add-item-modal");

const titleInput = document.getElementById("item-title");
const dateInput = document.getElementById("item-date");
const customInput = document.getElementById("item-custom");
const tagsInput = document.getElementById("item-tags");

// OPEN MODAL
document.getElementById("add-item").addEventListener("click", () => {

    addModal.classList.remove("hidden");
    itemModalTitle.textContent = "Add Item";
    previewBtn.style.display = "none";

    delete addModal.dataset.editIndex;

    if (COLLECTION.name === "popfigures") {
        imagesInput.value = "";
    }

    titleInput.value = "";
    dateInput.value = "";
    customInput.value = "";
    tagsInput.value = "";
});

// SAVE
const errorBox = document.getElementById("item-error");

document.getElementById("save-item").addEventListener("click", () => {

    const title = titleInput.value.trim();
    const date = dateInput.value.trim();
    const custom = customInput.value.trim();
    const tagsRaw = tagsInput.value.trim();
    let images = [];

    const tags = tagsRaw
        ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
        : [];


    if (!title || !date || !custom) {
        errorBox.textContent = "Please fill out all required fields";
        errorBox.classList.remove("hidden");
        return;
    }

    errorBox.classList.add("hidden");

    const editIndex = addModal.dataset.editIndex;

    const itemData = {};

    itemData[COLLECTION.fields.title] = title;
    itemData[COLLECTION.fields.date] = date;
    itemData[COLLECTION.fields.custom] = custom;
    itemData[COLLECTION.fields.tags] = tags;

    if (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") {

        const rawImages = imagesInput.value.trim();

        itemData.images = rawImages
            ? rawImages.split(",").map(x => x.trim()).filter(Boolean)
            : [];
    }

    if (editIndex !== undefined && editIndex !== "") {
        // Merge rather than replace, so fields not covered by the edit form
        // (e.g. completions' `dlcs`) survive an edit instead of being wiped.
        Object.assign(items[editIndex], itemData);
    } else {
        items.push(itemData);
    }

    delete addModal.dataset.editIndex;

    saveItems();
    sortItemsByDate();
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

// CANCEL
document.getElementById("cancel-item").addEventListener("click", () => {
    addModal.classList.add("hidden");
    errorBox.classList.add("hidden");
});

// DELETE
document.getElementById("delete-item").addEventListener("click", () => {

    const index = modalOverlay.dataset.index;
    if (index === undefined) return;

    items.splice(index, 1);

    saveItems();
    renderItems();

    modalOverlay.classList.add("hidden");
});

document.getElementById("edit-item").addEventListener("click", () => {

    const index = modalOverlay.dataset.index;
    const item = items[index];

    if (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") {
        imagesInput.value = (item.images || []).join(", ");
    }

    titleInput.value = item[COLLECTION.fields.title];
    
    if (COLLECTION.name === "popfigures") {
        dateInput.value = item[COLLECTION.fields.date] || "";
    } else {
        dateInput.value = formatDateForInput(item[COLLECTION.fields.date]);
    }
    tagsInput.value = (item[COLLECTION.fields.tags] || []).join(", ");
    customInput.value = item[COLLECTION.fields.custom];
    const tagsContainer = document.getElementById("modal-tags");

    addModal.dataset.editIndex = index;
    itemModalTitle.textContent = "Edit Item";
    previewBtn.style.display = "inline-block";

    tagsContainer.innerHTML = "";

    (item[COLLECTION.fields.tags] || []).forEach(tag => {
        const el = document.createElement("span");
        el.classList.add("tag-pill");
        el.textContent = tag;
        tagsContainer.appendChild(el);
    });

    addModal.classList.remove("hidden");
    modalOverlay.classList.add("hidden");

    // store edit index
    addModal.dataset.editIndex = index;
});

document.getElementById("import-button").addEventListener("click", () => {
    document.getElementById("import-items").click();
});

// IMPORT JSON BACKUP
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

            saveItems();
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
                    filename: COLLECTION.jsonFile,
                    content: data
                })
            });

            const result = await res.json();

            if (result.verified && result.committed) {
                alert(`✅ ${COLLECTION.jsonFile} committed to GitHub automatically.`);
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
    a.download = COLLECTION.jsonFile;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

/* earlier filterItems placeholder — implementation below */

function formatDateForInput(dateStr) {
    if (!dateStr) return "";

    // already ISO
    if (dateStr.includes("-")) return dateStr;

    // DD/MM/YYYY → YYYY-MM-DD
    const [day, month, year] = dateStr.split("/");
    return `${year}-${month}-${day}`;
}

/** function getPageModeOrder(items) {

    let start;
    let end;

    if (currentPage === 1) {
        start = 0;
        end = 12;
    } else {
        start = 12 + ((currentPage - 2) * 24);
        end = start + 24;
    }

    const pageItems = items.slice(start, end);

    const output = [];

    const rows = 3;

    for (let r = 0; r < rows; r++) {

        // first block (0–11)
        for (let c = 0; c < 4; c++) {
            const index = r * 4 + c;
            if (pageItems[index]) output.push(pageItems[index]);
        }

        // second block (12–23)
        for (let c = 0; c < 4; c++) {
            const index = 12 + (r * 4 + c);
            if (pageItems[index]) output.push(pageItems[index]);
        }
    }

    return output;
} **/

    function getPageModeOrder(items) {

    let start;
    let end;

    if (currentPage === 1) {
        start = 0;
        end = 12;
    } else {
        start = 12 + ((currentPage - 2) * 24);
        end = start + 24;
    }

    const pageItems = items.slice(start, end);

    // ---------------------------------
    // PAD FINAL PAGE TO 24 ITEMS
    // ---------------------------------
    while (pageItems.length < 24) {
        pageItems.push({
            empty: true
        });
    }

    const output = [];

    const rows = 3;

    for (let r = 0; r < rows; r++) {

        // LEFT PAGE
        for (let c = 0; c < 4; c++) {

            const index = r * 4 + c;

            output.push(pageItems[index]);
        }

        // RIGHT PAGE
        for (let c = 0; c < 4; c++) {

            const index = 12 + (r * 4 + c);

            output.push(pageItems[index]);
        }
    }

    return output;
}

const searchInput = document.getElementById("search");
const clearBtn = document.getElementById("clear-search");

searchInput.addEventListener("input", (e) => {
    filterItems(e.target.value);
});

clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    filterItems("");

    untaggedBtn.classList.remove("active");
});

// Dates are stored as ISO "YYYY-MM-DD", but that's not how anyone searches
// for one — reformats to "DD/MM/YYYY" so a query like "27/10" matches, in
// addition to the raw ISO string. Returns "" for anything that isn't a
// plain ISO date (e.g. popfigures' "date" field is actually the variant
// name), so it never introduces a false match there.
function isoDateToSlashFormat(dateStr) {
    const parts = String(dateStr).split("-");
    if (parts.length !== 3) return "";

    const [y, m, d] = parts;
    if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return "";

    return `${d}/${m}/${y}`;
}

function filterItems(query) {

    const q = query.toLowerCase().trim();

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {

        // -------------------------
        // COLLECTION-SPECIFIC FILTERS
        // -------------------------
        // map card -> item using data-item-index when available
        // map card -> item using data-item-index when available
        const dataIndex = (card.dataset && card.dataset.itemIndex) ? Number(card.dataset.itemIndex) : index;
        const realItem = items[dataIndex];
        if (!realItem) {
            card.style.display = "none";
            return;
        }

        // replace item with the realItem for checks
        const titleMatch2 = realItem[COLLECTION.fields.title].toLowerCase().includes(q);

        const tagMatch2 = (realItem[COLLECTION.fields.tags] || []).some(tag =>
            tag.toLowerCase().includes(q)
        );

        const untaggedMatch2 =
            (q === "untagged" || q === "no tags") &&
            (!realItem[COLLECTION.fields.tags] || realItem[COLLECTION.fields.tags].length === 0);

        // Search box also matches each collection's "date" field (variant
        // for popfigures, date acquired/completed/released elsewhere — as
        // both the raw ISO string and "DD/MM/YYYY") and "custom" field
        // (franchise, or nationality for sleeves) — not just title/tags.
        // Every collection maps both fields to something meaningful, so
        // this applies universally rather than per-name.
        const rawDateField = (realItem[COLLECTION.fields.date] || "").toString().toLowerCase();

        const dateFieldMatch2 =
            rawDateField.includes(q) || isoDateToSlashFormat(rawDateField).includes(q);

        const customFieldMatch2 =
            (realItem[COLLECTION.fields.custom] || "").toString().toLowerCase().includes(q);

        let match2 = titleMatch2 || tagMatch2 || untaggedMatch2 || dateFieldMatch2 || customFieldMatch2;

        // Sleeves: nationality filter (mutually exclusive)
        if (COLLECTION.name === "sleeves" && selectedNationality !== null) {
            const nat = (realItem[COLLECTION.fields.custom] || "").toLowerCase();
            if (!nat.includes(selectedNationality)) match2 = false;
        }

        // Popfigures: variant filter (mutually exclusive)
        if (COLLECTION.name === "popfigures" && selectedVariant !== null) {
            const variantTokens = (realItem[COLLECTION.fields.date] || "")
                .split(",")
                .map(v => v.trim().toLowerCase());
            if (!variantTokens.includes(selectedVariant)) match2 = false;
        }

        // Popfigures: franchise filter (mutually exclusive)
        if (COLLECTION.name === "popfigures" && selectedFranchise !== null) {
            if ((realItem[COLLECTION.fields.custom] || "") !== selectedFranchise) match2 = false;
        }

        // Popfigures: signed filter (based on the "signed" tag)
        if (COLLECTION.name === "popfigures" && filterSigned) {
            if (!isSignedPop(realItem)) match2 = false;
        }

        // Completions: DLC tag filter
        if (COLLECTION.name === "completions" && filterHasDlc === true) {
            const tags = realItem[COLLECTION.fields.tags] || [];
            const hasDlc = (Array.isArray(tags)
                ? tags.some(t => t.toLowerCase().includes("dlc"))
                : String(tags).toLowerCase().includes("dlc")
            );
            if (!hasDlc) match2 = false;
        }

        // Missing Photos: only show items whose image failed to load
        if (filterMissingImage && !missingImageItems.has(realItem)) match2 = false;

        card.style.display = match2 ? "block" : "none";
    });

    updateItemCount();
}

// =========================
// ITEM COUNT LABEL
// Mirrors the Pokédex page's "displayed" indicator — shown only while a
// search/filter is actually narrowing the grid, on both desktop (fixed
// top-right) and mobile (CSS repositions it into a bottom pill). Covers
// every collection page since the filter state variables it checks simply
// stay at their default on pages that don't use a given one.
// =========================
const itemCountLabel = document.createElement("div");
itemCountLabel.id = "item-count-label";
itemCountLabel.style.display = "none";
document.body.appendChild(itemCountLabel);

function hasActiveFilters() {
    return (
        searchInput.value.trim() !== "" ||
        selectedNationality !== null ||
        filterHasDlc !== null ||
        selectedVariant !== null ||
        selectedFranchise !== null ||
        filterSigned ||
        filterMissingImage
    );
}

function updateItemCount() {

    if (!hasActiveFilters()) {
        itemCountLabel.style.display = "none";
        return;
    }

    let count = 0;
    document.querySelectorAll(".pokemon-card").forEach(card => {
        if (card.style.display !== "none") count++;
    });

    const label = COLLECTION.name.charAt(0).toUpperCase() + COLLECTION.name.slice(1);
    itemCountLabel.textContent = `${label} displayed: ${count}`;
    itemCountLabel.style.display = "block";
}

previewBtn.addEventListener("click", () => {

    const index = addModal.dataset.editIndex;
    if (index === undefined) return;

    const item = items[index];

    if (
        (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks")
        && item.images?.length
    ) {
        setItemImage(zoomImage, item.images[0]);
    } else {
        setItemImage(zoomImage, item[COLLECTION.fields.title]);
    }

    imageZoomOverlay.classList.remove("hidden");
});

untaggedBtn.addEventListener("click", () => {

    const isActive = untaggedBtn.classList.toggle("active");

    if (isActive) {
        searchInput.value = "untagged";
        filterItems("untagged");
    } else {
        searchInput.value = "";
        filterItems("");
    }
});

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

    if (nextPos < 0)
        nextPos = visible.length - 1;

    if (nextPos >= visible.length)
        nextPos = 0;

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

if (document.body.classList.contains("completions-page")) {

    const addDlcBtn = document.getElementById("add-dlc-btn");
    const dlcModal = document.getElementById("add-dlc-modal");

    const dlcNameInput = document.getElementById("dlc-name");

    let currentDlcItem = null;

    addDlcBtn.addEventListener("click", () => {

        currentDlcItem = modalOverlay.dataset.index;

        dlcNameInput.value = "";

        dlcModal.classList.remove("hidden");
    });

    dlcNameInput.addEventListener("input", () => {

        dlcError.classList.add("hidden");
        dlcError.textContent = "";

    });

    document.getElementById("save-dlc").addEventListener("click", () => {

        const name = dlcNameInput.value.trim();

        if (!name) {
            dlcError.textContent = "Please enter a DLC name.";
            dlcError.classList.remove("hidden");
            return;
        }

        const { base, tryFormats } = getItemImagePath(name);

        let i = 0;

        const tryNext = () => {

            if (i >= tryFormats.length) {
                dlcError.textContent = "No matching image found for that DLC name.";
                dlcError.classList.remove("hidden");
                return;
            }

            const img = new Image();

            img.onload = () => {

                const item = items[currentDlcItem];

                item.dlcs = item.dlcs || [];
                item.dlcs.push(name);

                saveItems();

                dlcError.classList.add("hidden");
                dlcModal.classList.add("hidden");

                openModal(currentDlcItem);
            };

            img.onerror = () => {
                i++;
                tryNext();
            };

            img.src = `${COLLECTION.imageFolder}/${base}${tryFormats[i]}`;
        };

        tryNext();
    });

    document.getElementById("cancel-dlc").addEventListener("click", () => {
        dlcModal.classList.add("hidden");
    });


    document.getElementById("delete-dlcs-btn").addEventListener("click", () => {

        console.log("🟢 [DELETE DLC CLICKED]");

        console.log("modalOverlay.dataset.index =", modalOverlay.dataset.index);
        console.log("items length =", items.length);

        const index = modalOverlay.dataset.index;
        if (index === undefined) return;

        currentDeleteItem = items[index];

        deleteDlcList.innerHTML = "";
        selectedDlcIndex = null;

        (currentDeleteItem.dlcs || []).forEach((name, i) => {

            const btn = document.createElement("div");
            btn.textContent = name;
            btn.classList.add("tag-pill");

            btn.style.cursor = "pointer";

            btn.addEventListener("click", () => {

                console.log("🟡 DLC selected:", name, i);

                document.querySelectorAll("#delete-dlc-list .tag-pill")
                    .forEach(el => el.style.outline = "none");

                btn.style.outline = "2px solid red";
                selectedDlcIndex = i;

                console.log("selectedDlcIndex =", selectedDlcIndex);
            });

            deleteDlcList.appendChild(btn);
        });

        console.log("opening modal...");
        deleteDlcModal.classList.remove("hidden");
    });

    document.getElementById("cancel-delete-dlc").addEventListener("click", () => {
        deleteDlcModal.classList.add("hidden");
    });


    document.getElementById("confirm-delete-dlc").addEventListener("click", () => {

        if (selectedDlcIndex === null) return;

        const item = currentDeleteItem;

        item.dlcs.splice(selectedDlcIndex, 1);

        saveItems();

        deleteDlcModal.classList.add("hidden");

        openModal(items.indexOf(item));
    });
}

if (imagePrevBtn) {
    imagePrevBtn.addEventListener("click", e => {

        e.stopPropagation();

        if (currentImages.length <= 1) return;

        currentImageIndex--;

        if (currentImageIndex < 0)
            currentImageIndex = currentImages.length - 1;

        setItemImage(modalImage, currentImages[currentImageIndex]);

        modalTitle.textContent =
            `${items[modalOverlay.dataset.index][COLLECTION.fields.title]} (${currentImageIndex + 1}/${currentImages.length})`;
    });
}

if (imageNextBtn) {
    imageNextBtn.addEventListener("click", e => {

        e.stopPropagation();

        if (currentImages.length <= 1) return;

        currentImageIndex++;

        if (currentImageIndex >= currentImages.length)
            currentImageIndex = 0;

        setItemImage(modalImage, currentImages[currentImageIndex]);

        modalTitle.textContent =
            `${items[modalOverlay.dataset.index][COLLECTION.fields.title]} (${currentImageIndex + 1}/${currentImages.length})`;
    });
}

const toggleBtn = document.getElementById("toggle-front-image");

if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
        useUnboxedImage = !useUnboxedImage;

        toggleBtn.textContent = useUnboxedImage ? "Unboxed" : "Boxed";

        renderItems();
    });
}

if (toggleGlowBtn) {
    toggleGlowBtn.addEventListener("click", () => {
        useGlowImage = !useGlowImage;

        toggleGlowBtn.classList.toggle("active", useGlowImage);
        toggleGlowBtn.textContent = useGlowImage ? "Show Normal" : "Show Glowing";

        renderItems();
    });
}

const signedFilterBtn = document.getElementById("signed-filter");

if (signedFilterBtn) {
    signedFilterBtn.addEventListener("click", () => {
        filterSigned = !filterSigned;

        signedFilterBtn.classList.toggle("active", filterSigned);

        renderItems();
    });
}

const modalCloseBtn = document.getElementById("modal-close");
if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
    });
}

// =========================
// STATS MODAL
// Page-specific stats gated on COLLECTION.name — the trigger/modal elements
// only exist in the HTML of the pages that need them (sleeves, completions,
// popfigures), so everything here is guarded with `if` checks.
// =========================
const statsBtn = document.getElementById("stats-btn");
const statsModal = document.getElementById("stats-modal");
const statsModalBody = document.getElementById("stats-modal-body");
const statsModalClose = document.getElementById("stats-modal-close");

const statsDetailModal = document.getElementById("stats-detail-modal");
const statsDetailModalBody = document.getElementById("stats-detail-modal-body");
const statsDetailModalTitle = document.getElementById("stats-detail-modal-title");
const statsDetailModalClose = document.getElementById("stats-detail-modal-close");

let fullPokemonNameList = null;

async function getFullPokemonNameList() {
    if (!fullPokemonNameList) {
        fullPokemonNameList = await fetch("fullPokemonList.json").then(res => res.json());
    }
    return fullPokemonNameList;
}

function normalizeStatsTag(name) {
    return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function renderStatsRows(rows) {
    return rows.map(([label, value]) =>
        `<div class="stats-row"><span>${label}</span><span class="stats-value">${value}</span></div>`
    ).join("");
}

function renderStats() {

    if (COLLECTION.name === "sleeves") {

        const total = items.length;
        const counts = { eng: 0, jpn: 0, chn: 0 };

        items.forEach(item => {
            const nat = (item[COLLECTION.fields.custom] || "").toLowerCase();
            ["eng", "jpn", "chn"].forEach(key => {
                if (nat.includes(key)) counts[key]++;
            });
        });

        statsModalBody.innerHTML = `
            <div class="stats-section">
                <h3>By Nationality</h3>
                ${renderStatsRows([
                    ["English", `${counts.eng} / ${total}`],
                    ["Japanese", `${counts.jpn} / ${total}`],
                    ["Chinese", `${counts.chn} / ${total}`]
                ])}
            </div>
            <button id="stats-featured-pokemon-btn" class="item-action-btn stats-detail-btn">View Featured Pokémon</button>
        `;

        const featuredBtn = document.getElementById("stats-featured-pokemon-btn");
        if (featuredBtn) featuredBtn.addEventListener("click", renderFeaturedPokemonDetail);

    } else if (COLLECTION.name === "completions") {

        const total = items.length;

        const dlcDone = items.filter(item =>
            (item[COLLECTION.fields.tags] || []).some(t => t.toLowerCase().trim() === "dlc")
        ).length;

        const dlcToDo = items.filter(item =>
            (item[COLLECTION.fields.tags] || []).some(t => t.toLowerCase().trim() === "dlc available")
        ).length;

        const totalDlcs = items.reduce((sum, item) => sum + (item.dlcs || []).length, 0);

        statsModalBody.innerHTML = `
            <div class="stats-section">
                <h3>Overview</h3>
                ${renderStatsRows([["Total Completions", total]])}
            </div>
            <div class="stats-section">
                <h3>DLC</h3>
                ${renderStatsRows([
                    ["DLC Games Done", `${dlcDone} / ${total}`],
                    ["DLC Still To Do", `${dlcToDo} / ${total}`],
                    ["Total DLCs Completed", `${totalDlcs} / ${total}`]
                ])}
            </div>
            <button id="stats-franchise-btn" class="item-action-btn stats-detail-btn">View Franchise Breakdown</button>
        `;

        const franchiseBtn = document.getElementById("stats-franchise-btn");
        if (franchiseBtn) franchiseBtn.addEventListener("click", renderFranchiseDetail);

    } else if (COLLECTION.name === "popfigures") {

        const total = items.length;
        const variantCounts = {};

        items.forEach(item => {
            (item[COLLECTION.fields.date] || "")
                .split(",")
                .map(v => v.trim())
                .filter(Boolean)
                .forEach(v => {
                    variantCounts[v] = (variantCounts[v] || 0) + 1;
                });
        });

        const signedCount = items.filter(isSignedPop).length;

        const rows = Object.keys(variantCounts)
            .sort((a, b) => variantCounts[b] - variantCounts[a])
            .map(v => [v, `${variantCounts[v]} / ${total}`]);

        rows.push(["Signed", `${signedCount} / ${total}`]);

        statsModalBody.innerHTML = `
            <div class="stats-section">
                <h3>By Type</h3>
                ${renderStatsRows(rows)}
            </div>
        `;
    }
}

// Sleeves: cross-references each sleeve's tags against the master Pokémon
// name list (normalized the same way card/sprite filenames are) so only
// tags that are actually Pokémon names get counted, not descriptor tags
// like "etb" or "ultra pro".
async function renderFeaturedPokemonDetail() {

    statsDetailModalTitle.textContent = "Featured Pokémon";
    statsDetailModalBody.innerHTML = "<p>Loading…</p>";
    statsDetailModal.classList.remove("hidden");

    const pokemonList = await getFullPokemonNameList();
    const pokemonByNormalizedName = new Map(pokemonList.map(p => [normalizeStatsTag(p.name), p.name]));

    const counts = new Map();

    items.forEach(item => {
        (item[COLLECTION.fields.tags] || []).forEach(tag => {
            const canonicalName = pokemonByNormalizedName.get(normalizeStatsTag(tag));
            if (!canonicalName) return;
            counts.set(canonicalName, (counts.get(canonicalName) || 0) + 1);
        });
    });

    const total = items.length;

    const rows = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => [name, `${count} / ${total}`]);

    statsDetailModalBody.innerHTML = rows.length
        ? renderStatsRows(rows)
        : "<p>No Pokémon found in sleeve tags.</p>";
}

function renderFranchiseDetail() {

    statsDetailModalTitle.textContent = "Franchise Breakdown";

    const counts = new Map();

    items.forEach(item => {
        const franchise = item[COLLECTION.fields.custom];
        if (!franchise) return;
        counts.set(franchise, (counts.get(franchise) || 0) + 1);
    });

    const total = items.length;

    const rows = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => [name, `${count} / ${total}`]);

    statsDetailModalBody.innerHTML = rows.length
        ? renderStatsRows(rows)
        : "<p>No franchises found.</p>";

    statsDetailModal.classList.remove("hidden");
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

if (statsDetailModalClose) {
    statsDetailModalClose.addEventListener("click", () => {
        statsDetailModal.classList.add("hidden");
    });
}

if (statsDetailModal) {
    statsDetailModal.addEventListener("click", (e) => {
        if (e.target === statsDetailModal) statsDetailModal.classList.add("hidden");
    });
}

// =========================
// MOBILE FILTER POP-OUT
// On mobile, the real filter controls (Untagged, the sleeves/
// completions filter sidebar) are relocated into a pop-out panel
// instead of being hidden entirely, then moved back to their normal
// desktop spot if the window grows back past the mobile breakpoint.
// =========================

const syncMobileFilterPopout = createMobilePopout({
    toggleId: "mobile-filter-toggle",
    icon: "⚙",
    top: 130,
    heading: "Filters",
    elementIds: ["untagged-filter", "game-filter-container"]
});