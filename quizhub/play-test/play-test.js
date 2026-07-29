import { loadQuiz } from './data/quiz-loader.js';

// Preview mirrors the real host-quiz.js/join.js state machine as closely as
// possible — same lock/reveal pacing per answerRevealMode, same play-order
// marking sequence, same review-and-edit flow — just driven locally by one
// person instead of a host + Firestore session. "Host View"/"Player View"
// only change what's shown at each step (host sees the correct-answer
// spoiler and controls; player doesn't) — the underlying pacing is identical
// either way, exactly like a real session looks the same regardless of
// which screen you're looking at.
let quiz = null;
let mode = 'host'; // 'host' | 'player' — display only

let categories = [];               // [{start,end,name,titleScreen,exampleScreen}]
let completedCategories = [];      // start indices, in PLAY order
const answers = new Map();         // questionId -> { value, correct, pointsAwarded, gradeResult }
let reviewAllowed = false;         // "end" mode only, mirrors session.reviewAllowed

let currentCategory = null;
let introSteps = [];
let introIndex = 0;
let currentQuestionIndex = null;
let stage = 'intro';                // 'intro' | 'question' | 'review'
let reviewSequence = [];
let answered = false;

let reviewCategoryContext = null;   // for the review-and-edit sub-flow

const hostViewBtn = document.getElementById('host-view-btn');
const playerViewBtn = document.getElementById('player-view-btn');

const categorySelectArea = document.getElementById('category-select-area');
const reviewToggleRow = document.getElementById('review-toggle-row');
const reviewAllowedToggleBtn = document.getElementById('review-allowed-toggle-btn');
const openPreviewReviewBtn = document.getElementById('open-preview-review-btn');
const previewCategoryGrid = document.getElementById('preview-category-grid');

const categoryReadonlyView = document.getElementById('category-readonly-view');
const categoryReadonlyBackBtn = document.getElementById('category-readonly-back-btn');
const categoryReadonlyTitle = document.getElementById('category-readonly-title');
const categoryReadonlyList = document.getElementById('category-readonly-list');

const previewReviewCategoriesView = document.getElementById('preview-review-categories-view');
const previewReviewCategoriesBackBtn = document.getElementById('preview-review-categories-back-btn');
const previewReviewCategoryList = document.getElementById('preview-review-category-list');

const previewReviewQuestionsView = document.getElementById('preview-review-questions-view');
const previewReviewQuestionsBackBtn = document.getElementById('preview-review-questions-back-btn');
const previewReviewQuestionsTitle = document.getElementById('preview-review-questions-title');
const previewReviewQuestionList = document.getElementById('preview-review-question-list');

const previewReviewDetailView = document.getElementById('preview-review-detail-view');
const previewReviewDetailBackBtn = document.getElementById('preview-review-detail-back-btn');
const previewReviewDetailPrompt = document.getElementById('preview-review-detail-prompt');
const previewReviewDetailMedia = document.getElementById('preview-review-detail-media');
const previewReviewDetailPrevious = document.getElementById('preview-review-detail-previous');
const previewReviewDetailAnswerMount = document.getElementById('preview-review-detail-answer-mount');
const previewReviewSaveBtn = document.getElementById('preview-review-save-btn');
const previewReviewSaveStatus = document.getElementById('preview-review-save-status');

const questionContainer = document.getElementById('question-container');
const lockedPreviewView = document.getElementById('locked-preview-view');
const lockedPreviewAnswer = document.getElementById('locked-preview-answer');
const lockedPreviewStatus = document.getElementById('locked-preview-status');
const feedbackEl = document.getElementById('feedback');
const scoreDisplay = document.getElementById('score-display');
const submitBtn = document.getElementById('submit-btn');
const revealPreviewBtn = document.getElementById('reveal-preview-btn');
const nextBtn = document.getElementById('next-btn');
const quizArea = document.getElementById('quiz-area');
const backToCategoriesLink = document.getElementById('back-to-categories-link');

const playTestTitle = document.getElementById('play-test-title');
const playTestSubtitle = document.getElementById('play-test-subtitle');
const backButtonLink = document.getElementById('back-button-link');

document.addEventListener('DOMContentLoaded', () => {
    const quizId = new URLSearchParams(window.location.search).get('quiz');

    const loadPromise = quizId
        ? loadQuiz(quizId)
        : fetch('data/sample-quiz.json').then(res => res.json());

    loadPromise.then(data => {
        quiz = data;

        if (quizId) {
            playTestTitle.textContent = `🧠 Preview: ${quiz.title}`;
            playTestSubtitle.textContent = 'Click through this quiz exactly as it will play live — host or player view, any category order.';
            backButtonLink.href = 'manage-quizzes.html';
        }

        categories = buildCategories(quiz);
        showCategoryGrid();
    }).catch(err => {
        console.error(err);
        categorySelectArea.innerHTML = '<h2>Could not load this quiz.</h2>';
    });

    submitBtn.addEventListener('click', handleSubmit);
    nextBtn.addEventListener('click', handleNext);
    backToCategoriesLink.addEventListener('click', showCategoryGrid);
    hostViewBtn.addEventListener('click', () => setMode('host'));
    playerViewBtn.addEventListener('click', () => setMode('player'));

    categoryReadonlyBackBtn.addEventListener('click', showCategoryGrid);
    reviewAllowedToggleBtn.addEventListener('click', () => {
        reviewAllowed = !reviewAllowed;
        showCategoryGrid();
    });
    openPreviewReviewBtn.addEventListener('click', showPreviewReviewCategories);
    previewReviewCategoriesBackBtn.addEventListener('click', showCategoryGrid);
    previewReviewQuestionsBackBtn.addEventListener('click', showPreviewReviewCategories);
    previewReviewDetailBackBtn.addEventListener('click', () => showPreviewReviewQuestions(reviewCategoryContext));
});

function setMode(newMode) {
    mode = newMode;
    hostViewBtn.classList.toggle('active', mode === 'host');
    hostViewBtn.classList.toggle('btn-secondary', mode !== 'host');
    playerViewBtn.classList.toggle('active', mode === 'player');
    playerViewBtn.classList.toggle('btn-secondary', mode !== 'player');

    if (!categorySelectArea.hidden) {
        showCategoryGrid();
    } else if (!quizArea.hidden) {
        if (!feedbackEl.hidden) {
            // Already revealed — refresh just the spoiler line for the new mode.
            revealCurrentQuestionFeedback(quiz.questions[currentQuestionIndex]);
        } else if (!submitBtn.hidden) {
            submitBtn.textContent = mode === 'host' ? 'Submit Answer' : 'Send Answer';
        }
    }
}
setMode('host');

// =========================
// CATEGORY STRUCTURE (mirrors host-quiz.js's getCategoryBounds/getCategoriesWithNames)
// =========================
function buildCategories(quiz) {
    const bounds = [];
    let start = 0;

    for (let i = 1; i <= quiz.questions.length; i++) {
        const prev = quiz.questions[i - 1].category;
        const cur = i < quiz.questions.length ? quiz.questions[i].category : undefined;

        if (cur !== prev) {
            const name = quiz.questions[start].category || 'General';
            const meta = (quiz.categoryMeta || []).find(m => m.name === name) || {};
            bounds.push({ start, end: i - 1, name, titleScreen: meta.titleScreen || null, exampleScreen: meta.exampleScreen || null });
            start = i;
        }
    }

    return bounds;
}

function getCategoryBoundsFor(index) {
    return categories.find(c => index >= c.start && index <= c.end)
        || { start: index, end: index, name: quiz.questions[index].category || 'General' };
}

function isFinalRemainingCategory(catStart) {
    const remaining = categories.filter(c => !completedCategories.includes(c.start));
    return remaining.length === 1 && remaining[0].start === catStart;
}

// Whether the current question's answer can be revealed right now, per
// quiz.answerRevealMode: always ("immediate"), only at the end of its
// category ("category"), or only once every other category has been played
// ("end") — identical rules to host-quiz.js's shouldOfferReveal.
function shouldOfferReveal(index) {
    const revealMode = quiz.answerRevealMode || 'immediate';
    if (revealMode === 'immediate') return true;

    const catBlock = getCategoryBoundsFor(index);
    if (index !== catBlock.end) return false;

    if (revealMode === 'category') return true;
    if (revealMode === 'end') return isFinalRemainingCategory(catBlock.start);
    return false;
}

// The ordered question indexes to mark through: just this category, unless
// it's the final category of an "end"-mode quiz — then every played
// question, grouped by category in PLAY order (completedCategories), not
// quiz-authoring order. Buzzer questions are excluded — they're already
// resolved live and never go through this pipeline.
//
// IMPORTANT: takes the category that TRIGGERED the review (currentCategory),
// not whatever question the walkthrough is currently sitting on — recomputing
// this from the current index broke the whole-quiz case, since once the
// walkthrough stepped back into an earlier category's own questions, that
// category isn't "the final remaining one" and the sequence would wrongly
// collapse back down to just it, cutting the review short right there.
function getReviewSequence(triggeringCategoryStart) {
    const revealMode = quiz.answerRevealMode || 'immediate';

    if (revealMode === 'end' && isFinalRemainingCategory(triggeringCategoryStart)) {
        const playOrder = [...completedCategories];
        if (!playOrder.includes(triggeringCategoryStart)) playOrder.push(triggeringCategoryStart);

        const sequence = [];
        playOrder.forEach(catStart => {
            const bounds = getCategoryBoundsFor(catStart);
            for (let i = bounds.start; i <= bounds.end; i++) {
                if (quiz.questions[i].type !== 'buzzer') sequence.push(i);
            }
        });
        return sequence;
    }

    const catBlock = getCategoryBoundsFor(triggeringCategoryStart);
    const sequence = [];
    for (let i = catBlock.start; i <= catBlock.end; i++) {
        if (quiz.questions[i].type !== 'buzzer') sequence.push(i);
    }
    return sequence;
}

// =========================
// SCREEN SWITCHING
// =========================
function hideAllScreens() {
    categorySelectArea.hidden = true;
    categoryReadonlyView.hidden = true;
    previewReviewCategoriesView.hidden = true;
    previewReviewQuestionsView.hidden = true;
    previewReviewDetailView.hidden = true;
    scoreDisplay.hidden = true;
    quizArea.hidden = true;
}

function showCategoryGrid() {
    hideAllScreens();
    categorySelectArea.hidden = false;

    const reviewEligible = (quiz.answerRevealMode || 'immediate') === 'end';
    reviewToggleRow.hidden = !reviewEligible;
    if (reviewEligible) {
        reviewAllowedToggleBtn.hidden = mode !== 'host';
        reviewAllowedToggleBtn.textContent = reviewAllowed
            ? '📖 Review Allowed (click to stop)'
            : '📖 Allow Review of Answers';
        openPreviewReviewBtn.hidden = !(mode === 'player' && reviewAllowed);
    }

    previewCategoryGrid.innerHTML = '';
    categories.forEach(cat => {
        const isDone = completedCategories.includes(cat.start);
        const count = cat.end - cat.start + 1;

        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'preview-category-tile' + (isDone ? ' done' : '');
        tile.innerHTML = `
            ${escapeHtml(cat.name)}
            <span style="display:block;font-weight:normal;font-size:.85rem;color:var(--secondary);margin-top:4px;">${count} question${count === 1 ? '' : 's'}</span>
            ${isDone ? '<span class="previewed-tag">✓ Completed</span>' : ''}
        `;
        tile.addEventListener('click', () => {
            if (isDone) showCategoryReadonly(cat); else startCategoryPreview(cat);
        });
        previewCategoryGrid.appendChild(tile);
    });
}

// Read-only question list for a completed category — mirrors the host's own
// "reclick a completed category" feature: prompts only, no answers.
function showCategoryReadonly(cat) {
    hideAllScreens();
    categoryReadonlyView.hidden = false;
    categoryReadonlyTitle.textContent = cat.name;
    categoryReadonlyList.innerHTML = '';

    for (let i = cat.start; i <= cat.end; i++) {
        const row = document.createElement('div');
        row.className = 'readonly-question-row';
        row.textContent = quiz.questions[i].prompt;
        categoryReadonlyList.appendChild(row);
    }
}

// =========================
// REVIEW-AND-EDIT (mirrors join.js's player-review flow exactly — no
// correct/incorrect indication, saving only overwrites the stored value,
// never grades or scores it)
// =========================
function showPreviewReviewCategories() {
    hideAllScreens();
    previewReviewCategoriesView.hidden = false;

    const doneCats = categories.filter(c => completedCategories.includes(c.start));
    previewReviewCategoryList.innerHTML = '';

    if (!doneCats.length) {
        previewReviewCategoryList.innerHTML = '<p style="color:var(--secondary);">No completed categories yet.</p>';
        return;
    }

    doneCats.forEach(cat => {
        const count = cat.end - cat.start + 1;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';
        tile.innerHTML = `<span>${escapeHtml(cat.name)}</span><span class="tile-meta">${count} question${count === 1 ? '' : 's'}</span>`;
        tile.addEventListener('click', () => showPreviewReviewQuestions(cat));
        previewReviewCategoryList.appendChild(tile);
    });
}

function showPreviewReviewQuestions(cat) {
    reviewCategoryContext = cat;
    hideAllScreens();
    previewReviewQuestionsView.hidden = false;
    previewReviewQuestionsTitle.textContent = cat.name;
    previewReviewQuestionList.innerHTML = '';

    for (let i = cat.start; i <= cat.end; i++) {
        const question = quiz.questions[i];
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';

        const label = document.createElement('span');
        label.textContent = question.prompt;
        tile.appendChild(label);

        if (question.type === 'buzzer') {
            const meta = document.createElement('span');
            meta.className = 'tile-meta';
            meta.textContent = 'Not editable';
            tile.appendChild(meta);
        }

        tile.addEventListener('click', () => showPreviewReviewDetail(question));
        previewReviewQuestionList.appendChild(tile);
    }
}

function showPreviewReviewDetail(question) {
    hideAllScreens();
    previewReviewDetailView.hidden = false;
    previewReviewDetailPrompt.textContent = question.prompt;
    MediaUtils.render(question.media, previewReviewDetailMedia, false);
    previewReviewSaveStatus.textContent = '';
    previewReviewSaveStatus.className = '';

    const existing = answers.get(question.id);

    if (question.type === 'buzzer') {
        previewReviewDetailPrevious.textContent = 'This was judged live by the host — nothing to edit here.';
        previewReviewDetailAnswerMount.innerHTML = '';
        previewReviewSaveBtn.hidden = true;
        return;
    }

    previewReviewSaveBtn.hidden = false;
    previewReviewDetailPrevious.textContent = existing
        ? `Your submitted answer: ${formatAnswerValue(question, existing.value)}`
        : "You didn't answer this one.";

    previewReviewDetailAnswerMount.innerHTML = '';
    AnswerTypeRegistry.get(question.type).renderInput(question, previewReviewDetailAnswerMount);
    prefillReviewAnswer(question, previewReviewDetailAnswerMount, existing ? existing.value : null);

    previewReviewSaveBtn.onclick = () => {
        const typeImpl = AnswerTypeRegistry.get(question.type);
        const value = typeImpl.getValue(previewReviewDetailAnswerMount, question);
        const prior = answers.get(question.id) || {};

        // Deliberately just overwrites the value — no regrading, no score change.
        answers.set(question.id, { ...prior, value });

        previewReviewSaveStatus.className = 'success';
        previewReviewSaveStatus.textContent = 'Saved!';
    };
}

function prefillReviewAnswer(question, mount, previousValue) {
    if (previousValue === null || previousValue === undefined) return;

    if (question.type === 'text') {
        const input = mount.querySelector('.text-answer-input');
        if (input) input.value = previousValue;
    } else if (question.type === 'number') {
        const input = mount.querySelector('.number-answer-input');
        if (input && typeof previousValue === 'number') input.value = previousValue;
    } else if (question.type === 'multi-answer' && Array.isArray(previousValue)) {
        const inputs = mount.querySelectorAll('.multi-answer-input');
        previousValue.forEach((v, i) => { if (inputs[i]) inputs[i].value = v; });
    }
}

// =========================
// CATEGORY PLAYTHROUGH
// =========================
function startCategoryPreview(cat) {
    currentCategory = cat;
    introSteps = [];
    if (cat.titleScreen) introSteps.push({ label: cat.name, text: cat.titleScreen.text || '' });
    if (cat.exampleScreen) introSteps.push({ label: `${cat.name} — Example`, text: cat.exampleScreen.text || '' });
    introIndex = 0;

    hideAllScreens();
    scoreDisplay.hidden = false;
    quizArea.hidden = false;
    updateScoreDisplay();

    if (introSteps.length) {
        stage = 'intro';
        renderIntroStep(introSteps[0]);
    } else {
        currentQuestionIndex = cat.start;
        renderQuestionStep();
    }
}

function updateScoreDisplay() {
    let score = 0;
    let total = 0;

    quiz.questions.forEach(q => {
        const perMax = q.type === 'multi-answer' ? q.points * q.config.acceptedAnswers.length : q.points;
        total += perMax;
        const a = answers.get(q.id);
        if (a) score += a.pointsAwarded || 0;
    });

    scoreDisplay.textContent = `Score so far: ${score} / ${total}`;
}

function renderIntroStep(step) {
    questionContainer.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = step.label;
    questionContainer.appendChild(heading);

    if (step.text) {
        const text = document.createElement('p');
        text.style.color = 'var(--secondary)';
        text.textContent = step.text;
        questionContainer.appendChild(text);
    }

    lockedPreviewView.hidden = true;
    feedbackEl.hidden = true;
    feedbackEl.className = '';
    feedbackEl.innerHTML = '';

    submitBtn.hidden = true;
    revealPreviewBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.textContent = 'Continue';
}

function renderQuestionStep() {
    stage = 'question';
    answered = false;

    const question = quiz.questions[currentQuestionIndex];
    questionContainer.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = question.prompt;
    questionContainer.appendChild(heading);

    const mediaMount = document.createElement('div');
    questionContainer.appendChild(mediaMount);
    MediaUtils.render(question.media, mediaMount, true);

    const answerMount = document.createElement('div');
    answerMount.className = 'answer-mount';
    questionContainer.appendChild(answerMount);

    AnswerTypeRegistry.get(question.type).renderInput(question, answerMount);

    lockedPreviewView.hidden = true;
    feedbackEl.hidden = true;
    feedbackEl.className = '';
    feedbackEl.innerHTML = '';

    submitBtn.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = mode === 'host' ? 'Submit Answer' : 'Send Answer';
    revealPreviewBtn.hidden = true;
    nextBtn.hidden = true;
}

function handleSubmit() {
    if (answered) return;
    answered = true;

    const question = quiz.questions[currentQuestionIndex];
    const answerMount = questionContainer.querySelector('.answer-mount');
    const typeImpl = AnswerTypeRegistry.get(question.type);

    const value = typeImpl.getValue(answerMount, question);
    const gradeResult = typeImpl.grade(value, question);
    const pointsAwarded = gradeResult.pointsAwarded !== undefined
        ? gradeResult.pointsAwarded
        : (gradeResult.correct ? question.points : 0);

    answers.set(question.id, { value, correct: gradeResult.correct, pointsAwarded, gradeResult });
    updateScoreDisplay();

    submitBtn.hidden = true;

    // Buzzer bypasses the whole lock/reveal pacing pipeline — it's always
    // resolved live/immediately, same as in a real session.
    if (question.type === 'buzzer') {
        revealCurrentQuestionFeedback(question);
        showNextOrFinishButton();
        return;
    }

    const offerReveal = shouldOfferReveal(currentQuestionIndex);

    lockedPreviewView.hidden = false;
    lockedPreviewAnswer.textContent = `Your answer: ${formatAnswerValue(question, value)}`;
    lockedPreviewStatus.textContent = 'Your answer is locked in.';

    if (offerReveal) {
        const revealMode = quiz.answerRevealMode || 'immediate';
        nextBtn.hidden = true;
        revealPreviewBtn.hidden = false;
        revealPreviewBtn.innerHTML = revealMode === 'immediate'
            ? '▶ Reveal Answer <span class="host-action-tag">(host action)</span>'
            : '🔎 Reveal Answers <span class="host-action-tag">(host action)</span>';
        revealPreviewBtn.onclick = revealMode === 'immediate' ? revealSingleQuestion : startReviewWalkthrough;
    } else {
        revealPreviewBtn.hidden = true;
        showNextOrFinishButton();
    }
}

function showNextOrFinishButton() {
    nextBtn.hidden = false;
    const catBlock = getCategoryBoundsFor(currentQuestionIndex);
    const isLastInCategory = currentQuestionIndex === catBlock.end;
    nextBtn.innerHTML = isLastInCategory
        ? 'Finish Category <span class="host-action-tag">(host action)</span>'
        : 'Next Question <span class="host-action-tag">(host action)</span>';
}

function revealSingleQuestion() {
    lockedPreviewView.hidden = true;
    revealPreviewBtn.hidden = true;
    revealCurrentQuestionFeedback(quiz.questions[currentQuestionIndex]);
    showNextOrFinishButton();
}

function revealCurrentQuestionFeedback(question) {
    const stored = answers.get(question.id);
    const answerMount = questionContainer.querySelector('.answer-mount');
    const typeImpl = AnswerTypeRegistry.get(question.type);

    if (stored && answerMount && typeof typeImpl.reveal === 'function') {
        typeImpl.reveal(answerMount, question, stored.value, stored.gradeResult);
    }

    feedbackEl.hidden = false;
    feedbackEl.className = stored && stored.correct ? 'correct' : 'incorrect';
    feedbackEl.innerHTML = stored && stored.correct ? 'Correct!' : 'Incorrect.';

    // Only the host view gets the spoiler — a real player never sees this,
    // just whether they were right and (optionally) the explanation.
    if (mode === 'host' && question.type !== 'buzzer') {
        const correctAnswerEl = document.createElement('span');
        correctAnswerEl.className = 'correct-answer-line';
        correctAnswerEl.textContent = `Correct answer: ${getCorrectAnswerDisplay(question)}`;
        feedbackEl.appendChild(correctAnswerEl);
    }

    if (question.explanation) {
        const explanation = document.createElement('span');
        explanation.className = 'explanation';
        explanation.textContent = question.explanation;
        feedbackEl.appendChild(explanation);
    }
}

// =========================
// MARKING WALKTHROUGH ("category" mode end-of-category, or "end" mode's
// single final pass across every played question in play order)
// =========================
function startReviewWalkthrough() {
    stage = 'review';
    reviewSequence = getReviewSequence(currentCategory.start);
    currentQuestionIndex = reviewSequence[0];
    renderReviewQuestion();
}

function renderReviewQuestion() {
    const question = quiz.questions[currentQuestionIndex];
    questionContainer.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = question.prompt;
    questionContainer.appendChild(heading);

    const mediaMount = document.createElement('div');
    questionContainer.appendChild(mediaMount);
    MediaUtils.render(question.media, mediaMount, false);

    const answerMount = document.createElement('div');
    answerMount.className = 'answer-mount';
    questionContainer.appendChild(answerMount);

    const stored = answers.get(question.id);
    if (stored) {
        AnswerTypeRegistry.get(question.type).renderInput(question, answerMount);
        prefillReviewAnswer(question, answerMount, stored.value);
    } else {
        answerMount.innerHTML = '<p style="color:var(--secondary);">No answer was submitted.</p>';
    }

    lockedPreviewView.hidden = true;
    submitBtn.hidden = true;
    revealPreviewBtn.hidden = true;

    revealCurrentQuestionFeedback(question);

    nextBtn.hidden = false;
    const pos = reviewSequence.indexOf(currentQuestionIndex);
    nextBtn.innerHTML = pos === reviewSequence.length - 1
        ? 'Finish Category <span class="host-action-tag">(host action)</span>'
        : 'Next <span class="host-action-tag">(host action)</span>';
}

function handleNext() {
    if (stage === 'intro') {
        introIndex++;
        if (introIndex < introSteps.length) {
            renderIntroStep(introSteps[introIndex]);
        } else {
            currentQuestionIndex = currentCategory.start;
            renderQuestionStep();
        }
        return;
    }

    if (stage === 'review') {
        const pos = reviewSequence.indexOf(currentQuestionIndex);
        if (pos === reviewSequence.length - 1) {
            finishCategoryPlaythrough();
        } else {
            currentQuestionIndex = reviewSequence[pos + 1];
            renderReviewQuestion();
        }
        return;
    }

    // stage === 'question'
    const catBlock = getCategoryBoundsFor(currentQuestionIndex);
    if (currentQuestionIndex === catBlock.end) {
        finishCategoryPlaythrough();
    } else {
        currentQuestionIndex++;
        renderQuestionStep();
    }
}

function finishCategoryPlaythrough() {
    if (!completedCategories.includes(currentCategory.start)) {
        completedCategories = [...completedCategories, currentCategory.start];
    }
    showCategoryGrid();
}

// =========================
// SHARED DISPLAY HELPERS
// =========================
function getCorrectAnswerDisplay(question) {
    switch (question.type) {
        case 'text':
            return question.config.acceptedAnswers[0];

        case 'multiple-choice': {
            const opt = question.config.options.find(o => o.id === question.config.correctOptionId);
            return opt ? opt.label : question.config.correctOptionId;
        }

        case 'image-select': {
            const opt = question.config.options.find(o => o.id === question.config.correctOptionId);
            return opt ? (opt.alt || opt.id) : question.config.correctOptionId;
        }

        case 'ordering':
            return question.config.correctOrder
                .map(id => {
                    const item = question.config.items.find(i => i.id === id);
                    return item ? item.label : id;
                })
                .join(' → ');

        case 'number':
            return question.config.mode === 'range'
                ? `${question.config.min}–${question.config.max}`
                : String(question.config.correctValue);

        case 'multi-answer':
            return question.config.acceptedAnswers.join(', ');

        default:
            return '';
    }
}

function formatAnswerValue(question, value) {
    switch (question.type) {
        case 'text':
            return value || '(empty)';

        case 'multiple-choice': {
            const opt = question.config.options.find(o => o.id === value);
            return opt ? opt.label : '(no selection)';
        }

        case 'image-select': {
            const opt = question.config.options.find(o => o.id === value);
            return opt ? (opt.alt || opt.id) : '(no selection)';
        }

        case 'ordering':
            if (!Array.isArray(value)) return '(no answer)';
            return value
                .map(id => {
                    const item = question.config.items.find(i => i.id === id);
                    return item ? item.label : id;
                })
                .join(' → ');

        case 'number':
            return (value === null || value === undefined) ? '(no answer)' : String(value);

        case 'multi-answer':
            return (Array.isArray(value) && value.length) ? value.join(', ') : '(no answer)';

        default:
            return String(value);
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
