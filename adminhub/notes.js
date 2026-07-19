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
const deleteBtn = document.getElementById('delete-note-btn');
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
    contentInput.value = note.content || '';

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
            content: contentInput.value,
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
contentInput.addEventListener('input', scheduleSave);

deleteBtn.addEventListener('click', async () => {
    if (!activeNoteId) return;
    if (!confirm("Delete this note? This can't be undone.")) return;

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
