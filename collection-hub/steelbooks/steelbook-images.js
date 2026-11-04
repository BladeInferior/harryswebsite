// Steelbooks: add several images at once in the Add/Edit modal.
// Drop/paste/pick images -> each gets a slot (front, front + back, ...), can be
// cropped (SleeveCrop) and have its background cut out, and is previewed in a
// scrollable list. Nothing is written until Save; then each image goes through
// the local sleeve helper into steelbooks/<normalizedtitle><slot>.jpg|.png and
// the names join the item's `images` in the fixed slot order.
// Loaded after collections.js and uses its globals (titleInput, imagesInput, ...).
(() => {
    if (COLLECTION.name !== "steelbooks") return;

    // Fixed order the modal flicks through; the name suffix is what lands in `images`.
    const SLOTS = [
        ["front", "Front"],
        ["both", "Front + back"],
        ["back", "Back"],
        ["insidedisc", "Inside, with disc"],
        ["insidenodisc", "Inside, no disc"],
        ["angle", "Angled"]
    ];
    const slotRank = name => {
        const i = SLOTS.findIndex(([s]) => name.endsWith(s));
        return i === -1 ? 99 : i;
    };

    const BG_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm";
    let bgLib = null;

    const staged = []; // { id, file, srcUrl, bitmap, slot, quad, cutout, result, ext, resultUrl, busy }
    let nextId = 1;

    // ---------- markup ----------
    const box = document.createElement("div");
    box.id = "sb-images";
    box.innerHTML = `
        <div class="own-image-row">
            <button type="button" id="sb-add-btn">📎 Add images</button>
            <span class="own-image-hint">or paste / drop images anywhere in this window</span>
            <input type="file" id="sb-file" accept="image/*" multiple class="hidden">
        </div>
        <div id="sb-status" class="hidden"></div>
        <div id="sb-bulk" class="hidden">
            <button type="button" id="sb-cut-all">✨ Cut out all backgrounds</button>
            <button type="button" id="sb-preview-all">🔍 Preview all</button>
        </div>
        <div id="sb-strip" class="hidden"></div>`;
    imagesInput.closest("label").before(box);

    const fileInput = box.querySelector("#sb-file");
    const strip = box.querySelector("#sb-strip");
    const bulk = box.querySelector("#sb-bulk");
    const statusEl = box.querySelector("#sb-status");

    const overlay = document.createElement("div");
    overlay.id = "sb-preview-overlay";
    overlay.className = "hidden";
    overlay.innerHTML = `
        <div class="sb-prev-nav" id="sb-prev-left">◀</div>
        <div class="sb-prev-main">
            <div id="sb-prev-caption"></div>
            <img id="sb-prev-img" alt="">
        </div>
        <div class="sb-prev-nav" id="sb-prev-right">▶</div>`;
    document.body.appendChild(overlay);
    let previewIndex = 0;

    function setStatus(msg, isError) {
        statusEl.textContent = msg;
        statusEl.classList.toggle("error", !!isError);
        statusEl.classList.toggle("hidden", !msg);
    }

    // ---------- naming ----------
    const baseName = title => stripAccents(title).toLowerCase().replace(/[^a-z0-9]/g, "");
    const existingNames = () => imagesInput.value.split(",").map(x => x.trim()).filter(Boolean);

    function firstFreeSlot() {
        const used = new Set(staged.map(s => s.slot));
        existingNames().forEach(n => SLOTS.forEach(([s]) => { if (n.endsWith(s)) used.add(s); }));
        return (SLOTS.find(([s]) => !used.has(s)) || SLOTS[0])[0];
    }

    // ---------- adding / removing ----------
    async function addFiles(files) {
        const images = [...files].filter(f => f.type.startsWith("image/"));
        for (const file of images) {
            try {
                const bitmap = await createImageBitmap(file);
                staged.push({
                    id: nextId++, file, bitmap, srcUrl: URL.createObjectURL(file),
                    slot: firstFreeSlot(), quad: null, cutout: false, result: null
                });
            } catch {
                showToast(`Can't read ${file.name || "that image"}`, true);
            }
        }
        render();
    }

    function dropItem(item) {
        URL.revokeObjectURL(item.srcUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    }

    function reset() {
        staged.forEach(dropItem);
        staged.length = 0;
        setStatus("");
        overlay.classList.add("hidden");
        render();
    }

    // ---------- image processing ----------
    function canvasBlob(bitmap, mime, maxSide) {
        const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * k);
        canvas.height = Math.round(bitmap.height * k);
        const ctx = canvas.getContext("2d");
        if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return new Promise(res => canvas.toBlob(res, mime, 0.92));
    }

    // After a cut-out, crop away the empty transparent border (small margin left).
    async function trimTransparent(blob) {
        const bitmap = await createImageBitmap(blob);
        const c = document.createElement("canvas");
        c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                if (d[(y * c.width + x) * 4 + 3] > 16) {
                    if (x < x0) x0 = x; if (x > x1) x1 = x;
                    if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) return blob; // nothing left — keep as is
        const pad = Math.round(Math.max(c.width, c.height) * 0.01);
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
        x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
        const out = document.createElement("canvas");
        out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
        out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return new Promise(res => out.toBlob(res, "image/png"));
    }

    async function removeBackground(blob) {
        try {
            bgLib ??= import(BG_LIB);
            const { removeBackground: run } = await bgLib;
            return await trimTransparent(await run(blob, { output: { format: "image/png" } }));
        } catch (err) {
            bgLib = null; // allow a retry
            throw new Error("background removal failed (" + (err.message || err) + ") — needs internet the first time");
        }
    }

    // The exact file that would be saved: crop (if any), then cut-out (if any).
    async function ensureResult(item) {
        if (item.result) return item;
        item.busy = true;
        render();
        try {
            if (item.cutout) {
                const src = item.quad
                    ? await SleeveCrop.warp(item.bitmap, item.quad, 2048, "image/png")
                    : await canvasBlob(item.bitmap, "image/png", 2048);
                item.result = await removeBackground(src);
                item.ext = "png";
            } else if (item.quad) {
                item.result = await SleeveCrop.warp(item.bitmap, item.quad);
                item.ext = "jpg";
            } else {
                item.result = item.file.type === "image/jpeg" ? item.file : await canvasBlob(item.bitmap, "image/jpeg", 4096);
                item.ext = "jpg";
            }
            if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
            item.resultUrl = URL.createObjectURL(item.result);
        } catch (err) {
            item.cutout = false;
            item.result = null;
            setStatus(`Couldn't process an image: ${err.message}`, true);
        } finally {
            item.busy = false;
            render();
        }
        return item;
    }

    function invalidate(item) {
        item.result = null;
        if (item.resultUrl) { URL.revokeObjectURL(item.resultUrl); item.resultUrl = null; }
    }

    // ---------- list UI ----------
    function sorted() {
        return staged.slice().sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
    }

    function render() {
        strip.innerHTML = "";
        const has = staged.length > 0;
        strip.classList.toggle("hidden", !has);
        bulk.classList.toggle("hidden", !has);
        sorted().forEach(item => {
            const card = document.createElement("div");
            card.className = "sb-card" + (item.busy ? " busy" : "");

            const img = document.createElement("img");
            img.className = "sb-thumb";
            img.alt = "";
            img.src = item.resultUrl || item.srcUrl;
            img.addEventListener("click", () => openPreview(sorted().indexOf(item)));

            const select = document.createElement("select");
            select.className = "sb-slot";
            SLOTS.forEach(([s, label]) => select.add(new Option(label, s, false, s === item.slot)));
            select.addEventListener("change", () => { item.slot = select.value; render(); });

            const btns = document.createElement("div");
            btns.className = "sb-btns";
            const mk = (text, title, fn, cls) => {
                const b = document.createElement("button");
                b.type = "button"; b.textContent = text; b.title = title;
                if (cls) b.className = cls;
                b.disabled = item.busy;
                b.addEventListener("click", fn);
                btns.appendChild(b);
            };
            mk("✂", "Crop", () => cropItem(item));
            mk("✨", "Cut out background", () => toggleCutout(item), item.cutout ? "on" : "");
            mk("🔍", "Preview", () => openPreview(sorted().indexOf(item)));
            mk("✕", "Remove", () => { dropItem(item); staged.splice(staged.indexOf(item), 1); render(); });

            card.append(img, select, btns);
            if (item.busy) {
                const spin = document.createElement("div");
                spin.className = "sb-busy";
                spin.textContent = item.cutout ? "Cutting out…" : "Working…";
                card.appendChild(spin);
            }
            strip.appendChild(card);
        });
    }

    async function cropItem(item) {
        try {
            const full = [[0, 0], [item.bitmap.width, 0], [item.bitmap.width, item.bitmap.height], [0, item.bitmap.height]];
            const quad = await SleeveCrop.edit(item.bitmap, item.quad || full);
            if (!quad) return;
            item.quad = quad;
            invalidate(item);
            await ensureResult(item);
        } catch (err) {
            showToast(`Can't crop: ${err.message}`, true);
        }
    }

    async function toggleCutout(item) {
        item.cutout = !item.cutout;
        invalidate(item);
        setStatus(item.cutout ? "Removing background — the first time downloads the model, so it can take a while." : "");
        await ensureResult(item);
        if (!statusEl.classList.contains("error")) setStatus("");
    }

    document.getElementById("sb-cut-all")?.addEventListener("click", async () => {
        setStatus("Removing backgrounds — the first time downloads the model, so it can take a while.");
        for (const item of staged.slice()) {
            if (item.cutout || !staged.includes(item)) continue;
            item.cutout = true;
            invalidate(item);
            await ensureResult(item);
        }
        if (!statusEl.classList.contains("error")) setStatus("");
    });
    document.getElementById("sb-preview-all")?.addEventListener("click", () => openPreview(0));

    // ---------- preview (scrollable) ----------
    const prevImg = overlay.querySelector("#sb-prev-img");
    const prevCaption = overlay.querySelector("#sb-prev-caption");

    async function openPreview(index) {
        const list = sorted();
        if (!list.length) return;
        previewIndex = (index + list.length) % list.length;
        const item = list[previewIndex];
        overlay.classList.remove("hidden");
        prevCaption.textContent = `${SLOTS.find(([s]) => s === item.slot)[1]} (${previewIndex + 1}/${list.length})`;
        prevImg.src = item.resultUrl || item.srcUrl;
        await ensureResult(item);
        if (!overlay.classList.contains("hidden") && sorted()[previewIndex] === item) prevImg.src = item.resultUrl;
    }
    overlay.querySelector("#sb-prev-left").addEventListener("click", e => { e.stopPropagation(); openPreview(previewIndex - 1); });
    overlay.querySelector("#sb-prev-right").addEventListener("click", e => { e.stopPropagation(); openPreview(previewIndex + 1); });
    overlay.addEventListener("click", () => overlay.classList.add("hidden"));
    document.addEventListener("keydown", e => {
        if (overlay.classList.contains("hidden")) return;
        if (e.key === "Escape") overlay.classList.add("hidden");
        else if (e.key === "ArrowLeft") openPreview(previewIndex - 1);
        else if (e.key === "ArrowRight") openPreview(previewIndex + 1);
        else return;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    // ---------- input: picker / paste / drop ----------
    box.querySelector("#sb-add-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

    const modalOpen = () => !addModal.classList.contains("hidden");
    document.addEventListener("paste", e => {
        if (!modalOpen()) return;
        const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
        if (!files.length) return; // plain text pastes into the fields as usual
        e.preventDefault();
        addFiles(files);
    });
    document.addEventListener("dragover", e => { if (modalOpen()) e.preventDefault(); });
    document.addEventListener("drop", e => {
        if (!modalOpen()) return;
        const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        addFiles(files);
    });

    // A fresh Add / Edit / Cancel starts with nothing staged.
    ["add-item", "edit-item", "cancel-item"].forEach(id =>
        document.getElementById(id)?.addEventListener("click", reset));

    // ---------- hooks used by collections.js ----------
    window.SteelbookImages = {
        // Returns a message if the staged images can't be saved as they are.
        validate() {
            if (!staged.length) return "";
            if (staged.some(s => s.busy)) return "Wait for the images to finish processing.";
            const slots = staged.map(s => s.slot);
            const dup = slots.find((s, i) => slots.indexOf(s) !== i);
            if (dup) return `Two images are both set to "${SLOTS.find(([k]) => k === dup)[1]}" — give each its own slot.`;
            const clash = slots.find(s => existingNames().some(n => n.endsWith(s)));
            if (clash) return `This steelbook already has a "${SLOTS.find(([k]) => k === clash)[1]}" image — remove its name from the list first (or change the slot).`;
            return "";
        },

        // Existing names plus the new ones, in the fixed slot order.
        mergeNames(existing, title) {
            const base = baseName(title);
            const all = [...existing];
            staged.forEach(s => { if (!all.includes(base + s.slot)) all.push(base + s.slot); });
            return all
                .map((n, i) => [n, i])
                .sort((a, b) => slotRank(a[0]) - slotRank(b[0]) || a[1] - b[1])
                .map(([n]) => n);
        },

        // Fire-and-forget after the item is saved, like the sleeve download.
        async saveAll(title) {
            const list = staged.slice();
            const base = baseName(title);
            staged.length = 0;
            for (const item of list) {
                const name = `${base}${item.slot}`;
                try {
                    await ensureResult(item);
                    if (!item.result) throw new Error("image could not be processed");
                    const r = await fetch(`${SLEEVE_HELPER}/save-image?dir=steelbooks&name=${name}.${item.ext}`, { method: "POST", body: item.result });
                    const body = await r.json();
                    if (!r.ok) throw new Error(body.error || "Save failed");
                    showToast(`Saved steelbooks/${name}.${item.ext}`);
                } catch (err) {
                    showToast(err instanceof TypeError
                        ? "Can't reach the sleeve helper — run collection-hub/sleeve-helper/start-sleeve-helper.bat, then add the images again."
                        : `${name}: ${err.message}`, true);
                }
                dropItem(item);
            }
            render();
        }
    };
})();
