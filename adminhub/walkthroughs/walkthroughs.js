// Achievement Walkthroughs — imported from TrueAchievements via a
// Tampermonkey userscript (lives only in Tampermonkey, not this repo) and a
// dedicated Cloudflare Worker (lives only in Cloudflare, not this repo —
// see CLAUDE.md's "Achievement Walkthroughs" section for both of their full
// source/design, kept out of this public repo deliberately since the
// Worker's deployment steps are adjacent to its secrets). Lands as a static
// walkthroughs-backup.json, right next to this file, that this page just
// reads. No Firestore involved.
import { requireAdminAuth } from '../auth.js';
import { getAdminIdToken } from '../../admin-auth-core.js';

const adminContent = document.getElementById('admin-content');

const libraryPanel = document.getElementById('walkthrough-library');
const libraryGrid = document.getElementById('walkthrough-library-grid');
const libraryEmpty = document.getElementById('walkthrough-library-empty');

const outlinePanel = document.getElementById('walkthrough-outline');
const outlineTitle = document.getElementById('outline-title');
const outlineSectionList = document.getElementById('outline-section-list');
const outlineBackBtn = document.getElementById('outline-back-btn');
const outlineDeleteBtn = document.getElementById('outline-delete-btn');

const readerPanel = document.getElementById('walkthrough-reader');
const readerBackBtn = document.getElementById('reader-back-btn');
const readerNextSectionBtn = document.getElementById('reader-next-section-btn');
const readerSectionTitle = document.getElementById('reader-section-title');
const readerModeScrollBtn = document.getElementById('reader-mode-scroll-btn');
const readerModeStepBtn = document.getElementById('reader-mode-step-btn');
const readerScrollView = document.getElementById('reader-scroll-view');
const readerStepView = document.getElementById('reader-step-view');
const readerStepContent = document.getElementById('reader-step-content');
const readerStepPosition = document.getElementById('reader-step-position');
const readerStepPrevBtn = document.getElementById('reader-step-prev');
const readerStepNextBtn = document.getElementById('reader-step-next');

const deleteModal = document.getElementById('delete-walkthrough-modal');
const cancelDeleteBtn = document.getElementById('cancel-delete-walkthrough-btn');
const confirmDeleteBtn = document.getElementById('confirm-delete-walkthrough-btn');

const imageZoomOverlay = document.getElementById('walkthrough-zoom-overlay');
const zoomImage = document.getElementById('walkthrough-zoom-image');

// Click-to-enlarge, same pattern as collection-hub/collections.js's
// #image-zoom-overlay — click the big version (or the backdrop) to close.
function openImageZoom(url, alt) {
    zoomImage.src = url;
    zoomImage.alt = alt;
    zoomImage.referrerPolicy = 'no-referrer';
    imageZoomOverlay.classList.remove('hidden');
}

imageZoomOverlay.addEventListener('click', (e) => {
    if (e.target === imageZoomOverlay || e.target === zoomImage) {
        imageZoomOverlay.classList.add('hidden');
    }
});

const WALKTHROUGHS_FILE = './walkthroughs-backup.json';
// NOT the site's generic `.../export` Worker — that one always commits
// under a hardcoded collection-hub/ prefix (confirmed: it silently wrote to
// a bogus collection-hub/adminhub/walkthroughs/walkthroughs-backup.json
// instead of the real file), so it can't target this file at all. This is
// the same dedicated Worker /import POSTs to, now also handling /manage —
// see its source for the Firebase-ID-token verification this call needs.
const MANAGE_WORKER_URL = 'https://walkthrough-import.harrycummins.workers.dev/manage';
const PROGRESS_KEY_PREFIX = 'walkthroughProgress:';

let walkthroughs = [];

// Which section/step is currently open, as indexes into `walkthroughs` —
// null outside the reader/outline.
let currentWalkthroughIndex = null;
let currentSectionIndex = null;
let currentStepIndex = 0;
let currentMode = 'scroll'; // 'scroll' | 'step'

// Which word of the *current* text step (flattened, whitespace-split) reading-
// aloud has reached, -1 meaning none yet — only meaningful in Step mode on a
// 'text' step. Reset whenever the displayed step actually changes
// (goToStep()/openSection()), not on every re-render. Word-level rather than
// sentence-level so a rewind can land mid-sentence (see matchSpokenWords()).
let wordReadIndex = -1;

requireAdminAuth().then(() => {
    adminContent.classList.remove('hidden');
    loadWalkthroughs();
});

function loadWalkthroughs() {
    fetch(WALKTHROUGHS_FILE)
        .then(res => res.json())
        .then(data => {
            walkthroughs = Array.isArray(data) ? data : [];
            renderLibrary();
        })
        .catch(err => {
            console.error('Failed to load walkthroughs-backup.json:', err);
            walkthroughs = [];
            renderLibrary();
        });
}

// ---------------------------
// PROGRESS (localStorage, per device, per walkthrough — not synced data)
// ---------------------------
function progressKey(sourceUrl) {
    return PROGRESS_KEY_PREFIX + sourceUrl;
}

function loadProgress(sourceUrl) {
    try {
        const raw = localStorage.getItem(progressKey(sourceUrl));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// Called on every step change, every time the reader is left (back to
// outline/library, switching walkthrough), and on beforeunload/pagehide —
// belt-and-suspenders so leaving the page never loses position, however it
// happens to be left.
function saveProgress() {
    if (currentWalkthroughIndex === null || currentSectionIndex === null) return;

    const walkthrough = walkthroughs[currentWalkthroughIndex];
    if (!walkthrough) return;

    const data = { sectionIndex: currentSectionIndex, stepIndex: currentStepIndex, mode: currentMode };
    try {
        localStorage.setItem(progressKey(walkthrough.sourceUrl), JSON.stringify(data));
    } catch {
        // Storage full/unavailable (private window etc.) — resume just
        // won't work this time, nothing else depends on this succeeding.
    }
}

function clearProgress(sourceUrl) {
    try {
        localStorage.removeItem(progressKey(sourceUrl));
    } catch {
        // ignore
    }
}

window.addEventListener('beforeunload', saveProgress);
window.addEventListener('pagehide', saveProgress);

// ---------------------------
// LIBRARY
// ---------------------------
function renderLibrary() {
    showPanel(libraryPanel);
    libraryGrid.innerHTML = '';
    libraryEmpty.classList.toggle('hidden', walkthroughs.length > 0);

    walkthroughs.forEach((walkthrough, index) => {
        const progress = loadProgress(walkthrough.sourceUrl);

        const tile = document.createElement('div');
        tile.className = 'walkthrough-tile';

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'walkthrough-tile-main';

        const sectionCount = (walkthrough.sections || []).length;
        let resumeLine = '';
        if (progress && walkthrough.sections?.[progress.sectionIndex]) {
            const title = walkthrough.sections[progress.sectionIndex].title;
            resumeLine = `<p class="walkthrough-resume-line">▶ Resume: Section ${progress.sectionIndex + 1} — "${escapeHtml(title)}"</p>`;
        }

        main.innerHTML = `
            <h3>${escapeHtml(walkthrough.gameName)}</h3>
            <p>${sectionCount} section${sectionCount === 1 ? '' : 's'}</p>
            ${resumeLine}
        `;

        // No separate "Outline" button — this already goes somewhere
        // useful either way (resume, or the outline if there's nothing to
        // resume), so a second button doing one of those same two things
        // was redundant.
        main.addEventListener('click', () => {
            if (progress && walkthrough.sections?.[progress.sectionIndex]) {
                openSection(index, progress.sectionIndex, progress.mode || 'scroll', progress.stepIndex || 0);
            } else {
                renderOutline(index);
            }
        });

        tile.appendChild(main);
        libraryGrid.appendChild(tile);
    });
}

// ---------------------------
// OUTLINE — the section menu. Every row offers both reading modes
// explicitly, rather than only a toggle buried inside the reader.
// ---------------------------
function renderOutline(walkthroughIndex) {
    const walkthrough = walkthroughs[walkthroughIndex];
    if (!walkthrough) return;

    currentWalkthroughIndex = walkthroughIndex;
    currentSectionIndex = null;

    showPanel(outlinePanel);
    outlineTitle.textContent = walkthrough.gameName;
    outlineSectionList.innerHTML = '';

    (walkthrough.sections || []).forEach((section, sectionIndex) => {
        const row = document.createElement('div');
        row.className = 'outline-section-row';

        // Clicking the row itself (anywhere but the two explicit buttons
        // below) jumps straight into Step Through at this section's first
        // step — the fastest path in, since that's the default way most
        // sections get read. "📖 Read" stays as the explicit way to open it
        // in Scroll mode instead.
        row.addEventListener('click', () => openSection(walkthroughIndex, sectionIndex, 'step'));

        const label = document.createElement('span');
        label.className = 'outline-section-title';
        // section.title already carries TrueAchievements' own numbering
        // ("4.4 Spring Meadows", etc.) — prepending our own index on top of
        // that doubled it up ("1. 4.4 Spring Meadows").
        label.textContent = section.title;

        const readBtn = document.createElement('button');
        readBtn.type = 'button';
        readBtn.className = 'editor-toolbar-btn';
        readBtn.textContent = '📖 Read';
        readBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSection(walkthroughIndex, sectionIndex, 'scroll');
        });

        const stepBtn = document.createElement('button');
        stepBtn.type = 'button';
        stepBtn.className = 'editor-toolbar-btn';
        stepBtn.textContent = '👣 Step Through';
        stepBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSection(walkthroughIndex, sectionIndex, 'step');
        });

        row.appendChild(label);
        row.appendChild(readBtn);
        row.appendChild(stepBtn);
        outlineSectionList.appendChild(row);
    });
}

outlineBackBtn.addEventListener('click', () => {
    currentWalkthroughIndex = null;
    renderLibrary();
});

outlineDeleteBtn.addEventListener('click', () => {
    deleteModal.classList.remove('hidden');
});

cancelDeleteBtn.addEventListener('click', () => {
    deleteModal.classList.add('hidden');
});

deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) deleteModal.classList.add('hidden');
});

confirmDeleteBtn.addEventListener('click', async () => {
    const walkthrough = walkthroughs[currentWalkthroughIndex];
    if (!walkthrough) return;

    confirmDeleteBtn.disabled = true;
    try {
        const updated = walkthroughs.filter(w => w.sourceUrl !== walkthrough.sourceUrl);
        await commitWalkthroughsFile(updated);
        clearProgress(walkthrough.sourceUrl);
        walkthroughs = updated;
        currentWalkthroughIndex = null;
        deleteModal.classList.add('hidden');
        renderLibrary();
    } catch (err) {
        console.error('Failed to delete walkthrough:', err);
        alert('Failed to delete — see console for details.');
    } finally {
        confirmDeleteBtn.disabled = false;
    }
});

// Reuses the site's existing, already-deployed export Worker — it already
// accepts { filename, content } + a Firebase ID token for any file, not
// just pokedex data (see collection-hub/export-to-github.js, the only other
// caller). No new server-side auth code needed for anything the website
// itself writes; only the cross-origin TrueAchievements importer needs the
// separate, shared-secret-only Worker.
async function commitWalkthroughsFile(updatedArray) {
    const idToken = await getAdminIdToken();
    if (!idToken) throw new Error('Not signed in as admin');

    const res = await fetch(MANAGE_WORKER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ content: updatedArray })
    });

    const result = await res.json();
    if (!result.ok) {
        throw new Error(result.error || 'Worker did not confirm the commit');
    }
}

// ---------------------------
// READER
// ---------------------------
function openSection(walkthroughIndex, sectionIndex, mode, stepIndex = 0) {
    currentWalkthroughIndex = walkthroughIndex;
    currentSectionIndex = sectionIndex;
    currentStepIndex = stepIndex;
    currentMode = mode;
    wordReadIndex = -1;

    showPanel(readerPanel);
    renderReader();
    saveProgress();
}

readerBackBtn.addEventListener('click', () => {
    saveProgress();
    renderOutline(currentWalkthroughIndex);
});

readerNextSectionBtn.addEventListener('click', () => {
    const walkthrough = walkthroughs[currentWalkthroughIndex];
    if (!walkthrough || currentSectionIndex >= walkthrough.sections.length - 1) return;

    currentSectionIndex += 1;
    currentStepIndex = 0;
    renderReader();
    saveProgress();
    readerPanel.scrollIntoView({ block: 'start' });
});

readerModeScrollBtn.addEventListener('click', () => {
    currentMode = 'scroll';
    renderReader();
    saveProgress();
});

readerModeStepBtn.addEventListener('click', () => {
    currentMode = 'step';
    renderReader();
    saveProgress();
});

function currentSection() {
    const walkthrough = walkthroughs[currentWalkthroughIndex];
    return walkthrough?.sections?.[currentSectionIndex] || null;
}

function renderReader() {
    const walkthrough = walkthroughs[currentWalkthroughIndex];
    const section = currentSection();
    if (!walkthrough || !section) return;

    readerSectionTitle.textContent = section.title;

    // Only shown while actually reading a whole section at once — Step
    // Through already has its own Next/Back that cross section boundaries,
    // so a second "next section" control there would just be a redundant,
    // differently-scoped jump.
    const hasNextSection = currentSectionIndex < walkthrough.sections.length - 1;
    readerNextSectionBtn.classList.toggle('hidden', currentMode !== 'scroll' || !hasNextSection);

    readerModeScrollBtn.classList.toggle('active-mode', currentMode === 'scroll');
    readerModeStepBtn.classList.toggle('active-mode', currentMode === 'step');

    readerScrollView.classList.toggle('hidden', currentMode !== 'scroll');
    readerStepView.classList.toggle('hidden', currentMode !== 'step');

    if (currentMode === 'scroll') {
        readerScrollView.innerHTML = '';
        // Clicking any text while reading the whole section at once jumps
        // straight into Step mode at that exact step, rather than always
        // landing back on step 1 — see openStepFromScroll().
        (section.steps || []).forEach((step, stepIndex) => {
            readerScrollView.appendChild(renderStepElement(step, { onClickText: () => openStepFromScroll(stepIndex) }));
        });
    } else {
        renderStepView();
    }
}

function openStepFromScroll(stepIndex) {
    currentStepIndex = stepIndex;
    currentMode = 'step';
    wordReadIndex = -1;
    renderReader();
    saveProgress();
}

// A short (≤5-word) lead-in line got merged into the step right after it
// as `step.heading` (see the userscript's mergeShortHeadings()) rather than
// standing alone as its own step — nothing to click/step through for a
// one-line label on its own. Rendered as a small heading above whatever
// the step actually is, gapped from it, same in both modes.
function renderStepElement(step, options = {}) {
    const content = renderStepContent(step, options);
    if (!step.heading) return content;

    const wrapper = document.createElement('div');
    wrapper.className = 'walkthrough-step-heading-wrap';

    const heading = document.createElement('div');
    heading.className = 'walkthrough-step-heading';
    heading.textContent = step.heading;

    wrapper.appendChild(heading);
    wrapper.appendChild(content);
    return wrapper;
}

// `trackWords` is only ever true for Step mode's own text step (see
// renderStepView()) — scroll mode shows a whole section at once, where
// "which sentence have you reached" isn't a meaningful question. `onClickText`
// is scroll mode's own thing instead — jump into Step mode at this exact
// step when its text is clicked (see renderReader()'s scroll branch).
function renderStepContent(step, { trackWords = false, onClickText = null } = {}) {
    if (step.type === 'image') {
        const img = document.createElement('img');
        img.loading = 'lazy';
        // TrueAchievements blocks hotlinked images by checking the Referer
        // header (confirmed: a plain request from this site's origin gets a
        // 403, no Referer at all gets a 200) — this tells the browser to
        // send no Referer for this request at all, same as the no-Referer
        // case that works.
        img.referrerPolicy = 'no-referrer';
        img.src = step.url;
        img.alt = step.alt || '';
        img.className = 'walkthrough-step-image';
        img.addEventListener('click', () => openImageZoom(step.url, step.alt || ''));
        return img;
    }

    if (step.type === 'achievement') {
        // No icon — just the name + description, together as this one step.
        const card = document.createElement('div');
        card.className = 'walkthrough-achievement-card';
        card.innerHTML = `
            <div class="walkthrough-achievement-text">
                <div class="walkthrough-achievement-name">${escapeHtml(step.name || '')}</div>
                <div class="walkthrough-achievement-desc">${escapeHtml(step.description || '')}</div>
            </div>
        `;
        return card;
    }

    // Mirrors TrueAchievements' own spoiler widget (a reveal link sitting
    // next to a display:none payload) rather than just showing the content
    // straight away — same click-to-reveal interaction, just rebuilt here
    // since the original markup doesn't come along with the capture.
    if (step.type === 'spoiler') {
        const wrapper = document.createElement('div');
        wrapper.className = 'walkthrough-spoiler';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'walkthrough-spoiler-toggle';
        toggle.textContent = '🔒 Spoiler — click to reveal';

        const content = document.createElement('div');
        content.className = 'walkthrough-spoiler-content hidden';
        (step.steps || []).forEach(inner => content.appendChild(renderStepElement(inner)));

        toggle.addEventListener('click', () => {
            const nowHidden = content.classList.toggle('hidden');
            toggle.textContent = nowHidden ? '🔒 Spoiler — click to reveal' : '🔓 Click to hide';
        });

        wrapper.appendChild(toggle);
        wrapper.appendChild(content);
        return wrapper;
    }

    const p = document.createElement('p');
    p.className = 'walkthrough-step-text';

    if (!trackWords) {
        p.textContent = step.text || '';
        if (onClickText) {
            p.classList.add('walkthrough-step-text--clickable');
            p.addEventListener('click', onClickText);
        }
        return p;
    }

    // Reading-aloud tracking: one <span> per word (not per sentence) so a
    // rewind can land mid-sentence — saying "cat" can un-dim just "The cat"
    // out of an already-dimmed "The cat is strong", not the whole sentence.
    // Never removes/hides anything — see updateWordDimming().
    splitWords(step.text || '').forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'walkthrough-word';
        span.dataset.wordIndex = String(i);
        span.textContent = word + ' ';
        p.appendChild(span);
    });
    return p;
}

// Whitespace-split — keeps each word's own punctuation/casing intact for
// display; matchSpokenWords() normalizes separately for comparison.
function splitWords(text) {
    return text.split(/\s+/).filter(Boolean);
}

// Dims every word up to and including wordReadIndex, leaving the rest at
// normal brightness — never hides anything, so re-reading something
// already passed is still just a glance away.
function updateWordDimming() {
    readerStepContent.querySelectorAll('.walkthrough-word').forEach(span => {
        const i = Number(span.dataset.wordIndex);
        span.classList.toggle('walkthrough-word--read', i <= wordReadIndex);
    });
}

function renderStepView() {
    const section = currentSection();
    if (!section) return;

    const steps = section.steps || [];
    const step = steps[currentStepIndex];

    readerStepContent.innerHTML = '';
    if (step) readerStepContent.appendChild(renderStepElement(step, { trackWords: true }));
    updateWordDimming();
    readerStepPosition.textContent = `Step ${currentStepIndex + 1} of ${steps.length}`;
}

// The current step's own word list, for voice matching — [] for anything
// that isn't a plain text step (image/achievement/spoiler have no "words"
// to read along with).
function currentStepWords() {
    const section = currentSection();
    const step = section?.steps?.[currentStepIndex];
    if (!step || step.type !== 'text') return [];
    return splitWords(step.text || '');
}

// Word indices where a sentence ends (its last word carries ., ! or ?) —
// the trailing run of words after the last such punctuation (if any) counts
// as its own final "sentence" too, so nothing at the end is ever left out.
function sentenceBoundaries(rawWords) {
    const ends = [];
    rawWords.forEach((word, i) => {
        if (/[.!?]$/.test(word)) ends.push(i);
    });
    if (ends.length === 0 || ends[ends.length - 1] !== rawWords.length - 1) {
        ends.push(rawWords.length - 1);
    }
    return ends;
}

// The "back" command — unlike matchSpokenWords() advancing/rewinding by
// exactly the words said, this un-dims the *whole* most recently affected
// sentence (whether it was fully read or only partway through), since
// that's what's actually useful as a quick undo mid-step.
function rewindCurrentSentence() {
    if (wordReadIndex < 0) return;

    const rawWords = currentStepWords();
    if (rawWords.length === 0) return;

    const ends = sentenceBoundaries(rawWords);
    const currentBoundaryPos = ends.findIndex(end => end >= wordReadIndex);
    const sentenceStart = currentBoundaryPos > 0 ? ends[currentBoundaryPos - 1] + 1 : 0;

    wordReadIndex = sentenceStart - 1;
    updateWordDimming();
}

// Mirrors openAdjacentPokemon() in collection-hub/pokedexes/pokedexes.js —
// walking off either end of a section's steps moves into the next/previous
// section's first/last step, so Next/Back read as one continuous
// walkthrough across section boundaries instead of stopping dead at each
// section edge.
function goToStep(offset) {
    const walkthrough = walkthroughs[currentWalkthroughIndex];
    const section = currentSection();
    if (!walkthrough || !section) return;

    const steps = section.steps || [];
    let nextStepIndex = currentStepIndex + offset;

    if (nextStepIndex < 0) {
        const prevSectionIndex = currentSectionIndex - 1;
        if (prevSectionIndex < 0) return;
        const prevSteps = walkthrough.sections[prevSectionIndex].steps || [];
        currentSectionIndex = prevSectionIndex;
        currentStepIndex = Math.max(0, prevSteps.length - 1);
    } else if (nextStepIndex >= steps.length) {
        const nextSectionIndex = currentSectionIndex + 1;
        if (nextSectionIndex >= walkthrough.sections.length) return;
        currentSectionIndex = nextSectionIndex;
        currentStepIndex = 0;
    } else {
        currentStepIndex = nextStepIndex;
    }

    wordReadIndex = -1;
    renderReader();
    saveProgress();
}

readerStepPrevBtn.addEventListener('click', () => goToStep(-1));
readerStepNextBtn.addEventListener('click', () => goToStep(1));

document.addEventListener('keydown', (e) => {
    if (readerPanel.classList.contains('hidden')) return;
    if (currentMode !== 'step') return;
    if (e.key === 'ArrowLeft') goToStep(-1);
    if (e.key === 'ArrowRight') goToStep(1);
});

// ---------------------------
// PANEL SWITCHING — one visible at a time, same .hidden-toggle shape as
// every other single-page-app view on this site rather than any routing.
// ---------------------------
function showPanel(panel) {
    [libraryPanel, outlinePanel, readerPanel].forEach(p => p.classList.toggle('hidden', p !== panel));
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------
// VOICE — "next"/"previous" move a whole step; "back" undoes a single word
// of reading-aloud tracking instead (see wordReadIndex below); "stop" ends
// dictation. Anything else said is matched against the current step's own
// text — forward first (advancing tracking, same as before but word- not
// sentence-grained), and if nothing ahead matches, backward for the most
// recent already-read occurrence instead, rewinding to just before it — see
// matchSpokenWords(). A small dedicated listener rather than reusing
// collection-hub/voice-search.js's matcher, which solves a different
// problem (snapping spoken words to Pokémon names). No button at all where
// SpeechRecognition is unsupported, same guard voice-search.js itself uses.
// ---------------------------
(function attachWalkthroughMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const micBtn = document.createElement('span');
    micBtn.id = 'walkthrough-mic';
    micBtn.className = 'voice-search';
    micBtn.textContent = '🎤';
    micBtn.title = '"next"/"previous" moves a step, "back" undoes a word, "stop" stops — or just read aloud and it tracks you (saying something already read rewinds to its most recent spot)';
    document.getElementById('reader-step-position').insertAdjacentElement('afterend', micBtn);

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = false;

    let listening = false;

    function normalize(word) {
        return word.toLowerCase().replace(/[^a-z]/g, '');
    }

    function stop() {
        listening = false;
        micBtn.classList.remove('listening');
        recognition.abort();
    }

    const COMMANDS = new Set(['stop', 'back', 'previous', 'next']);

    function runCommand(cmd) {
        if (cmd === 'stop') { stop(); return; }
        if (cmd === 'previous') goToStep(-1);
        else if (cmd === 'next') goToStep(1);
        else if (cmd === 'back') rewindCurrentSentence();
    }

    // Only a short, isolated utterance counts as a command — otherwise the
    // walkthrough text itself saying e.g. "...went back to the village..."
    // while being read aloud would misfire navigation instead of being
    // matched as content. Doesn't fully remove the ambiguity (a one-word
    // sentence that genuinely is just "Back." would still misfire), just
    // narrows it from "any sentence containing the word" to that edge case.
    function asCommand(words) {
        return words.length <= 2 ? words.find(w => COMMANDS.has(w)) : undefined;
    }

    recognition.addEventListener('result', (e) => {
        if (!listening) return;

        for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript.trim();
            const words = transcript.split(/\s+/).map(normalize).filter(Boolean);

            // Saying a short command word quickly more than once (or twice
            // more) in a row often gets merged by the recognizer into one
            // result ("next next next" instead of three separate ones) —
            // without this, that transcript is too long to pass
            // asCommand()'s isolated-word check and silently falls through
            // to word-matching instead. Requires every word to be *some*
            // command, not all the *same* one — a run of three "next"s
            // where the engine mis-hears one as a different command word
            // still fires each in turn, rather than the whole thing being
            // thrown out for not matching exactly (a genuine misrecognition
            // into a non-command word still can't be helped, since nothing
            // here can know what was actually meant instead).
            // Runs of any length are accepted, and a run of "next"s is
            // forgiving of the recognizer's usual mangling ("nexts", "necks",
            // "nex", a stray filler word): once at least half the words are
            // next-like, every next-like word counts as one "next" and the
            // rest are ignored, so "next next next" always moves exactly as
            // many steps as were said.
            const isNextLike = (w) => w === 'next' || w === 'nexts' || /^nex/.test(w) || w === 'necks' || w === 'neck';
            const nextCount = words.filter(isNextLike).length;
            if (words.length > 1 && nextCount >= 2 && nextCount * 2 >= words.length) {
                for (const w of words) {
                    if (isNextLike(w)) runCommand('next');
                    else if (COMMANDS.has(w)) {
                        runCommand(w);
                        if (w === 'stop') return;
                    }
                }
                continue;
            }

            if (words.length > 1 && words.every(w => COMMANDS.has(w))) {
                for (const w of words) {
                    runCommand(w);
                    if (w === 'stop') return;
                }
                continue;
            }

            const command = asCommand(words);
            if (command) {
                runCommand(command);
                if (command === 'stop') return;
                continue;
            }

            matchSpokenWords(transcript);
        }
    });

    // After a navigation command, start a fresh recognition session so the
    // next "next" isn't waiting on a session that's gone quiet. abort()
    // fires 'end', which restarts it.
    const baseRunCommand = runCommand;
    runCommand = function (cmd) {
        baseRunCommand(cmd);
        if (cmd !== 'stop' && listening) {
            try { recognition.abort(); } catch { /* restarts via 'end' */ }
        }
    };

    // The engine's continuous session tends to stall or end after a couple of
    // results, so keep restarting it for as long as the mic is on — retrying
    // (start() throws until the old session has fully ended) rather than
    // giving up and leaving the mic looking on but deaf.
    function restartSoon(delay = 100) {
        setTimeout(() => {
            if (!listening) return;
            try {
                recognition.start();
            } catch {
                restartSoon(250);
            }
        }, delay);
    }

    recognition.addEventListener('end', () => restartSoon(50));

    recognition.addEventListener('error', (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stop();
        // Anything else (no-speech, network, aborted) is followed by 'end',
        // which restarts.
    });

    micBtn.addEventListener('click', () => {
        if (listening) {
            stop();
            return;
        }

        try {
            recognition.start();
            listening = true;
            micBtn.classList.add('listening');
        } catch {
            // start() throws if a previous session hasn't fully ended yet.
        }
    });

    // Switching away from the reader/step mode shouldn't leave the mic
    // dictating into a view that's no longer showing.
    readerBackBtn.addEventListener('click', stop);
    readerModeScrollBtn.addEventListener('click', stop);
    outlineBackBtn.addEventListener('click', stop);
})();

// At least this fraction of the spoken words have to actually appear in a
// candidate window before it counts as a match.
const WORD_MATCH_THRESHOLD = 0.6;

function wordsOf(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Overlap score for the window of `normalizedWords` starting at `start`,
// the same length as `spokenWords` — order-insensitive (speech doesn't
// always come back in a clean sequence), just "how much of what was said
// shows up here."
function windowScore(normalizedWords, start, spokenWords) {
    const windowSet = new Set(normalizedWords.slice(start, start + spokenWords.length));
    const matched = spokenWords.filter(w => windowSet.has(w)).length;
    return matched / spokenWords.length;
}

// Advances wordReadIndex to wherever what was just said matches, checked
// against the *whole* step, not just the next word or two, since reading
// aloud can legitimately skip or paraphrase ahead. Forward progress
// (something not yet read) always wins when it clears the threshold — the
// *first* (nearest) qualifying window wins, not whichever scores highest
// further ahead, so a word said once goes to its next real occurrence
// rather than possibly jumping past it to a later, better-scoring match.
// Only once there's *no* forward match does it look backward, for the most
// recent (highest-start, i.e. closest to the current position) already-read
// occurrence, and rewind to just before it — so saying "cat" again after
// reading "...The cat is big. The cat is strong." un-dims from that second
// "cat" onward, not the whole sentence, and not the first "cat" either,
// since the second is more recent. Step mode on a 'text' step only; a no-op
// everywhere else, since there's nothing to match against.
//
// The *best*-scoring forward window wins, not the first one merely
// clearing the threshold — e.g. saying "picks up the bricks" against "...He
// picks up the bricks..." would otherwise stop one word early at "He picks
// up the" (3/4 overlap, already past 0.6) before ever reaching the real,
// exact match starting one word later, leaving "bricks" itself undimmed.
// Ties still favour the earliest window, which is what actually gives "go
// to the first occurrence" for an exact repeat like plain "cat" appearing
// more than once — both score 1.0, and the first keeps it since a later
// equal score doesn't beat it.
function matchSpokenWords(transcript) {
    if (currentMode !== 'step') return;

    const rawWords = currentStepWords();
    if (rawWords.length === 0) return;

    const spokenWords = wordsOf(transcript);
    if (spokenWords.length === 0) return;

    const normalizedWords = rawWords.map(w => wordsOf(w)[0] || '');
    const windowLen = spokenWords.length;
    const lastStart = normalizedWords.length - windowLen;

    let forwardBestStart = -1;
    let forwardBestScore = 0;
    for (let start = wordReadIndex + 1; start <= lastStart; start++) {
        const score = windowScore(normalizedWords, start, spokenWords);
        if (score > forwardBestScore) { forwardBestScore = score; forwardBestStart = start; }
    }

    if (forwardBestStart !== -1 && forwardBestScore >= WORD_MATCH_THRESHOLD) {
        wordReadIndex = forwardBestStart + windowLen - 1;
        updateWordDimming();
        return;
    }

    let backwardBestStart = -1;
    let backwardBestScore = 0;
    for (let start = 0; start <= Math.min(wordReadIndex, lastStart); start++) {
        const score = windowScore(normalizedWords, start, spokenWords);
        if (score >= backwardBestScore) { backwardBestScore = score; backwardBestStart = start; }
    }

    if (backwardBestStart !== -1 && backwardBestScore >= WORD_MATCH_THRESHOLD) {
        wordReadIndex = backwardBestStart - 1;
        updateWordDimming();
    }
}
