import { db } from './firebase/firebase-config.js';
import { collection, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const titleInput = document.getElementById('quiz-title-input');
const descInput = document.getElementById('quiz-description-input');
const categoriesContainer = document.getElementById('categories-container');
const addCategoryBtn = document.getElementById('add-category-btn');
const addQuestionBtn = document.getElementById('add-question-btn');
const saveQuizBtn = document.getElementById('save-quiz-btn');
const saveQuizStatus = document.getElementById('save-quiz-status');

const questionModal = document.getElementById('question-modal');
const questionModalTitle = document.getElementById('question-modal-title');
const qCategorySelect = document.getElementById('q-category-select');
const qPromptInput = document.getElementById('q-prompt-input');
const qPointsInput = document.getElementById('q-points-input');
const qImageInput = document.getElementById('q-image-input');
const qSilhouetteInput = document.getElementById('q-silhouette-input');
const qExplanationInput = document.getElementById('q-explanation-input');
const qTypeSelect = document.getElementById('q-type-select');
const qError = document.getElementById('q-error');
const saveQuestionBtn = document.getElementById('save-question-btn');
const cancelQuestionBtn = document.getElementById('cancel-question-btn');
const acceptedAnswersInput = document.getElementById('q-accepted-answers');

const mcOptionsList = document.getElementById('mc-options-list');
const imageOptionsList = document.getElementById('image-options-list');
const orderingItemsList = document.getElementById('ordering-items-list');

const numberRangeToggle = document.getElementById('q-number-range-toggle');
const numberExactRow = document.getElementById('number-exact-row');
const numberRangeRow = document.getElementById('number-range-row');
const numberExactInput = document.getElementById('q-number-exact');
const numberMinInput = document.getElementById('q-number-min');
const numberMaxInput = document.getElementById('q-number-max');

const fieldSections = {
    'text': document.getElementById('fields-text'),
    'mc-buttons': document.getElementById('fields-mc'),
    'mc-dropdown': document.getElementById('fields-mc'),
    'image-select': document.getElementById('fields-image-select'),
    'ordering': document.getElementById('fields-ordering'),
    'number': document.getElementById('fields-number')
};

const TYPE_LABELS = {
    'text': 'Text',
    'multiple-choice': 'Multiple Choice',
    'image-select': 'Image Select',
    'ordering': 'Ordering',
    'number': 'Number'
};

// categories = [{ id, name, questions: [questionObj, ...] }]
let categories = [];

// null = adding a new question; otherwise { categoryId, index } of the one being edited
let currentEditContext = null;

// If ?quiz=<id> is present, we're editing an existing Firestore-authored quiz
// rather than creating a new one — Save Quiz updates that doc instead of
// creating a new one.
const params = new URLSearchParams(window.location.search);
const editingQuizId = params.get('quiz');

if (editingQuizId) {
    loadQuizForEditing(editingQuizId);
} else {
    renderCategories();
}

async function loadQuizForEditing(quizId) {
    const snap = await getDoc(doc(db, 'quizzes', quizId));

    if (!snap.exists()) {
        alert("That quiz couldn't be found — it may have been deleted. Starting a new quiz instead.");
        renderCategories();
        return;
    }

    const quiz = snap.data();
    titleInput.value = quiz.title || '';
    descInput.value = quiz.description || '';

    const byCategory = new Map();
    (quiz.questions || []).forEach(q => {
        const categoryName = q.category || 'General';

        if (!byCategory.has(categoryName)) {
            byCategory.set(categoryName, {
                id: 'cat' + Date.now() + Math.floor(Math.random() * 1000) + byCategory.size,
                name: categoryName,
                questions: []
            });
        }

        const { category, ...questionWithoutCategory } = q;
        byCategory.get(categoryName).questions.push(questionWithoutCategory);
    });

    categories = [...byCategory.values()];

    document.querySelector('.hero h1').textContent = '🛠️ Edit Quiz';
    saveQuizBtn.textContent = 'Save Changes';

    renderCategories();
}

// =========================
// CATEGORIES
// =========================
addCategoryBtn.addEventListener('click', () => {
    const name = prompt('Category name:');
    if (!name || !name.trim()) return;

    categories.push({
        id: 'cat' + Date.now() + Math.floor(Math.random() * 1000),
        name: name.trim(),
        questions: []
    });
    renderCategories();
});

addQuestionBtn.addEventListener('click', () => {
    if (!categories.length) {
        alert('Add a category first — questions live inside a category.');
        return;
    }
    openQuestionModal(null);
});

function renderCategories() {
    categoriesContainer.innerHTML = '';

    if (!categories.length) {
        categoriesContainer.innerHTML = '<p class="empty-hint">No categories yet — click "+ Add Category" to start.</p>';
        return;
    }

    categories.forEach(category => {
        const section = document.createElement('section');
        section.className = 'category-section';

        const header = document.createElement('div');
        header.className = 'category-header';

        const h2 = document.createElement('h2');
        h2.textContent = category.name;
        header.appendChild(h2);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-small btn-danger';
        removeBtn.textContent = 'Remove Category';
        removeBtn.addEventListener('click', () => {
            if (category.questions.length && !confirm(`Remove "${category.name}" and its ${category.questions.length} question(s)?`)) return;
            categories = categories.filter(c => c.id !== category.id);
            renderCategories();
        });
        header.appendChild(removeBtn);

        section.appendChild(header);

        const list = document.createElement('div');
        list.className = 'question-list';
        list.dataset.categoryId = category.id;

        if (!category.questions.length) {
            const hint = document.createElement('p');
            hint.className = 'empty-hint';
            hint.textContent = 'No questions in this category yet.';
            list.appendChild(hint);
        }

        category.questions.forEach((question, index) => {
            list.appendChild(createQuestionRow(category, question, index));
        });

        addDragEvents(list);
        section.appendChild(list);
        categoriesContainer.appendChild(section);
    });
}

function createQuestionRow(category, question, index) {
    const row = document.createElement('div');
    row.className = 'question-row';
    row.draggable = true;
    row._question = question;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    row.appendChild(handle);

    const info = document.createElement('div');
    info.className = 'question-row-info';

    const promptSpan = document.createElement('span');
    promptSpan.textContent = question.prompt;
    info.appendChild(promptSpan);

    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = TYPE_LABELS[question.type] || question.type;
    info.appendChild(badge);

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'question-row-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openQuestionModal({ categoryId: category.id, index }));
    actions.appendChild(editBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
        category.questions.splice(index, 1);
        renderCategories();
    });
    actions.appendChild(removeBtn);

    row.appendChild(actions);

    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        syncCategoryOrderFromDOM(category);
        renderCategories();
    });

    return row;
}

// =========================
// DRAG-AND-DROP REORDER (within a single category's list only)
// =========================
function addDragEvents(listEl) {
    listEl.addEventListener('dragover', e => {
        e.preventDefault();

        const dragging = listEl.querySelector('.dragging');
        if (!dragging) return;

        const afterElement = getDragAfterElement(listEl, e.clientY);
        if (afterElement == null) {
            listEl.appendChild(dragging);
        } else {
            listEl.insertBefore(dragging, afterElement);
        }
    });
}

function getDragAfterElement(container, y) {
    const rows = [...container.querySelectorAll('.question-row:not(.dragging)')];

    return rows.reduce((closest, row) => {
        const box = row.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset, element: row };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function syncCategoryOrderFromDOM(category) {
    const list = categoriesContainer.querySelector(`.question-list[data-category-id="${category.id}"]`);
    if (!list) return;

    const rows = [...list.querySelectorAll('.question-row')];
    category.questions = rows.map(row => row._question);
}

// =========================
// QUESTION MODAL — field toggling
// =========================
cancelQuestionBtn.addEventListener('click', closeQuestionModal);
qTypeSelect.addEventListener('change', updateVisibleFields);
numberRangeToggle.addEventListener('change', updateNumberModeFields);
document.getElementById('mc-add-option-btn').addEventListener('click', () => addOptionRow(mcOptionsList, false, ''));
document.getElementById('image-add-option-btn').addEventListener('click', () => addImageOptionRow(false, '', ''));
document.getElementById('ordering-add-item-btn').addEventListener('click', () => addOrderingRow(''));

function updateVisibleFields() {
    Object.values(fieldSections).forEach(el => el.hidden = true);
    const section = fieldSections[qTypeSelect.value];
    if (section) section.hidden = false;
}

function updateNumberModeFields() {
    const isRange = numberRangeToggle.checked;
    numberExactRow.hidden = isRange;
    numberRangeRow.hidden = !isRange;
}

// =========================
// DYNAMIC OPTION / ITEM ROWS
// =========================
function resetOptionLists() {
    mcOptionsList.innerHTML = '';
    imageOptionsList.innerHTML = '';
    orderingItemsList.innerHTML = '';
}

function addOptionRow(container, isCorrect, labelValue) {
    const row = document.createElement('div');
    row.className = 'option-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'mc-correct-radio';
    radio.checked = !!isCorrect;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'option-label-input';
    input.placeholder = 'Option text';
    input.value = labelValue || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(radio);
    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

function addImageOptionRow(isCorrect, altValue, srcValue) {
    const row = document.createElement('div');
    row.className = 'option-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'image-correct-radio';
    radio.checked = !!isCorrect;

    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.className = 'option-label-input';
    altInput.placeholder = 'Label';
    altInput.value = altValue || '';

    const srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.className = 'option-src-input';
    srcInput.placeholder = 'Image path';
    srcInput.value = srcValue || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(radio);
    row.appendChild(altInput);
    row.appendChild(srcInput);
    row.appendChild(removeBtn);
    imageOptionsList.appendChild(row);
}

function addOrderingRow(labelValue) {
    const row = document.createElement('div');
    row.className = 'option-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'option-label-input';
    input.placeholder = 'Item (in correct order)';
    input.value = labelValue || '';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => {
        const prev = row.previousElementSibling;
        if (prev) orderingItemsList.insertBefore(row, prev);
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next) orderingItemsList.insertBefore(next, row);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(input);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(removeBtn);
    orderingItemsList.appendChild(row);
}

// =========================
// OPEN / CLOSE MODAL
// =========================
function openQuestionModal(editContext) {
    currentEditContext = editContext;
    qError.hidden = true;
    resetOptionLists();

    qCategorySelect.innerHTML = '';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        qCategorySelect.appendChild(opt);
    });

    if (editContext === null) {
        questionModalTitle.textContent = 'Add Question';
        qPromptInput.value = '';
        qPointsInput.value = '100';
        qImageInput.value = '';
        qSilhouetteInput.checked = false;
        qExplanationInput.value = '';
        qTypeSelect.value = 'text';
        acceptedAnswersInput.value = '';
        numberRangeToggle.checked = false;
        numberExactInput.value = '';
        numberMinInput.value = '';
        numberMaxInput.value = '';
        addOptionRow(mcOptionsList, true, '');
        addOptionRow(mcOptionsList, false, '');
        addImageOptionRow(true, '', '');
        addImageOptionRow(false, '', '');
        addOrderingRow('');
        addOrderingRow('');
    } else {
        const { categoryId, index } = editContext;
        const category = categories.find(c => c.id === categoryId);
        const q = category.questions[index];

        qCategorySelect.value = categoryId;
        questionModalTitle.textContent = 'Edit Question';
        qPromptInput.value = q.prompt;
        qPointsInput.value = q.points;
        qImageInput.value = q.media ? q.media.src : '';
        qSilhouetteInput.checked = !!(q.media && q.media.silhouette);
        qExplanationInput.value = q.explanation || '';

        if (q.type === 'text') {
            qTypeSelect.value = 'text';
            acceptedAnswersInput.value = q.config.acceptedAnswers.join(', ');
            addOptionRow(mcOptionsList, true, '');
            addOptionRow(mcOptionsList, false, '');
            addImageOptionRow(true, '', '');
            addImageOptionRow(false, '', '');
            addOrderingRow('');
            addOrderingRow('');
        } else if (q.type === 'multiple-choice') {
            qTypeSelect.value = q.config.display === 'dropdown' ? 'mc-dropdown' : 'mc-buttons';
            q.config.options.forEach(opt =>
                addOptionRow(mcOptionsList, opt.id === q.config.correctOptionId, opt.label));
            addImageOptionRow(true, '', '');
            addImageOptionRow(false, '', '');
            addOrderingRow('');
            addOrderingRow('');
        } else if (q.type === 'image-select') {
            qTypeSelect.value = 'image-select';
            q.config.options.forEach(opt =>
                addImageOptionRow(opt.id === q.config.correctOptionId, opt.alt, opt.src));
            addOptionRow(mcOptionsList, true, '');
            addOptionRow(mcOptionsList, false, '');
            addOrderingRow('');
            addOrderingRow('');
        } else if (q.type === 'ordering') {
            qTypeSelect.value = 'ordering';
            q.config.correctOrder.forEach(id => {
                const item = q.config.items.find(i => i.id === id);
                addOrderingRow(item ? item.label : '');
            });
            addOptionRow(mcOptionsList, true, '');
            addOptionRow(mcOptionsList, false, '');
            addImageOptionRow(true, '', '');
            addImageOptionRow(false, '', '');
        } else if (q.type === 'number') {
            qTypeSelect.value = 'number';
            if (q.config.mode === 'range') {
                numberRangeToggle.checked = true;
                numberMinInput.value = q.config.min;
                numberMaxInput.value = q.config.max;
            } else {
                numberRangeToggle.checked = false;
                numberExactInput.value = q.config.correctValue;
            }
            addOptionRow(mcOptionsList, true, '');
            addOptionRow(mcOptionsList, false, '');
            addImageOptionRow(true, '', '');
            addImageOptionRow(false, '', '');
            addOrderingRow('');
            addOrderingRow('');
        }
    }

    updateNumberModeFields();
    updateVisibleFields();
    questionModal.hidden = false;
}

function closeQuestionModal() {
    questionModal.hidden = true;
}

function showError(msg) {
    qError.textContent = msg;
    qError.hidden = false;
}

// =========================
// SAVE QUESTION
// =========================
saveQuestionBtn.addEventListener('click', () => {
    const prompt = qPromptInput.value.trim();
    const points = parseInt(qPointsInput.value, 10) || 100;
    const explanation = qExplanationInput.value.trim();
    const imageSrc = qImageInput.value.trim();
    const media = imageSrc ? { kind: 'image', src: imageSrc, alt: '', silhouette: qSilhouetteInput.checked } : null;
    const typeValue = qTypeSelect.value;
    const targetCategoryId = qCategorySelect.value;

    if (!prompt) {
        showError('Please enter a question prompt.');
        return;
    }
    if (!targetCategoryId) {
        showError('Please choose a category.');
        return;
    }

    let type, config;

    if (typeValue === 'text') {
        const accepted = acceptedAnswersInput.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!accepted.length) { showError('Enter at least one accepted answer.'); return; }

        type = 'text';
        config = { acceptedAnswers: accepted };

    } else if (typeValue === 'mc-buttons' || typeValue === 'mc-dropdown') {
        const rows = Array.from(mcOptionsList.querySelectorAll('.option-row'));
        if (rows.length < 2) { showError('Add at least 2 options.'); return; }

        const options = [];
        let correctOptionId = null;

        rows.forEach((row, i) => {
            const id = 'opt' + (i + 1);
            const label = row.querySelector('.option-label-input').value.trim();
            const radio = row.querySelector('input[type="radio"]');
            options.push({ id, label });
            if (radio.checked) correctOptionId = id;
        });

        if (options.some(o => !o.label)) { showError('All options need text.'); return; }
        if (!correctOptionId) { showError('Mark one option as correct.'); return; }

        type = 'multiple-choice';
        config = { display: typeValue === 'mc-dropdown' ? 'dropdown' : 'buttons', options, correctOptionId };

    } else if (typeValue === 'image-select') {
        const rows = Array.from(imageOptionsList.querySelectorAll('.option-row'));
        if (rows.length < 2) { showError('Add at least 2 image options.'); return; }

        const options = [];
        let correctOptionId = null;

        rows.forEach((row, i) => {
            const id = 'opt' + (i + 1);
            const alt = row.querySelector('.option-label-input').value.trim();
            const src = row.querySelector('.option-src-input').value.trim();
            const radio = row.querySelector('input[type="radio"]');
            options.push({ id, src, alt });
            if (radio.checked) correctOptionId = id;
        });

        if (options.some(o => !o.src)) { showError('All image options need an image path.'); return; }
        if (!correctOptionId) { showError('Mark one image as correct.'); return; }

        type = 'image-select';
        config = { options, correctOptionId };

    } else if (typeValue === 'ordering') {
        const rows = Array.from(orderingItemsList.querySelectorAll('.option-row'));
        if (rows.length < 2) { showError('Add at least 2 items.'); return; }

        const labels = rows.map(row => row.querySelector('.option-label-input').value.trim());
        if (labels.some(l => !l)) { showError('All items need text.'); return; }

        const correctItems = labels.map((label, i) => ({ id: 'item' + (i + 1), label }));
        const correctOrder = correctItems.map(item => item.id);

        let shuffled = shuffle(correctItems);
        if (correctItems.length > 1) {
            let attempts = 0;
            while (shuffled.map(item => item.id).join(',') === correctOrder.join(',') && attempts < 20) {
                shuffled = shuffle(correctItems);
                attempts++;
            }
        }

        type = 'ordering';
        config = { items: shuffled, correctOrder };

    } else if (typeValue === 'number') {
        if (numberRangeToggle.checked) {
            const min = Number(numberMinInput.value);
            const max = Number(numberMaxInput.value);

            if (numberMinInput.value.trim() === '' || numberMaxInput.value.trim() === '' || Number.isNaN(min) || Number.isNaN(max)) {
                showError('Enter a valid min and max.');
                return;
            }
            if (min > max) { showError('Min must not be greater than max.'); return; }

            type = 'number';
            config = { mode: 'range', min, max };
        } else {
            const correctValue = Number(numberExactInput.value);

            if (numberExactInput.value.trim() === '' || Number.isNaN(correctValue)) {
                showError('Enter a valid number.');
                return;
            }

            type = 'number';
            config = { mode: 'exact', correctValue };
        }
    }

    const questionData = { type, prompt, media, points, timeLimitSeconds: null, config, explanation };

    if (currentEditContext === null) {
        categories.find(c => c.id === targetCategoryId).questions.push(questionData);
    } else {
        const { categoryId, index } = currentEditContext;

        if (categoryId === targetCategoryId) {
            categories.find(c => c.id === categoryId).questions[index] = questionData;
        } else {
            categories.find(c => c.id === categoryId).questions.splice(index, 1);
            categories.find(c => c.id === targetCategoryId).questions.push(questionData);
        }
    }

    closeQuestionModal();
    renderCategories();
});

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// =========================
// SAVE QUIZ
// =========================
saveQuizBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const totalQuestions = categories.reduce((sum, c) => sum + c.questions.length, 0);

    if (!title) {
        saveQuizStatus.className = 'failure';
        saveQuizStatus.textContent = 'Please enter a quiz title.';
        return;
    }

    if (!totalQuestions) {
        saveQuizStatus.className = 'failure';
        saveQuizStatus.textContent = 'Add at least one question.';
        return;
    }

    saveQuizBtn.disabled = true;
    saveQuizStatus.className = 'pending';
    saveQuizStatus.textContent = 'Saving...';

    const quizRef = editingQuizId ? doc(db, 'quizzes', editingQuizId) : doc(collection(db, 'quizzes'));
    const quizId = quizRef.id;

    const flatQuestions = [];
    categories.forEach(category => {
        category.questions.forEach(q => {
            flatQuestions.push({ ...q, category: category.name });
        });
    });
    const questionsWithIds = flatQuestions.map((q, i) => ({ ...q, id: 'q' + (i + 1) }));

    try {
        await setDoc(quizRef, {
            id: quizId,
            title,
            description,
            version: 1,
            questions: questionsWithIds
        });

        saveQuizStatus.className = 'success';
        saveQuizStatus.textContent = 'Quiz saved! Redirecting...';

        setTimeout(() => {
            window.location.href = 'manage-quizzes.html';
        }, 800);
    } catch (err) {
        console.error(err);
        saveQuizStatus.className = 'failure';
        saveQuizStatus.textContent = 'Failed to save — check console.';
        saveQuizBtn.disabled = false;
    }
});
