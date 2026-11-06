// Plushes: add the plush's single picture in the Add/Edit modal.
// Pick, paste (Ctrl+V) or drop one image while the modal is open; optionally
// crop it (SleeveCrop). Nothing is written until Save: then the file goes
// through the local sleeve helper into plushes/<normalizedtitle>.jpg|.png
// (the same name collections.js looks the picture up by).
// Loaded after collections.js and uses its globals (titleInput, customInput, ...).
(() => {
    if (COLLECTION.name !== "plushes") return;

    let staged = null; // { file, bitmap, srcUrl, quad, result, resultUrl, ext }

    // ---------- markup ----------
    const box = document.createElement("div");
    box.id = "plush-image-box";
    box.innerHTML = `
        <div class="own-image-row">
            <button type="button" id="plush-add-btn">📎 Add picture</button>
            <span class="own-image-hint">or paste / drop an image anywhere in this window</span>
            <input type="file" id="plush-file" accept="image/*" class="hidden">
        </div>
        <div id="plush-staged" class="hidden">
            <img id="plush-staged-img" alt="">
            <div class="sb-btns">
                <button type="button" id="plush-crop-btn" title="Crop">✂</button>
                <button type="button" id="plush-remove-btn" title="Remove">✕</button>
            </div>
        </div>`;
    customInput.closest("label").after(box);

    const fileInput = box.querySelector("#plush-file");
    const stagedBox = box.querySelector("#plush-staged");
    const stagedImg = box.querySelector("#plush-staged-img");

    function render() {
        stagedBox.classList.toggle("hidden", !staged);
        if (staged) stagedImg.src = staged.resultUrl || staged.srcUrl;
    }

    function drop() {
        if (!staged) return;
        URL.revokeObjectURL(staged.srcUrl);
        if (staged.resultUrl) URL.revokeObjectURL(staged.resultUrl);
        staged = null;
    }

    function canvasJpeg(bitmap) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
        return new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
    }

    // The exact file that will be saved: the crop if there is one, else the
    // original (PNG stays PNG so transparency survives; anything else is JPEG).
    async function ensureResult() {
        if (staged.result) return;
        if (staged.quad) {
            staged.result = await SleeveCrop.warp(staged.bitmap, staged.quad);
            staged.ext = "jpg";
        } else if (staged.file.type === "image/png") {
            staged.result = staged.file;
            staged.ext = "png";
        } else if (staged.file.type === "image/jpeg") {
            staged.result = staged.file;
            staged.ext = "jpg";
        } else {
            staged.result = await canvasJpeg(staged.bitmap);
            staged.ext = "jpg";
        }
        if (staged.resultUrl) URL.revokeObjectURL(staged.resultUrl);
        staged.resultUrl = URL.createObjectURL(staged.result);
    }

    async function setFile(file) {
        if (!file || !file.type.startsWith("image/")) return;
        try {
            const bitmap = await createImageBitmap(file);
            drop();
            staged = { file, bitmap, srcUrl: URL.createObjectURL(file), quad: null, result: null, resultUrl: null, ext: "jpg" };
            render();
        } catch {
            showToast(`Can't read ${file.name || "that image"}`, true);
        }
    }

    box.querySelector("#plush-add-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { setFile(fileInput.files[0]); fileInput.value = ""; });
    box.querySelector("#plush-remove-btn").addEventListener("click", () => { drop(); render(); });
    stagedImg.addEventListener("click", () => {
        if (!staged) return;
        zoomImage.src = stagedImg.src;
        imageZoomOverlay.classList.remove("hidden");
    });

    box.querySelector("#plush-crop-btn").addEventListener("click", async () => {
        if (!staged) return;
        try {
            const { bitmap } = staged;
            const full = [[0, 0], [bitmap.width, 0], [bitmap.width, bitmap.height], [0, bitmap.height]];
            const quad = await SleeveCrop.edit(bitmap, staged.quad || full);
            if (!quad) return;
            staged.quad = quad;
            staged.result = null;
            await ensureResult();
            render();
        } catch (err) {
            showToast(`Can't crop: ${err.message}`, true);
        }
    });

    // ---------- input: paste / drop ----------
    const modalOpen = () => !addModal.classList.contains("hidden");
    document.addEventListener("paste", e => {
        if (!modalOpen()) return;
        const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
        if (!file) return; // plain text pastes into the fields as usual
        e.preventDefault();
        setFile(file);
    });
    document.addEventListener("dragover", e => { if (modalOpen()) e.preventDefault(); });
    document.addEventListener("drop", e => {
        if (!modalOpen()) return;
        const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/"));
        if (!file) return;
        e.preventDefault();
        setFile(file);
    });

    // A fresh Add / Edit / Cancel starts with nothing staged. While editing, the
    // picture chosen replaces the plush's current one; while adding it never
    // overwrites a file that already exists.
    let editing = false;
    ["add-item", "edit-item", "cancel-item"].forEach(id =>
        document.getElementById(id)?.addEventListener("click", () => {
            editing = id === "edit-item";
            drop();
            render();
        }));

    // ---------- hook used by collections.js ----------
    window.PlushImages = {
        // Fire-and-forget after the item is saved, like the sleeve download.
        async saveAll(title) {
            if (!staged) return;
            const item = staged;
            const overwrite = editing;
            staged = null;
            const name = stripAccents(title).toLowerCase().replace(/[^a-z0-9]/g, "");
            try {
                staged = item;
                await ensureResult();
                staged = null;
                const r = await fetch(`${SLEEVE_HELPER}/save-image?dir=plushes&name=${name}.${item.ext}${overwrite ? "&overwrite=1" : ""}`, { method: "POST", body: item.result });
                const body = await r.json();
                if (!r.ok) throw new Error(body.error || "Save failed");
                showToast(`Saved plushes/${name}.${item.ext}`);
            } catch (err) {
                showToast(err instanceof TypeError
                    ? "Can't reach the sleeve helper — run collection-hub/sleeve-helper/start-sleeve-helper.bat (restart it if it was already running), then add the picture again."
                    : `${name}: ${err.message}`, true);
            }
            staged = item;
            drop();
            render();
        }
    };
})();
