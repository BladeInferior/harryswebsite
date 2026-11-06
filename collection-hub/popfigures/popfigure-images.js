// Pop figures: in the Edit modal, flick through the figure's current images
// (box, unboxed, ...) and replace any of them (pick or drop a file, optional ✂ crop).
// Nothing is written until Save: then each replacement goes through the local
// sleeve helper over popfigures/<name>.png (pop figure images are always PNG).
// Loaded after collections.js and existing-images.js.
(() => {
    if (COLLECTION.name !== "popfigures") return;

    const staged = new Map(); // image name -> { file, bitmap, srcUrl, quad, result, resultUrl }
    const names = () => imagesInput.value.split(",").map(x => x.trim()).filter(Boolean);

    function dropItem(item) {
        URL.revokeObjectURL(item.srcUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    }
    function clear() {
        staged.forEach(dropItem);
        staged.clear();
    }

    function canvasPng(bitmap) {
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext("2d").drawImage(bitmap, 0, 0);
        return new Promise(res => c.toBlob(res, "image/png"));
    }

    // The exact PNG that will be saved: the crop if there is one, else the original.
    async function ensureResult(item) {
        if (item.result) return;
        item.result = item.quad
            ? await SleeveCrop.warp(item.bitmap, item.quad, 2048, "image/png")
            : (item.file.type === "image/png" ? item.file : await canvasPng(item.bitmap));
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.resultUrl = URL.createObjectURL(item.result);
    }

    const carousel = ExistingImages.create({
        anchor: imagesInput.closest("label"),
        getNames: names,
        getStagedUrl: name => staged.get(name)?.resultUrl || staged.get(name)?.srcUrl || null,
        onReplace: async (name, file) => {
            try {
                const bitmap = await createImageBitmap(file);
                if (staged.has(name)) dropItem(staged.get(name));
                staged.set(name, { file, bitmap, srcUrl: URL.createObjectURL(file), quad: null, result: null, resultUrl: null });
                carousel.refresh();
            } catch {
                showToast(`Can't read ${file.name || "that image"}`, true);
            }
        },
        onUndo: name => {
            if (staged.has(name)) dropItem(staged.get(name));
            staged.delete(name);
            carousel.refresh();
        },
        onCrop: async name => {
            const item = staged.get(name);
            if (!item) return;
            try {
                const { bitmap } = item;
                const full = [[0, 0], [bitmap.width, 0], [bitmap.width, bitmap.height], [0, bitmap.height]];
                const quad = await SleeveCrop.edit(bitmap, item.quad || full);
                if (!quad) return;
                item.quad = quad;
                item.result = null;
                await ensureResult(item);
                carousel.refresh();
            } catch (err) {
                showToast(`Can't crop: ${err.message}`, true);
            }
        }
    });

    // A fresh Add / Edit / Cancel starts with nothing staged.
    ["add-item", "edit-item", "cancel-item"].forEach(id =>
        document.getElementById(id)?.addEventListener("click", () => { clear(); carousel.refresh(); }));

    window.PopfigureImages = {
        // Fire-and-forget after the item is saved, like the sleeve download.
        async saveAll() {
            const list = [...staged.entries()];
            staged.clear();
            for (const [name, item] of list) {
                try {
                    await ensureResult(item);
                    const r = await fetch(`${SLEEVE_HELPER}/save-image?dir=popfigures&name=${name}.png&overwrite=1`, { method: "POST", body: item.result });
                    const body = await r.json();
                    if (!r.ok) throw new Error(body.error || "Save failed");
                    showToast(`Saved popfigures/${name}.png`);
                } catch (err) {
                    showToast(err instanceof TypeError
                        ? "Can't reach the sleeve helper — run collection-hub/sleeve-helper/start-sleeve-helper.bat (restart it if it was already running), then replace the image again."
                        : `${name}: ${err.message}`, true);
                }
                dropItem(item);
            }
            carousel.refresh();
        }
    };
})();
