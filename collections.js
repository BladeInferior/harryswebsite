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

const dlcInput = document.getElementById("dlc-name");
const dlcError = document.getElementById("dlc-error");
const deleteDlcModal = document.getElementById("delete-dlc-modal");
const deleteDlcList = document.getElementById("delete-dlc-list");

let selectedDlcIndex = null;
let currentDeleteItem = null;

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

    document.querySelectorAll(".pokemon-card").forEach(card => {
        card.style.display = "block";
    });
});

modalImage.addEventListener("click", () => {
    zoomImage.src = modalImage.src;
    imageZoomOverlay.classList.remove("hidden");
});

function getItemImagePath(name) {

    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    return {
        base,
        tryFormats: [".jpg", ".png", ".webp"]
    };
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

        const img = document.createElement("img");
        setItemImage(img, item[COLLECTION.fields.title]);

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

    modalTitle.textContent = item[COLLECTION.fields.title];
    setItemImage(modalImage, item[COLLECTION.fields.title]);

    document.getElementById("modal-date").textContent =
        formatDateDisplay(item[COLLECTION.fields.date]);

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

    titleInput.value = item[COLLECTION.fields.title];
    dateInput.value = formatDateForInput(item[COLLECTION.fields.date]);
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

document.getElementById("export-items").addEventListener("click", () => {

    const data = JSON.stringify(items, null, 2);

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

function filterItems(query) {

    const q = query.toLowerCase().trim();

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {

        const item = items[index];

        if (!item) return;

        const titleMatch =
            item[COLLECTION.fields.title].toLowerCase().includes(q);

        const tagMatch =
            (item[COLLECTION.fields.tags] || []).some(tag =>
                tag.toLowerCase().includes(q)
            );

        const match = titleMatch || tagMatch;

        card.style.display = match ? "block" : "none";
    });
}

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

        const item = items[index];
        if (!item) return;

        const titleMatch = item[COLLECTION.fields.title].toLowerCase().includes(q);

        const tagMatch = (item[COLLECTION.fields.tags] || []).some(tag =>
            tag.toLowerCase().includes(q)
        );

        // -------------------------
        // SPECIAL FILTER: untagged
        // -------------------------
        const untaggedMatch =
            (q === "untagged" || q === "no tags") &&
            (!item[COLLECTION.fields.tags] || item[COLLECTION.fields.tags].length === 0);

        const match = titleMatch || tagMatch || untaggedMatch;

        card.style.display = match ? "block" : "none";
    });
}

previewBtn.addEventListener("click", () => {
    const index = addModal.dataset.editIndex;
    if (index === undefined) return;

    const item = items[index];

    setItemImage(zoomImage, item[COLLECTION.fields.title]);
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

    if (next < 0) next = items.length - 1; // wrap
    if (next >= items.length) next = 0;

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

