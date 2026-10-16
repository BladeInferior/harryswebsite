// Adds a 🎤 button to #search-row (between the input and #clear-search) that
// dictates into #search via the browser's built-in Web Speech API. Every
// page's search logic already listens for the input's "input" event, so this
// just sets the value and fires that event — no page-specific wiring needed.
// Browsers without speech recognition (e.g. Firefox) never get the button.
// Saying "clear" empties the box. On the Pokédex, a phrase the recognizer
// struggled with (the guess flickered between names, or part couldn't be
// placed) pops up a "Did you mean…?" picker of up to three candidates.
// Other inputs get their own mic via window.attachVoiceSearch() (e.g. the
// Pokédex's Add To Do box); only one mic dictates at a time, and
// window.stopVoiceSearch() stops whichever is on.
//
// One click keeps listening until clicked again, or until you say "stop"
// (which is never added to the search). Saying "back" removes the most
// recently added term without stopping the mic — neither word is ever added
// to the search itself. Spoken words are appended to whatever's already in
// the box as comma-separated terms — every page this is on treats a comma as
// "match any of these". On the Pokédex (which sets window.voiceSearchNames)
// each term is snapped to the closest real name — see matchSpokenTerms().
// Elsewhere, exact Pokémon names are split out and other words kept as heard
// — see splitLooseTerms().

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

    // Region prefixes starting at words[i], best first, possibly split across
    // words by speech ("his UI and" → Hisuian) or heard as something close
    // ("alone", "a low and"). Each is { region, next } where next is the index
    // of the first word after it. Loose candidates are only ever accepted by
    // the caller when a real species of that region follows, so they can be
    // generous about spelling.
    function findRegions(words, i, exactNames) {
        const out = [];
        for (let n = Math.min(3, words.length - i); n >= 1; n--) {
            let key = normalize(words.slice(i, i + n).join(""));
            if (n > 1 && key.endsWith("and")) key = key.slice(0, -3);
            const exact = REGIONS[key];
            if (exact) { out.push({ region: exact, next: i + n, loose: false }); continue; }
            if (key.length < 4 || exactNames.has(key)) continue;
            let bestRegion = null;
            let bestDist = Infinity;
            for (const r of Object.keys(REGIONS)) {
                if (r.length < 5) continue;
                const d = distance(key, r, 5);
                if (d < bestDist) { bestDist = d; bestRegion = r; }
            }
            const limit = key.length >= 8 ? 4 : key.length >= 5 ? 3 : 2;
            if (bestRegion && bestDist <= limit) {
                out.push({ region: REGIONS[bestRegion], next: i + n, loose: true });
            }
        }
        // Exact spellings first, then the closest loose ones (longer span first).
        return out.sort((a, b) => a.loose - b.loose);
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
            let regionHandled = false;
            const regionHits = findRegions(words, i, idx.exact);
            for (const regionHit of regionHits) {
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
                    regionHandled = true;
                    break;
                }
                if (regionHit.loose) continue;
                if (j >= words.length) {
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
                regionHandled = true;
                break;
            }
            if (regionHandled) continue;

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

    // "regional": swaps a term for its regional form. Already regional →
    // the next form of the same species (Meowth: Alolan → Galarian → Alolan).
    // Returns null when the species has no regional form.
    const REGION_PREFIX = /^(Alolan|Galarian|Hisuian|Paldean) /;
    function regionalVariant(term, names) {
        const base = term.replace(REGION_PREFIX, "");
        const forms = names.filter(n => REGION_PREFIX.test(n) && n.replace(REGION_PREFIX, "") === base);
        if (!forms.length) return null;
        const at = forms.indexOf(term);
        return forms[(at + 1) % forms.length];
    }

    // Closest real names to whatever was said, best first — for the "Did you
    // mean…?" picker. Unlike matchSpokenTerms() there's no cut-off, so it
    // always has a best guess even for words that couldn't be placed. Ranked
    // by spelling distance or sound-alike (whichever is closer); a name that
    // starts with, or contains, what was said counts as very close.
    function rankNear(spokenWords, names, count) {
        const key = normalize(spokenWords.filter(w => !DROPPED.has(normalize(w))).join(""));
        if (key.length < 2) return [];
        const spokenSound = soundKey(key);
        return buildIndex(names).all
            .map(entry => {
                let score = Math.min(distance(key, entry.key, Infinity),
                    distance(spokenSound, entry.sound, Infinity) * 1.5);
                if (key.length >= 3 && entry.key.includes(key)) score = Math.min(score, 0.5);
                return { name: entry.name, score };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, count)
            .map(r => r.name);
    }

    return { normalize, toWords, matchSpokenTerms, splitLooseTerms, regionalVariant, rankNear };
})();

if (typeof module !== "undefined") module.exports = voiceSearchMatcher;

(function () {
    if (typeof window === "undefined") return;
    const { normalize, toWords, matchSpokenTerms, splitLooseTerms } = voiceSearchMatcher;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    const MIC_TITLE = "Search by voice (click again, or say \"stop\", to stop; say \"back\" to undo the last one; \"pause\" mutes every command until you say \"unpause\")";
    const HEARD_LOG_SIZE = 5;

    // Every mic on the page — only one may dictate at a time, so starting
    // one (or window.stopVoiceSearch()) stops the rest.
    const controllers = [];

    function stopAll() {
        controllers.forEach(c => c.stop());
    }

    // The Pokédex sets window.voiceSearchNames: every term must be a real
    // Pokémon (near-misses snapped, anything else reported as missed).
    // Elsewhere, only exact Pokémon names are split out and nothing is ever
    // missed — see splitLooseTerms(). pokedexes.js loads after this script,
    // so this is checked when needed, not once up front.
    function strictMode() {
        return Array.isArray(window.voiceSearchNames);
    }

    // Name list for splitLooseTerms(), fetched on first use of a mic.
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
    const REGIONAL_WORDS = new Set(["regional", "regionals", "region"]);

    function splitIntoTerms(text) {
        const words = toWords(text);
        if (strictMode()) return matchSpokenTerms(words, window.voiceSearchNames);
        return { terms: splitLooseTerms(words, looseNames || []), missed: [] };
    }

    // How well a guess lines up with real names: each name is worth 10, a
    // regional form 6 more, each unplaced word costs 1.
    function interimScore(text) {
        const { terms: found, missed } = splitIntoTerms(text);
        const regional = found.filter(t => /^(Alolan|Galarian|Hisuian|Paldean) /.test(t)).length;
        return found.length * 10 + regional * 6 - missed.length;
    }

    // Of the browser's guesses for one phrase, the one that places the most
    // words as names (fewest missed on a tie, then the top guess).
    // `shown` is what the box was last displaying for this phrase while it was
    // still interim: it's tried first and only displaced by a guess that
    // places strictly more names, so a Pokémon that's already appeared doesn't
    // vanish or swap for another one just because the final guess differs.
    function pickBestAlternative(result, shown) {
        const alternatives = Array.from(result, alt => alt.transcript);
        if (!strictMode() || (alternatives.length < 2 && !shown)) return shown || alternatives[0];

        let best = shown || alternatives[0];
        let bestScore = interimScore(best);
        // A regional form counts for more than its plain species, so a final
        // guess that drops "Alolan" never beats one that kept it.
        const margin = shown ? 5 : 1;
        for (const text of alternatives) {
            const s = interimScore(text);
            if (s >= bestScore + margin) {
                best = text;
                bestScore = s;
            }
        }
        return best;
    }

    // Adds a 🎤 to `row`, just before `before`, that dictates into `input`.
    // `clearBtn` is that row's ✕ (it wipes the running list of terms), and
    // `placeNotice()` returns where the "didn't catch" notice goes, as
    // { top, left, width, height }. Returns { stop }, or null when the
    // browser has no speech recognition (no mic is added).
    // `onAdd` (optional) is called when "add" is said — the to-do boxes use it
    // to add the current selection; whatever was said before it is committed first.
    function attachVoiceSearch({ input, row, before, clearBtn, id, placeNotice, onListenChange, onAdd }) {
        if (!SpeechRecognition || !input || !row) return null;

        const micBtn = document.createElement("span");
        if (id) micBtn.id = id;
        micBtn.className = "voice-search";
        micBtn.textContent = "🎤";
        micBtn.title = MIC_TITLE;
        row.insertBefore(micBtn, before || null);

        const recognition = new SpeechRecognition();
        recognition.lang = "en-GB";
        recognition.interimResults = true;
        recognition.continuous = true;
        // The browser's backup guesses for each phrase — pickBestAlternative()
        // chooses whichever lines up with the most real names.
        recognition.maxAlternatives = 5;

        // The raw words the browser heard, shown in the mic's hover tooltip so
        // a miss can be traced back to what was actually heard.
        const heardLog = [];

        function logHeard(raw, { terms: found, missed }) {
            const outcome = [found.join(", "), missed.length ? `missed: ${missed.join(", ")}` : ""]
                .filter(Boolean).join(" | ") || "(nothing)";
            heardLog.push(`"${raw.trim()}" → ${outcome}`);
            if (heardLog.length > HEARD_LOG_SIZE) heardLog.shift();
            micBtn.title = `${MIC_TITLE}\n\nRecently heard:\n${heardLog.join("\n")}`;
            console.info("[voice search] heard", JSON.stringify(raw.trim()), "→", found, missed.length ? { missed } : "");
        }

        // Brief note when spoken words couldn't be matched to a Pokémon —
        // they're left out of the search, so this is the cue to just say the
        // name again (listening carries on). Positioned on show, since what
        // it sits over is itself placed from JS.
        const notice = document.createElement("div");
        notice.className = "voice-search-notice";
        notice.hidden = true;
        document.body.appendChild(notice);
        let noticeTimer = null;

        function showMissed(missed) {
            if (!missed.length) return;
            notice.textContent = `Didn't catch "${missed.join("\", \"")}" — say it again`;
            const rect = placeNotice();
            notice.style.top = `${rect.top}px`;
            notice.style.left = `${rect.left}px`;
            notice.style.width = `${rect.width}px`;
            notice.style.minHeight = `${rect.height}px`;
            notice.hidden = false;
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
        }

        // "Did you mean…?" picker, shown (Pokédex only) when a phrase was a
        // struggle: the guess flickered between several names while speaking,
        // or part of it couldn't be placed. Up to three candidate cards plus a
        // red "None of these". Stays up until a choice is made, or until the
        // next phrase/command replaces it.
        const suggest = document.createElement("div");
        suggest.className = "voice-search-suggest";
        suggest.hidden = true;
        document.body.appendChild(suggest);

        function hideSuggest() {
            suggest.hidden = true;
            suggest.textContent = "";
        }

        // `guess` is the term the phrase already added (or null if none was);
        // picking replaces it, "None of these" removes it.
        function showSuggest(candidates, guess) {
            hideSuggest();
            // Full-screen backdrop (like the Pokémon modal) with the panel centred.
            const panel = document.createElement("div");
            panel.className = "voice-search-suggest-panel";
            suggest.appendChild(panel);
            const title = document.createElement("div");
            title.className = "voice-search-suggest-title";
            title.textContent = "Did you mean…?";
            panel.appendChild(title);

            const cards = document.createElement("div");
            cards.className = "voice-search-suggest-cards";
            const replaceGuess = (replacement) => {
                const at = guess ? terms.lastIndexOf(guess) : -1;
                if (at !== -1 && replacement) terms[at] = replacement;
                else if (at !== -1) terms.splice(at, 1);
                else if (replacement) terms.push(replacement);
                terms = terms.filter((t, i) => terms.indexOf(t) === i);
                hideSuggest();
                render("");
            };
            for (const name of candidates) {
                const card = document.createElement("button");
                card.type = "button";
                card.className = "voice-search-suggest-card";
                if (window.voiceSearchSprite) {
                    const img = document.createElement("img");
                    img.src = window.voiceSearchSprite(name);
                    img.alt = "";
                    card.appendChild(img);
                }
                const label = document.createElement("span");
                label.textContent = name;
                card.appendChild(label);
                card.addEventListener("click", () => replaceGuess(name));
                cards.appendChild(card);
            }
            panel.appendChild(cards);

            const none = document.createElement("button");
            none.type = "button";
            none.className = "voice-search-suggest-none";
            none.textContent = "No — none of these";
            none.addEventListener("click", () => replaceGuess(null));
            panel.appendChild(none);

            suggest.hidden = false;
        }

        let listening = false;
        // Saying "pause" turns the mic red and ignores everything — every
        // command, "stop" and "back" included — until "unpause" is said.
        let paused = false;
        let terms = [];        // committed terms (existing box text + finished speech)
        let resultOffset = 0;  // results already folded into `terms` this session
        let carriedRegion = ""; // region said at the end of the last phrase, e.g. "Hisuian" before a pause
        let rendering = false;
        // Last interim text shown for each in-progress phrase, by result index.
        const shownInterim = new Map();
        // Every real name the top guess has shown for each in-progress phrase,
        // by result index → Map(name → times seen). A phrase that showed
        // several different names is one the recognizer struggled with.
        const displayedNames = new Map();

        function noteDisplayed(i, text) {
            if (!strictMode()) return;
            const seen = displayedNames.get(i) || new Map();
            for (const name of splitIntoTerms(text).terms) {
                if (window.voiceSearchNames.includes(name)) seen.set(name, (seen.get(name) || 0) + 1);
            }
            displayedNames.set(i, seen);
        }

        // Up to three names to offer for a finished phrase, or null when it
        // wasn't a struggle. Most-shown names first, then the browser's backup
        // guesses for the final result.
        function suggestionsFor(result, i, split, heardText) {
            if (!strictMode() || split.terms.length > 1) return null;
            const seen = displayedNames.get(i) || new Map();
            const heardWords = toWords(heardText);
            // Unsure = the guess flickered between names, part couldn't be
            // placed, or the one name placed isn't spelled the way it was heard
            // (it was snapped to the nearest, not matched exactly).
            const snapped = split.terms.length === 1
                && normalize(heardWords.join("")) !== normalize(split.terms[0]);
            const unsure = seen.size >= 2 || split.missed.length > 0 || snapped;
            if (!unsure) return null;

            const ranked = [...seen].sort((a, b) => b[1] - a[1]).map(([name]) => name);
            const add = name => { if (name && !ranked.includes(name)) ranked.push(name); };
            split.terms.forEach(add);
            for (const alt of Array.from(result, a => a.transcript)) {
                for (const name of splitIntoTerms(alt).terms) {
                    if (window.voiceSearchNames.includes(name)) add(name);
                }
            }
            // Still short: the closest names by spelling/sound, so even a
            // phrase nothing matched gets a best guess.
            const spoken = split.missed.length ? split.missed.join(" ") : heardWords.join(" ");
            voiceSearchMatcher.rankNear(toWords(spoken), window.voiceSearchNames, 3).forEach(add);
            const candidates = ranked.slice(0, 3);
            return candidates.length >= 2 ? candidates : null;
        }

        function render(interimText) {
            const all = [...terms, ...splitIntoTerms(interimText || "").terms];
            input.value = all.join(", ");
            rendering = true;
            // Flagged so listeners can tell dictation from the user emptying
            // the box (the Pokédex turns "Exact match" off only for the latter).
            const event = new Event("input", { bubbles: true });
            event.fromVoice = true;
            input.dispatchEvent(event);
            rendering = false;
        }

        // abort() rather than stop(): anything still being processed would be
        // ignored anyway (see the `listening` check in "result"), and it frees
        // the microphone straight away for another mic to start.
        function setPaused(value) {
            paused = value;
            micBtn.classList.toggle("paused", value);
        }

        // "unpause", or the recognizer splitting it into "un pause".
        function isUnpause(words) {
            return words.some((w, idx) => normalize(w) === "unpause"
                || (normalize(w) === "pause" && normalize(words[idx - 1] || "") === "un"));
        }

        function stop() {
            listening = false;
            setPaused(false);
            carriedRegion = "";
            hideSuggest();
            micBtn.classList.remove("listening");
            recognition.abort();
            onListenChange?.(false);
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

                // While paused only "unpause" is listened for; any other
                // phrase is dropped once it finishes.
                if (paused) {
                    if (isUnpause(words)) {
                        setPaused(false);
                        carriedRegion = "";
                        interim = "";
                        resultOffset = i + 1;
                        shownInterim.delete(i);
                    } else if (e.results[i].isFinal) {
                        resultOffset = i + 1;
                        shownInterim.delete(i);
                    }
                    continue;
                }

                const pauseIdx = words.findIndex((w, idx) => normalize(w) === "pause" && normalize(words[idx - 1] || "") !== "un");
                if (pauseIdx !== -1) {
                    const beforePause = interim + " " + words.slice(0, pauseIdx).join(" ");
                    const split = splitIntoTerms(beforePause);
                    if (split.terms.length || split.missed.length) logHeard(beforePause, split);
                    showMissed(split.missed);
                    terms.push(...split.terms);
                    carriedRegion = "";
                    interim = "";
                    resultOffset = i + 1;
                    shownInterim.delete(i);
                    setPaused(true);
                    render("");
                    continue;
                }

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

                // "back" undoes the most recent term — same reactive-on-interim
                // handling as "stop" above (so it fires the moment it's heard),
                // but keeps listening instead of ending the session. Anything
                // said earlier in this same phrase is committed first (so
                // "pikachu back" nets out to nothing added, same as never
                // saying it), then the single most recent term — from that or
                // an earlier phrase — is popped.
                const backIdx = words.findIndex(w => normalize(w) === "back");
                if (backIdx !== -1) {
                    const beforeBack = interim + " " + words.slice(0, backIdx).join(" ");
                    const split = splitIntoTerms(beforeBack);
                    if (split.terms.length || split.missed.length) logHeard(beforeBack, split);
                    showMissed(split.missed);
                    terms.push(...split.terms);
                    terms.pop();
                    carriedRegion = "";
                    interim = "";
                    resultOffset = i + 1;
                    render(interim);
                    continue;
                }

                // "clear" wipes everything in the box (typed text included),
                // discarding anything said earlier in this same phrase too.
                const clearIdx = words.findIndex(w => normalize(w) === "clear");
                if (clearIdx !== -1) {
                    terms = [];
                    carriedRegion = "";
                    interim = "";
                    resultOffset = i + 1;
                    shownInterim.delete(i);
                    displayedNames.delete(i);
                    hideSuggest();
                    render("");
                    continue;
                }

                // "regional" turns the most recent term into its regional form
                // (when it has one), after committing what came before it.
                const regionalIdx = words.findIndex(w => REGIONAL_WORDS.has(normalize(w)));
                if (regionalIdx !== -1) {
                    const beforeRegional = interim + " " + words.slice(0, regionalIdx).join(" ");
                    const split = splitIntoTerms(beforeRegional);
                    if (split.terms.length || split.missed.length) logHeard(beforeRegional, split);
                    showMissed(split.missed);
                    terms.push(...split.terms);
                    const variant = terms.length
                        ? voiceSearchMatcher.regionalVariant(terms[terms.length - 1], window.voiceSearchNames || looseNames || [])
                        : null;
                    if (variant) terms[terms.length - 1] = variant;
                    carriedRegion = "";
                    interim = "";
                    resultOffset = i + 1;
                    shownInterim.delete(i);
                    render("");
                    continue;
                }

                // "add" commits whatever came before it, then hands over to the
                // to-do box's own add (see the onAdd option above).
                const addIdx = onAdd ? words.findIndex(w => normalize(w) === "add") : -1;
                if (addIdx !== -1) {
                    const beforeAdd = interim + " " + words.slice(0, addIdx).join(" ");
                    const split = splitIntoTerms(beforeAdd);
                    if (split.terms.length || split.missed.length) logHeard(beforeAdd, split);
                    showMissed(split.missed);
                    terms.push(...split.terms);
                    carriedRegion = "";
                    interim = "";
                    resultOffset = i + 1;
                    shownInterim.delete(i);
                    render("");
                    onAdd();
                    if (!listening) return;
                    continue;
                }

                if (e.results[i].isFinal) {
                    const chosen = carriedRegion + " " + pickBestAlternative(e.results[i], shownInterim.get(i));
                    shownInterim.delete(i);
                    const split = splitIntoTerms(chosen);
                    logHeard(chosen, split);
                    noteDisplayed(i, chosen);
                    const candidates = suggestionsFor(e.results[i], i, split, chosen);
                    displayedNames.delete(i);
                    if (candidates) {
                        // The picker replaces the plain "didn't catch" notice.
                        notice.hidden = true;
                    } else {
                        showMissed(split.missed);
                    }
                    terms.push(...split.terms);
                    if (candidates) showSuggest(candidates, split.terms[0] || null);
                    carriedRegion = split.trailingRegion || "";
                    interim = carriedRegion;
                    resultOffset = i + 1;
                } else {
                    // Keeps the best-scoring interim seen, not the latest: the
                    // recognizer often drops a word ("Alolan") from a later one.
                    const prev = shownInterim.get(i);
                    if (!prev || interimScore(text) >= interimScore(prev)) {
                        shownInterim.set(i, text);
                    }
                    noteDisplayed(i, text);
                    interim += " " + text;
                }
            }
            if (paused) return;
            render(interim);
        });

        // Browsers end a session on their own after a stretch of silence —
        // restart it so listening only stops when the button is clicked again.
        recognition.addEventListener("end", () => {
            resultOffset = 0;
            shownInterim.clear();
            displayedNames.clear();
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
            return input.value.split(",").map(t => t.trim()).filter(Boolean);
        }

        // Any change to the box mid-dictation that didn't come from render() —
        // typing, ✕ (which empties it), removing a term from the search-terms
        // dropdown — becomes the new base that later speech is appended to,
        // rather than being overwritten.
        input.addEventListener("input", () => {
            if (listening && !rendering) terms = termsFromBox();
        });
        clearBtn?.addEventListener("click", () => {
            terms = [];
        });

        micBtn.addEventListener("click", () => {
            if (listening) {
                stop();
                return;
            }

            stopAll();
            loadLooseNames();
            terms = termsFromBox();
            carriedRegion = "";
            resultOffset = 0;

            try {
                recognition.start();
                listening = true;
                micBtn.classList.add("listening");
                onListenChange?.(true);
            } catch {
                // start() throws if a previous session hasn't fully ended yet.
            }
        });

        const controller = { stop: () => { if (listening) stop(); } };
        controllers.push(controller);
        return controller;
    }

    window.attachVoiceSearch = attachVoiceSearch;
    window.stopVoiceSearch = stopAll;

    // Every collection page's main search bar. The notice is laid directly
    // over the search toggles row (#search-evolutions-row) where there is
    // one, else just under the search bar.
    const clearSearch = document.getElementById("clear-search");
    attachVoiceSearch({
        input: document.getElementById("search"),
        row: document.getElementById("search-row"),
        before: clearSearch,
        clearBtn: clearSearch,
        id: "voice-search",
        // Saying "add" adds the current search's matches to the to-do list,
        // when the page has one to add to (see voiceSearchAddHandler in
        // pokedexes.js / cards.js); returns false when there is nothing to add.
        onAdd: () => window.voiceSearchAddHandler ? window.voiceSearchAddHandler() : false,
        placeNotice() {
            const toggles = document.getElementById("search-evolutions-row")?.getBoundingClientRect();
            if (toggles && toggles.height > 0) return toggles;
            const wrapper = document.getElementById("search-wrapper").getBoundingClientRect();
            return { top: wrapper.bottom + 6, left: wrapper.left, width: wrapper.width, height: 0 };
        },
        // Pokédex-only ("Exact match" doesn't exist elsewhere) — spoken terms
        // are already snapped to real Pokémon names, so exact matching keeps
        // e.g. "Onix" from also pulling in every other name that merely
        // contains "on". Only turned on here, not off — it stays on after
        // the mic stops (so the results you just dictated don't change),
        // until the search bar itself is cleared (see pokedexes.js's
        // clear-search and #search "input" handlers).
        onListenChange(listening) {
            if (!listening) return;
            const exactToggle = document.getElementById("search-exact-toggle");
            if (!exactToggle) return;
            exactToggle.checked = true;
            exactToggle.dispatchEvent(new Event("change", { bubbles: true }));
        }
    });
})();
