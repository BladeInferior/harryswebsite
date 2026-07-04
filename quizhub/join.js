import { db } from './firebase/firebase-config.js';
import { loadQuiz } from './data/quiz-loader.js';
import {
    doc,
    getDoc,
    setDoc,
    addDoc,
    deleteDoc,
    onSnapshot,
    collection,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const joinStatus = document.getElementById('join-status');

const waitingSection = document.getElementById('waiting-section');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendStatus = document.getElementById('send-status');

const quizSection = document.getElementById('quiz-section');
const playerScoreEl = document.getElementById('player-score');
const questionProgressEl = document.getElementById('player-question-progress');
const questionPromptEl = document.getElementById('player-question-prompt');
const questionMediaEl = document.getElementById('player-question-media');
const answerMount = document.getElementById('answer-mount');
const answerActions = document.getElementById('answer-actions');
const sendAnswerBtn = document.getElementById('send-answer-btn');
const lockedView = document.getElementById('locked-view');
const lockedYourAnswerEl = document.getElementById('locked-your-answer');
const lockedStatusEl = document.getElementById('locked-status');
const backBtn = document.getElementById('back-btn');
const revealView = document.getElementById('reveal-view');

const endedSection = document.getElementById('ended-section');
const finalScoreEl = document.getElementById('final-score');

let currentCode = null;
let currentName = null;
let currentPlayerId = null;
let quiz = null;

let currentPhase = 'answering';
let currentQuestionIndex = null;
let sessionAnswerRevealed = false;
let watchedQuestionIndex = null;
let editing = false;
let unsubscribeOwnAnswer = null;
let ownAnswerData = null;

joinForm.addEventListener('submit', async e => {
    e.preventDefault();

    const code = codeInput.value.trim();
    const name = nameInput.value.trim();
    if (!code || !name) return;

    joinStatus.className = 'pending';
    joinStatus.textContent = 'Checking code...';

    const sessionRef = doc(db, 'sessions', code);
    const snapshot = await getDoc(sessionRef);

    if (!snapshot.exists()) {
        joinStatus.className = 'failure';
        joinStatus.textContent = 'That code was not found. Check with the host and try again.';
        return;
    }

    currentCode = code;
    currentName = name;

    const playerRef = await addDoc(collection(db, 'sessions', code, 'players'), {
        name,
        joinedAt: serverTimestamp(),
        score: 0
    });
    currentPlayerId = playerRef.id;

    const quizId = snapshot.data().quizId;
    quiz = await loadQuiz(quizId);

    joinStatus.className = 'success';
    joinStatus.textContent = 'Joined!';
    joinForm.hidden = true;

    onSnapshot(sessionRef, snap => {
        if (snap.exists()) renderSessionState(snap.data());
    });

    onSnapshot(doc(db, 'sessions', code, 'players', currentPlayerId), snap => {
        if (!snap.exists()) return;
        const score = snap.data().score || 0;
        playerScoreEl.textContent = `Score: ${score}`;
        finalScoreEl.textContent = `Your final score: ${score}`;
    });
});

messageForm.addEventListener('submit', async e => {
    e.preventDefault();

    const message = messageInput.value.trim();
    if (!message || !currentCode) return;

    sendStatus.className = 'pending';
    sendStatus.textContent = 'Sending...';

    await addDoc(collection(db, 'sessions', currentCode, 'messages'), {
        name: currentName,
        message,
        sentAt: serverTimestamp()
    });

    sendStatus.className = 'success';
    sendStatus.textContent = 'Sent!';
    messageInput.value = '';
});

backBtn.addEventListener('click', () => {
    editing = true;
    const question = quiz.questions[currentQuestionIndex];
    updateAnswerView(question);

    // Dropping the doc marks this player as "no answer" for the host again
    // until they resend — editing shouldn't leave their old answer standing.
    deleteDoc(doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`));
});

function renderSessionState(session) {
    if (session.status === 'lobby') {
        waitingSection.hidden = false;
        quizSection.hidden = true;
        endedSection.hidden = true;
        return;
    }

    if (session.status === 'ended') {
        waitingSection.hidden = true;
        quizSection.hidden = true;
        endedSection.hidden = false;
        return;
    }

    waitingSection.hidden = true;
    quizSection.hidden = false;
    endedSection.hidden = true;

    currentPhase = session.questionPhase;
    currentQuestionIndex = session.currentQuestionIndex;
    sessionAnswerRevealed = !!session.answerRevealed;

    const question = quiz.questions[currentQuestionIndex];
    if (!question) return;

    if (watchedQuestionIndex !== currentQuestionIndex) {
        watchedQuestionIndex = currentQuestionIndex;
        editing = false;
        ownAnswerData = null;
        watchOwnAnswer(question);
    }

    renderQuestionContent(question);
    updateAnswerView(question);
}

function watchOwnAnswer(question) {
    if (unsubscribeOwnAnswer) unsubscribeOwnAnswer();

    const answerRef = doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`);
    unsubscribeOwnAnswer = onSnapshot(answerRef, snap => {
        ownAnswerData = snap.exists() ? snap.data() : null;
        updateAnswerView(question);
    });
}

function renderQuestionContent(question) {
    questionProgressEl.textContent = `Question ${currentQuestionIndex + 1} of ${quiz.questions.length}`;
    questionPromptEl.textContent = question.prompt;

    questionMediaEl.innerHTML = '';
    if (question.media) {
        const img = document.createElement('img');
        img.src = question.media.src;
        img.alt = question.media.alt || '';
        img.className = 'question-media' + (question.media.silhouette && currentPhase === 'answering' ? ' silhouette' : '');
        questionMediaEl.appendChild(img);
    }
}

// The player's own view only changes on two triggers: the host revealing the
// correct answer (sessionAnswerRevealed) — never on individual per-player
// reveals on the host's results list, which are host-screen-only.
function updateAnswerView(question) {
    if (sessionAnswerRevealed) {
        showRevealed(question, ownAnswerData);
    } else if (currentPhase === 'answering' && (editing || !ownAnswerData)) {
        showAnswerInput(question);
    } else {
        showLocked(question, ownAnswerData);
    }
}

function showAnswerInput(question) {
    answerActions.hidden = false;
    answerMount.hidden = false;
    lockedView.hidden = true;
    revealView.hidden = true;

    answerMount.innerHTML = '';
    AnswerTypeRegistry.get(question.type).renderInput(question, answerMount);

    sendAnswerBtn.onclick = async () => {
        const value = AnswerTypeRegistry.get(question.type).getValue(answerMount, question);
        editing = false;

        await setDoc(doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`), {
            questionId: question.id,
            playerId: currentPlayerId,
            playerName: currentName,
            value,
            correct: null,
            pointsAwarded: null,
            textRevealed: false,
            manualOverride: false,
            updatedAt: serverTimestamp()
        });
    };
}

function showLocked(question, answerData) {
    answerActions.hidden = true;
    answerMount.hidden = true;
    revealView.hidden = true;
    lockedView.hidden = false;

    if (answerData) {
        lockedYourAnswerEl.hidden = false;
        lockedYourAnswerEl.textContent = `Your answer: ${formatAnswerValue(question, answerData.value)}`;
        lockedStatusEl.textContent = currentPhase === 'answering'
            ? 'Answer submitted.'
            : 'Your answer is locked in.';
        backBtn.hidden = currentPhase !== 'answering';
    } else {
        lockedYourAnswerEl.hidden = true;
        lockedStatusEl.textContent = "You didn't submit an answer.";
        backBtn.hidden = true;
    }
}

function showRevealed(question, answerData) {
    answerActions.hidden = true;
    answerMount.hidden = true;
    lockedView.hidden = true;
    revealView.hidden = false;

    revealView.innerHTML = '';

    const label = document.createElement('div');
    if (answerData) {
        revealView.className = answerData.correct ? 'correct' : 'incorrect';
        label.textContent = answerData.correct ? 'Correct!' : 'Incorrect.';
    } else {
        revealView.className = 'incorrect';
        label.textContent = "You didn't answer this one.";
    }
    revealView.appendChild(label);

    if (question.explanation) {
        const explanation = document.createElement('span');
        explanation.className = 'explanation';
        explanation.textContent = question.explanation;
        revealView.appendChild(explanation);
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
