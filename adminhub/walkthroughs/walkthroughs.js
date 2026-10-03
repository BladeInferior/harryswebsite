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

const WALKTHROUGHS_FILE = './walkthroughs-backup.json';
const EXPORT_WORKER_URL = 'https://orange-bar-b027.harrycummins.workers.dev/export';
const EXPORT_FILENAME = 'adminhub/walkthroughs/walkthroughs-backup.json';
const PROGRESS_KEY_PREFIX = 'walkthroughProgress:';

let walkthroughs = [];

// Which section/step is currently open, as indexes into `walkthroughs` —
// null outside the reader/outline.
let currentWalkthroughIndex = null;
let currentSectionIndex = null;
let currentStepIndex = 0;
let currentMode = 'scroll'; // 'scroll' | 'step'

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

        main.addEventListener('click', () => {
            if (progress && walkthrough.sections?.[progress.sectionIndex]) {
                openSection(index, progress.sectionIndex, progress.mode || 'scroll', progress.stepIndex || 0);
            } else {
                renderOutline(index);
            }
        });

        const outlineBtn = document.createElement('button');
        outlineBtn.type = 'button';
        outlineBtn.className = 'walkthrough-tile-outline-btn editor-toolbar-btn';
        outlineBtn.textContent = 'Outline';
        outlineBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderOutline(index);
        });

        tile.appendChild(main);
        tile.appendChild(outlineBtn);
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

        const label = document.createElement('span');
        label.className = 'outline-section-title';
        label.textContent = `${sectionIndex + 1}. ${section.title}`;

        const readBtn = document.createElement('button');
        readBtn.type = 'button';
        readBtn.className = 'editor-toolbar-btn';
        readBtn.textContent = '📖 Read';
        readBtn.addEventListener('click', () => openSection(walkthroughIndex, sectionIndex, 'scroll'));

        const stepBtn = document.createElement('button');
        stepBtn.type = 'button';
        stepBtn.className = 'editor-toolbar-btn';
        stepBtn.textContent = '👣 Step Through';
        stepBtn.addEventListener('click', () => openSection(walkthroughIndex, sectionIndex, 'step'));

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

    const res = await fetch(EXPORT_WORKER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ filename: EXPORT_FILENAME, content: JSON.stringify(updatedArray, null, 2) })
    });

    const result = await res.json();
    if (!result.verified || (!result.committed && !result.unchanged)) {
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

    showPanel(readerPanel);
    renderReader();
    saveProgress();
}

readerBackBtn.addEventListener('click', () => {
    saveProgress();
    renderOutline(currentWalkthroughIndex);
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

    readerSectionTitle.textContent = `${currentSectionIndex + 1}. ${section.title}`;

    readerModeScrollBtn.classList.toggle('active-mode', currentMode === 'scroll');
    readerModeStepBtn.classList.toggle('active-mode', currentMode === 'step');

    readerScrollView.classList.toggle('hidden', currentMode !== 'scroll');
    readerStepView.classList.toggle('hidden', currentMode !== 'step');

    if (currentMode === 'scroll') {
        readerScrollView.innerHTML = '';
        (section.steps || []).forEach(step => {
            readerScrollView.appendChild(renderStepElement(step));
        });
    } else {
        renderStepView();
    }
}

function renderStepElement(step) {
    if (step.type === 'image') {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = step.url;
        img.alt = step.alt || '';
        img.className = 'walkthrough-step-image';
        return img;
    }

    if (step.type === 'achievement') {
        const card = document.createElement('div');
        card.className = 'walkthrough-achievement-card';
        card.innerHTML = `
            ${step.iconUrl ? `<img loading="lazy" src="${escapeHtml(step.iconUrl)}" class="walkthrough-achievement-icon">` : ''}
            <div class="walkthrough-achievement-text">
                <div class="walkthrough-achievement-name">${escapeHtml(step.name || '')}</div>
                <div class="walkthrough-achievement-desc">${escapeHtml(step.description || '')}</div>
            </div>
        `;
        return card;
    }

    const p = document.createElement('p');
    p.className = 'walkthrough-step-text';
    p.textContent = step.text || '';
    return p;
}

function renderStepView() {
    const section = currentSection();
    if (!section) return;

    const steps = section.steps || [];
    const step = steps[currentStepIndex];

    readerStepContent.innerHTML = '';
    if (step) readerStepContent.appendChild(renderStepElement(step));

    readerStepPosition.textContent = `Step ${currentStepIndex + 1} of ${steps.length}`;
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
// VOICE — "next" / "back" / "stop", nothing else. Deliberately a small
// dedicated listener rather than reusing collection-hub/voice-search.js's
// matcher, which solves a different problem (snapping spoken words to
// Pokémon names) — there's nothing to snap here, just three fixed
// keywords. No button at all where SpeechRecognition is unsupported, same
// guard voice-search.js itself uses.
// ---------------------------
(function attachWalkthroughMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const micBtn = document.createElement('span');
    micBtn.id = 'walkthrough-mic';
    micBtn.className = 'voice-search';
    micBtn.textContent = '🎤';
    micBtn.title = 'Say "next", "back", or "stop"';
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

    recognition.addEventListener('result', (e) => {
        if (!listening) return;

        for (let i = e.resultIndex; i < e.results.length; i++) {
            const words = e.results[i][0].transcript.trim().split(/\s+/).map(normalize);

            if (words.includes('stop')) { stop(); return; }
            if (words.includes('back')) goToStep(-1);
            else if (words.includes('next')) goToStep(1);
        }
    });

    recognition.addEventListener('end', () => {
        if (!listening) return;
        try {
            recognition.start();
        } catch {
            stop();
        }
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
