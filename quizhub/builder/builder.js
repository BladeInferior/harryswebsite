import { db } from './firebase/firebase-config.js';
import { collection, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { hashPassword } from './password-utils.js';
import { downloadTemplate, parseFile, validateRows } from './import-questions.js';

const titleInput = document.getElementById('quiz-title-input');
const descInput = document.getElementById('quiz-description-input');
const revealModeInput = document.getElementById('quiz-reveal-mode-input');
const buzzerQuizRevealNote = document.getElementById('buzzer-quiz-reveal-note');
const quizBuzzerToggle = document.getElementById('quiz-buzzer-toggle');
const quizBuzzerScoreThroughoutRow = document.getElementById('quiz-buzzer-score-throughout-row');
const quizBuzzerScoreThroughoutToggle = document.getElementById('quiz-buzzer-score-throughout-toggle');
const quizBuzzersDefaultOpenToggle = document.getElementById('quiz-buzzers-default-open-toggle');
const quizDefaultExplanationsToggle = document.getElementById('quiz-default-explanations-toggle');
const reviewEnabledToggle = document.getElementById('quiz-review-enabled-toggle');
const quizPasswordLabel = document.getElementById('quiz-password-label');
const quizPasswordInput = document.getElementById('quiz-password-input');
const quizRemovePasswordRow = document.getElementById('quiz-remove-password-row');
const quizRemovePasswordToggle = document.getElementById('quiz-remove-password-toggle');
const categoriesContainer = document.getElementById('categories-container');
const addCategoryBtn = document.getElementById('add-category-btn');
const saveQuizBtn = document.getElementById('save-quiz-btn');
const saveQuizStatus = document.getElementById('save-quiz-status');

const importSpreadsheetBtn = document.getElementById('import-spreadsheet-btn');
const importModal = document.getElementById('import-modal');
const downloadTemplateBtn = document.getElementById('download-template-btn');
const importFileInput = document.getElementById('import-file-input');
const importStatus = document.getElementById('import-status');
const importPreview = document.getElementById('import-preview');
const importValidCount = document.getElementById('import-valid-count');
const importPreviewList = document.getElementById('import-preview-list');
const importErrors = document.getElementById('import-errors');
const importErrorList = document.getElementById('import-error-list');
const confirmImportBtn = document.getElementById('confirm-import-btn');
const cancelImportBtn = document.getElementById('cancel-import-btn');

const passwordCheckModal = document.getElementById('password-check-modal');
const passwordCheckError = document.getElementById('password-check-error');
const passwordCheckInput = document.getElementById('password-check-input');
const passwordCheckSubmitBtn = document.getElementById('password-check-submit-btn');

// The edit/delete password hash currently stored on the quiz being edited
// (null for a brand-new quiz, or one with no password set).
let existingPasswordHash = null;

const categoryModal = document.getElementById('category-modal');
const categoryModalTitle = document.getElementById('category-modal-title');
const catError = document.getElementById('cat-error');
const catNameInput = document.getElementById('cat-name-input');
const catBackgroundInput = document.getElementById('cat-background-input');
const catQuestionBackgroundInput = document.getElementById('cat-question-background-input');
const catTitleToggle = document.getElementById('cat-title-toggle');
const catTitleFields = document.getElementById('cat-title-fields');
const catTitleTextInput = document.getElementById('cat-title-text-input');
const catExampleToggle = document.getElementById('cat-example-toggle');
const catExampleFields = document.getElementById('cat-example-fields');
const catExampleTextInput = document.getElementById('cat-example-text-input');
const saveCategoryBtn = document.getElementById('save-category-btn');
const cancelCategoryBtn = document.getElementById('cancel-category-btn');

const questionModal = document.getElementById('question-modal');
const questionModalTitle = document.getElementById('question-modal-title');
const qCategorySelect = document.getElementById('q-category-select');
const qPromptInput = document.getElementById('q-prompt-input');
const qPointsInput = document.getElementById('q-points-input');
const qMediaToggle = document.getElementById('q-media-toggle');
const qMediaFields = document.getElementById('q-media-fields');
const qImageInput = document.getElementById('q-image-input');
const qMediaTypeSelect = document.getElementById('q-media-type-select');
const qSilhouetteRow = document.getElementById('q-silhouette-row');
const qSilhouetteInput = document.getElementById('q-silhouette-input');
const qMediaPreview = document.getElementById('q-media-preview');
const qExplanationToggle = document.getElementById('q-explanation-toggle');
const qExplanationFields = document.getElementById('q-explanation-fields');
const qExplanationInput = document.getElementById('q-explanation-input');
const qTypeSelect = document.getElementById('q-type-select');
const qError = document.getElementById('q-error');
const saveQuestionBtn = document.getElementById('save-question-btn');
const cancelQuestionBtn = document.getElementById('cancel-question-btn');
const acceptedAnswersInput = document.getElementById('q-accepted-answers');

const mcOptionsList = document.getElementById('mc-options-list');
const imageOptionsList = document.getElementById('image-options-list');
const orderingItemsList = document.getElementById('ordering-items-list');

const multiAnswerAcceptedInput = document.getElementById('q-multi-answer-accepted');
const multiAnswerMaxInput = document.getElementById('q-multi-answer-max');

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
    'number': document.getElementById('fields-number'),
    'multi-answer': document.getElementById('fields-multi-answer'),
    'buzzer': document.getElementById('fields-buzzer')
};

const TYPE_LABELS = {
    'text': 'Text',
    'multiple-choice': 'Multiple Choice',
    'image-select': 'Image Select',
    'ordering': 'Ordering',
    'number': 'Number',
    'multi-answer': 'Multi-Answer',
    'buzzer': 'Buzzer'
};

// categories = [{ id, name, background, titleScreen, exampleScreen, questions: [questionObj, ...] }]
// titleScreen / exampleScreen are either null or { text, image }
let categories = [];

// null = adding a new question; otherwise { categoryId, index } of the one being edited
let currentEditContext = null;

// null = adding a new category; otherwise the category object being edited
let categoryEditContext = null;

// If ?quiz=<id> is present, we're editing an existing Firestore-authored quiz
// rather than creating a new one — Save Quiz updates that doc instead of
// creating a new one. activeQuizId starts the same but, for a brand-new
// quiz, gets set to the freshly-created doc id after the first save so
// later saves in the same session update that doc instead of creating
// duplicates (see 8.1 — Save no longer navigates away).
const params = new URLSearchParams(window.location.search);
const editingQuizId = params.get('quiz');
let activeQuizId = editingQuizId;

if (editingQuizId) {
    document.getElementById('back-button-link').href = 'manage-quizzes.html';
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
    existingPasswordHash = quiz.editPasswordHash || null;

    if (existingPasswordHash) {
        await requirePasswordUnlock(existingPasswordHash);
    }

    populateBuilderFromQuiz(quiz);
}

// Blocks (via an unresolved promise) until the correct password is entered
// into the password-check modal — the caller awaits this before revealing
// any of the protected quiz's content.
function requirePasswordUnlock(expectedHash) {
    return new Promise(resolve => {
        passwordCheckModal.hidden = false;
        passwordCheckError.hidden = true;
        passwordCheckInput.value = '';
        passwordCheckInput.focus();

        async function attempt() {
            const hash = await hashPassword(passwordCheckInput.value);
            if (hash === expectedHash) {
                passwordCheckModal.hidden = true;
                passwordCheckSubmitBtn.removeEventListener('click', attempt);
                passwordCheckInput.removeEventListener('keydown', onKeydown);
                resolve();
            } else {
                passwordCheckError.textContent = 'Incorrect password.';
                passwordCheckError.hidden = false;
                passwordCheckInput.value = '';
                passwordCheckInput.focus();
            }
        }

        function onKeydown(e) {
            if (e.key === 'Enter') attempt();
        }

        passwordCheckSubmitBtn.addEventListener('click', attempt);
        passwordCheckInput.addEventListener('keydown', onKeydown);
    });
}

function populateBuilderFromQuiz(quiz) {
    titleInput.value = quiz.title || '';
    descInput.value = quiz.description || '';
    revealModeInput.value = quiz.answerRevealMode || 'immediate';
    quizBuzzerToggle.checked = !!quiz.isBuzzerQuiz;
    quizBuzzerScoreThroughoutToggle.checked = !!quiz.buzzerShowScoreThroughout;
    quizBuzzersDefaultOpenToggle.checked = quiz.buzzersDefaultOpen !== false;
    quizDefaultExplanationsToggle.checked = !!quiz.defaultExplanationsOn;
    updateBuzzerQuizFields();
    reviewEnabledToggle.checked = !!quiz.reviewEnabled;

    quizPasswordInput.value = '';
    quizPasswordLabel.textContent = existingPasswordHash
        ? 'New edit/delete password (leave blank to keep current)'
        : 'Edit/delete password (optional)';
    quizRemovePasswordRow.hidden = !existingPasswordHash;
    quizRemovePasswordToggle.checked = false;

    const byCategory = new Map();
    (quiz.questions || []).forEach(q => {
        const categoryName = q.category || 'General';

        if (!byCategory.has(categoryName)) {
            const meta = (quiz.categoryMeta || []).find(m => m.name === categoryName) || {};
            byCategory.set(categoryName, {
                id: 'cat' + Date.now() + Math.floor(Math.random() * 1000) + byCategory.size,
                name: categoryName,
                background: meta.background || '',
                questionBackground: meta.questionBackground || '',
                titleScreen: meta.titleScreen || null,
                exampleScreen: meta.exampleScreen || null,
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
// QUIZ-LEVEL SETTINGS
// =========================
quizBuzzerToggle.addEventListener('change', updateBuzzerQuizFields);

function updateBuzzerQuizFields() {
    const isBuzzerQuiz = quizBuzzerToggle.checked;
    buzzerQuizRevealNote.hidden = !isBuzzerQuiz;
    revealModeInput.disabled = isBuzzerQuiz;
    if (isBuzzerQuiz) revealModeInput.value = 'immediate';

    quizBuzzerScoreThroughoutRow.hidden = !isBuzzerQuiz;
    if (!isBuzzerQuiz) quizBuzzerScoreThroughoutToggle.checked = false;
}

// =========================
// CATEGORIES
// =========================
addCategoryBtn.addEventListener('click', () => openCategoryModal(null));

catTitleToggle.addEventListener('change', () => {
    catTitleFields.hidden = !catTitleToggle.checked;
});
catExampleToggle.addEventListener('change', () => {
    catExampleFields.hidden = !catExampleToggle.checked;
});
cancelCategoryBtn.addEventListener('click', () => {
    categoryModal.hidden = true;
});

function openCategoryModal(category) {
    categoryEditContext = category;
    catError.hidden = true;

    if (category) {
        categoryModalTitle.textContent = 'Edit Category';
        catNameInput.value = category.name;
        catBackgroundInput.value = category.background || '';
        catQuestionBackgroundInput.value = category.questionBackground || '';

        catTitleToggle.checked = !!category.titleScreen;
        catTitleFields.hidden = !category.titleScreen;
        catTitleTextInput.value = category.titleScreen ? category.titleScreen.text || '' : '';

        catExampleToggle.checked = !!category.exampleScreen;
        catExampleFields.hidden = !category.exampleScreen;
        catExampleTextInput.value = category.exampleScreen ? category.exampleScreen.text || '' : '';
    } else {
        categoryModalTitle.textContent = 'Add Category';
        catNameInput.value = '';
        catBackgroundInput.value = '';
        catQuestionBackgroundInput.value = '';

        catTitleToggle.checked = false;
        catTitleFields.hidden = true;
        catTitleTextInput.value = '';

        catExampleToggle.checked = false;
        catExampleFields.hidden = true;
        catExampleTextInput.value = '';
    }

    categoryModal.hidden = false;
}

saveCategoryBtn.addEventListener('click', () => {
    const name = catNameInput.value.trim();
    if (!name) {
        catError.textContent = 'Please enter a category name.';
        catError.hidden = false;
        return;
    }

    const background = catBackgroundInput.value.trim();
    const questionBackground = catQuestionBackgroundInput.value.trim();
    const titleScreen = catTitleToggle.checked
        ? { text: catTitleTextInput.value.trim() }
        : null;
    const exampleScreen = catExampleToggle.checked
        ? { text: catExampleTextInput.value.trim() }
        : null;

    if (categoryEditContext) {
        categoryEditContext.name = name;
        categoryEditContext.background = background;
        categoryEditContext.questionBackground = questionBackground;
        categoryEditContext.titleScreen = titleScreen;
        categoryEditContext.exampleScreen = exampleScreen;
    } else {
        categories.push({
            id: 'cat' + Date.now() + Math.floor(Math.random() * 1000),
            name,
            background,
            questionBackground,
            titleScreen,
            exampleScreen,
            questions: []
        });
    }

    categoryModal.hidden = true;
    renderCategories();
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

        const headerActions = document.createElement('div');
        headerActions.className = 'category-header-actions';

        const editCategoryBtn = document.createElement('button');
        editCategoryBtn.type = 'button';
        editCategoryBtn.className = 'btn btn-small btn-secondary';
        editCategoryBtn.textContent = 'Edit';
        editCategoryBtn.addEventListener('click', () => openCategoryModal(category));
        headerActions.appendChild(editCategoryBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-small btn-danger';
        removeBtn.textContent = 'Remove Category';
        removeBtn.addEventListener('click', () => {
            if (category.questions.length && !confirm(`Remove "${category.name}" and its ${category.questions.length} question(s)?`)) return;
            categories = categories.filter(c => c.id !== category.id);
            renderCategories();
        });
        headerActions.appendChild(removeBtn);

        header.appendChild(headerActions);

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

        const addQuestionBtn = document.createElement('button');
        addQuestionBtn.type = 'button';
        addQuestionBtn.className = 'btn btn-secondary btn-small add-question-to-category-btn';
        addQuestionBtn.textContent = '+ Add Question';
        addQuestionBtn.addEventListener('click', () => openQuestionModal(null, category.id));
        section.appendChild(addQuestionBtn);

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

    const reorderControls = document.createElement('div');
    reorderControls.className = 'question-row-reorder';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'reorder-btn';
    upBtn.textContent = '▲';
    upBtn.disabled = index === 0;
    upBtn.setAttribute('aria-label', 'Move question up');
    upBtn.addEventListener('click', () => {
        if (index === 0) return;
        [category.questions[index - 1], category.questions[index]] =
            [category.questions[index], category.questions[index - 1]];
        renderCategories();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'reorder-btn';
    downBtn.textContent = '▼';
    downBtn.disabled = index === category.questions.length - 1;
    downBtn.setAttribute('aria-label', 'Move question down');
    downBtn.addEventListener('click', () => {
        if (index === category.questions.length - 1) return;
        [category.questions[index + 1], category.questions[index]] =
            [category.questions[index], category.questions[index + 1]];
        renderCategories();
    });

    reorderControls.appendChild(upBtn);
    reorderControls.appendChild(downBtn);
    row.appendChild(reorderControls);

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
qImageInput.addEventListener('input', updateMediaPreview);
qMediaTypeSelect.addEventListener('change', updateMediaPreview);
qMediaToggle.addEventListener('change', () => {
    qMediaFields.hidden = !qMediaToggle.checked;
    if (qMediaToggle.checked) updateMediaPreview();
});
qExplanationToggle.addEventListener('change', () => {
    qExplanationFields.hidden = !qExplanationToggle.checked;
});

function updateMediaPreview() {
    const src = qImageInput.value.trim();
    const selectedType = qMediaTypeSelect.value;
    const kind = selectedType === 'auto' ? (src ? MediaUtils.guessKind(src) : 'image') : selectedType;

    qSilhouetteRow.hidden = kind !== 'image';

    if (!src) {
        qMediaPreview.innerHTML = '';
        return;
    }

    MediaUtils.render({ kind, src, alt: '', silhouette: false }, qMediaPreview, false);
}
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
function openQuestionModal(editContext, defaultCategoryId) {
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
        if (defaultCategoryId) qCategorySelect.value = defaultCategoryId;
        questionModalTitle.textContent = 'Add Question';
        qPromptInput.value = '';
        qPointsInput.value = '1';
        qImageInput.value = '';
        qMediaTypeSelect.value = 'auto';
        qSilhouetteInput.checked = false;
        qMediaToggle.checked = false;
        qMediaFields.hidden = true;
        qExplanationInput.value = '';
        qExplanationToggle.checked = quizDefaultExplanationsToggle.checked;
        qExplanationFields.hidden = !qExplanationToggle.checked;
        qTypeSelect.value = quizBuzzerToggle.checked ? 'buzzer' : 'text';
        acceptedAnswersInput.value = '';
        numberRangeToggle.checked = false;
        numberExactInput.value = '';
        numberMinInput.value = '';
        numberMaxInput.value = '';
        multiAnswerAcceptedInput.value = '';
        multiAnswerMaxInput.value = '';
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
        qMediaTypeSelect.value = q.media ? (q.media.kind || 'auto') : 'auto';
        qSilhouetteInput.checked = !!(q.media && q.media.silhouette);
        qMediaToggle.checked = !!q.media;
        qMediaFields.hidden = !q.media;
        qExplanationInput.value = q.explanation || '';
        qExplanationToggle.checked = !!q.explanation;
        qExplanationFields.hidden = !q.explanation;

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
        } else if (q.type === 'multi-answer') {
            qTypeSelect.value = 'multi-answer';
            multiAnswerAcceptedInput.value = q.config.acceptedAnswers.join(', ');
            multiAnswerMaxInput.value = q.config.maxAnswers || '';
            addOptionRow(mcOptionsList, true, '');
            addOptionRow(mcOptionsList, false, '');
            addImageOptionRow(true, '', '');
            addImageOptionRow(false, '', '');
            addOrderingRow('');
            addOrderingRow('');
        } else if (q.type === 'buzzer') {
            qTypeSelect.value = 'buzzer';
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
    updateMediaPreview();
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
    const points = parseInt(qPointsInput.value, 10) || 1;
    const explanation = qExplanationInput.value.trim();
    const imageSrc = qImageInput.value.trim();
    const mediaKind = qMediaTypeSelect.value === 'auto'
        ? (imageSrc ? MediaUtils.guessKind(imageSrc) : 'image')
        : qMediaTypeSelect.value;
    const media = imageSrc
        ? { kind: mediaKind, src: imageSrc, alt: '', silhouette: mediaKind === 'image' && qSilhouetteInput.checked }
        : null;
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

    } else if (typeValue === 'multi-answer') {
        const accepted = multiAnswerAcceptedInput.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!accepted.length) { showError('Enter at least one accepted answer.'); return; }

        const maxRaw = multiAnswerMaxInput.value.trim();
        const maxAnswers = maxRaw ? parseInt(maxRaw, 10) : accepted.length;
        if (maxRaw && (!Number.isFinite(maxAnswers) || maxAnswers < 1)) {
            showError('Max answers must be a positive number.');
            return;
        }

        type = 'multi-answer';
        config = { acceptedAnswers: accepted, maxAnswers };

    } else if (typeValue === 'buzzer') {
        type = 'buzzer';
        config = {};
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

    const quizRef = activeQuizId ? doc(db, 'quizzes', activeQuizId) : doc(collection(db, 'quizzes'));
    const quizId = quizRef.id;

    const flatQuestions = [];
    categories.forEach(category => {
        category.questions.forEach(q => {
            flatQuestions.push({ ...q, category: category.name });
        });
    });
    const questionsWithIds = flatQuestions.map((q, i) => ({ ...q, id: 'q' + (i + 1) }));

    const categoryMeta = categories.map(c => ({
        name: c.name,
        background: c.background || '',
        questionBackground: c.questionBackground || '',
        titleScreen: c.titleScreen ? { text: c.titleScreen.text || '' } : null,
        exampleScreen: c.exampleScreen ? { text: c.exampleScreen.text || '' } : null
    }));

    let editPasswordHash = existingPasswordHash;
    if (quizRemovePasswordToggle.checked) {
        editPasswordHash = null;
    } else if (quizPasswordInput.value) {
        editPasswordHash = await hashPassword(quizPasswordInput.value);
    }

    try {
        await setDoc(quizRef, {
            id: quizId,
            title,
            description,
            version: 1,
            answerRevealMode: quizBuzzerToggle.checked ? 'immediate' : revealModeInput.value,
            isBuzzerQuiz: quizBuzzerToggle.checked,
            buzzerShowScoreThroughout: quizBuzzerToggle.checked && quizBuzzerScoreThroughoutToggle.checked,
            buzzersDefaultOpen: quizBuzzersDefaultOpenToggle.checked,
            defaultExplanationsOn: quizDefaultExplanationsToggle.checked,
            reviewEnabled: reviewEnabledToggle.checked,
            categoryMeta,
            editPasswordHash,
            questions: questionsWithIds
        });

        // Stay on this screen (8.1) — but if this was a brand-new quiz's
        // first save, switch into "editing" mode so later saves update the
        // same doc instead of creating a new one each time.
        if (!activeQuizId) {
            activeQuizId = quizId;
            existingPasswordHash = editPasswordHash;
            document.getElementById('back-button-link').href = 'manage-quizzes.html';
            document.querySelector('.hero h1').textContent = '🛠️ Edit Quiz';
            saveQuizBtn.textContent = 'Save Changes';
            history.replaceState(null, '', `builder.html?quiz=${encodeURIComponent(quizId)}`);
        }

        saveQuizStatus.className = 'success';
        saveQuizStatus.textContent = 'Quiz saved!';
        saveQuizBtn.disabled = false;
    } catch (err) {
        console.error(err);
        saveQuizStatus.className = 'failure';
        saveQuizStatus.textContent = 'Failed to save — check console.';
        saveQuizBtn.disabled = false;
    }
});

// =========================
// IMPORT FROM SPREADSHEET
// =========================
// Rows validated by the last-parsed file, kept until Import/Cancel/re-parse
// so the confirm button doesn't need to re-parse the file.
let pendingImportRows = [];

importSpreadsheetBtn.addEventListener('click', () => {
    resetImportModal();
    importModal.hidden = false;
});

cancelImportBtn.addEventListener('click', () => {
    importModal.hidden = true;
});

downloadTemplateBtn.addEventListener('click', downloadTemplate);

function resetImportModal() {
    importFileInput.value = '';
    importStatus.hidden = true;
    importPreview.hidden = true;
    importErrors.hidden = true;
    importPreviewList.innerHTML = '';
    importErrorList.innerHTML = '';
    pendingImportRows = [];
    confirmImportBtn.disabled = true;
    confirmImportBtn.textContent = 'Import 0 Questions';
}

importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files[0];
    if (!file) return;

    pendingImportRows = [];
    importPreview.hidden = true;
    importStatus.hidden = false;
    importStatus.className = 'pending';
    importStatus.textContent = 'Parsing file...';
    confirmImportBtn.disabled = true;
    confirmImportBtn.textContent = 'Import 0 Questions';

    try {
        const rawRows = await parseFile(file);
        const { valid, errors } = validateRows(rawRows);

        importStatus.hidden = true;
        importPreview.hidden = false;
        pendingImportRows = valid;

        importValidCount.textContent = `${valid.length} question(s)`;
        importPreviewList.innerHTML = '';

        if (!valid.length) {
            const hint = document.createElement('p');
            hint.className = 'empty-hint';
            hint.textContent = 'No valid rows found.';
            importPreviewList.appendChild(hint);
        }

        valid.forEach(q => {
            const row = document.createElement('div');
            row.className = 'question-row';
            row.draggable = false;

            const info = document.createElement('div');
            info.className = 'question-row-info';

            const promptSpan = document.createElement('span');
            promptSpan.textContent = `[${q.category}] ${q.prompt} (${q.points} pts)`;
            info.appendChild(promptSpan);

            const badge = document.createElement('span');
            badge.className = 'type-badge';
            badge.textContent = TYPE_LABELS[q.type] || q.type;
            info.appendChild(badge);

            row.appendChild(info);
            importPreviewList.appendChild(row);
        });

        importErrors.hidden = errors.length === 0;
        importErrorList.innerHTML = '';
        errors.forEach(err => {
            const li = document.createElement('li');
            li.textContent = err;
            importErrorList.appendChild(li);
        });

        confirmImportBtn.disabled = valid.length === 0;
        confirmImportBtn.textContent = `Import ${valid.length} Question${valid.length === 1 ? '' : 's'}`;
    } catch (err) {
        console.error(err);
        importStatus.hidden = false;
        importStatus.className = 'failure';
        importStatus.textContent = err.message || 'Failed to parse file — check console.';
    }
});

confirmImportBtn.addEventListener('click', () => {
    if (!pendingImportRows.length) return;

    pendingImportRows.forEach(q => {
        const { category: categoryName, ...questionData } = q;

        let category = categories.find(c => c.name.trim().toLowerCase() === categoryName.trim().toLowerCase());
        if (!category) {
            category = {
                id: 'cat' + Date.now() + Math.floor(Math.random() * 1000) + categories.length,
                name: categoryName,
                background: '',
                questionBackground: '',
                titleScreen: null,
                exampleScreen: null,
                questions: []
            };
            categories.push(category);
        }

        category.questions.push(questionData);
    });

    importModal.hidden = true;
    renderCategories();
});
