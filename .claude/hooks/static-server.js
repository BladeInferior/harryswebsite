// Minimal no-cache static file server for the repo root — the stand-in that
// turn-guard.js starts on port 5500 when VS Code's Live Server isn't running.
// No live reload (unlike Live Server): refresh the tab to see later changes.
// Runs detached until the machine restarts or its node process is killed.

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.argv[2]) || 5500;

const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8", ".mp3": "audio/mpeg", ".mp4": "video/mp4"
};

http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
        res.writeHead(400).end();
        return;
    }
    let file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
            return;
        }
        res.writeHead(200, {
            "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        res.end(data);
    });
}).listen(PORT, "127.0.0.1");
