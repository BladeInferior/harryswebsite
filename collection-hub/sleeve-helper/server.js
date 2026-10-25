// Local helper for the Sleeve Tracker's "product code" autofill.
// Browsers can't read artofpkm.com pages or save into the repo, so this
// tiny server (built-ins only, no npm install) does both:
//   GET  /product/<code>     -> { title, date, images: [url, ...] }
//   GET  /image?url=<cdn>    -> the image bytes (cdn.artofpkm.com only)
//   POST /save-image?name=x  -> writes the request body to ../sleeves/x
// Start it with start-sleeve-helper.bat; close its window to stop it.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5501;
const SLEEVES_DIR = path.join(__dirname, "..", "sleeves");
const UA = { "User-Agent": "Mozilla/5.0" };

function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // Chrome's private-network preflight, sent when the https live site calls this.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(res, status, body) {
    cors(res);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function parseProduct(html) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const time = html.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/);

    // Gallery images carry data-gallery-overlay-index-param="N"; the active
    // image repeats index 0, so keep the first src seen per index.
    const byIndex = {};
    const imgRe = /<img\b[^>]*>/g;
    let m;
    while ((m = imgRe.exec(html))) {
        const tag = m[0];
        const idx = tag.match(/data-gallery-overlay-index-param="(\d+)"/);
        const src = tag.match(/\ssrc="(https:\/\/cdn\.artofpkm\.com\/[^"]+)"/);
        if (idx && src && !(idx[1] in byIndex)) byIndex[idx[1]] = src[1];
    }
    const images = Object.keys(byIndex).sort((a, b) => a - b).map(k => byIndex[k]);

    return {
        title: h1 ? decodeEntities(h1[1].replace(/<[^>]+>/g, "").trim()) : "",
        date: time ? time[1] : "",
        images
    };
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

    try {
        const product = url.pathname.match(/^\/product\/(\d{1,8})$/);
        if (req.method === "GET" && product) {
            const r = await fetch(`https://www.artofpkm.com/products/${product[1]}`, { headers: UA });
            if (!r.ok) return json(res, 404, { error: `artofpkm returned ${r.status}` });
            const data = parseProduct(await r.text());
            if (!data.title) return json(res, 404, { error: "No title found on that page" });
            return json(res, 200, data);
        }

        if (req.method === "GET" && url.pathname === "/image") {
            const target = url.searchParams.get("url") || "";
            if (!/^https:\/\/cdn\.artofpkm\.com\/[\w-]+$/.test(target)) return json(res, 400, { error: "Bad image URL" });
            const r = await fetch(target, { headers: UA });
            if (!r.ok) return json(res, 502, { error: `Image returned ${r.status}` });
            cors(res);
            res.writeHead(200, { "Content-Type": r.headers.get("content-type") || "application/octet-stream" });
            return res.end(Buffer.from(await r.arrayBuffer()));
        }

        if (req.method === "POST" && url.pathname === "/save-image") {
            const name = url.searchParams.get("name") || "";
            if (!/^[a-z0-9]+\.jpg$/.test(name)) return json(res, 400, { error: "Bad file name" });
            const dest = path.join(SLEEVES_DIR, name);
            if (fs.existsSync(dest)) return json(res, 409, { error: `${name} already exists — not overwritten` });
            const chunks = [];
            for await (const c of req) chunks.push(c);
            fs.writeFileSync(dest, Buffer.concat(chunks));
            return json(res, 200, { saved: name });
        }

        json(res, 404, { error: "Not found" });
    } catch (e) {
        json(res, 500, { error: e.message });
    }
}).listen(PORT, "127.0.0.1", () => console.log(`Sleeve helper running on http://127.0.0.1:${PORT}`));
