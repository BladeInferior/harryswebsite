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
    line.dataset.type = 'text';
    line.textContent = text;
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
    textSpan.textContent = text;

    line.appendChild(checkbox);
    line.appendChild(textSpan);
    return line;
}

function createImageLine(url) {
    const line = document.createElement('div');
    line.className = 'note-line note-line-image';
    line.dataset.type = 'image';
    line.dataset.url = url;
    line.contentEditable = 'false';

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
    contentInput.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function focusLineStart(el) {
    contentInput.focus();
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

// The whole editor is ONE contenteditable (contentInput), so a drag or
// Shift+click selection can span several lines. Each line is just a styled
// block inside it. The browser's own Enter/Backspace/Delete/cross-line delete
// would mangle the checkbox/image line structure, so those are done by hand
// below (editing within a single line is left to the browser).
contentInput.contentEditable = 'true';

function setCaret(editableEl, offset) {
    contentInput.focus();
    const range = document.createRange();
    if (editableEl.firstChild) range.setStart(editableEl.firstChild, Math.min(offset, editableEl.textContent.length));
    else range.setStart(editableEl, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function lineOfNode(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el && el !== contentInput ? el.closest('.note-line') : null;
}

// Maps a DOM boundary point to { line, offset } where offset counts
// characters into that line's editable text. `isEnd` matters only for points
// on the container itself (between lines).
function resolvePoint(node, offset, isEnd) {
    const kids = contentInput.children;
    if (!kids.length) return null;

    if (node === contentInput) {
        if (isEnd) {
            const line = kids[Math.max(0, Math.min(offset - 1, kids.length - 1))];
            const ed = getEditablePart(line);
            return { line, offset: ed && offset > 0 ? ed.textContent.length : 0 };
        }
        if (offset >= kids.length) {
            const line = kids[kids.length - 1];
            const ed = getEditablePart(line);
            return { line, offset: ed ? ed.textContent.length : 0 };
        }
        return { line: kids[offset], offset: 0 };
    }

    const line = lineOfNode(node);
    if (!line || !contentInput.contains(line)) return null;
    const ed = getEditablePart(line);
    if (!ed) return { line, offset: 0 };

    const er = document.createRange();
    er.selectNodeContents(ed);
    const cmp = er.comparePoint(node, offset);
    if (cmp < 0) return { line, offset: 0 };
    if (cmp > 0) return { line, offset: ed.textContent.length };
    er.setEnd(node, offset);
    return { line, offset: er.toString().length };
}

function caretPoint() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !contentInput.contains(sel.anchorNode)) return null;
    return resolvePoint(sel.anchorNode, sel.anchorOffset, false);
}

// Line the cursor is on (null if the editor has no selection).
function currentLine() {
    const p = caretPoint();
    return p ? p.line : null;
}

// Deletes a selection that spans more than one line: text before the
// selection in its first line and text after it in its last line join into
// the first line; everything in between goes. Returns false (doing nothing)
// when the selection sits inside one line, so the browser handles that.
function deleteAcrossLines(range) {
    const s = resolvePoint(range.startContainer, range.startOffset, false);
    const e = resolvePoint(range.endContainer, range.endOffset, true);
    if (!s || !e || s.line === e.line) return false;

    const sEd = getEditablePart(s.line);
    const eEd = getEditablePart(e.line);
    const before = sEd ? sEd.textContent.slice(0, s.offset) : '';
    const after = eEd ? eEd.textContent.slice(e.offset) : '';

    let target = s.line;
    if (!sEd) {
        target = createTextLine('');
        s.line.insertAdjacentElement('beforebegin', target);
    }

    const kids = Array.from(contentInput.children);
    const si = kids.indexOf(s.line);
    const ei = kids.indexOf(e.line);
    for (let i = sEd ? si + 1 : si; i <= ei; i++) kids[i].remove();

    const ed = getEditablePart(target);
    ed.textContent = before + after;
    setCaret(ed, before.length);
    return true;
}

// Removes whatever is selected (one line or several), leaving a caret.
function removeSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    if (!deleteAcrossLines(sel.getRangeAt(0))) document.execCommand('delete');
}

contentInput.addEventListener('input', scheduleSave);

// Typing over / deleting / cutting a multi-line selection.
contentInput.addEventListener('beforeinput', e => {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const t = e.inputType;
    if (!(t.startsWith('delete') || t === 'insertText')) return;

    if (!deleteAcrossLines(sel.getRangeAt(0))) return;
    e.preventDefault();
    if (t === 'insertText' && e.data) document.execCommand('insertText', false, e.data);
    scheduleSave();
});

contentInput.addEventListener('keydown', e => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const isEnter = e.key === 'Enter';
    const isBack = e.key === 'Backspace';
    const isDel = e.key === 'Delete';
    if (!isEnter && !isBack && !isDel) return;

    const sel = window.getSelection();
    if (!sel.rangeCount || !contentInput.contains(sel.anchorNode)) return;

    // With a selection, Backspace/Delete are handled by 'beforeinput';
    // Enter replaces the selection with a line break.
    if (!sel.isCollapsed) {
        if (!isEnter) return;
        e.preventDefault();
        removeSelection();
    }

    const p = caretPoint();
    if (!p) return;
    const line = p.line;
    const ed = getEditablePart(line);

    if (isEnter) {
        e.preventDefault();

        if (!ed) { // cursor on an image: new text line under it
            const newLine = createTextLine('');
            line.insertAdjacentElement('afterend', newLine);
            focusLineStart(newLine);
            scheduleSave();
            return;
        }

        // Split at the cursor: text before stays, text after moves to the
        // new line (same type as this one).
        const text = ed.textContent;
        ed.textContent = text.slice(0, p.offset);
        const newLine = lineOfType(line.dataset.type, text.slice(p.offset), false);
        line.insertAdjacentElement('afterend', newLine);
        focusLineStart(getEditablePart(newLine));
        scheduleSave();
        return;
    }

    if (!ed) { // images are removed with their x button
        e.preventDefault();
        return;
    }

    if (isBack && p.offset === 0) {
        e.preventDefault();
        const prev = line.previousElementSibling;
        if (!prev) return;
        const prevEd = getEditablePart(prev);

        if (ed.textContent === '') {
            line.remove();
            if (prevEd) focusLineEnd(prevEd);
        } else if (prevEd) {
            const len = prevEd.textContent.length;
            prevEd.textContent += ed.textContent;
            line.remove();
            setCaret(prevEd, len);
        } else {
            return;
        }
        scheduleSave();
        return;
    }

    if (isDel && p.offset === ed.textContent.length) {
        e.preventDefault();
        const next = line.nextElementSibling;
        const nextEd = next && getEditablePart(next);
        if (!nextEd) return;
        const len = ed.textContent.length;
        ed.textContent += nextEd.textContent;
        next.remove();
        setCaret(ed, len);
        scheduleSave();
    }
});

// Plain-text paste only: pasted HTML/formatting has no meaning here.
// A multi-line paste becomes one new line per pasted line (still checking for
// [ ]/[x] syntax). A selection is replaced, as in any editor.
contentInput.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');

    removeSelection();

    if (!text.includes('\n')) {
        document.execCommand('insertText', false, text);
        return;
    }

    let insertAfter = currentLine() || contentInput.lastElementChild;
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

// A caret that lands on a checkbox line itself (e.g. clicking just left of
// the box) would type outside its text span and lose the text on save, so
// nudge it into the span.
document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 1 || !node.classList.contains('note-line-checkbox')) return;
    if (!contentInput.contains(node)) return;
    const span = node.querySelector('.note-line-text');
    if (span) setCaret(span, sel.anchorOffset <= 1 ? 0 : span.textContent.length);
});

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
    const referenceLine = currentLine();

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
    imageInsertReferenceLine = currentLine();

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
// contentInput itself is the single editable region (see above).

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
