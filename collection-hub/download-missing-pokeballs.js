// One-off utility: fills in cards/pokeballs/ with any sprite images missing
// for balls listed in cards-pokeballs-backup.json, pulled from the PokeAPI
// sprites CDN. Filenames there use hyphenated names (e.g. "level-ball.png"),
// while the site expects normalized names (e.g. "levelball.png") per the
// same convention getItemImagePath() already uses: lowercase, non-alphanumeric
// characters stripped.
const fs = require("fs");
const path = require("path");
const https = require("https");

const backupFile = path.join(__dirname, "cards-pokeballs-backup.json");
const pokeballsFolder = path.join(__dirname, "cards", "pokeballs");
const baseUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// "Love Ball" -> "love-ball", "Team Rocket's Great Ball" -> "team-rockets-great-ball"
function toPokeApiSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
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
        const destPath = path.join(pokeballsFolder, `${norm}.png`);

        if (fs.existsSync(destPath)) {
            skipped.push(item.name);
            continue;
        }

        const slug = toPokeApiSlug(item.name);
        const data = await download(`${baseUrl}${slug}.png`);

        if (!data) {
            notFound.push(item.name);
            continue;
        }

        fs.writeFileSync(destPath, data);
        downloaded.push(item.name);
    }

    console.log(`Downloaded (${downloaded.length}):`, downloaded);
    console.log(`Already had (${skipped.length})`);
    console.log(`Not found (${notFound.length}):`, notFound);
}

main();
