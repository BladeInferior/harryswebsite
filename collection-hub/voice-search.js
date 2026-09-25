// Adds a 🎤 button to #search-row (between the input and #clear-search) that
// dictates into #search via the browser's built-in Web Speech API. Every
// page's search logic already listens for the input's "input" event, so this
// just sets the value and fires that event — no page-specific wiring needed.
// Browsers without speech recognition (e.g. Firefox) never get the button.
//
// One click keeps listening until clicked again, or until you say "stop"
// (which is never added to the search). Spoken words are appended to
// whatever's already in the box as comma-separated terms — every page this
// is on treats a comma as "match any of these". On the Pokédex (which sets
// window.voiceSearchNames) each term is snapped to the closest real name —
// see matchSpokenTerms(). Elsewhere, exact Pokémon names are split out and
// other words kept as heard — see splitLooseTerms().

// Turns a list of spoken words into search terms, snapping each to the
// closest real Pokémon name by spelling or sound (speech often hears "Sligo"
// for Sliggoo, or "sorrow arc" for Zoroark). Type names ("fire") are kept
// too. Words that can't be placed — including a region ("Hisuian") with no
// Pokémon after it — are returned separately as `missed`, never as terms.
const voiceSearchMatcher = (() => {
    const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const toWords = text => text.replace(/[.,!?]/g, " ").split(/\s+/).filter(Boolean);

    // Speech tends to say the region name ("Hisui"), or split the adjective
    // into "Hisui and"; both mean the regional-form prefix.
    const REGIONS = {
        alola: "Alolan", alolan: "Alolan",
        galar: "Galarian", galarian: "Galarian",
        hisui: "Hisuian", hisuian: "Hisuian",
        paldea: "Paldean", paldean: "Paldean"
    };
    const FILLER_AFTER_REGION = new Set(["and", "an", "in", "on", "n"]);
    // Said between names, not meant as search terms ("pikachu and raichu").
    const DROPPED = new Set(["and", "comma", "then", "um", "uh"]);
    const ALIASES = { mister: "mr", junior: "jr" };
    const TYPES = new Set(["normal", "fire", "water", "grass", "electric", "ice",
        "fighting", "poison", "ground", "flying", "psychic", "bug", "rock",
        "ghost", "dragon", "dark", "steel", "fairy"]);
    const MAX_NAME_WORDS = 3;

    // How many letters out a spoken word can be and still snap to a name —
    // stricter for short words, where one letter is a big change.
    function tolerance(length) {
        if (length <= 3) return 0;
        if (length <= 4) return 1;
        if (length <= 10) return 2;
        return 3;
    }

    // Rough "how it sounds" key: letters that sound alike are merged and
    // vowels after the first letter dropped, so "sorrow arc" and "Zoroark"
    // both become "srk". Used only when spelling alone finds nothing.
    function soundKey(key) {
        let s = key
            .replace(/ph/g, "f").replace(/gh/g, "g").replace(/ck/g, "k")
            .replace(/[cs]h/g, "%")
            .replace(/[cq]/g, "k").replace(/x/g, "ks").replace(/z/g, "s")
            .replace(/%/g, "x");
        const first = /[aeiouy]/.test(s[0]) ? "a" : s[0];
        s = first + s.slice(1).replace(/[aeiouyhw]/g, "");
        return s.replace(/(.)\1+/g, "$1");
    }

    // Shortest sound key trusted for a match — two-letter keys ("sr", "mw")
    // match far too many names.
    const MIN_SOUND_KEY = 3;
    // Rank given to a sound-alike match: worse than any spelling match.
    const SOUND_MATCH_DIST = 99;

    function distance(a, b, cap = 3) {
        if (Math.abs(a.length - b.length) > cap) return Infinity;
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length];
    }

    // Closest entry by spelling within maxDist letters, falling back to one
    // that sounds the same (ties broken by spelling). The sound fallback is
    // skipped when what was said is the start of a real name ("charm"), since
    // that's a partial search, not a mishearing.
    function closest(spokenKey, entries, maxDist) {
        let best = null;
        let bestDist = maxDist + 1;
        for (const entry of entries) {
            const d = entry.key === spokenKey ? 0 : distance(spokenKey, entry.key);
            if (d < bestDist) {
                best = entry;
                bestDist = d;
                if (d === 0) break;
            }
        }
        if (best) return { ...best, dist: bestDist };

        const spokenSound = soundKey(spokenKey);
        if (spokenSound.length < MIN_SOUND_KEY) return null;
        if (entries.some(entry => entry.key.startsWith(spokenKey))) return null;
        let soundBest = null;
        let soundBestDist = Infinity;
        for (const entry of entries) {
            if (entry.sound !== spokenSound) continue;
            const d = distance(spokenKey, entry.key, Infinity);
            if (d < soundBestDist) {
                soundBest = entry;
                soundBestDist = d;
            }
        }
        return soundBest && { ...soundBest, dist: SOUND_MATCH_DIST };
    }

    let indexFor = null;
    let index = null;

    function entryFor(name, keyText) {
        const key = normalize(keyText);
        return { name, key, sound: soundKey(key) };
    }

    function buildIndex(names) {
        if (indexFor === names) return index;
        const entries = names.map(name => entryFor(name, name));
        index = {
            all: entries,
            exact: new Set(entries.map(e => e.key)),
            byKey: new Map(entries.map(e => [e.key, e.name])),
            byRegion: Object.fromEntries([...new Set(Object.values(REGIONS))].map(region =>
                [region, names
                    .filter(name => name.startsWith(region + " "))
                    .map(name => entryFor(name, name.slice(region.length)))]
            ))
        };
        indexFor = names;
        return index;
    }

    // Region prefix starting at words[i], possibly split across words by
    // speech ("his UI and" → Hisuian) or a letter off ("Hisuyan"). Returns
    // the region and the index of the first word after it.
    function findRegion(words, i) {
        for (let n = Math.min(3, words.length - i); n >= 1; n--) {
            let key = normalize(words.slice(i, i + n).join(""));
            if (n > 1 && key.endsWith("and")) key = key.slice(0, -3);
            const exact = REGIONS[key];
            if (exact) return { region: exact, next: i + n };
            if (key.length >= 5) {
                const near = Object.keys(REGIONS).find(r =>
                    r.length >= 5 && distance(key, r) <= (r.length >= 7 ? 2 : 1));
                if (near) return { region: REGIONS[near], next: i + n };
            }
        }
        return null;
    }

    function matchSpokenTerms(rawWords, names) {
        const idx = buildIndex(names);
        const words = rawWords.map(w => ALIASES[normalize(w)] || w);
        const terms = [];
        const missed = [];
        let lastWasMissed = false;
        let trailingRegion = "";
        let i = 0;

        while (i < words.length) {
            const key = normalize(words[i]);

            if (!key || DROPPED.has(key)) { i++; continue; }

            // "Hisui (and) sligu" → Hisuian Sliggoo. The species is only
            // compared against that region's own forms, a small enough set
            // to allow one extra letter of slack, plus sound-alikes.
            const regionHit = findRegion(words, i);
            if (regionHit) {
                const region = regionHit.region;
                let j = regionHit.next;
                if (j < words.length && FILLER_AFTER_REGION.has(normalize(words[j]))) j++;
                let matched = null;
                for (let n = Math.min(2, words.length - j); n >= 1 && !matched; n--) {
                    const speciesKey = normalize(words.slice(j, j + n).join(""));
                    const hit = closest(speciesKey, idx.byRegion[region], tolerance(speciesKey.length) + 1);
                    if (hit) matched = { name: hit.name, next: j + n };
                }
                if (matched) {
                    terms.push(matched.name);
                    i = matched.next;
                    lastWasMissed = false;
                } else if (j >= words.length) {
                    // Region as the very last thing heard — likely a pause
                    // before the species, which the browser can send as the
                    // next phrase. Handed back so the caller can prepend it.
                    trailingRegion = words.slice(i).join(" ");
                    i = j;
                } else {
                    // A region with no species after it isn't a Pokémon, so
                    // it's reported as missed rather than searched for.
                    const heard = words.slice(i, j).join(" ");
                    if (lastWasMissed) missed[missed.length - 1] += " " + heard;
                    else missed.push(heard);
                    i = j;
                    lastWasMissed = true;
                }
                continue;
            }

            // Tries this word alone and joined with the next one or two:
            // real multi-word names ("Tapu Koko", "Iron Moth", "Ho-Oh"), and
            // single names speech split into English words ("gira teena",
            // "zorro ark"). The closest fit wins, fewer words on a tie, so a
            // following word isn't swallowed ("tapu koko ho oh" must not read
            // "tapukokoho" as a near-miss for Tapu Koko). A word that's
            // itself a real name or type is never joined onto another. A type
            // on its own ("fire") stays a type search, but can still start a
            // name ("dragon ite" → Dragonite).
            let best = null;
            for (let n = 1; n <= Math.min(MAX_NAME_WORDS, words.length - i); n++) {
                const group = words.slice(i, i + n).map(normalize);
                const last = group[n - 1];
                if (n > 1 && (idx.exact.has(last) || TYPES.has(last))) break;
                if (n === 1 && TYPES.has(key)) {
                    best = { name: key, dist: 1, n: 1 };
                    continue;
                }
                const joinedKey = group.join("");
                const hit = closest(joinedKey, idx.all, tolerance(joinedKey.length));
                if (hit && (!best || hit.dist < best.dist)) best = { name: hit.name, dist: hit.dist, n };
                if (best?.dist === 0) break;
            }

            if (best) {
                terms.push(best.name);
                i += best.n;
            } else {
                // Consecutive unplaceable words are reported as one phrase.
                if (lastWasMissed) missed[missed.length - 1] += " " + words[i];
                else missed.push(words[i]);
                i++;
                lastWasMissed = true;
                continue;
            }
            lastWasMissed = false;
        }
        return { terms, missed, trailingRegion };
    }

    // For the other collection pages, whose searches cover more than
    // Pokémon (sleeve words like "etb", "ultra pro", "shiny"). Only exact
    // Pokémon names (up to MAX_NAME_WORDS words, "galarian ponyta") are split
    // out as their own terms — no near-miss or sound-alike snapping, which
    // would "correct" ordinary words ("shiny" → Shinx). Everything else is
    // kept as heard, consecutive words together as one phrase. "and" next to
    // a name is dropped ("zapdos and articuno"), but kept inside a phrase.
    function splitLooseTerms(rawWords, names) {
        const idx = buildIndex(names);
        const terms = [];
        let phrase = [];

        const flushPhrase = () => {
            while (phrase.length && normalize(phrase[phrase.length - 1]) === "and") phrase.pop();
            if (phrase.length) terms.push(phrase.join(" "));
            phrase = [];
        };

        let i = 0;
        while (i < rawWords.length) {
            const key = normalize(rawWords[i]);
            if (!key || (DROPPED.has(key) && key !== "and")) { i++; continue; }
            if (key === "and" && phrase.length === 0) { i++; continue; }

            let name = null;
            let taken = 0;
            for (let n = Math.min(MAX_NAME_WORDS, rawWords.length - i); n >= 1 && !name; n--) {
                name = idx.byKey.get(normalize(rawWords.slice(i, i + n).join(""))) || null;
                if (name) taken = n;
            }

            if (name) {
                flushPhrase();
                terms.push(name);
                i += taken;
            } else {
                phrase.push(rawWords[i]);
                i++;
            }
        }
        flushPhrase();
        return terms;
    }

    return { normalize, toWords, matchSpokenTerms, splitLooseTerms };
})();

if (typeof module !== "undefined") module.exports = voiceSearchMatcher;

(function () {
    if (typeof window === "undefined") return;
    const { normalize, toWords, matchSpokenTerms, splitLooseTerms } = voiceSearchMatcher;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const searchInput = document.getElementById("search");
    const searchRow = document.getElementById("search-row");
    if (!SpeechRecognition || !searchInput || !searchRow) return;

    const MIC_TITLE = "Search by voice (click again, or say \"stop\", to stop)";

    const micBtn = document.createElement("span");
    micBtn.id = "voice-search";
    micBtn.textContent = "🎤";
    micBtn.title = MIC_TITLE;
    searchRow.insertBefore(micBtn, document.getElementById("clear-search"));

    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.interimResults = true;
    recognition.continuous = true;
    // The browser's backup guesses for each phrase — pickBestAlternative()
    // chooses whichever lines up with the most real names.
    recognition.maxAlternatives = 5;

    // The raw words the browser heard, shown in the mic's hover tooltip so a
    // miss can be traced back to what was actually heard.
    const heardLog = [];
    const HEARD_LOG_SIZE = 5;

    function logHeard(raw, { terms: found, missed }) {
        const outcome = [found.join(", "), missed.length ? `missed: ${missed.join(", ")}` : ""]
            .filter(Boolean).join(" | ") || "(nothing)";
        heardLog.push(`"${raw.trim()}" → ${outcome}`);
        if (heardLog.length > HEARD_LOG_SIZE) heardLog.shift();
        micBtn.title = `${MIC_TITLE}\n\nRecently heard:\n${heardLog.join("\n")}`;
        console.info("[voice search] heard", JSON.stringify(raw.trim()), "→", found, missed.length ? { missed } : "");
    }

    // Brief note when spoken words couldn't be matched to a Pokémon — they're
    // left out of the search, so this is the cue to just say the name again
    // (listening carries on). Laid directly over the search toggles row
    // (#search-evolutions-row) where there is one, else just under the
    // search bar; positioned on show since those rows are placed from JS.
    const notice = document.createElement("div");
    notice.id = "voice-search-notice";
    notice.hidden = true;
    document.body.appendChild(notice);
    let noticeTimer = null;

    function positionNotice() {
        const targetRect = document.getElementById("search-evolutions-row")?.getBoundingClientRect();
        const anchor = targetRect && targetRect.height > 0 ? targetRect : null;
        const wrapper = document.getElementById("search-wrapper").getBoundingClientRect();
        const rect = anchor || { top: wrapper.bottom + 6, left: wrapper.left, width: wrapper.width, height: 0 };
        notice.style.top = `${rect.top}px`;
        notice.style.left = `${rect.left}px`;
        notice.style.width = `${rect.width}px`;
        notice.style.minHeight = `${rect.height}px`;
    }

    function showMissed(missed) {
        if (!missed.length) return;
        notice.textContent = `Didn't catch "${missed.join("\", \"")}" — say it again`;
        positionNotice();
        notice.hidden = false;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
    }

    let listening = false;
    let terms = [];        // committed terms (existing box text + finished speech)
    let resultOffset = 0;  // results already folded into `terms` this session
    let carriedRegion = ""; // region said at the end of the last phrase, e.g. "Hisuian" before a pause

    // The Pokédex sets window.voiceSearchNames: every term must be a real
    // Pokémon (near-misses snapped, anything else reported as missed).
    // Elsewhere, only exact Pokémon names are split out and nothing is ever
    // missed — see splitLooseTerms(). pokedexes.js loads after this script,
    // so this is checked when needed, not once up front.
    function strictMode() {
        return Array.isArray(window.voiceSearchNames);
    }

    // Name list for splitLooseTerms(), fetched on first use of the mic.
    // Until it arrives, speech still works — it just isn't split on names.
    let looseNames = null;
    let looseNamesRequested = false;

    function loadLooseNames() {
        if (strictMode() || looseNamesRequested) return;
        looseNamesRequested = true;
        fetch("../fullPokemonList.json")
            .then(res => res.json())
            .then(list => { looseNames = list.map(p => p.name); })
            .catch(() => { looseNamesRequested = false; });
    }

    // { terms, missed, trailingRegion }
    function splitIntoTerms(text) {
        const words = toWords(text);
        if (strictMode()) return matchSpokenTerms(words, window.voiceSearchNames);
        return { terms: splitLooseTerms(words, looseNames || []), missed: [] };
    }

    // Of the browser's guesses for one phrase, the one that places the most
    // words as names (fewest missed on a tie, then the top guess).
    function pickBestAlternative(result) {
        const alternatives = Array.from(result, alt => alt.transcript);
        if (!strictMode() || alternatives.length < 2) return alternatives[0];

        let best = alternatives[0];
        let bestScore = -Infinity;
        for (const text of alternatives) {
            const { terms: found, missed } = splitIntoTerms(text);
            const score = found.length * 10 - missed.length;
            if (score > bestScore) {
                best = text;
                bestScore = score;
            }
        }
        return best;
    }

    let rendering = false;

    function render(interimText) {
        const all = [...terms, ...splitIntoTerms(interimText || "").terms];
        searchInput.value = all.join(", ");
        rendering = true;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        rendering = false;
    }

    function stop() {
        listening = false;
        carriedRegion = "";
        micBtn.classList.remove("listening");
        recognition.stop();
    }

    recognition.addEventListener("result", (e) => {
        // Results for the utterance that contained "stop" can still arrive
        // after stop() — ignore them.
        if (!listening) return;

        let interim = carriedRegion;
        for (let i = resultOffset; i < e.results.length; i++) {
            const text = e.results[i][0].transcript;

            // Acts on interim results too, so it stops as soon as "stop" is
            // heard rather than after the browser's end-of-phrase pause.
            const words = toWords(text);
            const stopIdx = words.findIndex(w => normalize(w) === "stop");
            if (stopIdx !== -1) {
                const beforeStop = interim + " " + words.slice(0, stopIdx).join(" ");
                const split = splitIntoTerms(beforeStop);
                // Nothing more is coming, so a trailing region is a miss.
                if (split.trailingRegion) split.missed.push(split.trailingRegion);
                if (split.terms.length || split.missed.length) logHeard(beforeStop, split);
                showMissed(split.missed);
                terms.push(...split.terms);
                render("");
                stop();
                return;
            }

            if (e.results[i].isFinal) {
                const chosen = carriedRegion + " " + pickBestAlternative(e.results[i]);
                const split = splitIntoTerms(chosen);
                logHeard(chosen, split);
                showMissed(split.missed);
                terms.push(...split.terms);
                carriedRegion = split.trailingRegion || "";
                interim = carriedRegion;
                resultOffset = i + 1;
            } else {
                interim += " " + text;
            }
        }
        render(interim);
    });

    // Browsers end a session on their own after a stretch of silence —
    // restart it so listening only stops when the button is clicked again.
    recognition.addEventListener("end", () => {
        resultOffset = 0;
        if (!listening) return;
        try {
            recognition.start();
        } catch {
            stop();
        }
    });

    recognition.addEventListener("error", (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            micBtn.title = "Microphone access was blocked";
            stop();
        }
    });

    function termsFromBox() {
        return searchInput.value.split(",").map(t => t.trim()).filter(Boolean);
    }

    // Any change to the box mid-dictation that didn't come from render() —
    // typing, ✕ (which empties it), removing a term from the search-terms
    // dropdown — becomes the new base that later speech is appended to,
    // rather than being overwritten.
    searchInput.addEventListener("input", () => {
        if (listening && !rendering) terms = termsFromBox();
    });
    document.getElementById("clear-search")?.addEventListener("click", () => {
        terms = [];
    });

    micBtn.addEventListener("click", () => {
        if (listening) {
            stop();
            return;
        }

        loadLooseNames();
        terms = termsFromBox();
        carriedRegion = "";
        resultOffset = 0;

        try {
            recognition.start();
            listening = true;
            micBtn.classList.add("listening");
        } catch {
            // start() throws if a previous session hasn't fully ended yet.
        }
    });
})();
