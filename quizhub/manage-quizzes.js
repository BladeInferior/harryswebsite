import { QUIZ_PATHS } from './data/quiz-registry.js';
import { db } from './firebase/firebase-config.js';
import { collection, getDocs, doc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { hashPassword } from './password-utils.js';

const quizList = document.getElementById('quiz-list');
const deleteModal = document.getElementById('delete-confirm-modal');
const deleteConfirmText = document.getElementById('delete-confirm-text');
const deleteConfirmError = document.getElementById('delete-confirm-error');
const deletePasswordField = document.getElementById('delete-password-field');
const deletePasswordInput = document.getElementById('delete-password-input');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

let pendingDeleteQuiz = null;

const staticQuizzes = Object.entries(QUIZ_PATHS).map(([id, dataPath]) =>
    fetch(dataPath)
        .then(res => res.json())
        .then(data => ({ ...data, id, source: 'static' }))
);

const firestoreQuizzes = getDocs(collection(db, 'quizzes')).then(snapshot =>
    snapshot.docs.map(docSnap => ({ ...docSnap.data(), id: docSnap.id, source: 'firestore' }))
);

Promise.all([Promise.all(staticQuizzes), firestoreQuizzes]).then(([staticList, firestoreList]) => {
    const quizzes = [...staticList, ...firestoreList];

    quizList.innerHTML = '';

    quizzes.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'card';

        const h3 = document.createElement('h3');
        h3.textContent = quiz.title;

        const p = document.createElement('p');
        p.textContent = quiz.description || '';

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const startLink = document.createElement('a');
        startLink.className = 'btn';
        startLink.href = `host-quiz.html?quiz=${encodeURIComponent(quiz.id)}`;
        startLink.textContent = 'Start Quiz';
        actions.appendChild(startLink);

        if (quiz.source === 'firestore') {
            const editLink = document.createElement('a');
            editLink.className = 'btn btn-secondary';
            editLink.href = `builder.html?quiz=${encodeURIComponent(quiz.id)}`;
            editLink.textContent = 'Edit';
            actions.appendChild(editLink);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => openDeleteConfirm(quiz));
            actions.appendChild(deleteBtn);
        }

        card.appendChild(h3);
        card.appendChild(p);
        card.appendChild(actions);
        quizList.appendChild(card);
    });
});

function openDeleteConfirm(quiz) {
    pendingDeleteQuiz = quiz;
    deleteConfirmText.textContent = `"${quiz.title}" will be permanently deleted. This can't be undone.`;
    deleteConfirmError.hidden = true;
    deletePasswordInput.value = '';
    deletePasswordField.hidden = !quiz.editPasswordHash;
    deleteModal.hidden = false;
}

cancelDeleteBtn.addEventListener('click', () => {
    pendingDeleteQuiz = null;
    deleteModal.hidden = true;
});

deleteModal.addEventListener('click', e => {
    if (e.target === deleteModal) {
        pendingDeleteQuiz = null;
        deleteModal.hidden = true;
    }
});

confirmDeleteBtn.addEventListener('click', async () => {
    if (!pendingDeleteQuiz) return;

    if (pendingDeleteQuiz.editPasswordHash) {
        const hash = await hashPassword(deletePasswordInput.value);
        if (hash !== pendingDeleteQuiz.editPasswordHash) {
            deleteConfirmError.textContent = 'Incorrect password.';
            deleteConfirmError.hidden = false;
            return;
        }
    }

    confirmDeleteBtn.disabled = true;
    try {
        await deleteDoc(doc(db, 'quizzes', pendingDeleteQuiz.id));
        deleteModal.hidden = true;
        pendingDeleteQuiz = null;
        window.location.reload();
    } catch (err) {
        console.error(err);
        alert('Failed to delete — check console.');
    } finally {
        confirmDeleteBtn.disabled = false;
    }
});
