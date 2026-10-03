// One-off scraper: builds plza-distortions.json from Serebii's Pokémon
// Legends: Z-A Hyperspace Wild Zone pages, one per type plus the Legendary/
// special page. Re-run manually any time Serebii updates those pages (e.g. a
// DLC wave) — see "Asset-download scripts" in CLAUDE.md for the convention
// this follows.
//
// Output shape: { "<Pokemon name>": [{ star, mates: [...other names] }, ...] }
// — one entry per distinct Hyperspace Wild Zone cluster that pokemon spawns
// in, "mates" being every other pokemon sharing that same cluster (so the
// Pokédex's "Combinations" modal can show, for any one pokemon, every
// distortion combo it's actually found in). A cluster with nothing else in
// it (a solo spawn) still gets an entry with mates: [] — needed so that
// pokemon's star rating still shows up on its card (see plzaDistortions in
// pokedexes.js), even though there's nothing to list in Combinations for it.
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting",
    "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
    "dragon", "dark", "steel", "fairy"
];

const PAGES = [...TYPES, "special"].map(
    key => `https://www.serebii.net/legendsz-a/hyperspacewildzone/${key}.shtml`
);

// Serebii's icon filenames suffix regional forms (e.g. "105-a.png" for
// Alolan Marowak) rather than saying so in the alt text/link, which just
// reads "Marowak" either way — matches this site's own fullPokemonList.json
// convention of naming the form outright ("Alolan Marowak").
const FORM_PREFIX = { a: "Alolan", g: "Galarian", h: "Hisuian", p: "Paldean" };

// Strips diacritics too (é -> e) — fullPokemonList.json spells accented
// names in plain ASCII (e.g. "Flabebe", not "Flabébé"), unlike Serebii.
function normalizeName(name) {
    return name
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

const NAMED_ENTITIES = { eacute: "é", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä", amp: "&", apos: "'", quot: '"' };

function decodeEntities(str) {
    return str.replace(/&(#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, _all, dec, hex, name) => {
        if (dec) return String.fromCharCode(Number(dec));
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        return NAMED_ENTITIES[name.toLowerCase()] || match;
    });
}

// Only the "Spawns" roster's own sprites carry class="wildsprite" — the
// Focus trio above it uses a plain 100px icon with no class at all, and is
// a subset of Spawns anyway (Spawns also includes pre-evolutions Focus
// skips, e.g. Cubone alongside a spawned Marowak), so Focus is ignored
// entirely rather than double-counted.
const WILDSPRITE_RE = /<img src="\/legendsz-a\/pokemon\/\d+(-[a-z]+)?\.png"[^>]*class="wildsprite"[^>]*alt="([^"]+)"/g;
const STAR_SECTION_RE = /<a name="(\d)star">/g;
const CLUSTER_RE = /Hyperspace Wild Zone \d+/g;

async function fetchPage(url) {
    const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 20000
    });
    return res.data;
}

function resolveName(rawAltName, formSuffix, canonicalByKey) {
    const altName = decodeEntities(rawAltName);
    const letter = formSuffix ? formSuffix.slice(1) : null;
    const prefix = letter ? FORM_PREFIX[letter] : null;

    // Icon suffix letters double up for non-regional form variants too
    // (Rotom's appliance forms, Vivillon's patterns, etc.) — only actually
    // prefix the name when that gives a Pokémon this site's own
    // fullPokemonList.json already tracks separately (e.g. "Alolan
    // Marowak"); otherwise it's the same base species this list only tracks
    // under its plain name, regardless of which form happened to spawn.
    const candidate = prefix ? `${prefix} ${altName}` : altName;
    return prefix && canonicalByKey.has(normalizeName(candidate)) ? candidate : altName;
}

// Returns [{ name, star, mates: [names] }], one entry per (pokemon, cluster)
// pair found on this page.
function parsePage(html, canonicalByKey) {
    const starMarkers = [];
    let m;
    STAR_SECTION_RE.lastIndex = 0;
    while ((m = STAR_SECTION_RE.exec(html))) {
        starMarkers.push({ star: Number(m[1]), index: m.index });
    }

    const results = [];

    starMarkers.forEach((marker, i) => {
        const sectionEnd = i + 1 < starMarkers.length ? starMarkers[i + 1].index : html.length;
        const section = html.slice(marker.index, sectionEnd);

        const clusterStarts = [];
        let c;
        CLUSTER_RE.lastIndex = 0;
        while ((c = CLUSTER_RE.exec(section))) {
            clusterStarts.push(c.index);
        }

        clusterStarts.forEach((startIdx, ci) => {
            const endIdx = ci + 1 < clusterStarts.length ? clusterStarts[ci + 1] : section.length;
            const cluster = section.slice(startIdx, endIdx);

            const roster = [];
            let entry;
            WILDSPRITE_RE.lastIndex = 0;
            while ((entry = WILDSPRITE_RE.exec(cluster))) {
                const [, formSuffix, rawAltName] = entry;
                const name = resolveName(rawAltName, formSuffix, canonicalByKey);
                if (!roster.includes(name)) roster.push(name);
            }

            roster.forEach(name => {
                results.push({ name, star: marker.star, mates: roster.filter(n => n !== name) });
            });
        });
    });

    return results;
}

async function main() {
    // Prefer fullPokemonList.json's exact casing/name when it matches the
    // same normalized key, so the output lines up with how this site's own
    // Pokédex data already spells every name.
    const fullListPath = path.join(__dirname, "fullPokemonList.json");
    const fullList = JSON.parse(fs.readFileSync(fullListPath, "utf8"));
    const canonicalByKey = new Map(fullList.map(p => [normalizeName(p.name), p.name]));

    const byName = new Map(); // normalized -> { name, combos: Map(signature -> {star, mates}) }

    for (const url of PAGES) {
        console.log(`Fetching ${url}`);
        let html;
        try {
            html = await fetchPage(url);
        } catch (err) {
            console.error(`  Failed: ${err.message}`);
            continue;
        }

        parsePage(html, canonicalByKey).forEach(({ name, star, mates }) => {
            const key = normalizeName(name);
            if (!byName.has(key)) byName.set(key, { name, combos: new Map() });

            // A dual-type pokemon's cluster can appear verbatim on more than
            // one type page (once per type it has) — same star + same mates
            // is the same real in-game cluster, so it's only kept once.
            const signature = `${star}|${[...mates].sort().join("\u0000")}`;
            const entryCombos = byName.get(key).combos;
            if (!entryCombos.has(signature)) entryCombos.set(signature, { star, mates });
        });
    }

    const unmatched = [];
    const output = {};

    Array.from(byName.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(({ name, combos }) => {
            const key = normalizeName(name);
            const canonical = canonicalByKey.get(key);
            if (!canonical) unmatched.push(name);

            const comboList = Array.from(combos.values())
                .sort((a, b) => a.star - b.star || a.mates.join().localeCompare(b.mates.join()));

            output[canonical || name] = comboList;
        });

    const outPath = path.join(__dirname, "plza-distortions.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

    console.log(`\nWrote ${Object.keys(output).length} pokemon to ${outPath}`);
    if (unmatched.length) {
        console.log(`\n${unmatched.length} name(s) had no match in fullPokemonList.json — check spelling/form:`);
        unmatched.forEach(n => console.log(`  - ${n}`));
    }
}

main();
