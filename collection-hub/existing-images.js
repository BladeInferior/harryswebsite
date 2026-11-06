// Shared by every collection whose items have several pictures (steelbooks,
// pop figures): in the Edit modal, flick through the item's current images and
// replace any of them. This file only draws the carousel; the page's own script
// decides what "replace" means (crop, cut-out, saving) via the callbacks.
//
//   const c = ExistingImages.create({
//       anchor,                      // element the carousel is inserted before
//       getNames: () => [...],       // image base names of the item being edited
//       getStagedUrl: name => url,   // preview of a pending replacement, or null
//       onReplace: (name, file) => {},   // a new file was chosen for `name`
//       onUndo: name => {},              // drop the pending replacement for `name`
//       onCrop: name => {}               // optional: shows a ✂ Crop button on a pending replacement
//   });
//   c.refresh();                     // call after names / pending replacements change
// Loaded after collections.js (uses its setItemImage()).
window.ExistingImages = (() => {
    function create({ anchor, getNames, getStagedUrl, onReplace, onUndo, onCrop }) {
        const box = document.createElement("div");
        box.className = "ex-images hidden";
        box.innerHTML = `
            <div class="ex-head">Current images <span class="ex-count"></span></div>
            <div class="ex-row">
                <button type="button" class="ex-prev">◀</button>
                <div class="ex-view" title="Drop an image here to replace this one">
                    <img class="ex-img" alt="">
                    <div class="ex-caption"></div>
                </div>
                <button type="button" class="ex-next">▶</button>
            </div>
            <div class="ex-actions">
                <button type="button" class="ex-replace">🔁 Replace this image</button>
                <button type="button" class="ex-crop hidden">✂ Crop</button>
                <button type="button" class="ex-undo hidden">↩ Keep the old one</button>
                <input type="file" accept="image/*" class="hidden">
            </div>`;
        anchor.before(box);

        const img = box.querySelector(".ex-img");
        const caption = box.querySelector(".ex-caption");
        const count = box.querySelector(".ex-count");
        const undoBtn = box.querySelector(".ex-undo");
        const cropBtn = box.querySelector(".ex-crop");
        const fileInput = box.querySelector("input[type=file]");
        let index = 0;

        function refresh() {
            const names = getNames();
            box.classList.toggle("hidden", names.length === 0);
            if (!names.length) return;
            if (index >= names.length) index = names.length - 1;
            const name = names[index];
            const staged = getStagedUrl(name);
            if (staged) {
                img.onerror = null;
                img.src = staged;
            } else {
                setItemImage(img, name);
            }
            caption.textContent = staged ? `${name} — will be replaced on Save` : name;
            caption.classList.toggle("ex-pending", !!staged);
            count.textContent = names.length > 1 ? `(${index + 1}/${names.length})` : "";
            box.querySelector(".ex-prev").style.visibility = names.length > 1 ? "visible" : "hidden";
            box.querySelector(".ex-next").style.visibility = names.length > 1 ? "visible" : "hidden";
            undoBtn.classList.toggle("hidden", !staged);
            cropBtn.classList.toggle("hidden", !staged || !onCrop);
        }

        const step = d => {
            const n = getNames().length;
            if (!n) return;
            index = (index + d + n) % n;
            refresh();
        };
        box.querySelector(".ex-prev").addEventListener("click", () => step(-1));
        box.querySelector(".ex-next").addEventListener("click", () => step(1));

        const replaceWith = file => {
            const name = getNames()[index];
            if (name && file && file.type.startsWith("image/")) onReplace(name, file);
        };
        box.querySelector(".ex-replace").addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => { replaceWith(fileInput.files[0]); fileInput.value = ""; });
        undoBtn.addEventListener("click", () => { const n = getNames()[index]; if (n) onUndo(n); });
        cropBtn.addEventListener("click", () => { const n = getNames()[index]; if (n && onCrop) onCrop(n); });

        // Dropping on the picture replaces it (and stops the page's own
        // "drop = add new image" handler from also grabbing the file).
        const view = box.querySelector(".ex-view");
        view.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); });
        view.addEventListener("drop", e => {
            e.preventDefault();
            e.stopPropagation();
            replaceWith([...(e.dataTransfer?.files || [])].find(f => f.type.startsWith("image/")));
        });
        img.addEventListener("click", () => {
            if (!img.src) return;
            zoomImage.src = img.src;
            imageZoomOverlay.classList.remove("hidden");
        });

        // Always start on the first image when the modal is opened for editing.
        const reset = () => { index = 0; setTimeout(refresh, 0); };
        document.getElementById("edit-item")?.addEventListener("click", reset);
        document.getElementById("add-item")?.addEventListener("click", reset);
        // Names can also be edited by hand in the "Image names" box.
        document.getElementById("item-images")?.addEventListener("input", refresh);

        return { refresh, reset };
    }

    return { create };
})();
