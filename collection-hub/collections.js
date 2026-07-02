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
const previewBtn = document.getElementById("preview-image-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalImage = document.getElementById("modal-image");
const navLeft = document.getElementById("modal-nav-left");
const navRight = document.getElementById("modal-nav-right");
const imagesInput = document.getElementById("item-images");
const imagePrevBtn = document.getElementById("image-prev");
const imageNextBtn = document.getElementById("image-next");
let useUnboxedImage = false;

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

    if (COLLECTION.name === "popfigures") {
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

function createCollectionFilters() {

    // avoid creating twice
    if (document.getElementById("game-filter-container")) return;

    const container = document.createElement("div");
    container.id = "game-filter-container";

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

    // RESET BUTTON
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset Filters";
    resetBtn.classList.add("game-filter-btn");
    resetBtn.addEventListener("click", () => {
        // clear state
        selectedNationality = null;
        filterHasDlc = null;

        // clear visuals
        container.querySelectorAll(".game-filter-active").forEach(el => el.classList.remove("game-filter-active"));

        filterItems(searchInput.value);
    });

    // attach reset button to container
    container.appendChild(resetBtn);

    const box = document.getElementById("box-container");
    if (box && box.parentNode) {
        box.parentNode.insertBefore(container, box.nextSibling);
    } else {
        document.body.appendChild(container);
    }
}

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
        if (COLLECTION.name === "popfigures" || COLLECTION.name === "steelbooks") {

            const imgName = item.images?.[useUnboxedImage ? 1 : 0];

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
    items.sort((a, b) => {
        return parseDate(a[COLLECTION.fields.date]) -
       parseDate(b[COLLECTION.fields.date]);
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
        currentImageIndex = 0;
        currentImageIndex = 0;

        if (currentImages.length > 0) {
            setItemImage(modalImage, currentImages[0]);

            modalTitle.textContent =
                `${item[COLLECTION.fields.title]} (1/${currentImages.length})`;
        }
        else {
            setItemImage(modalImage, item[COLLECTION.fields.title]);
        }

        document.getElementById("image-prev").style.display =
            currentImages.length > 1 ? "block" : "none";

        document.getElementById("image-next").style.display =
            currentImages.length > 1 ? "block" : "none";
    }
    else {
        setItemImage(modalImage, item[COLLECTION.fields.title]);
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

    pageMode = true;
    currentPage = 1;

    searchInput.value = "";
    filterItems("");

    renderItems();
    applyPagination();
    updateModeUI();
});

listBtn.addEventListener("click", () => {

    pageMode = false;
    currentPage = 1;

    searchInput.value = "";
    filterItems("");

    renderItems();
    updateModeUI();
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
    untaggedBtn.classList.toggle("hidden", pageMode);

    document.body.classList.toggle("page-mode", pageMode);
    document.body.classList.toggle("list-mode", !pageMode);
    document.body.classList.toggle(
        "first-page",
        pageMode && currentPage === 1
    );
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
    modalTitle.textContent = "Add Item";
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
        items[editIndex] = itemData;
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
    modalTitle.textContent = "Edit Item";
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

        let match2 = titleMatch2 || tagMatch2 || untaggedMatch2;

        // Sleeves: nationality filter (mutually exclusive)
        if (COLLECTION.name === "sleeves" && selectedNationality !== null) {
            const nat = (realItem[COLLECTION.fields.custom] || "").toLowerCase();
            if (!nat.includes(selectedNationality)) match2 = false;
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

        card.style.display = match2 ? "block" : "none";
    });
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

function openAdjacent(offset) {

    const current = Number(modalOverlay.dataset.index);

    if (isNaN(current)) return;

    let next = current + offset;

    if (next < 0)
        next = items.length - 1;

    if (next >= items.length)
        next = 0;

    openModal(next);
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

const modalCloseBtn = document.getElementById("modal-close");
if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
    });
}

// =========================
// MOBILE FILTER SUMMARY PANEL
// =========================
(function initMobileFilterPanel() {

    const toggleBtn = document.createElement("div");
    toggleBtn.id = "mobile-filter-toggle";
    toggleBtn.textContent = "⚙";
    document.body.appendChild(toggleBtn);

    const panel = document.createElement("div");
    panel.id = "mobile-filter-panel";
    panel.innerHTML = `<h4>Active Filters</h4><div id="mobile-filter-list"></div>`;
    document.body.appendChild(panel);

    const listEl = panel.querySelector("#mobile-filter-list");

    toggleBtn.addEventListener("click", () => {
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) refreshMobileFilterPanel();
    });

    function getActiveFilterElements() {
        const selectors = [
            ".generation-filter-btn.active",
            ".generation-filter-btn.game-filter-active",
            ".game-filter-btn.game-filter-active",
            ".game-filter-btn.include-btn.game-filter-active",
            ".game-filter-btn.exclude-btn.game-filter-active",
            "#missing-dex-filter.active",
            "#untagged-filter.active",
            "#toggle-front-image.active"
        ];
        return Array.from(document.querySelectorAll(selectors.join(",")));
    }

    function refreshMobileFilterPanel() {

        listEl.innerHTML = "";
        let count = 0;

        if (typeof searchInput !== "undefined" && searchInput.value.trim()) {
            count++;
            const pill = document.createElement("div");
            pill.classList.add("mobile-filter-pill");
            pill.innerHTML = `<span>Search: "${searchInput.value.trim()}"</span><span>✕</span>`;
            pill.addEventListener("click", () => {
                clearBtn.click();
                refreshMobileFilterPanel();
            });
            listEl.appendChild(pill);
        }

        getActiveFilterElements().forEach(el => {
            count++;
            const label = el.textContent.trim() || "Filter";
            const pill = document.createElement("div");
            pill.classList.add("mobile-filter-pill");
            pill.innerHTML = `<span>${label}</span><span>✕</span>`;
            pill.addEventListener("click", () => {
                el.click();
                refreshMobileFilterPanel();
            });
            listEl.appendChild(pill);
        });

        if (count === 0) {
            listEl.innerHTML = `<div class="mobile-filter-empty">No filters active</div>`;
        }

        toggleBtn.classList.toggle("has-active", count > 0);
    }

    document.addEventListener("click", () => {
        setTimeout(refreshMobileFilterPanel, 50);
    });

    refreshMobileFilterPanel();

})();