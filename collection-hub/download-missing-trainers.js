// One-off utility: fills in cards/trainers/ with any sprite images missing
// for trainers listed in cards-trainers-backup.json, pulled from Pokemon
// Showdown's trainer sprite CDN (same naming convention the site already
// uses: lowercase, non-alphanumeric characters stripped).
const fs = require("fs");
const path = require("path");
const https = require("https");

const backupFile = path.join(__dirname, "cards-trainers-backup.json");
const trainersFolder = path.join(__dirname, "cards", "trainers");
const baseUrl = "https://play.pokemonshowdown.com/sprites/trainers/";

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function download(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }

            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        }).on("error", reject);
    });
}

async function main() {
    const items = JSON.parse(fs.readFileSync(backupFile, "utf8"));

    const downloaded = [];
    const skipped = [];
    const notFound = [];

    for (const item of items) {

        const norm = normalizeName(item.name);
        const destPath = path.join(trainersFolder, `${norm}.png`);

        if (fs.existsSync(destPath)) {
            skipped.push(item.name);
            continue;
        }

        const data = await download(`${baseUrl}${norm}.png`);

        if (!data) {
            notFound.push(item.name);
            continue;
        }

        fs.writeFileSync(destPath, data);
        downloaded.push(item.name);
    }

    console.log(`Downloaded (${downloaded.length}):`, downloaded);
    console.log(`Already had (${skipped.length})`);
    console.log(`Not found on Showdown (${notFound.length}):`, notFound);
}

main();
