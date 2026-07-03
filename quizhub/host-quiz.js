import { db } from './firebase/firebase-config.js';
import { QUIZ_PATHS } from './data/quiz-registry.js';
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
    getDocs,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz') || 'sample-quiz-1';
const quizPath = QUIZ_PATHS[quizId] || QUIZ_PATHS['sample-quiz-1'];

const titleEl = document.getElementById('quiz-title');
const descEl = document.getElementById('quiz-description');
const codeDisplay = document.getElementById('code-display');
const beginBtn = document.getElementById('begin-btn');

const lobbyView = document.getElementById('lobby-view');
const playerList = document.getElementById('player-list');
const messageList = document.getElementById('message-list');

const quizView = document.getElementById('quiz-view');
const questionProgressEl = document.getElementById('question-progress');
const questionPromptEl = document.getElementById('host-question-prompt');
const questionMediaEl = document.getElementById('host-question-media');
const answerCountEl = document.getElementById('answer-count');
const lockBtn = document.getElementById('lock-btn');
const lockedControls = document.getElementById('locked-controls');
const revealAnswerBtn = document.getElementById('reveal-answer-btn');
const correctAnswerDisplay = document.getElementById('correct-answer-display');
const nextQuestionBtn = document.getElementById('next-question-btn');
const resultsList = document.getElementById('results-list');
const scoreboardList = document.getElementById('scoreboard-list');

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

fetch(quizPath)
    .then(res => res.json())
    .then(data => {
        quiz = data;
        titleEl.textContent = quiz.title;
        descEl.textContent = quiz.description || '';
        startSession();
    });

function startSession() {
    code = generateCode();
    codeDisplay.textContent = code;
    sessionRef = doc(db, 'sessions', code);

    setDoc(sessionRef, {
        quizId: quiz.id,
        status: 'lobby',
        currentQuestionIndex: -1,
        questionPhase: 'answering',
        answerRevealed: false,
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
        updateDoc(sessionRef, {
            status: 'active',
            currentQuestionIndex: 0,
            questionPhase: 'answering'
        });
    }, { once: true });

    lockBtn.addEventListener('click', handleLock);
    revealAnswerBtn.addEventListener('click', handleRevealAnswer);
    nextQuestionBtn.addEventListener('click', handleNextQuestion);
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

    if (session.status === 'lobby') {
        lobbyView.hidden = false;
        quizView.hidden = true;
        endedView.hidden = true;
        return;
    }

    if (session.status === 'ended') {
        lobbyView.hidden = true;
        quizView.hidden = true;
        endedView.hidden = false;
        return;
    }

    lobbyView.hidden = true;
    quizView.hidden = false;
    endedView.hidden = true;

    renderHostQuestion(session.currentQuestionIndex, session.questionPhase, session.answerRevealed);
}

function renderHostQuestion(index, phase, answerRevealed) {
    const question = quiz.questions[index];
    if (!question) return;
    currentQuestion = question;

    questionProgressEl.textContent = `Question ${index + 1} of ${quiz.questions.length}`;
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
    } else {
        lockBtn.hidden = true;
        lockedControls.hidden = false;
        nextQuestionBtn.hidden = !answerRevealed;
        nextQuestionBtn.textContent = index === quiz.questions.length - 1 ? 'Finish Quiz' : 'Next Question';
    }

    if (answerRevealed) {
        revealAnswerBtn.hidden = true;
        correctAnswerDisplay.hidden = false;
        correctAnswerDisplay.textContent = `Correct answer: ${getCorrectAnswerDisplay(question)}`;
    } else {
        revealAnswerBtn.hidden = false;
        correctAnswerDisplay.hidden = true;
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
            overrideBtn.addEventListener('click', () => overrideAnswer(answer));
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

async function handleNextQuestion() {
    if (!currentSession) return;

    const index = currentSession.currentQuestionIndex;
    nextQuestionBtn.disabled = true;

    try {
        if (index === quiz.questions.length - 1) {
            renderFinalScoreboard();
            await updateDoc(sessionRef, { status: 'ended' });
            await finishQuizCleanup();
        } else {
            await updateDoc(sessionRef, {
                currentQuestionIndex: index + 1,
                questionPhase: 'answering',
                answerRevealed: false
            });
        }
    } finally {
        nextQuestionBtn.disabled = false;
    }
}

// Folds each player's score into their persistent leaderboard total, then
// wipes the session's ephemeral data (code, players, messages, answers) —
// only the name + running total survive past the end of the quiz.
async function finishQuizCleanup() {
    await Promise.all(
        latestPlayers.map(player =>
            setDoc(doc(db, 'leaderboard', slugifyName(player.name)), {
                name: player.name,
                totalScore: increment(player.score || 0)
            }, { merge: true })
        )
    );

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

        default:
            return String(value);
    }
}

function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}
