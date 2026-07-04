import { db } from './firebase/firebase-config.js';
import { loadQuiz } from './data/quiz-loader.js';
import {
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    increment,
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    getDoc,
    getDocs,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz');

const titleEl = document.getElementById('quiz-title');
const descEl = document.getElementById('quiz-description');
const codeDisplay = document.getElementById('code-display');
const joinQrImg = document.getElementById('join-qr-img');
const joinQrCaption = document.getElementById('join-qr-caption');
const beginBtn = document.getElementById('begin-btn');

const lobbyView = document.getElementById('lobby-view');
const playerList = document.getElementById('player-list');
const messageList = document.getElementById('message-list');

const categorySelectView = document.getElementById('category-select-view');
const categorySelectGrid = document.getElementById('category-select-grid');
const goToResultsBtn = document.getElementById('go-to-results-btn');

const categoryIntroView = document.getElementById('category-intro-view');
const categoryIntroLabelEl = document.getElementById('category-intro-label');
const categoryIntroTextEl = document.getElementById('category-intro-text');
const categoryIntroContinueBtn = document.getElementById('category-intro-continue-btn');

const quizView = document.getElementById('quiz-view');
const questionCardEl = document.querySelector('#quiz-view .question-card');
const questionProgressEl = document.getElementById('question-progress');
const questionPromptEl = document.getElementById('host-question-prompt');
const questionMediaEl = document.getElementById('host-question-media');
const answerCountEl = document.getElementById('answer-count');
const lockBtn = document.getElementById('lock-btn');
const lockedControls = document.getElementById('locked-controls');
const revealAnswerBtn = document.getElementById('reveal-answer-btn');
const correctAnswerDisplay = document.getElementById('correct-answer-display');
const startReviewBtn = document.getElementById('start-review-btn');
const nextQuestionBtn = document.getElementById('next-question-btn');
const resultsList = document.getElementById('results-list');
const scoreboardList = document.getElementById('scoreboard-list');

const resultsView = document.getElementById('results-view');
const resultsRevealList = document.getElementById('results-reveal-list');
const finishQuizBtn = document.getElementById('finish-quiz-btn');

const endedView = document.getElementById('ended-view');
const finalScoreboardList = document.getElementById('final-scoreboard-list');

let quiz = null;
let code = null;
let sessionRef = null;
let currentSession = null;
let currentQuestion = null;
let latestPlayers = [];
let latestAnswers = new Map();
let unsubscribeAnswers = null;
let watchedQuestionKey = null;

// Built once, the first time the session reaches "results" — holds the
// score/name reveal state for each player's row. Not synced to Firestore:
// this is a host-screen-only dramatic reveal, not resumable across refresh.
let resultsRows = null;

if (quizId) {
    loadQuiz(quizId).then(data => {
        quiz = data;
        titleEl.textContent = quiz.title;
        descEl.textContent = quiz.description || '';
        startSession();
    }).catch(err => {
        console.error(err);
        titleEl.textContent = 'Quiz not found';
        descEl.textContent = "This quiz doesn't exist or may have been deleted.";
    });
} else {
    titleEl.textContent = 'No quiz selected';
    descEl.textContent = 'Start a quiz from Manage Quizzes instead of opening this page directly.';
}

function startSession() {
    code = generateCode();
    codeDisplay.textContent = code;
    sessionRef = doc(db, 'sessions', code);

    setDoc(sessionRef, {
        quizId: quizId,
        status: 'lobby',
        currentQuestionIndex: -1,
        currentCategoryStart: null,
        completedCategories: [],
        questionPhase: 'answering',
        answerRevealed: false,
        reviewMode: false,
        introPhase: null,
        createdAt: serverTimestamp()
    });

    onSnapshot(
        query(collection(db, 'sessions', code, 'players'), orderBy('joinedAt', 'asc')),
        renderPlayers
    );

    onSnapshot(
        query(collection(db, 'sessions', code, 'messages'), orderBy('sentAt', 'asc')),
        renderMessages
    );

    onSnapshot(sessionRef, snap => {
        if (snap.exists()) renderSession(snap.data());
    });

    beginBtn.addEventListener('click', () => {
        updateDoc(sessionRef, { status: 'category-select' });
    }, { once: true });

    lockBtn.addEventListener('click', handleLock);
    revealAnswerBtn.addEventListener('click', handleRevealAnswer);
    startReviewBtn.addEventListener('click', handleStartReview);
    nextQuestionBtn.addEventListener('click', handleNextQuestion);
    categoryIntroContinueBtn.addEventListener('click', handleCategoryIntroContinue);
    goToResultsBtn.addEventListener('click', () => updateDoc(sessionRef, { status: 'results' }));
    finishQuizBtn.addEventListener('click', handleFinishQuiz);

    // Purely cosmetic — never let a QR rendering issue take down the rest
    // of session setup (that's what happened when this used to run first
    // and throw before the session doc / listeners / button were wired up).
    try {
        renderJoinQrCode();
    } catch (err) {
        console.error('QR code render failed:', err);
    }
}

function renderPlayers(snapshot) {
    latestPlayers = [];
    playerList.innerHTML = '';
    scoreboardList.innerHTML = '';

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        latestPlayers.push({ id: docSnap.id, ...data });

        const li = document.createElement('li');
        li.textContent = data.name;
        playerList.appendChild(li);

        const scoreLi = document.createElement('li');
        scoreLi.textContent = `${data.name} — ${data.score || 0} pts`;
        scoreboardList.appendChild(scoreLi);
    });

    renderResultsList();
}

// Captured once, at the moment the quiz finishes — the live players listener
// gets cleared out by finishQuizCleanup() right after, so the ended screen
// can't depend on it.
function renderFinalScoreboard() {
    finalScoreboardList.innerHTML = '';

    [...latestPlayers]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .forEach(player => {
            const li = document.createElement('li');
            li.textContent = `${player.name} — ${player.score || 0} pts`;
            finalScoreboardList.appendChild(li);
        });
}

function renderMessages(snapshot) {
    messageList.innerHTML = '';
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement('li');
        li.textContent = `${data.name}: ${data.message}`;
        messageList.appendChild(li);
    });
}

function renderSession(session) {
    currentSession = session;

    lobbyView.hidden = true;
    categorySelectView.hidden = true;
    categoryIntroView.hidden = true;
    quizView.hidden = true;
    resultsView.hidden = true;
    endedView.hidden = true;

    if (session.status === 'lobby') {
        lobbyView.hidden = false;
        return;
    }

    if (session.status === 'category-select') {
        categorySelectView.hidden = false;
        renderCategorySelectView(session);
        return;
    }

    if (session.status === 'category-intro') {
        categoryIntroView.hidden = false;
        renderCategoryIntroView(session);
        return;
    }

    if (session.status === 'results') {
        resultsView.hidden = false;
        ensureResultsRows();
        renderResultsView();
        return;
    }

    if (session.status === 'ended') {
        endedView.hidden = false;
        return;
    }

    quizView.hidden = false;
    renderHostQuestion(
        session.currentQuestionIndex,
        session.questionPhase,
        session.answerRevealed,
        !!session.reviewMode,
        session.completedCategories || []
    );
}

// Contiguous runs of same-category questions in quiz.questions (the builder
// always saves categories as contiguous blocks).
function getCategoryBounds() {
    const bounds = [];
    let start = 0;

    for (let i = 1; i <= quiz.questions.length; i++) {
        const prevCategory = quiz.questions[i - 1].category;
        const currentCategory = i < quiz.questions.length ? quiz.questions[i].category : undefined;

        if (currentCategory !== prevCategory) {
            bounds.push({ start, end: i - 1 });
            start = i;
        }
    }

    return bounds;
}

function getCategoriesWithNames() {
    return getCategoryBounds().map(b => {
        const name = quiz.questions[b.start].category || 'General';
        const meta = (quiz.categoryMeta || []).find(m => m.name === name) || {};

        return {
            start: b.start,
            end: b.end,
            name,
            background: meta.background || '',
            questionBackground: meta.questionBackground || '',
            titleScreen: meta.titleScreen || null,
            exampleScreen: meta.exampleScreen || null
        };
    });
}

function getCategoryBoundsFor(index) {
    return getCategoryBounds().find(b => index >= b.start && index <= b.end) || { start: index, end: index };
}

function isFinalRemainingCategory(categoryStart, completedCategories) {
    const remaining = getCategoryBounds().filter(c => !completedCategories.includes(c.start));
    return remaining.length === 1 && remaining[0].start === categoryStart;
}

// Whether the current question's answer can be revealed right now, per the
// quiz's answerRevealMode: always ("immediate"), only at the end of its
// category ("category"), or only once every other category has already been
// played through ("end").
function shouldOfferReveal(index, completedCategories) {
    const mode = quiz.answerRevealMode || 'immediate';
    if (mode === 'immediate') return true;

    const catBlock = getCategoryBoundsFor(index);
    if (index !== catBlock.end) return false;

    if (mode === 'category') return true;
    if (mode === 'end') return isFinalRemainingCategory(catBlock.start, completedCategories || []);
    return false;
}

// The range of question indexes to step through when revealing: just this
// category, unless this is the final category of an "end"-mode quiz, in
// which case every question across the whole quiz gets reviewed at once.
function getReviewRange(index, completedCategories) {
    const mode = quiz.answerRevealMode || 'immediate';
    const catBlock = getCategoryBoundsFor(index);

    if (mode === 'end' && isFinalRemainingCategory(catBlock.start, completedCategories || [])) {
        return { start: 0, end: quiz.questions.length - 1 };
    }

    return catBlock;
}

function renderCategorySelectView(session) {
    categorySelectGrid.innerHTML = '';
    const categories = getCategoriesWithNames();
    const completed = session.completedCategories || [];

    categories.forEach(cat => {
        const isDone = completed.includes(cat.start);

        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'category-tile';
        tile.disabled = isDone;
        if (cat.background) tile.style.backgroundImage = `url('${cat.background}')`;

        const label = document.createElement('span');
        label.textContent = cat.name;
        tile.appendChild(label);

        if (isDone) {
            const doneTag = document.createElement('span');
            doneTag.className = 'done-tag';
            doneTag.textContent = 'Completed ✓';
            tile.appendChild(doneTag);
        } else {
            tile.addEventListener('click', () => startCategory(cat));
        }

        categorySelectGrid.appendChild(tile);
    });

    goToResultsBtn.hidden = categories.length === 0 || completed.length < categories.length;
}

function startCategory(cat) {
    if (cat.titleScreen || cat.exampleScreen) {
        updateDoc(sessionRef, {
            status: 'category-intro',
            currentCategoryStart: cat.start,
            introPhase: cat.titleScreen ? 'title' : 'example',
            questionPhase: 'answering',
            answerRevealed: false,
            reviewMode: false
        });
    } else {
        updateDoc(sessionRef, {
            status: 'active',
            currentQuestionIndex: cat.start,
            currentCategoryStart: cat.start,
            questionPhase: 'answering',
            answerRevealed: false,
            reviewMode: false
        });
    }
}

function renderCategoryIntroView(session) {
    const cat = getCategoriesWithNames().find(c => c.start === session.currentCategoryStart);
    if (!cat) return;

    const screen = session.introPhase === 'example' ? cat.exampleScreen : cat.titleScreen;

    categoryIntroLabelEl.textContent = session.introPhase === 'example' ? `${cat.name} — Example` : cat.name;
    categoryIntroTextEl.textContent = (screen && screen.text) || '';

    const hasMoreSteps = session.introPhase === 'title' && !!cat.exampleScreen;
    categoryIntroContinueBtn.textContent = hasMoreSteps ? 'Continue' : 'Start Category';
}

async function handleCategoryIntroContinue() {
    if (!currentSession) return;
    categoryIntroContinueBtn.disabled = true;

    try {
        const cat = getCategoriesWithNames().find(c => c.start === currentSession.currentCategoryStart);
        if (!cat) return;

        if (currentSession.introPhase === 'title' && cat.exampleScreen) {
            await updateDoc(sessionRef, { introPhase: 'example' });
        } else {
            await updateDoc(sessionRef, {
                status: 'active',
                currentQuestionIndex: cat.start,
                introPhase: null,
                questionPhase: 'answering',
                answerRevealed: false,
                reviewMode: false
            });
        }
    } finally {
        categoryIntroContinueBtn.disabled = false;
    }
}

function renderHostQuestion(index, phase, answerRevealed, reviewMode, completedCategories) {
    const question = quiz.questions[index];
    if (!question) return;
    currentQuestion = question;

    const catBlock = getCategoryBoundsFor(index);
    const categoryName = question.category || 'General';
    const catMeta = (quiz.categoryMeta || []).find(m => m.name === categoryName);
    const questionBg = catMeta && catMeta.questionBackground;

    questionCardEl.classList.toggle('themed-bg', !!questionBg);
    questionCardEl.style.backgroundImage = questionBg ? `url('${questionBg}')` : '';

    questionProgressEl.textContent =
        `${categoryName} — Question ${index - catBlock.start + 1} of ${catBlock.end - catBlock.start + 1}`;
    questionPromptEl.textContent = question.prompt;

    questionMediaEl.innerHTML = '';
    if (question.media) {
        const img = document.createElement('img');
        img.src = question.media.src;
        img.alt = question.media.alt || '';
        img.className = 'question-media' + (question.media.silhouette && phase === 'answering' ? ' silhouette' : '');
        questionMediaEl.appendChild(img);
    }

    const questionKey = `${index}:${question.id}`;
    if (watchedQuestionKey !== questionKey) {
        watchedQuestionKey = questionKey;
        latestAnswers = new Map();
        watchAnswers(question);
    }

    if (phase === 'answering') {
        lockBtn.hidden = false;
        lockedControls.hidden = true;
        renderResultsList();
        return;
    }

    lockBtn.hidden = true;
    lockedControls.hidden = false;

    const isLastInCategory = index === catBlock.end;
    const paced = (quiz.answerRevealMode || 'immediate') !== 'immediate';
    const offerReveal = shouldOfferReveal(index, completedCategories);

    if (paced && !reviewMode && !isLastInCategory) {
        // Mid-category: the answer isn't revealed yet, just move straight on
        // to the next question — locked in, no reveal.
        revealAnswerBtn.hidden = true;
        correctAnswerDisplay.hidden = true;
        startReviewBtn.hidden = true;
        nextQuestionBtn.hidden = false;
        nextQuestionBtn.textContent = 'Next Question';
    } else if (paced && !reviewMode && isLastInCategory && !offerReveal) {
        // "End of quiz" reveal mode, but other categories are still unplayed
        // — finish this category without revealing anything yet.
        revealAnswerBtn.hidden = true;
        correctAnswerDisplay.hidden = true;
        startReviewBtn.hidden = true;
        nextQuestionBtn.hidden = false;
        nextQuestionBtn.textContent = 'Finish Category';
    } else if (paced && !reviewMode && isLastInCategory && offerReveal) {
        // End of category (or the final category in "end" mode) — hand off
        // to review mode instead of revealing here.
        revealAnswerBtn.hidden = true;
        correctAnswerDisplay.hidden = true;
        nextQuestionBtn.hidden = true;
        startReviewBtn.hidden = false;
        startReviewBtn.textContent = 'Reveal Answers';
    } else {
        // Either "immediate" mode, or stepping back through a block in
        // review mode — reveal one question at a time.
        startReviewBtn.hidden = true;
        const reviewRange = reviewMode ? getReviewRange(index, completedCategories) : { start: index, end: index };
        const isLastInReview = index === reviewRange.end;

        if (answerRevealed) {
            revealAnswerBtn.hidden = true;
            correctAnswerDisplay.hidden = false;
            correctAnswerDisplay.textContent = `Correct answer: ${getCorrectAnswerDisplay(question)}`;
            nextQuestionBtn.hidden = false;

            if (reviewMode) {
                nextQuestionBtn.textContent = isLastInReview ? 'Finish Category' : 'Next';
            } else {
                nextQuestionBtn.textContent = isLastInCategory ? 'Finish Category' : 'Next Question';
            }
        } else {
            revealAnswerBtn.hidden = false;
            correctAnswerDisplay.hidden = true;
            nextQuestionBtn.hidden = true;
        }
    }

    renderResultsList();
}

function watchAnswers(question) {
    if (unsubscribeAnswers) unsubscribeAnswers();

    const answersQuery = query(
        collection(db, 'sessions', code, 'answers'),
        where('questionId', '==', question.id)
    );

    unsubscribeAnswers = onSnapshot(answersQuery, snapshot => {
        latestAnswers = new Map();
        snapshot.forEach(docSnap => {
            latestAnswers.set(docSnap.data().playerId, { ref: docSnap.ref, ...docSnap.data() });
        });

        answerCountEl.textContent = `${latestAnswers.size} / ${latestPlayers.length} answered`;
        renderResultsList();
    });
}

function renderResultsList() {
    resultsList.innerHTML = '';

    const phase = currentSession ? currentSession.questionPhase : 'answering';
    const bigRevealDone = !!(currentSession && currentSession.answerRevealed);

    latestPlayers.forEach(player => {
        const answer = latestAnswers.get(player.id);
        const li = document.createElement('li');

        if (!answer) {
            li.className = 'no-answer';
            li.textContent = `${player.name} — no answer`;
            resultsList.appendChild(li);
            return;
        }

        if (phase === 'answering') {
            // Individual answers can only be revealed once the host has locked them.
            li.className = 'no-answer';
            li.textContent = `${player.name} — answered`;
            resultsList.appendChild(li);
            return;
        }

        if (bigRevealDone) {
            li.className = answer.correct ? 'correct' : 'incorrect';

            const label = document.createElement('span');
            label.textContent = `${player.name}: ${formatAnswerValue(currentQuestion, answer.value)}`;
            li.appendChild(label);

            const overrideBtn = document.createElement('button');
            overrideBtn.type = 'button';
            overrideBtn.className = 'btn btn-small btn-secondary';
            overrideBtn.textContent = 'Override';
            overrideBtn.addEventListener('click', async () => {
                overrideBtn.disabled = true;
                await overrideAnswer(answer);
                overrideBtn.disabled = false;
            });
            li.appendChild(overrideBtn);
        } else if (answer.textRevealed) {
            const label = document.createElement('span');
            label.textContent = `${player.name}: ${formatAnswerValue(currentQuestion, answer.value)}`;
            li.appendChild(label);
        } else {
            const label = document.createElement('span');
            label.textContent = player.name;
            li.appendChild(label);

            const revealBtn = document.createElement('button');
            revealBtn.type = 'button';
            revealBtn.className = 'btn btn-small';
            revealBtn.textContent = 'Reveal';
            revealBtn.addEventListener('click', () => revealAnswerText(answer));
            li.appendChild(revealBtn);
        }

        resultsList.appendChild(li);
    });
}

async function handleLock() {
    if (!currentSession) return;
    lockBtn.disabled = true;

    try {
        const index = currentSession.currentQuestionIndex;
        const question = quiz.questions[index];
        const typeImpl = AnswerTypeRegistry.get(question.type);

        const answersSnap = await getDocs(
            query(collection(db, 'sessions', code, 'answers'), where('questionId', '==', question.id))
        );

        for (const docSnap of answersSnap.docs) {
            const data = docSnap.data();
            const gradeResult = typeImpl.grade(data.value, question);

            await updateDoc(docSnap.ref, {
                correct: gradeResult.correct,
                pointsAwarded: gradeResult.correct ? question.points : 0,
                textRevealed: false,
                manualOverride: false
            });
        }

        await updateDoc(sessionRef, { questionPhase: 'locked' });
    } finally {
        lockBtn.disabled = false;
    }
}

async function revealAnswerText(answer) {
    if (answer.textRevealed) return;
    await updateDoc(answer.ref, { textRevealed: true });
}

async function overrideAnswer(answer) {
    const newCorrect = !answer.correct;
    const newPoints = newCorrect ? currentQuestion.points : 0;
    const delta = newPoints - (answer.pointsAwarded || 0);

    await updateDoc(answer.ref, {
        correct: newCorrect,
        pointsAwarded: newPoints,
        manualOverride: true
    });

    if (delta !== 0) {
        await updateDoc(doc(db, 'sessions', code, 'players', answer.playerId), {
            score: increment(delta)
        });
    }
}

async function handleRevealAnswer() {
    if (!currentSession) return;
    revealAnswerBtn.disabled = true;

    try {
        const updates = [];

        latestAnswers.forEach(answer => {
            if (!answer.textRevealed) {
                updates.push(updateDoc(answer.ref, { textRevealed: true }));
            }
            if (answer.pointsAwarded > 0) {
                updates.push(updateDoc(doc(db, 'sessions', code, 'players', answer.playerId), {
                    score: increment(answer.pointsAwarded)
                }));
            }
        });

        await Promise.all(updates);
        await updateDoc(sessionRef, { answerRevealed: true });
    } finally {
        revealAnswerBtn.disabled = false;
    }
}

async function handleStartReview() {
    if (!currentSession) return;
    startReviewBtn.disabled = true;

    try {
        const reviewRange = getReviewRange(currentSession.currentQuestionIndex, currentSession.completedCategories);
        await updateDoc(sessionRef, {
            currentQuestionIndex: reviewRange.start,
            questionPhase: 'locked',
            answerRevealed: false,
            reviewMode: true
        });
    } finally {
        startReviewBtn.disabled = false;
    }
}

async function handleNextQuestion() {
    if (!currentSession) return;

    const index = currentSession.currentQuestionIndex;
    const reviewMode = !!currentSession.reviewMode;
    nextQuestionBtn.disabled = true;

    try {
        if (reviewMode) {
            const reviewRange = getReviewRange(index, currentSession.completedCategories);

            if (index === reviewRange.end) {
                await finishCategory();
            } else {
                await updateDoc(sessionRef, {
                    currentQuestionIndex: index + 1,
                    questionPhase: 'locked',
                    answerRevealed: false,
                    reviewMode: true
                });
            }
        } else {
            const catBlock = getCategoryBoundsFor(index);

            if (index === catBlock.end) {
                await finishCategory();
            } else {
                await updateDoc(sessionRef, {
                    currentQuestionIndex: index + 1,
                    questionPhase: 'answering',
                    answerRevealed: false,
                    reviewMode: false
                });
            }
        }
    } finally {
        nextQuestionBtn.disabled = false;
    }
}

// Marks the category just played as complete and returns to the category
// picker — the host chooses what to play next (or, once every category is
// done, moves on to the results reveal).
async function finishCategory() {
    const categoryStart = currentSession.currentCategoryStart;
    const completed = Array.from(new Set([...(currentSession.completedCategories || []), categoryStart]));

    await updateDoc(sessionRef, {
        status: 'category-select',
        questionPhase: 'answering',
        answerRevealed: false,
        reviewMode: false,
        introPhase: null,
        completedCategories: completed
    });
}

function ensureResultsRows() {
    if (resultsRows) return;

    resultsRows = [...latestPlayers]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .map(player => ({
            name: player.name,
            score: player.score || 0,
            scoreRevealed: false,
            nameRevealed: false
        }));
}

function renderResultsView() {
    resultsRevealList.innerHTML = '';

    resultsRows.forEach((row, i) => {
        const li = document.createElement('li');
        li.className = 'result-row';

        const posEl = document.createElement('span');
        posEl.className = 'result-pos';
        posEl.textContent = `#${i + 1}`;
        li.appendChild(posEl);

        const nameEl = document.createElement('span');
        nameEl.className = 'result-name';
        if (row.nameRevealed) {
            nameEl.textContent = row.name;
        } else {
            const revealNameBtn = document.createElement('button');
            revealNameBtn.type = 'button';
            revealNameBtn.className = 'btn btn-small btn-secondary';
            revealNameBtn.textContent = 'Reveal Name';
            revealNameBtn.addEventListener('click', () => {
                row.nameRevealed = true;
                renderResultsView();
            });
            nameEl.appendChild(revealNameBtn);
        }
        li.appendChild(nameEl);

        const scoreEl = document.createElement('span');
        scoreEl.className = 'result-score';
        if (row.scoreRevealed) {
            scoreEl.textContent = `${row.score} pts`;
        } else {
            const revealScoreBtn = document.createElement('button');
            revealScoreBtn.type = 'button';
            revealScoreBtn.className = 'btn btn-small btn-secondary';
            revealScoreBtn.textContent = 'Reveal Score';
            revealScoreBtn.addEventListener('click', () => {
                row.scoreRevealed = true;
                renderResultsView();
            });
            scoreEl.appendChild(revealScoreBtn);
        }
        li.appendChild(scoreEl);

        resultsRevealList.appendChild(li);
    });
}

async function handleFinishQuiz() {
    finishQuizBtn.disabled = true;

    try {
        renderFinalScoreboard();
        await updateDoc(sessionRef, { status: 'ended' });
        await finishQuizCleanup();
    } finally {
        finishQuizBtn.disabled = false;
    }
}

// Records match history + folds each player's outcome into their persistent
// leaderboard stats, then wipes the session's ephemeral data (code, players,
// messages, answers) — only the aggregate leaderboard totals and the
// standalone quizResults record survive past the end of the quiz.
//
// Stats are only recorded for 2+ players — a solo session always has a
// trivial "win" regardless of score, which would otherwise pollute the
// leaderboard with the host's own content test-runs.
async function finishQuizCleanup() {
    if (latestPlayers.length >= 2) {
        const scores = latestPlayers.map(p => p.score || 0);
        const maxScore = Math.max(...scores);
        const winnerCount = scores.filter(s => s === maxScore).length;

        const resultPlayers = latestPlayers.map(player => {
            const score = player.score || 0;
            const outcome = score !== maxScore ? 'loss' : (winnerCount > 1 ? 'draw' : 'win');
            return { name: player.name, score, outcome };
        });

        await addDoc(collection(db, 'quizResults'), {
            quizId: quiz.id,
            quizTitle: quiz.title,
            playedAt: serverTimestamp(),
            players: resultPlayers
        });

        await Promise.all(resultPlayers.map(async result => {
            const leaderboardRef = doc(db, 'leaderboard', slugifyName(result.name));

            await setDoc(leaderboardRef, {
                name: result.name,
                totalScore: increment(result.score),
                gamesPlayed: increment(1),
                wins: increment(result.outcome === 'win' ? 1 : 0),
                draws: increment(result.outcome === 'draw' ? 1 : 0),
                losses: increment(result.outcome === 'loss' ? 1 : 0)
            }, { merge: true });

            const existingSnap = await getDoc(leaderboardRef);
            const existingBest = (existingSnap.exists() && existingSnap.data().bestScore) || 0;

            if (result.score > existingBest) {
                await setDoc(leaderboardRef, { bestScore: result.score }, { merge: true });
            }
        }));
    }

    await deleteCollectionDocs(collection(db, 'sessions', code, 'players'));
    await deleteCollectionDocs(collection(db, 'sessions', code, 'messages'));
    await deleteCollectionDocs(collection(db, 'sessions', code, 'answers'));
    await deleteDoc(sessionRef);
}

async function deleteCollectionDocs(colRef) {
    const snap = await getDocs(colRef);
    await Promise.all(snap.docs.map(docSnap => deleteDoc(docSnap.ref)));
}

function slugifyName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

        default:
            return String(value);
    }
}

function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Encodes a join.html link (with the code pre-filled via ?code=) as a QR
// image, so scanning it drops a player straight into the name-only join
// form. Rendered via a public QR image API rather than a bundled library —
// if that service is ever unreachable the <img> just fails to load (onerror
// hides it and falls back to the caption), instead of throwing and taking
// down the rest of the page like a failed <script> load would.
function renderJoinQrCode() {
    const basePath = window.location.hostname === 'bladeinferior.github.io' ? '/harryswebsite/' : '/';
    const joinUrl = `${window.location.origin}${basePath}quizhub/join.html?code=${code}`;

    joinQrImg.onload = () => { joinQrImg.hidden = false; };
    joinQrImg.onerror = () => {
        joinQrImg.hidden = true;
        joinQrCaption.textContent = `Or go to join.html and enter code ${code}`;
    };
    joinQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}`;
}
