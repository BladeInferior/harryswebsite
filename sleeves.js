
let sleeves = [];

let pageMode = false;
let currentPage = 1;
const boxContainer = document.getElementById("box-container");

const pageBtn = document.getElementById("page-mode");
const listBtn = document.getElementById("list-mode");
const pagination = document.getElementById("pagination-controls");
const pageDisplay = document.getElementById("page-display");
const searchWrapper = document.getElementById("search-wrapper");
const untaggedBtn = document.getElementById("untagged-filter");

const modalTitle = document.getElementById("sleeve-modal-title");
const previewBtn = document.getElementById("preview-image-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalName = document.getElementById("modal-name");
const modalImage = document.getElementById("modal-image");

const imageZoomOverlay = document.getElementById("image-zoom-overlay");
const zoomImage = document.getElementById("zoom-image");


Promise.all([
    fetch("sleeves-backup.json").then(res => res.json())
])
.then(([sleeveList]) => {

    const local = localStorage.getItem("sleeves");

    if (local) {
        try {
            sleeves = JSON.parse(local);
        } catch {
            sleeves = sleeveList;
        }
    } else {
        sleeves = sleeveList;
    }

    renderSleeves();

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

function getSleeveImagePath(name) {

    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    return {
        base,
        tryFormats: [".jpg", ".png", ".webp"]
    };
}

function setSleeveImage(imgElement, name) {

    const { base, tryFormats } = getSleeveImagePath(name);

    let i = 0;

    imgElement.onerror = () => {
        i++;
        if (i < tryFormats.length) {
            imgElement.src = `sleeves/${base}${tryFormats[i]}`;
        } else {
            imgElement.src = "";
        }
    };

    imgElement.src = `sleeves/${base}${tryFormats[i]}`;
}

function getCurrentPageSize() {

    if (!pageMode) {
        return sleeves.length;
    }

    return currentPage === 1 ? 12 : 24;
}

// =========================
// SAVE
// =========================
function saveSleeves() {
    localStorage.setItem("sleeves", JSON.stringify(sleeves));
}

// =========================
// RENDER CARDS
// =========================
function renderSleeves() {

    boxContainer.innerHTML = "";

    sortSleevesByDate();

    const data = pageMode
        ? getPageModeOrder(sleeves)
        : sleeves;

    data.forEach((sleeve, index) => {

        // ---------------------------------
        // EMPTY PLACEHOLDER CARD
        // ---------------------------------
        if (sleeve.empty) {

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
        setSleeveImage(img, sleeve.name);

        card.appendChild(img);

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = sleeve.name;

        card.appendChild(label);

        card.addEventListener("click", () => {
            openModal(sleeves.indexOf(sleeve));
        });

        boxContainer.appendChild(card);
    });

    applyPagination();
}

/**function renderSleeves() {

    boxContainer.innerHTML = "";

    sortSleevesByDate();

    const data = pageMode
        ? getPageModeOrder(sleeves)
        : sleeves;

    data.forEach((sleeve, index) => {

        const card = document.createElement("div");
        card.classList.add("pokemon-card");

        const img = document.createElement("img");
        setSleeveImage(img, sleeve.name);

        card.appendChild(img);

        const label = document.createElement("div");
        label.classList.add("pokemon-name");
        label.textContent = sleeve.name;

        card.appendChild(label);

        card.addEventListener("click", () => {
            openModal(sleeves.indexOf(sleeve));
        });

        boxContainer.appendChild(card);
    });

    applyPagination();
} **/

function sortSleevesByDate() {
    sleeves.sort((a, b) => {
        return parseDate(a.date) - parseDate(b.date);
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

    const sleeve = sleeves[index];

    modalName.textContent = sleeve.name;
    setSleeveImage(modalImage, sleeve.name);

    document.getElementById("modal-date").textContent =
        formatDateDisplay(sleeve.date);

    document.getElementById("modal-nationality").textContent =
        sleeve.nationality || "No nationality";

    document.getElementById("modal-tags").textContent =
        sleeve.tags?.join(", ") || "No tags";

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
    filterSleeves("");

    renderSleeves();
    applyPagination();
    updateModeUI();
});

listBtn.addEventListener("click", () => {

    pageMode = false;
    currentPage = 1;

    searchInput.value = "";
    filterSleeves("");

    renderSleeves();
    updateModeUI();
});

// =========================
// PAGINATION
// =========================
document.getElementById("next-page").addEventListener("click", () => {

    const remaining = Math.max(0, sleeves.length - 12);

    const maxPage =
        sleeves.length <= 12
            ? 1
            : 1 + Math.ceil(remaining / 24);

    if (currentPage < maxPage) {
        currentPage++;
        renderSleeves();
        updateModeUI();
    }
});

document.getElementById("prev-page").addEventListener("click", () => {

    if (currentPage > 1) {
        currentPage--;
        renderSleeves();
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
// ADD SLEEVE
// =========================
const addModal = document.getElementById("add-sleeve-modal");

const nameInput = document.getElementById("sleeve-name");
const dateInput = document.getElementById("sleeve-date");
const nationalityInput = document.getElementById("sleeve-nationality");
const tagsInput = document.getElementById("sleeve-tags");

// OPEN MODAL
document.getElementById("add-sleeve").addEventListener("click", () => {

    addModal.classList.remove("hidden");
    modalTitle.textContent = "Add Sleeve";
    previewBtn.style.display = "none";

    delete addModal.dataset.editIndex;

    nameInput.value = "";
    dateInput.value = "";
    nationalityInput.value = "";
    tagsInput.value = "";
});

// SAVE
const errorBox = document.getElementById("sleeve-error");

document.getElementById("save-sleeve").addEventListener("click", () => {

    const name = nameInput.value.trim();
    const date = dateInput.value.trim();
    const nationality = nationalityInput.value.trim();
    const tagsRaw = tagsInput.value.trim();

    const tags = tagsRaw
        ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
        : [];


    if (!name || !date || !nationality) {
        errorBox.textContent = "Please fill out all required fields";
        errorBox.classList.remove("hidden");
        return;
    }

    errorBox.classList.add("hidden");

    const editIndex = addModal.dataset.editIndex;

    const sleeveData = {
        name,
        date,
        nationality,
        tags
    };

    if (editIndex !== undefined && editIndex !== "") {
        sleeves[editIndex] = sleeveData;
    } else {
        sleeves.push(sleeveData);
    }

    delete addModal.dataset.editIndex;

    saveSleeves();
    sortSleevesByDate();
    renderSleeves();

    addModal.classList.add("hidden");
});

// CANCEL
document.getElementById("cancel-sleeve").addEventListener("click", () => {
    addModal.classList.add("hidden");
    errorBox.classList.add("hidden");
});

// DELETE
document.getElementById("delete-sleeve").addEventListener("click", () => {

    const index = modalOverlay.dataset.index;
    if (index === undefined) return;

    sleeves.splice(index, 1);

    saveSleeves();
    renderSleeves();

    modalOverlay.classList.add("hidden");
});

document.getElementById("edit-sleeve").addEventListener("click", () => {

    const index = modalOverlay.dataset.index;
    const sleeve = sleeves[index];

    nameInput.value = sleeve.name;
    dateInput.value = formatDateForInput(sleeve.date);
    tagsInput.value = (sleeve.tags || []).join(", ");
    nationalityInput.value = sleeve.nationality;
    const tagsContainer = document.getElementById("modal-tags");

    addModal.dataset.editIndex = index;
    modalTitle.textContent = "Edit Sleeve";
    previewBtn.style.display = "inline-block";

    tagsContainer.innerHTML = "";

    (sleeve.tags || []).forEach(tag => {
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

// IMPORT JSON BACKUP
document.getElementById("import-sleeves").addEventListener("change", (e) => {

    const file = e.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {

        try {

            const importedSleeves = JSON.parse(event.target.result);

            if (!Array.isArray(importedSleeves)) {
                alert("Invalid backup format");
                return;
            }

            sleeves = importedSleeves;

            saveSleeves();
            renderSleeves();

            alert(`Imported ${sleeves.length} sleeves`);

        } catch (err) {

            console.error(err);
            alert("Failed to import backup");
        }
    };

    reader.readAsText(file);
});

document.getElementById("export-sleeves").addEventListener("click", () => {

    const data = JSON.stringify(sleeves, null, 2);

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `sleeves-backup-${new Date().toISOString().slice(0,10)}.json`;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

function filterSleeves(query) {

    const q = query.toLowerCase().trim();

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {

        const sleeve = sleeves[index];

        if (!sleeve) return;

        const nameMatch =
            sleeve.name.toLowerCase().includes(q);

        const tagMatch =
            (sleeve.tags || []).some(tag =>
                tag.toLowerCase().includes(q)
            );

        const match = nameMatch || tagMatch;

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
    filterSleeves(e.target.value);
});

clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    filterSleeves("");

    untaggedBtn.classList.remove("active");
});

/** function filterSleeves(query) {

    const q = query.toLowerCase().trim();

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {

        const sleeve = sleeves[index];
        if (!sleeve) return;

        const nameMatch = sleeve.name.toLowerCase().includes(q);

        const tagMatch = (sleeve.tags || []).some(tag =>
            tag.toLowerCase().includes(q)
        );

        const match = nameMatch || tagMatch;

        card.style.display = match ? "block" : "none";
    });
} **/

function filterSleeves(query) {

    const q = query.toLowerCase().trim();

    document.querySelectorAll(".pokemon-card").forEach((card, index) => {

        const sleeve = sleeves[index];
        if (!sleeve) return;

        const nameMatch = sleeve.name.toLowerCase().includes(q);

        const tagMatch = (sleeve.tags || []).some(tag =>
            tag.toLowerCase().includes(q)
        );

        // -------------------------
        // SPECIAL FILTER: untagged
        // -------------------------
        const untaggedMatch =
            (q === "untagged" || q === "no tags") &&
            (!sleeve.tags || sleeve.tags.length === 0);

        const match = nameMatch || tagMatch || untaggedMatch;

        card.style.display = match ? "block" : "none";
    });
}

previewBtn.addEventListener("click", () => {
    const index = addModal.dataset.editIndex;
    if (index === undefined) return;

    const sleeve = sleeves[index];

    setSleeveImage(zoomImage, sleeve.name);
    imageZoomOverlay.classList.remove("hidden");
});

untaggedBtn.addEventListener("click", () => {

    const isActive = untaggedBtn.classList.toggle("active");

    if (isActive) {
        searchInput.value = "untagged";
        filterSleeves("untagged");
    } else {
        searchInput.value = "";
        filterSleeves("");
    }
});
// -----------------------------
// CSV IMPORT
// -----------------------------
/** document.getElementById("import-sleeves").addEventListener("click", () => {

    const fileInput = document.getElementById("import-file");
    const file = fileInput.files[0];

    if (!file) {
        alert("Please select a CSV file");
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {

        const text = e.target.result;

        const rows = text
            .split("\n")
            .map(r => r.replace("\r", "").split(","))
            .map(r => r.map(v => v.trim()))
            .filter(r => r.length >= 3);

        for (let i = 0; i < rows.length; i++) {

            const row = rows[i];

            const date = (row[0] || "").trim();
            const name = (row[1] || "").trim();
            const nationality = (row[2] || "").trim();

            if (!date || !name) continue;

            sleeves.push({
                name,
                date,
                nationality,
                tags: []
            });
        }

        saveSleeves();
        renderSleeves();

        alert("Import complete!");
    };

    reader.readAsText(file);
});

document.getElementById("delete-all-sleeves").addEventListener("click", () => {

    const confirmDelete = confirm("Delete ALL sleeves? This cannot be undone.");

    if (!confirmDelete) return;

    sleeves = [];

    saveSleeves();
    renderSleeves();

    currentPage = 1;
    pageMode = false;
    updateModeUI();

    console.log("All sleeves deleted");
}); **/