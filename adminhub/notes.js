import { requireAdminAuth } from './auth.js';
import { db } from './firebase/firebase-config.js';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const adminContent = document.getElementById('admin-content');
const notesListEl = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const titleInput = document.getElementById('note-title-input');
const contentInput = document.getElementById('note-content-input');
const addCheckboxBtn = document.getElementById('add-checkbox-btn');
const deleteBtn = document.getElementById('delete-note-btn');
const deleteNoteModal = document.getElementById('delete-note-modal');
const cancelDeleteNoteBtn = document.getElementById('cancel-delete-note-btn');
const confirmDeleteNoteBtn = document.getElementById('confirm-delete-note-btn');
const saveStatusEl = document.getElementById('save-status');
const editorPane = document.getElementById('editor-pane');
const editorEmptyState = document.getElementById('editor-empty-state');
const backToListBtn = document.getElementById('back-to-list-btn');

let notes = [];
let activeNoteId = null;
let saveTimer = null;

requireAdminAuth().then(() => {
    adminContent.classList.remove('hidden');
    subscribeToNotes();
});

// =========================
// CHECKLIST LINES — the note body used to be one plain <textarea>; it's now
// a stack of per-line elements (contentInput's children) so a line can be
// either free text or a real interactive checkbox. Stored/serialized as
// plain text either way (content stays a single string in Firestore,
// backward-compatible with existing notes): a checkbox line round-trips as
// "[ ] text" / "[x] text", GitHub-task-list style, everything else is just
// the line's own text. Deliberately not one big contenteditable region —
// each line owns its own contenteditable so Enter/Backspace can be handled
// precisely (create/remove a whole line) instead of fighting the browser's
// own, inconsistent-across-browsers contenteditable line-splitting.
const CHECKBOX_LINE_RE = /^\[( |x|X)\] (.*)$/;

function createTextLine(text = '') {
    const line = document.createElement('div');
    line.className = 'note-line note-line-text';
    line.contentEditable = 'true';
    line.dataset.type = 'text';
    line.textContent = text;
    attachLineEvents(line, line);
    return line;
}

function createCheckboxLine(text = '', checked = false) {
    const line = document.createElement('div');
    line.className = 'note-line note-line-checkbox';
    line.dataset.type = 'checkbox';
    if (checked) line.classList.add('checked');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => {
        line.classList.toggle('checked', checkbox.checked);
        scheduleSave();
    });

    const textSpan = document.createElement('span');
    textSpan.className = 'note-line-text';
    textSpan.contentEditable = 'true';
    textSpan.textContent = text;
    attachLineEvents(textSpan, line);

    line.appendChild(checkbox);
    line.appendChild(textSpan);
    return line;
}

function lineOfType(type, text, checked) {
    return type === 'checkbox' ? createCheckboxLine(text, checked) : createTextLine(text);
}

function focusLineEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

// `editableEl` is what actually receives keystrokes (the line itself for
// text lines, the inner span for checkbox lines); `lineEl` is the whole row
// that gets inserted/removed as a unit.
function attachLineEvents(editableEl, lineEl) {

    editableEl.addEventListener('input', scheduleSave);

    editableEl.addEventListener('keydown', e => {

        if (e.key === 'Enter') {
            e.preventDefault();
            const newLine = lineOfType(lineEl.dataset.type, '', false);
            lineEl.insertAdjacentElement('afterend', newLine);
            focusLineEnd(newLine.dataset.type === 'checkbox' ? newLine.querySelector('.note-line-text') : newLine);
            scheduleSave();
            return;
        }

        if (e.key === 'Backspace' && editableEl.textContent === '' && contentInput.children.length > 1) {
            e.preventDefault();
            const prev = lineEl.previousElementSibling;
            lineEl.remove();
            if (prev) {
                focusLineEnd(prev.dataset.type === 'checkbox' ? prev.querySelector('.note-line-text') : prev);
            }
            scheduleSave();
        }
    });

    // Plain-text paste only — pasted HTML/formatting has no meaning here.
    // A multi-line paste can't fit inside one line's contenteditable, so
    // each pasted line becomes its own new line (still checking for [ ]/[x]
    // syntax) instead of being silently flattened or rejected.
    editableEl.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');

        if (!text.includes('\n')) {
            document.execCommand('insertText', false, text);
            return;
        }

        let insertAfter = lineEl;
        text.split('\n').forEach(raw => {
            const match = raw.match(CHECKBOX_LINE_RE);
            const newLine = match
                ? createCheckboxLine(match[2], match[1].toLowerCase() === 'x')
                : createTextLine(raw);
            insertAfter.insertAdjacentElement('afterend', newLine);
            insertAfter = newLine;
        });
        scheduleSave();
    });
}

function deserializeContent(text) {
    contentInput.innerHTML = '';
    const lines = (text || '').split('\n');

    lines.forEach(raw => {
        const match = raw.match(CHECKBOX_LINE_RE);
        contentInput.appendChild(
            match ? createCheckboxLine(match[2], match[1].toLowerCase() === 'x') : createTextLine(raw)
        );
    });
}

function serializeContent() {
    return Array.from(contentInput.children).map(line => {
        if (line.dataset.type === 'checkbox') {
            const checked = line.querySelector('input[type="checkbox"]').checked;
            const text = line.querySelector('.note-line-text').textContent;
            return `[${checked ? 'x' : ' '}] ${text}`;
        }
        return line.textContent;
    }).join('\n');
}

addCheckboxBtn.addEventListener('click', () => {
    const active = document.activeElement;
    const referenceLine = contentInput.contains(active) ? active.closest('.note-line') : null;

    const newLine = createCheckboxLine();

    if (referenceLine) {
        referenceLine.insertAdjacentElement('afterend', newLine);
    } else {
        contentInput.appendChild(newLine);
    }

    focusLineEnd(newLine.querySelector('.note-line-text'));
    scheduleSave();
});

function subscribeToNotes() {
    const notesQuery = query(collection(db, 'notes'), orderBy('updatedAt', 'desc'));

    onSnapshot(notesQuery, snapshot => {
        notes = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        renderList();

        // Note was deleted (e.g. from another tab) while open here.
        if (activeNoteId && !notes.some(n => n.id === activeNoteId)) {
            closeEditor();
        }
    });
}

function renderList() {
    notesListEl.innerHTML = '';

    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'notes-empty';
        empty.textContent = 'No notes yet — create one to get started.';
        notesListEl.appendChild(empty);
        return;
    }

    notes.forEach(note => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'note-list-item';
        if (note.id === activeNoteId) item.classList.add('active');

        const title = document.createElement('div');
        title.className = 'note-list-title';
        title.textContent = note.title || 'Untitled';

        const snippet = document.createElement('div');
        snippet.className = 'note-list-snippet';
        snippet.textContent = (note.content || '').slice(0, 80);

        item.appendChild(title);
        item.appendChild(snippet);

        item.addEventListener('click', () => openNote(note.id));

        notesListEl.appendChild(item);
    });
}

function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Any pending autosave on the previously open note should still land
    // before we swap the editor's contents out from under it.
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveActiveNote();
    }

    activeNoteId = id;
    titleInput.value = note.title || '';
    deserializeContent(note.content || '');

    editorEmptyState.classList.add('hidden');
    editorPane.classList.remove('hidden');
    document.body.classList.add('note-open');

    setSaveStatus('Saved');
    renderList();
}

function closeEditor() {
    activeNoteId = null;
    editorPane.classList.add('hidden');
    editorEmptyState.classList.remove('hidden');
    document.body.classList.remove('note-open');
    renderList();
}

newNoteBtn.addEventListener('click', async () => {
    const docRef = await addDoc(collection(db, 'notes'), {
        title: '',
        content: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    openNote(docRef.id);
    titleInput.focus();
});

function scheduleSave() {
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActiveNote, 600);
}

async function saveActiveNote() {
    saveTimer = null;
    if (!activeNoteId) return;

    const id = activeNoteId;

    try {
        await updateDoc(doc(db, 'notes', id), {
            title: titleInput.value.trim(),
            content: serializeContent(),
            updatedAt: serverTimestamp()
        });
        if (activeNoteId === id) setSaveStatus('Saved');
    } catch (err) {
        console.error(err);
        if (activeNoteId === id) setSaveStatus('Failed to save');
    }
}

function setSaveStatus(text) {
    saveStatusEl.textContent = text;
}

titleInput.addEventListener('input', scheduleSave);
// contentInput's own children (each line) handle their own 'input' via
// attachLineEvents() — there's no single editable region to listen on here.

deleteBtn.addEventListener('click', () => {
    if (!activeNoteId) return;
    deleteNoteModal.classList.remove('hidden');
});

cancelDeleteNoteBtn.addEventListener('click', () => {
    deleteNoteModal.classList.add('hidden');
});

deleteNoteModal.addEventListener('click', e => {
    if (e.target === deleteNoteModal) deleteNoteModal.classList.add('hidden');
});

confirmDeleteNoteBtn.addEventListener('click', async () => {
    if (!activeNoteId) return;

    deleteNoteModal.classList.add('hidden');

    clearTimeout(saveTimer);
    saveTimer = null;

    const id = activeNoteId;
    closeEditor();

    try {
        await deleteDoc(doc(db, 'notes', id));
    } catch (err) {
        console.error(err);
        alert('Failed to delete — check console.');
    }
});

backToListBtn.addEventListener('click', () => {
    document.body.classList.remove('note-open');
});
