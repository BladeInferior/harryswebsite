// Claude Code hook, run in two modes (see .claude/settings.json):
//
//   node turn-guard.js snapshot   (UserPromptSubmit) — records a hash of every
//                                 uncommitted file, so Stop can tell what this
//                                 turn itself changed.
//   node turn-guard.js stop       (Stop) — if this turn changed any files:
//     1. makes sure the site is being served on port 5500 (VS Code's Live
//        Server, normally), starting static-server.js there if nothing is
//        listening, and opens the Collection Hub in the browser — on the
//        first changing turn of each session, or whenever it had to start
//        the server. A running server doesn't prove a tab is open, so that
//        alone isn't taken as "already open"; after the first open, Live
//        Server's own reload keeps the tab current.
//     2. if CLAUDE.md wasn't among the changes, blocks the stop once and asks
//        Claude to bring it up to date (stop_hook_active stops it looping).

const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = 5500;
const OPEN_URL = `http://127.0.0.1:${PORT}/collection-hub/collectionhub.html`;
const IGNORED = [/^\.VSCodeCounter\//];

function readStdin() {
    try {
        return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    } catch {
        return {};
    }
}

// path -> content hash, for every modified/added/untracked file.
function dirtyFiles() {
    const out = execSync("git status --porcelain -uall -z", { cwd: ROOT, encoding: "utf8" });
    const files = {};
    const entries = out.split("\0").filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
        const status = entries[i].slice(0, 2);
        const file = entries[i].slice(3);
        if (status[0] === "R" || status[0] === "C") i++; // skip the rename's source path
        if (IGNORED.some(re => re.test(file))) continue;
        const full = path.join(ROOT, file);
        files[file] = fs.existsSync(full)
            ? crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex")
            : "deleted";
    }
    return files;
}

function snapshotPath(sessionId) {
    return path.join(os.tmpdir(), `claude-turn-guard-${sessionId || "default"}.json`);
}

function isListening(port) {
    return new Promise(resolve => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        socket.setTimeout(500);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("timeout", () => { socket.destroy(); resolve(false); });
        socket.once("error", () => resolve(false));
    });
}

async function ensureSiteOpen(sessionId) {
    const openedMarker = path.join(os.tmpdir(), `claude-turn-guard-${sessionId || "default"}.opened`);
    const serverUp = await isListening(PORT);
    if (serverUp && fs.existsSync(openedMarker)) return;

    if (!serverUp) await startServer();
    spawn("cmd", ["/c", "start", "", OPEN_URL], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    fs.writeFileSync(openedMarker, "");
}

async function startServer() {
    const server = spawn(process.execPath, [path.join(__dirname, "static-server.js"), String(PORT)], {
        cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true
    });
    server.unref();

    for (let i = 0; i < 20 && !(await isListening(PORT)); i++) {
        await new Promise(r => setTimeout(r, 150));
    }
}

async function main() {
    const mode = process.argv[2];
    const input = readStdin();
    const file = snapshotPath(input.session_id);

    if (mode === "snapshot") {
        fs.writeFileSync(file, JSON.stringify(dirtyFiles()));
        return;
    }

    if (mode !== "stop" || !fs.existsSync(file)) return;

    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const after = dirtyFiles();
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(f => before[f] !== after[f]);
    if (changed.length === 0) return;

    await ensureSiteOpen(input.session_id);

    if (!changed.includes("CLAUDE.md") && !input.stop_hook_active) {
        process.stdout.write(JSON.stringify({
            decision: "block",
            reason: `Files changed this turn (${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", ..." : ""}) but CLAUDE.md wasn't updated. ` +
                "Per the project rule, update CLAUDE.md to reflect these changes (new features, changed behaviour, new files/conventions), " +
                "or, if they genuinely don't affect anything it documents, say so briefly and stop."
        }));
    }
}

main().catch(err => {
    process.stderr.write(`turn-guard: ${err.message}\n`);
});
