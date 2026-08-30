// One-off utility: downloads the 18 Pokemon type badge icons (Scarlet/Violet
// style, from the PokeAPI sprites CDN) into icons/types/ for use as the small
// logos in the pokedex's type-filter popup.
const fs = require("fs");
const path = require("path");
const https = require("https");

const typesFolder = path.join(__dirname, "icons", "types");
const baseUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/types/generation-ix/scarlet-violet/";

// PokeAPI type ids -> lowercase names, matching how fullPokemonList.json's
// "type" field normalizes (see pokedexes.js: toLowerCase().split(",")).
const types = {
    1: "normal", 2: "fighting", 3: "flying", 4: "poison", 5: "ground",
    6: "rock", 7: "bug", 8: "ghost", 9: "steel", 10: "fire",
    11: "water", 12: "grass", 13: "electric", 14: "psychic", 15: "ice",
    16: "dragon", 17: "dark", 18: "fairy"
};

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
    fs.mkdirSync(typesFolder, { recursive: true });

    const downloaded = [];
    const skipped = [];
    const notFound = [];

    for (const [id, name] of Object.entries(types)) {

        const destPath = path.join(typesFolder, `${name}.png`);

        if (fs.existsSync(destPath)) {
            skipped.push(name);
            continue;
        }

        const data = await download(`${baseUrl}${id}.png`);

        if (!data) {
            notFound.push(name);
            continue;
        }

        fs.writeFileSync(destPath, data);
        downloaded.push(name);
    }

    console.log(`Downloaded (${downloaded.length}):`, downloaded);
    console.log(`Already had (${skipped.length}):`, skipped);
    console.log(`Not found (${notFound.length}):`, notFound);
}

main();
