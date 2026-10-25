// Four-corner crop for sleeve images (Sleeves page only; used by collections.js).
//   SleeveCrop.guessQuad(bitmap)        -> starting corners [TL, TR, BR, BL] in image pixels
//   SleeveCrop.edit(bitmap, quad)       -> Promise<quad | null>  (null = cancelled)
//   SleeveCrop.warp(bitmap, quad)       -> Promise<Blob>  straightened JPEG of just that quad
// Corners are always ordered top-left, top-right, bottom-right, bottom-left.
const SleeveCrop = (() => {
    const RATIO = 1487 / 2048; // width / height of the existing sleeve images

    // Rough first guess only — the owner adjusts the corners. Finds the
    // non-white content; if it's wide (two sleeves side by side) takes a
    // sleeve-shaped slice from its left edge, otherwise the whole content.
    function guessQuad(bitmap) {
        const scale = Math.min(1, 500 / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
        let cw = x1 - x0 + 1;
        const ch = y1 - y0 + 1;
        if (cw / ch > 0.95) cw = Math.min(cw, ch * RATIO);
        const s = 1 / scale;
        const L = x0 * s, T = y0 * s, R = (x0 + cw) * s, B = (y1 + 1) * s;
        return [[L, T], [R, T], [R, B], [L, B]];
    }

    function edit(bitmap, startQuad) {
        return new Promise(resolve => {
            const quad = startQuad.map(p => p.slice());
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;inset:0;z-index:4600;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;";
            const stage = document.createElement("div");
            const fit = Math.min((window.innerWidth * 0.92) / bitmap.width, (window.innerHeight * 0.78) / bitmap.height);
            const dw = Math.round(bitmap.width * fit), dh = Math.round(bitmap.height * fit);
            stage.style.cssText = `position:relative;width:${dw}px;height:${dh}px;touch-action:none;user-select:none;`;
            const canvas = document.createElement("canvas");
            canvas.width = dw; canvas.height = dh;
            const cctx = canvas.getContext("2d");
            cctx.fillStyle = "#fff";
            cctx.fillRect(0, 0, dw, dh);
            cctx.drawImage(bitmap, 0, 0, dw, dh);
            canvas.style.cssText = "position:absolute;inset:0;";
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", dw); svg.setAttribute("height", dh);
            svg.style.cssText = "position:absolute;inset:0;pointer-events:none;";
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            poly.setAttribute("fill", "rgba(255,80,80,.12)");
            poly.setAttribute("stroke", "#ff4d4d");
            poly.setAttribute("stroke-width", "2");
            svg.appendChild(poly);
            stage.append(canvas, svg);

            // See-through rings so the image underneath stays visible.
            const ringCss = "position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,77,77,.12);border:2px solid #ff4d4d;box-shadow:0 0 0 1px rgba(255,255,255,.7);cursor:grab;touch-action:none;";
            const makeHandle = (css, onDrag) => {
                const hd = document.createElement("div");
                hd.style.cssText = css;
                hd.addEventListener("pointerdown", e => {
                    e.preventDefault();
                    hd.setPointerCapture(e.pointerId);
                    const start = onDrag.begin(e);
                    const move = ev => { onDrag.move(start, ev); draw(); };
                    const up = () => { hd.removeEventListener("pointermove", move); hd.removeEventListener("pointerup", up); };
                    hd.addEventListener("pointermove", move);
                    hd.addEventListener("pointerup", up);
                });
                stage.appendChild(hd);
                return hd;
            };
            const toImage = ev => {
                const r = stage.getBoundingClientRect();
                return [(ev.clientX - r.left) / fit, (ev.clientY - r.top) / fit];
            };

            // Corner dots move one corner.
            const handles = quad.map((p, i) => makeHandle(ringCss, {
                begin: () => null,
                move: (_, ev) => {
                    const [x, y] = toImage(ev);
                    quad[i][0] = Math.max(0, Math.min(bitmap.width, x));
                    quad[i][1] = Math.max(0, Math.min(bitmap.height, y));
                }
            }));

            // Edge-middle dots slide a whole edge (both of its corners) by the same amount.
            const edgeHandles = quad.map((p, i) => {
                const j = (i + 1) % 4;
                return makeHandle(ringCss + "border-radius:6px;width:16px;height:16px;margin:-8px 0 0 -8px;", {
                    begin: ev => ({ at: toImage(ev), a: quad[i].slice(), b: quad[j].slice() }),
                    move: (s, ev) => {
                        const [x, y] = toImage(ev);
                        let dx = x - s.at[0], dy = y - s.at[1];
                        dx = Math.max(-Math.min(s.a[0], s.b[0]), Math.min(bitmap.width - Math.max(s.a[0], s.b[0]), dx));
                        dy = Math.max(-Math.min(s.a[1], s.b[1]), Math.min(bitmap.height - Math.max(s.a[1], s.b[1]), dy));
                        quad[i] = [s.a[0] + dx, s.a[1] + dy];
                        quad[j] = [s.b[0] + dx, s.b[1] + dy];
                    }
                });
            });

            function draw() {
                poly.setAttribute("points", quad.map(p => `${p[0] * fit},${p[1] * fit}`).join(" "));
                handles.forEach((hd, i) => { hd.style.left = `${quad[i][0] * fit}px`; hd.style.top = `${quad[i][1] * fit}px`; });
                edgeHandles.forEach((hd, i) => {
                    const j = (i + 1) % 4;
                    hd.style.left = `${(quad[i][0] + quad[j][0]) / 2 * fit}px`;
                    hd.style.top = `${(quad[i][1] + quad[j][1]) / 2 * fit}px`;
                });
            }

            const bar = document.createElement("div");
            bar.style.cssText = "display:flex;gap:10px;align-items:center;color:#ddd;font-size:14px;flex-wrap:wrap;justify-content:center;";
            const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.style.cssText = "padding:6px 16px;border-radius:6px;border:1px solid #666;background:#2a2a2a;color:#fff;cursor:pointer;"; b.addEventListener("click", fn); return b; };
            const close = result => { overlay.remove(); resolve(result); };
            bar.append(
                document.createTextNode("Drag the corner circles onto the sleeve's corners, or the square in the middle of an edge to move that whole edge."),
                mk("Reset", () => { startQuad.forEach((p, i) => { quad[i] = p.slice(); }); draw(); }),
                mk("Apply crop", () => close(quad)),
                mk("Cancel", () => close(null))
            );
            overlay.append(stage, bar);
            document.body.appendChild(overlay);
            draw();
        });
    }

    // Unit square -> quad projective map (Heckbert), then sample bilinearly.
    async function warp(bitmap, quad) {
        const [p0, p1, p2, p3] = quad;
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        // Output no larger than the source sleeve itself (no upscaling), capped at the existing images' size.
        let H = Math.round(Math.max(dist(p0, p3), dist(p1, p2)));
        H = Math.max(50, Math.min(2048, H));
        const W = Math.round(H * RATIO);

        const sx = p0[0] - p1[0] + p2[0] - p3[0], sy = p0[1] - p1[1] + p2[1] - p3[1];
        let g = 0, h = 0;
        if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
            const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
            const det = dx1 * dy2 - dx2 * dy1;
            g = (sx * dy2 - dx2 * sy) / det;
            h = (dx1 * sy - sx * dy1) / det;
        }
        const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0];
        const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];

        const src = document.createElement("canvas");
        src.width = bitmap.width; src.height = bitmap.height;
        const sctx = src.getContext("2d", { willReadFrequently: true });
        sctx.fillStyle = "#fff";
        sctx.fillRect(0, 0, src.width, src.height);
        sctx.drawImage(bitmap, 0, 0);
        const S = sctx.getImageData(0, 0, src.width, src.height).data;
        const sw = src.width, sh = src.height;

        const out = document.createElement("canvas");
        out.width = W; out.height = H;
        const octx = out.getContext("2d");
        const O = octx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
            const v = (y + 0.5) / H;
            for (let x = 0; x < W; x++) {
                const u = (x + 0.5) / W;
                const q = g * u + h * v + 1;
                const X = (a * u + b * v + c) / q - 0.5, Y = (d * u + e * v + f) / q - 0.5;
                const xi = Math.max(0, Math.min(sw - 2, Math.floor(X))), yi = Math.max(0, Math.min(sh - 2, Math.floor(Y)));
                const fx = Math.max(0, Math.min(1, X - xi)), fy = Math.max(0, Math.min(1, Y - yi));
                const i00 = (yi * sw + xi) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
                const o = (y * W + x) * 4;
                for (let k = 0; k < 3; k++) {
                    O.data[o + k] = (S[i00 + k] * (1 - fx) + S[i10 + k] * fx) * (1 - fy) + (S[i01 + k] * (1 - fx) + S[i11 + k] * fx) * fy;
                }
                O.data[o + 3] = 255;
            }
        }
        octx.putImageData(O, 0, 0);
        return new Promise(res => out.toBlob(res, "image/jpeg", 0.92));
    }

    return { guessQuad, edit, warp };
})();
