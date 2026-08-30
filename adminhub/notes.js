import { requireAdminAuth } from './auth.js';
import { db, storage } from './firebase/firebase-config.js';
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
import {
    ref as storageRef,
    uploadBytes,
    getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js';

const adminContent = document.getElementById('admin-content');
const notesListEl = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const titleInput = document.getElementById('note-title-input');
const contentInput = document.getElementById('note-content-input');
const addCheckboxBtn = document.getElementById('add-checkbox-btn');
const addImageBtn = document.getElementById('add-image-btn');
const imageFileInput = document.getElementById('note-image-input');
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

const CHECKBOX_LINE_RE = /^\[( |x|X)\] (.*)$/;
const IMAGE_LINE_RE = /^\[img\] (.*)$/;

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

function createImageLine(url) {
    const line = document.createElement('div');
    line.className = 'note-line note-line-image';
    line.dataset.type = 'image';
    line.dataset.url = url;

    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    line.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'note-image-remove-btn';
    removeBtn.title = 'Remove image';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
        const prev = line.previousElementSibling;
        line.remove();

        // Never leave the editor with zero lines — nothing left to click
        // into to start typing again.
        if (contentInput.children.length === 0) {
            const newLine = createTextLine('');
            contentInput.appendChild(newLine);
            focusLineStart(newLine);
        } else {
            const target = prev ? getEditablePart(prev) : getEditablePart(contentInput.firstElementChild);
            if (target) focusLineEnd(target);
        }

        scheduleSave();
    });
    line.appendChild(removeBtn);

    return line;
}

function lineOfType(type, text, checked) {
    if (type === 'checkbox') return createCheckboxLine(text, checked);
    if (type === 'image') return createImageLine(text);
    return createTextLine(text);
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

function focusLineStart(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function getEditablePart(lineEl) {
    if (!lineEl) return null;
    if (lineEl.dataset.type === 'image') return null;
    return lineEl.dataset.type === 'checkbox' ? lineEl.querySelector('.note-line-text') : lineEl;
}

// `editableEl` is what actually receives keystrokes (the line itself for
// text lines, the inner span for checkbox lines); `lineEl` is the whole row
// that gets inserted/removed as a unit.
function attachLineEvents(editableEl, lineEl) {

    editableEl.addEventListener('input', scheduleSave);

    editableEl.addEventListener('keydown', e => {

        if (e.key === 'Enter') {
            e.preventDefault();

            // Split at the cursor, like a normal text editor — text before
            // it stays on this line, text after it moves to the new one,
            // rather than always inserting a blank line and leaving this
            // one's text untouched regardless of where the cursor was.
            const selection = window.getSelection();
            const range = selection.rangeCount ? selection.getRangeAt(0) : null;

            let beforeText = editableEl.textContent;
            let afterText = '';

            if (range) {
                const beforeRange = document.createRange();
                beforeRange.selectNodeContents(editableEl);
                beforeRange.setEnd(range.startContainer, range.startOffset);
                beforeText = beforeRange.toString();

                const afterRange = document.createRange();
                afterRange.selectNodeContents(editableEl);
                afterRange.setStart(range.endContainer, range.endOffset);
                afterText = afterRange.toString();
            }

            editableEl.textContent = beforeText;

            const newLine = lineOfType(lineEl.dataset.type, afterText, false);
            lineEl.insertAdjacentElement('afterend', newLine);
            focusLineStart(getEditablePart(newLine));
            scheduleSave();
            return;
        }

        if (e.key === 'Backspace' && editableEl.textContent === '' && contentInput.children.length > 1) {
            e.preventDefault();
            const prev = lineEl.previousElementSibling;
            lineEl.remove();
            const prevEditable = getEditablePart(prev);
            if (prevEditable) {
                focusLineEnd(prevEditable);
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
        const imageMatch = raw.match(IMAGE_LINE_RE);
        if (imageMatch) {
            contentInput.appendChild(createImageLine(imageMatch[1]));
            return;
        }

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
        if (line.dataset.type === 'image') {
            return `[img] ${line.dataset.url}`;
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

// The reference line (where to insert) has to be captured on click, before
// the OS file picker steals focus — by the time the async upload finishes,
// document.activeElement is back on the page but no longer reflects where
// the cursor was.
let imageInsertReferenceLine = null;

addImageBtn.addEventListener('click', () => {
    const active = document.activeElement;
    imageInsertReferenceLine = contentInput.contains(active) ? active.closest('.note-line') : null;

    imageFileInput.value = '';
    imageFileInput.click();
});

imageFileInput.addEventListener('change', async () => {
    const file = imageFileInput.files[0];
    if (!file || !activeNoteId) return;

    const referenceLine = imageInsertReferenceLine;
    const noteId = activeNoteId;

    setSaveStatus('Uploading image…');

    try {
        const path = `notes/${noteId}/${Date.now()}-${file.name}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);

        // The note may have been switched away from while the upload was
        // in flight — drop the result rather than inserting it into
        // whatever note happens to be open now.
        if (activeNoteId !== noteId) return;

        const newLine = createImageLine(url);

        if (referenceLine && contentInput.contains(referenceLine)) {
            referenceLine.insertAdjacentElement('afterend', newLine);
        } else {
            contentInput.appendChild(newLine);
        }

        scheduleSave();
    } catch (err) {
        console.error(err);
        setSaveStatus('Image upload failed');
    }
});

// Clicking a line (or its text) already places the cursor there natively —
// this only fires for clicks that land on the container itself: the empty
// space below the last line (contentInput is flex:1, so there's usually a
// lot of it) or in the padding around the lines. Matches a normal textarea,
// where clicking anywhere below the text still starts you typing at the end
// of it instead of doing nothing.
contentInput.addEventListener('click', e => {
    if (e.target !== contentInput) return;

    const lastLine = contentInput.lastElementChild;
    const editable = getEditablePart(lastLine);
    if (editable) focusLineEnd(editable);
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
