// Quiz Ideas — owner-only scratchpad inside the quiz hub: free-text notes
// (with dictation) and single-question drafts that can be previewed with the
// real quiz answer widgets and then sent into an existing quiz.
//
// Data lives in two Firestore collections, `quizIdeaNotes` and
// `quizIdeaDrafts`. The sign-in gate below is only a UI nicety — the real
// protection is owner-only Firestore rules on those collections (and write
// access to `quizzes` for "Send to a quiz"), set in the Firebase console.
import { db } from '../firebase/firebase-config.js';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import {
    signInAdmin,
    signOutAdmin,
    onAdminStateChange,
    getCurrentUser,
    redirectResultReady
} from '../../admin-auth-core.js';

const NOTES_COLLECTION = 'quizIdeaNotes';
const DRAFTS_COLLECTION = 'quizIdeaDrafts';

const $ = id => document.getElementById(id);

// =========================
// SIGN-IN GATE
// =========================
const gateEl = $('gate');
const gateBtn = $('gate-signin-btn');
const gateError = $('gate-error');
const contentEl = $('ideas-content');
let started = false;

redirectResultReady.catch(err => {
    gateError.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
    gateError.hidden = false;
});

gateBtn.addEventListener('click', async () => {
    gateError.hidden = true;
    gateBtn.disabled = true;
    try {
        if (getCurrentUser()) await signOutAdmin();
        else await signInAdmin();
    } catch (err) {
        console.error(err);
        gateError.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
        gateError.hidden = false;
    } finally {
        gateBtn.disabled = false;
    }
});

onAdminStateChange((authorized, user) => {
    gateEl.hidden = authorized;
    contentEl.hidden = !authorized;

    if (user && !authorized) {
        gateError.textContent = `Signed in as ${user.email}, which isn't authorized for this. Sign out and try a different account.`;
        gateError.hidden = false;
        gateBtn.textContent = 'Sign out';
    } else {
        gateError.hidden = true;
        gateBtn.textContent = 'Sign in with Google';
    }

    if (authorized && !started) {
        started = true;
        subscribeToNotes();
        subscribeToDrafts();
    }
});

// =========================
// SHARED HELPERS
// =========================
const confirmModal = $('confirm-modal');

// Promise<boolean> stand-in for window.confirm(), which browsers can
// silently auto-dismiss.
function askConfirm(title, message, yesLabel = 'Delete') {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-yes-btn').textContent = yesLabel;
    confirmModal.hidden = false;

    return new Promise(resolve => {
        function done(result) {
            confirmModal.hidden = true;
            $('confirm-yes-btn').removeEventListener('click', yes);
            $('confirm-no-btn').removeEventListener('click', no);
            confirmModal.removeEventListener('click', backdrop);
            resolve(result);
        }
        const yes = () => done(true);
        const no = () => done(false);
        const backdrop = e => { if (e.target === confirmModal) done(false); };
        $('confirm-yes-btn').addEventListener('click', yes);
        $('confirm-no-btn').addEventListener('click', no);
        confirmModal.addEventListener('click', backdrop);
    });
}

function makeDebouncedSaver(fn, ms = 600) {
    let timer = null;
    return {
        schedule() { clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(); }, ms); },
        // Runs a pending save right now (used before switching away).
        flush() { if (timer) { clearTimeout(timer); timer = null; fn(); } },
        cancel() { clearTimeout(timer); timer = null; }
    };
}

// =========================
// TABS
// =========================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        $('tab-notes').hidden = tab.dataset.tab !== 'notes';
        $('tab-questions').hidden = tab.dataset.tab !== 'questions';
        stopDictation();
    });
});

document.querySelectorAll('.back-to-list-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const app = $(btn.dataset.back === 'notes' ? 'tab-notes' : 'tab-questions');
        app.classList.remove('editing');
    });
});

// =========================
// DICTATION (notes)
// =========================
// A small dedicated SpeechRecognition listener — not collection-hub's
// voice-search.js, whose matcher snaps words to Pokémon names. This one just
// types what it hears. "pause" ignores everything until "unpause"; a lone
// "stop" turns the mic off; "new line" / "new paragraph" insert breaks.
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('note-mic-btn');
let recognition = null;
let micOn = false;
let micPaused = false;

if (!SpeechRec) micBtn.hidden = true;

function setMicUI() {
    micBtn.classList.toggle('on', micOn);
    micBtn.classList.toggle('paused', micOn && micPaused);
    micBtn.textContent = !micOn ? '🎤 Dictate' : micPaused ? '⏸ Paused' : '🎤 Listening…';
}

function stopDictation() {
    micOn = false;
    micPaused = false;
    if (recognition) {
        try { recognition.abort(); } catch (e) { /* already stopped */ }
        recognition = null;
    }
    setMicUI();
}

function startDictation() {
    if (!SpeechRec) return;
    micOn = true;
    micPaused = false;

    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-GB';

    recognition.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) handleSpeech(e.results[i][0].transcript);
        }
    };
    recognition.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopDictation();
    };
    // The session ends on its own after silences — keep going while "on".
    recognition.onend = () => {
        if (!micOn || !recognition) return;
        setTimeout(() => {
            if (micOn && recognition) {
                try { recognition.start(); } catch (e) { /* still ending; next onend retries */ }
            }
        }, 200);
    };

    try { recognition.start(); } catch (e) { console.error(e); }
    setMicUI();
}

function handleSpeech(raw) {
    const plain = raw.toLowerCase().replace(/[^a-z ]/g, '').trim();

    if (plain === 'unpause' || plain === 'un pause') { micPaused = false; setMicUI(); return; }
    if (micPaused) return;
    if (plain === 'pause') { micPaused = true; setMicUI(); return; }
    if (plain === 'stop') { stopDictation(); return; }

    let text = raw.trim()
        .replace(/\bnew paragraph\b[.,]?/gi, '\n\n')
        .replace(/\bnew line\b[.,]?/gi, '\n');
    if (!text) return;

    const body = $('note-body');
    const current = body.value;
    const atStart = current === '' || /[\n]\s*$/.test(current);

    if (atStart || /[.!?]\s*$/.test(current)) text = text.charAt(0).toUpperCase() + text.slice(1);
    const needsSpace = current !== '' && !/\s$/.test(current) && !/^\s/.test(text);

    body.value = current + (needsSpace ? ' ' : '') + text;
    body.scrollTop = body.scrollHeight;
    noteSaver.schedule();
    setNoteStatus('Saving…');
}

micBtn.addEventListener('click', () => {
    if (micOn) stopDictation();
    else startDictation();
});

// =========================
// NOTES
// =========================
let notes = [];
let activeNoteId = null;

const noteList = $('notes-list');
const noteTitle = $('note-title');
const noteBody = $('note-body');
const noteEditor = $('note-editor');
const noteEmpty = $('note-empty');
const noteSearch = $('note-search');
const noteSaver = makeDebouncedSaver(saveActiveNote);

function setNoteStatus(text) { $('note-status').textContent = text; }

function subscribeToNotes() {
    const q = query(collection(db, NOTES_COLLECTION), orderBy('updatedAt', 'desc'));
    onSnapshot(q, snap => {
        notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNoteList();
        if (activeNoteId && !notes.some(n => n.id === activeNoteId)) closeNote();
    }, err => {
        console.error(err);
        noteList.innerHTML = '<p class="list-empty">Couldn\'t load notes — check the Firestore rules for <b>quizIdeaNotes</b>.</p>';
    });
}

function renderNoteList() {
    noteList.innerHTML = '';
    const term = noteSearch.value.trim().toLowerCase();
    const shown = notes.filter(n => !term || `${n.title || ''} ${n.content || ''}`.toLowerCase().includes(term));

    if (!shown.length) {
        const p = document.createElement('p');
        p.className = 'list-empty';
        p.textContent = notes.length ? 'No notes match.' : 'No notes yet — create one to get started.';
        noteList.appendChild(p);
        return;
    }

    shown.forEach(n => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'list-item' + (n.id === activeNoteId ? ' active' : '');

        const title = document.createElement('div');
        title.className = 'list-title' + (n.title ? '' : ' empty');
        title.textContent = n.title || 'Untitled';

        const snippet = document.createElement('div');
        snippet.className = 'list-snippet';
        snippet.textContent = (n.content || '').replace(/\s+/g, ' ').slice(0, 80);

        item.append(title, snippet);
        item.addEventListener('click', () => openNote(n.id));
        noteList.appendChild(item);
    });
}

noteSearch.addEventListener('input', renderNoteList);

function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    noteSaver.flush();
    stopDictation();

    activeNoteId = id;
    noteTitle.value = note.title || '';
    noteBody.value = note.content || '';
    noteEmpty.hidden = true;
    noteEditor.hidden = false;
    $('tab-notes').classList.add('editing');
    setNoteStatus('Saved');
    renderNoteList();
}

function closeNote() {
    stopDictation();
    activeNoteId = null;
    noteEditor.hidden = true;
    noteEmpty.hidden = false;
    $('tab-notes').classList.remove('editing');
    renderNoteList();
}

$('new-note-btn').addEventListener('click', async () => {
    const data = { title: '', content: '' };
    const ref = await addDoc(collection(db, NOTES_COLLECTION), {
        ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    if (!notes.some(n => n.id === ref.id)) notes.unshift({ id: ref.id, ...data });
    openNote(ref.id);
    noteTitle.focus();
});

async function saveActiveNote() {
    if (!activeNoteId) return;
    const id = activeNoteId;
    try {
        await updateDoc(doc(db, NOTES_COLLECTION, id), {
            title: noteTitle.value.trim(),
            content: noteBody.value,
            updatedAt: serverTimestamp()
        });
        if (activeNoteId === id) setNoteStatus('Saved');
    } catch (err) {
        console.error(err);
        if (activeNoteId === id) setNoteStatus('Failed to save');
    }
}

[noteTitle, noteBody].forEach(el => el.addEventListener('input', () => {
    setNoteStatus('Saving…');
    noteSaver.schedule();
}));

$('note-delete-btn').addEventListener('click', async () => {
    if (!activeNoteId) return;
    if (!await askConfirm('Delete note?', "This can't be undone.")) return;

    const id = activeNoteId;
    noteSaver.cancel();
    closeNote();
    try {
        await deleteDoc(doc(db, NOTES_COLLECTION, id));
    } catch (err) {
        console.error(err);
        alert('Failed to delete — check console.');
    }
});

// =========================
// QUESTION DRAFTS
// =========================
const TYPE_OPTIONS = [
    ['text', 'Text'],
    ['mc-buttons', 'Multiple Choice (buttons)'],
    ['mc-dropdown', 'Multiple Choice (dropdown)'],
    ['image-select', 'Image Select'],
    ['ordering', 'Ordering'],
    ['number', 'Number'],
    ['multi-answer', 'Multi-Answer'],
    ['buzzer', 'Buzzer']
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS);

function newDraftDefaults() {
    return {
        type: 'text',
        status: 'rough',
        topic: '',
        prompt: '',
        points: 1,
        mediaSrc: '',
        explanation: '',
        accepted: '',
        options: [{ label: '', correct: true }, { label: '', correct: false }],
        imageOptions: [{ src: '', alt: '', correct: true }, { src: '', alt: '', correct: false }],
        items: ['', ''],
        numberRange: false,
        numExact: '',
        numMin: '',
        numMax: '',
        multiAccepted: '',
        multiMax: '',
        sentTo: null
    };
}

let drafts = [];
let activeDraftId = null;
let draft = null;            // working copy of the open draft
let statusFilter = 'all';

const draftList = $('drafts-list');
const draftEditor = $('draft-editor');
const draftEmpty = $('draft-empty');
const typeFields = $('d-type-fields');
const previewMount = $('d-preview');
const draftSaver = makeDebouncedSaver(saveActiveDraft);
const previewTimer = makeDebouncedSaver(renderPreview, 250);

function setDraftStatus(text) { $('draft-status').textContent = text; }

$('d-type').innerHTML = TYPE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

function subscribeToDrafts() {
    const q = query(collection(db, DRAFTS_COLLECTION), orderBy('updatedAt', 'desc'));
    onSnapshot(q, snap => {
        drafts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDraftList();
        refreshTopicOptions();
        if (activeDraftId && !drafts.some(d => d.id === activeDraftId)) closeDraft();
    }, err => {
        console.error(err);
        draftList.innerHTML = '<p class="list-empty">Couldn\'t load drafts — check the Firestore rules for <b>quizIdeaDrafts</b>.</p>';
    });
}

function refreshTopicOptions() {
    const topics = [...new Set(drafts.map(d => (d.topic || '').trim()).filter(Boolean))].sort();
    $('topic-options').innerHTML = topics.map(t => `<option value="${t.replace(/"/g, '&quot;')}">`).join('');
}

function renderDraftList() {
    draftList.innerHTML = '';
    const shown = drafts.filter(d => statusFilter === 'all' || (d.status || 'rough') === statusFilter);

    if (!shown.length) {
        const p = document.createElement('p');
        p.className = 'list-empty';
        p.textContent = drafts.length ? 'Nothing with that status.' : 'No drafts yet — press “Add Question”.';
        draftList.appendChild(p);
        return;
    }

    shown.forEach(d => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'list-item' + (d.id === activeDraftId ? ' active' : '');

        const title = document.createElement('div');
        title.className = 'list-title' + (d.prompt ? '' : ' empty');
        title.textContent = d.prompt || '(no question yet)';

        const meta = document.createElement('div');
        meta.className = 'list-meta';
        const addBadge = (text, cls = '') => {
            const b = document.createElement('span');
            b.className = 'badge ' + cls;
            b.textContent = text;
            meta.appendChild(b);
        };
        addBadge(TYPE_LABEL[d.type] || d.type);
        addBadge(d.status === 'ready' ? 'Ready' : 'Rough', d.status === 'ready' ? 'ready' : 'rough');
        if (d.topic) addBadge(d.topic);
        if (d.sentTo) addBadge('Sent', 'sent');

        item.append(title, meta);
        item.addEventListener('click', () => openDraft(d.id));
        draftList.appendChild(item);
    });
}

document.querySelectorAll('#draft-filter .chip').forEach(chip => {
    chip.addEventListener('click', () => {
        statusFilter = chip.dataset.status;
        document.querySelectorAll('#draft-filter .chip').forEach(c => c.classList.toggle('active', c === chip));
        renderDraftList();
    });
});

function openDraft(id) {
    const found = drafts.find(d => d.id === id);
    if (!found) return;

    draftSaver.flush();

    activeDraftId = id;
    // Merge over defaults so drafts saved before a field existed still work.
    const { id: _id, createdAt, updatedAt, ...fields } = found;
    draft = { ...newDraftDefaults(), ...structuredCloneSafe(fields) };

    draftEmpty.hidden = true;
    draftEditor.hidden = false;
    $('tab-questions').classList.add('editing');
    setDraftStatus('Saved');

    fillFormFromDraft();
    renderPreview();
    renderDraftList();
}

function structuredCloneSafe(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function closeDraft() {
    draftSaver.cancel();
    activeDraftId = null;
    draft = null;
    draftEditor.hidden = true;
    draftEmpty.hidden = false;
    $('tab-questions').classList.remove('editing');
    renderDraftList();
}

$('new-draft-btn').addEventListener('click', async () => {
    const data = newDraftDefaults();
    const ref = await addDoc(collection(db, DRAFTS_COLLECTION), {
        ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    if (!drafts.some(d => d.id === ref.id)) drafts.unshift({ id: ref.id, ...data });
    openDraft(ref.id);
    $('d-prompt').focus();
});

async function saveActiveDraft() {
    if (!activeDraftId || !draft) return;
    const id = activeDraftId;
    try {
        await updateDoc(doc(db, DRAFTS_COLLECTION, id), { ...draft, updatedAt: serverTimestamp() });
        if (activeDraftId === id) setDraftStatus('Saved');
    } catch (err) {
        console.error(err);
        if (activeDraftId === id) setDraftStatus('Failed to save');
    }
}

// Called after any edit: autosave + refresh the preview.
function changed() {
    setDraftStatus('Saving…');
    draftSaver.schedule();
    previewTimer.schedule();
}

$('draft-delete-btn').addEventListener('click', async () => {
    if (!activeDraftId) return;
    if (!await askConfirm('Delete draft?', "This can't be undone.")) return;

    const id = activeDraftId;
    closeDraft();
    try {
        await deleteDoc(doc(db, DRAFTS_COLLECTION, id));
    } catch (err) {
        console.error(err);
        alert('Failed to delete — check console.');
    }
});

// ---------- form ----------
function bindInput(id, key, transform = v => v) {
    $(id).addEventListener('input', e => {
        draft[key] = transform(e.target.value);
        changed();
    });
}

bindInput('d-topic', 'topic');
bindInput('d-prompt', 'prompt');
bindInput('d-points', 'points');
bindInput('d-media', 'mediaSrc');
bindInput('d-explanation', 'explanation');

$('d-status').addEventListener('change', e => { draft.status = e.target.value; changed(); });

$('d-type').addEventListener('change', e => {
    draft.type = e.target.value;
    renderTypeFields();
    changed();
});

function fillFormFromDraft() {
    $('d-type').value = draft.type;
    $('d-status').value = draft.status || 'rough';
    $('d-topic').value = draft.topic || '';
    $('d-prompt').value = draft.prompt || '';
    $('d-points').value = draft.points || 1;
    $('d-media').value = draft.mediaSrc || '';
    $('d-explanation').value = draft.explanation || '';
    renderTypeFields();
    renderSentNote();
}

function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    children.forEach(c => e.append(c));
    return e;
}

function textInput(value, placeholder, onInput) {
    const i = el('input', { type: 'text', className: 'field-input', value: value || '', placeholder });
    i.addEventListener('input', () => onInput(i.value));
    return i;
}

function removeButton(onClick) {
    const b = el('button', { type: 'button', className: 'row-btn', title: 'Remove', textContent: '×' });
    b.addEventListener('click', onClick);
    return b;
}

function addButton(label, onClick) {
    const b = el('button', { type: 'button', className: 'btn btn-secondary btn-small', textContent: label });
    b.addEventListener('click', onClick);
    return b;
}

function block(label, ...children) {
    return el('div', { className: 'type-block' }, el('span', { className: 'block-label', textContent: label }), ...children);
}

// Radio-per-row list for the "one correct answer" types.
function renderChoiceRows(arr, makeRowInputs, minRows) {
    const wrap = el('div');
    const radioName = 'correct-' + Math.random().toString(36).slice(2);

    arr.forEach((item, i) => {
        const radio = el('input', { type: 'radio', name: radioName, checked: !!item.correct, title: 'Correct answer' });
        radio.addEventListener('change', () => {
            arr.forEach((o, j) => { o.correct = j === i; });
            changed();
        });

        const row = el('div', { className: 'option-row' }, radio, ...makeRowInputs(item, i));
        if (arr.length > minRows) {
            row.append(removeButton(() => {
                const wasCorrect = arr[i].correct;
                arr.splice(i, 1);
                if (wasCorrect && arr.length) arr[0].correct = true;
                renderTypeFields();
                changed();
            }));
        }
        wrap.appendChild(row);
    });
    return wrap;
}

function renderTypeFields() {
    typeFields.innerHTML = '';
    const t = draft.type;

    if (t === 'text') {
        typeFields.append(block('Accepted answers (comma separated)',
            textInput(draft.accepted, 'e.g. Pikachu, pika', v => { draft.accepted = v; changed(); })));

    } else if (t === 'mc-buttons' || t === 'mc-dropdown') {
        typeFields.append(block('Options — tick the correct one',
            renderChoiceRows(draft.options, (o, i) =>
                [textInput(o.label, `Option ${i + 1}`, v => { o.label = v; changed(); })], 2),
            addButton('+ Add option', () => {
                draft.options.push({ label: '', correct: false });
                renderTypeFields();
                changed();
            })));

    } else if (t === 'image-select') {
        typeFields.append(block('Image options — tick the correct one',
            renderChoiceRows(draft.imageOptions, (o, i) => [
                textInput(o.src, 'Image link', v => { o.src = v; changed(); }),
                textInput(o.alt, 'Label', v => { o.alt = v; changed(); })
            ], 2),
            addButton('+ Add image', () => {
                draft.imageOptions.push({ src: '', alt: '', correct: false });
                renderTypeFields();
                changed();
            })));

    } else if (t === 'ordering') {
        const wrap = el('div');
        draft.items.forEach((label, i) => {
            const row = el('div', { className: 'option-row' },
                el('span', { className: 'row-num', textContent: String(i + 1) }),
                textInput(label, `Item ${i + 1}`, v => { draft.items[i] = v; changed(); }));
            if (draft.items.length > 2) {
                row.append(removeButton(() => {
                    draft.items.splice(i, 1);
                    renderTypeFields();
                    changed();
                }));
            }
            wrap.appendChild(row);
        });
        typeFields.append(block('Items in the CORRECT order (players see them shuffled)',
            wrap,
            addButton('+ Add item', () => {
                draft.items.push('');
                renderTypeFields();
                changed();
            })));

    } else if (t === 'number') {
        const rangeBox = el('input', { type: 'checkbox', checked: !!draft.numberRange });
        const holder = el('div');

        const renderNumberInputs = () => {
            holder.innerHTML = '';
            if (draft.numberRange) {
                const min = el('input', { type: 'number', className: 'field-input', placeholder: 'Min', value: draft.numMin });
                const max = el('input', { type: 'number', className: 'field-input', placeholder: 'Max', value: draft.numMax });
                min.addEventListener('input', () => { draft.numMin = min.value; changed(); });
                max.addEventListener('input', () => { draft.numMax = max.value; changed(); });
                holder.append(el('div', { className: 'option-row' }, min, max));
            } else {
                const exact = el('input', { type: 'number', className: 'field-input', placeholder: 'Correct number', value: draft.numExact });
                exact.addEventListener('input', () => { draft.numExact = exact.value; changed(); });
                holder.append(exact);
            }
        };
        rangeBox.addEventListener('change', () => {
            draft.numberRange = rangeBox.checked;
            renderNumberInputs();
            changed();
        });
        renderNumberInputs();

        typeFields.append(block('Answer',
            el('label', { className: 'check-row' }, rangeBox, 'Accept a range'),
            holder));

    } else if (t === 'multi-answer') {
        const max = el('input', { type: 'number', className: 'field-input', min: 1, placeholder: 'Max answers (blank = all)', value: draft.multiMax });
        max.addEventListener('input', () => { draft.multiMax = max.value; changed(); });
        typeFields.append(
            block('Accepted answers (comma separated)',
                textInput(draft.multiAccepted, 'e.g. Mars, Venus, Earth', v => { draft.multiAccepted = v; changed(); })),
            block('How many answer boxes?', max));

    } else if (t === 'buzzer') {
        typeFields.append(el('p', { className: 'hint', textContent: 'Players just buzz in; you judge the answer live. Nothing else to fill in.' }));
    }
}

// ---------- build a real quiz question from the draft ----------
function splitList(s) {
    return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Always returns a renderable question (filling gaps with placeholders so
// the preview works on half-written drafts) plus a `problems` list of what a
// real quiz would still need. Sending to a quiz requires problems to be empty.
// `forQuiz` shuffles ordering items randomly like the builder does; the
// preview just reverses them so it doesn't reshuffle on every keystroke.
function buildQuestion(d, { forQuiz = false } = {}) {
    const problems = [];
    const prompt = (d.prompt || '').trim();
    if (!prompt) problems.push('a question');

    const points = parseInt(d.points, 10) || 1;
    const src = (d.mediaSrc || '').trim();
    const media = src ? { kind: MediaUtils.guessKind(src), src, alt: '', silhouette: false } : null;

    let type;
    let config;

    if (d.type === 'text') {
        type = 'text';
        const accepted = splitList(d.accepted);
        if (!accepted.length) problems.push('an accepted answer');
        config = { acceptedAnswers: accepted.length ? accepted : ['(answer)'] };

    } else if (d.type === 'mc-buttons' || d.type === 'mc-dropdown') {
        type = 'multiple-choice';
        const opts = d.options;
        if (opts.length < 2 || opts.some(o => !o.label.trim())) problems.push('at least 2 filled-in options');
        const options = opts.map((o, i) => ({ id: 'opt' + (i + 1), label: o.label.trim() || `Option ${i + 1}` }));
        let correctIdx = opts.findIndex(o => o.correct);
        if (correctIdx < 0) { problems.push('a correct option'); correctIdx = 0; }
        config = {
            display: d.type === 'mc-dropdown' ? 'dropdown' : 'buttons',
            options,
            correctOptionId: options[correctIdx] ? options[correctIdx].id : 'opt1'
        };

    } else if (d.type === 'image-select') {
        type = 'image-select';
        const withSrc = d.imageOptions.filter(o => o.src.trim());
        if (withSrc.length < 2 || withSrc.length !== d.imageOptions.length) problems.push('at least 2 image options, each with a link');
        const options = withSrc.map((o, i) => ({ id: 'opt' + (i + 1), src: o.src.trim(), alt: o.alt.trim() }));
        let correctIdx = withSrc.findIndex(o => o.correct);
        if (correctIdx < 0) { problems.push('a correct image'); correctIdx = 0; }
        config = { options, correctOptionId: options[correctIdx] ? options[correctIdx].id : 'opt1' };

    } else if (d.type === 'ordering') {
        type = 'ordering';
        if (d.items.length < 2 || d.items.some(l => !l.trim())) problems.push('at least 2 filled-in items');
        const correctItems = d.items.map((l, i) => ({ id: 'item' + (i + 1), label: l.trim() || `Item ${i + 1}` }));
        const correctOrder = correctItems.map(i => i.id);
        let items = forQuiz ? shuffled(correctItems) : correctItems.slice().reverse();
        if (forQuiz && correctItems.length > 1) {
            let tries = 0;
            while (items.map(i => i.id).join() === correctOrder.join() && tries++ < 20) items = shuffled(correctItems);
        }
        config = { items, correctOrder };

    } else if (d.type === 'number') {
        type = 'number';
        if (d.numberRange) {
            const min = Number(d.numMin);
            const max = Number(d.numMax);
            const bad = String(d.numMin).trim() === '' || String(d.numMax).trim() === '' || Number.isNaN(min) || Number.isNaN(max);
            if (bad) problems.push('a min and max');
            else if (min > max) problems.push('min no greater than max');
            config = { mode: 'range', min: bad ? 0 : min, max: bad ? 0 : max };
        } else {
            const v = Number(d.numExact);
            const bad = String(d.numExact).trim() === '' || Number.isNaN(v);
            if (bad) problems.push('the correct number');
            config = { mode: 'exact', correctValue: bad ? 0 : v };
        }

    } else if (d.type === 'multi-answer') {
        type = 'multi-answer';
        const accepted = splitList(d.multiAccepted);
        if (!accepted.length) problems.push('accepted answers');
        const maxRaw = String(d.multiMax).trim();
        let maxAnswers = maxRaw ? parseInt(maxRaw, 10) : accepted.length;
        if (!Number.isFinite(maxAnswers) || maxAnswers < 1) {
            if (maxRaw) problems.push('a positive max answers');
            maxAnswers = Math.max(accepted.length, 1);
        }
        config = { acceptedAnswers: accepted.length ? accepted : ['(answer)'], maxAnswers };

    } else {
        type = 'buzzer';
        config = {};
    }

    return {
        question: { type, prompt, media, points, timeLimitSeconds: null, config, explanation: (d.explanation || '').trim() },
        problems
    };
}

// ---------- preview ----------
let previewQuestion = null;
let previewAnswerMount = null;

function renderPreview() {
    if (!draft) return;

    // The answer widgets focus their first input on render, which would steal
    // the caret from whatever field is being typed in — put it back after.
    const active = document.activeElement;

    const { question, problems } = buildQuestion(draft);
    previewQuestion = question;

    previewMount.innerHTML = '';
    const card = el('div', { className: 'question-card' });
    card.append(el('h2', {
        className: question.prompt ? '' : 'placeholder',
        textContent: question.prompt || 'Your question will appear here'
    }));

    const mediaMount = el('div');
    card.append(mediaMount);
    MediaUtils.render(question.media, mediaMount, false);

    const answerMount = el('div');
    previewAnswerMount = answerMount;
    card.append(answerMount);
    try {
        AnswerTypeRegistry.get(question.type).renderInput(question, answerMount);
    } catch (err) {
        console.error(err);
        answerMount.textContent = 'Couldn\'t preview this one yet.';
    }
    card.append(el('div', { className: 'preview-points', textContent: `${question.points} point${question.points === 1 ? '' : 's'}` }));
    previewMount.append(card);

    $('preview-result').hidden = true;
    $('preview-check-btn').hidden = question.type === 'buzzer';

    const problemsEl = $('preview-problems');
    problemsEl.hidden = !problems.length;
    problemsEl.textContent = problems.length ? 'Still needs: ' + problems.join(', ') + '.' : '';

    if (active && active !== document.body && active.focus && document.contains(active)) active.focus();
}

$('preview-reset-btn').addEventListener('click', renderPreview);

$('preview-check-btn').addEventListener('click', () => {
    if (!previewQuestion) return;
    const q = previewQuestion;
    const impl = AnswerTypeRegistry.get(q.type);
    const mount = previewAnswerMount;
    if (!mount) return;

    const value = impl.getValue(mount);
    const result = impl.grade(value, q);
    impl.reveal(mount, q, value, result);

    let answerText = result.correctValue;
    if (q.type === 'ordering') {
        answerText = result.correctValue.map(id => q.config.items.find(i => i.id === id).label).join(' → ');
    } else if (q.type === 'multiple-choice' || q.type === 'image-select') {
        const opt = q.config.options.find(o => o.id === q.config.correctOptionId);
        answerText = opt ? (opt.label || opt.alt || opt.id) : '';
    }

    const out = $('preview-result');
    const ok = q.type === 'multi-answer' ? result.correctCount > 0 : result.correct;
    out.className = 'preview-result ' + (ok ? 'correct' : 'incorrect');
    out.textContent = q.type === 'multi-answer'
        ? `${result.correctCount} of ${q.config.acceptedAnswers.length} correct. Answers: ${answerText}`
        : `${ok ? '✅ Correct' : '❌ Not quite'} — answer: ${answerText}`;
    out.hidden = false;
});

// =========================
// SEND TO A QUIZ
// =========================
const sendModal = $('send-modal');
const sendQuiz = $('send-quiz');
const sendCategory = $('send-category');
const sendNewRow = $('send-new-category-row');
const sendNewInput = $('send-new-category');
const sendError = $('send-error');
const NEW_CATEGORY = '__new__';
let quizzes = [];

function renderSentNote() {
    const note = $('sent-note');
    const s = draft && draft.sentTo;
    note.hidden = !s;
    if (!s) return;
    note.textContent = '';
    note.append(`Sent to “${s.title}” (${s.category}). `);
    note.append(el('a', { href: `../builder/builder.html?quiz=${encodeURIComponent(s.quizId)}`, textContent: 'Open in builder' }));
}

function showSendError(msg) {
    sendError.textContent = msg;
    sendError.hidden = false;
}

function categoriesOf(quiz) {
    const names = [];
    (quiz.questions || []).forEach(q => {
        const name = q.category || 'General';
        if (!names.includes(name)) names.push(name);
    });
    (quiz.categoryMeta || []).forEach(m => { if (!names.includes(m.name)) names.push(m.name); });
    return names;
}

function fillCategoryOptions() {
    const quiz = quizzes.find(q => q.id === sendQuiz.value);
    const names = quiz ? categoriesOf(quiz) : [];
    sendCategory.innerHTML = '';
    names.forEach(n => sendCategory.append(el('option', { value: n, textContent: n })));
    sendCategory.append(el('option', { value: NEW_CATEGORY, textContent: '+ New category…' }));

    // Pre-pick the draft's topic label if the quiz already has that category.
    const topic = (draft && draft.topic || '').trim().toLowerCase();
    const match = names.find(n => n.toLowerCase() === topic);
    sendCategory.value = match || (names.length ? names[0] : NEW_CATEGORY);
    if (!match && !names.length && topic) sendNewInput.value = draft.topic.trim();
    sendNewRow.hidden = sendCategory.value !== NEW_CATEGORY;
}

sendQuiz.addEventListener('change', fillCategoryOptions);
sendCategory.addEventListener('change', () => { sendNewRow.hidden = sendCategory.value !== NEW_CATEGORY; });
$('send-cancel-btn').addEventListener('click', () => { sendModal.hidden = true; });
sendModal.addEventListener('click', e => { if (e.target === sendModal) sendModal.hidden = true; });

$('send-btn').addEventListener('click', async () => {
    if (!draft) return;
    draftSaver.flush();
    sendError.hidden = true;

    const { problems } = buildQuestion(draft);
    if (problems.length) {
        await askConfirm('Not ready to send', 'Still needs: ' + problems.join(', ') + '.', 'OK');
        return;
    }

    try {
        const snap = await getDocs(collection(db, 'quizzes'));
        quizzes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } catch (err) {
        console.error(err);
        await askConfirm('Couldn\'t load your quizzes', 'Check the console for details.', 'OK');
        return;
    }

    if (!quizzes.length) {
        await askConfirm('No quizzes yet', 'Create a quiz in the Quiz Builder first, then send this question to it.', 'OK');
        return;
    }

    sendQuiz.innerHTML = '';
    quizzes.forEach(q => sendQuiz.append(el('option', { value: q.id, textContent: q.title || '(untitled)' })));
    sendNewInput.value = '';
    fillCategoryOptions();
    sendModal.hidden = false;
});

$('send-confirm-btn').addEventListener('click', async () => {
    const quiz = quizzes.find(q => q.id === sendQuiz.value);
    if (!quiz) return;

    const isNew = sendCategory.value === NEW_CATEGORY;
    const category = (isNew ? sendNewInput.value : sendCategory.value).trim();
    if (!category) { showSendError('Enter a category name.'); return; }

    if (draft.sentTo && !await askConfirm('Send again?', `This draft was already sent to “${draft.sentTo.title}”. Sending it again adds a second copy.`, 'Send anyway')) return;

    const btn = $('send-confirm-btn');
    btn.disabled = true;

    try {
        const { question } = buildQuestion(draft, { forQuiz: true });
        const questions = quiz.questions || [];
        const nextQuestions = [...questions, { ...question, id: 'q' + (questions.length + 1), category }];

        const update = { questions: nextQuestions };
        const meta = quiz.categoryMeta || [];
        if (!meta.some(m => m.name === category)) {
            update.categoryMeta = [...meta, {
                name: category, background: '', questionBackground: '', titleScreen: null, exampleScreen: null
            }];
        }

        await updateDoc(doc(db, 'quizzes', quiz.id), update);

        draft.sentTo = { quizId: quiz.id, title: quiz.title || '(untitled)', category, at: Date.now() };
        draft.status = 'ready';
        $('d-status').value = 'ready';
        renderSentNote();
        saveActiveDraft();
        sendModal.hidden = true;
    } catch (err) {
        console.error(err);
        showSendError('Failed to add — check the console (the Firestore rules may not allow writing to quizzes).');
    } finally {
        btn.disabled = false;
    }
});
