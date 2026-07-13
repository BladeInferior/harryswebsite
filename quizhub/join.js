import { db } from './firebase/firebase-config.js';
import { loadQuiz } from './data/quiz-loader.js';
import {
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    addDoc,
    deleteDoc,
    onSnapshot,
    collection,
    query,
    where,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const joinHero = document.getElementById('join-hero');
const joinHeroText = document.getElementById('join-hero-text');
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const codeFieldWrapper = document.getElementById('code-field-wrapper');
const codeInput = document.getElementById('code-input');
const joinStatus = document.getElementById('join-status');

// Arriving via a host's QR code pre-fills the join code and skips straight
// to asking for a name — see renderJoinQrCode() in host-quiz.js.
const prefilledCode = new URLSearchParams(window.location.search).get('code');
if (prefilledCode) {
    codeInput.value = prefilledCode;
    codeFieldWrapper.hidden = true;
    joinHeroText.textContent = 'Enter your name to join the quiz.';
    nameInput.focus();
}

const joinCard = document.getElementById('join-card');
const waitingSection = document.getElementById('waiting-section');
const waitingPlayerList = document.getElementById('waiting-player-list');
const hostScreenSection = document.getElementById('host-screen-section');
const hostScreenMessage = document.getElementById('host-screen-message');
const openReviewBtn = document.getElementById('open-review-btn');

const playerReviewSection = document.getElementById('player-review-section');
const playerReviewCategoriesBackBtn = document.getElementById('player-review-categories-back-btn');
const playerReviewCategoriesView = document.getElementById('player-review-categories-view');
const playerReviewCategoryList = document.getElementById('player-review-category-list');
const playerReviewQuestionsView = document.getElementById('player-review-questions-view');
const playerReviewQuestionsBackBtn = document.getElementById('player-review-questions-back-btn');
const playerReviewQuestionsTitle = document.getElementById('player-review-questions-title');
const playerReviewQuestionList = document.getElementById('player-review-question-list');
const playerReviewDetailView = document.getElementById('player-review-detail-view');
const playerReviewDetailBackBtn = document.getElementById('player-review-detail-back-btn');
const playerReviewDetailPrompt = document.getElementById('player-review-detail-prompt');
const playerReviewDetailMedia = document.getElementById('player-review-detail-media');
const playerReviewDetailPrevious = document.getElementById('player-review-detail-previous');
const playerReviewDetailAnswerMount = document.getElementById('player-review-detail-answer-mount');
const playerReviewSaveBtn = document.getElementById('player-review-save-btn');
const playerReviewSaveStatus = document.getElementById('player-review-save-status');

const categoryIntroSection = document.getElementById('category-intro-section');
const categoryIntroLabelEl = document.getElementById('player-category-intro-label');
const categoryIntroTextEl = document.getElementById('player-category-intro-text');
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
const waitingOnPlayersEl = document.getElementById('waiting-on-players');
const backBtn = document.getElementById('back-btn');
const revealView = document.getElementById('reveal-view');
const buzzerView = document.getElementById('buzzer-view');
const buzzInBtn = document.getElementById('buzz-in-btn');
const buzzerStatusText = document.getElementById('buzzer-status-text');

const endedSection = document.getElementById('ended-section');
const finalScoreEl = document.getElementById('final-score');
const reviewAnswersLink = document.getElementById('review-answers-link');

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
let unsubscribeBuzzes = null;
let latestBuzzesForPlayer = [];
let unsubscribeAnswerCount = null;
let answeredCount = 0;
let latestPlayersForJoin = [];
let reviewCategoryContext = null;
let reviewQuestionContext = null;
let latestSessionSnapshot = null;
let playerReviewModeActive = false;

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

    const nameKey = AnswerMatching.normalize(name);
    const playersRef = collection(db, 'sessions', code, 'players');
    const existingSnap = await getDocs(query(playersRef, where('nameKey', '==', nameKey)));
    const existingDoc = existingSnap.docs[0] || null;

    const deviceTokenKey = `quizhub_device_${code}_${nameKey}`;

    if (existingDoc) {
        const data = existingDoc.data();
        const storedToken = localStorage.getItem(deviceTokenKey);

        // Someone else appears to be actively using this name right now —
        // ask before taking over rather than silently merging two players.
        if (data.connected && data.deviceToken !== storedToken) {
            const proceed = confirm(
                `"${data.name}" is already active in this quiz. If that's you on another device, reconnecting will take over that session. Continue?`
            );
            if (!proceed) {
                joinStatus.className = 'failure';
                joinStatus.textContent = 'Please choose a different name.';
                return;
            }
        }

        currentPlayerId = existingDoc.id;
        currentName = data.name;

        const deviceToken = generateDeviceToken();
        localStorage.setItem(deviceTokenKey, deviceToken);

        await updateDoc(doc(db, 'sessions', code, 'players', currentPlayerId), {
            connected: true,
            deviceToken
        });

        // Fire-and-forget — this is just the host's toast notification, and
        // must never block the player actually getting into the quiz (a
        // rules/permission hiccup here used to leave the join stuck on
        // "Checking code..." forever even though the player doc above had
        // already gone through).
        addDoc(collection(db, 'sessions', code, 'events'), {
            type: 'reconnected',
            name: currentName,
            at: serverTimestamp()
        }).catch(err => console.error('Reconnect event log failed:', err));
    } else {
        currentName = name;
        const deviceToken = generateDeviceToken();
        localStorage.setItem(deviceTokenKey, deviceToken);

        const playerRef = await addDoc(playersRef, {
            name,
            nameKey,
            joinedAt: serverTimestamp(),
            score: 0,
            connected: true,
            deviceToken
        });
        currentPlayerId = playerRef.id;

        addDoc(collection(db, 'sessions', code, 'events'), {
            type: 'joined',
            name,
            at: serverTimestamp()
        }).catch(err => console.error('Join event log failed:', err));
    }

    const quizId = snapshot.data().quizId;
    try {
        quiz = await loadQuiz(quizId);
    } catch (err) {
        console.error(err);
        joinStatus.className = 'failure';
        joinStatus.textContent = "This session's quiz couldn't be loaded. Check with the host.";
        return;
    }

    joinStatus.className = 'success';
    joinStatus.textContent = 'Joined!';
    joinForm.hidden = true;
    joinHero.hidden = true;

    // Best-effort disconnect detection — Firestore has no built-in presence,
    // so a hard crash/force-close won't mark this player disconnected until
    // they try to reconnect under the same name (handled above via deviceToken).
    window.addEventListener('pagehide', () => {
        updateDoc(doc(db, 'sessions', currentCode, 'players', currentPlayerId), { connected: false }).catch(() => {});
    });

    onSnapshot(sessionRef, snap => {
        if (snap.exists()) renderSessionState(snap.data());
    });

    onSnapshot(doc(db, 'sessions', code, 'players', currentPlayerId), snap => {
        if (!snap.exists()) return;
        const score = snap.data().score || 0;
        playerScoreEl.textContent = `Score: ${score}`;
        finalScoreEl.textContent = `Your final score: ${score}`;
    });

    onSnapshot(playersRef, snap => {
        latestPlayersForJoin = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderWaitingPlayerList();

        const question = currentQuestionIndex !== null ? quiz.questions[currentQuestionIndex] : null;
        if (question) updateAnswerView(question);
    });
});

function renderWaitingPlayerList() {
    waitingPlayerList.innerHTML = '';

    latestPlayersForJoin.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        li.className = [
            player.id === currentPlayerId ? 'self' : '',
            player.connected === false ? 'disconnected' : ''
        ].filter(Boolean).join(' ');
        waitingPlayerList.appendChild(li);
    });
}

function generateDeviceToken() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
}

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

buzzInBtn.addEventListener('click', async () => {
    if (!currentCode || currentQuestionIndex === null) return;
    const question = quiz.questions[currentQuestionIndex];
    if (!question || question.type !== 'buzzer') return;

    buzzInBtn.disabled = true;
    try {
        await setDoc(doc(db, 'sessions', currentCode, 'buzzes', `${question.id}_${currentPlayerId}`), {
            questionId: question.id,
            playerId: currentPlayerId,
            playerName: currentName,
            status: 'pending',
            buzzedAt: serverTimestamp()
        });
    } catch (err) {
        console.error(err);
        buzzInBtn.disabled = false;
    }
});

function renderSessionState(session) {
    latestSessionSnapshot = session;

    waitingSection.hidden = true;
    hostScreenSection.hidden = true;
    playerReviewSection.hidden = true;
    categoryIntroSection.hidden = true;
    quizSection.hidden = true;
    endedSection.hidden = true;

    if (session.status === 'lobby') {
        waitingSection.hidden = false;
        applyCardBackground(null);
        return;
    }

    if (session.status === 'category-select') {
        applyCardBackground(null);

        if (!session.reviewAllowed) playerReviewModeActive = false;

        if (playerReviewModeActive) {
            playerReviewSection.hidden = false;
        } else {
            hostScreenSection.hidden = false;
            hostScreenMessage.textContent = 'The host is choosing the next category to play...';
            openReviewBtn.hidden = !session.reviewAllowed;
        }
        return;
    }

    if (session.status === 'category-intro') {
        categoryIntroSection.hidden = false;
        renderCategoryIntro(session);
        return;
    }

    if (session.status === 'results') {
        hostScreenSection.hidden = false;
        hostScreenMessage.textContent = 'The host is revealing the final results...';
        applyCardBackground(null);
        return;
    }

    if (session.status === 'ended') {
        endedSection.hidden = false;
        applyCardBackground(null);

        reviewAnswersLink.hidden = !quiz.reviewEnabled;
        if (quiz.reviewEnabled) {
            reviewAnswersLink.href = `review.html?name=${encodeURIComponent(currentName)}`;
        }
        return;
    }

    quizSection.hidden = false;

    currentPhase = session.questionPhase;
    currentQuestionIndex = session.currentQuestionIndex;
    sessionAnswerRevealed = !!session.answerRevealed;

    const question = quiz.questions[currentQuestionIndex];
    if (!question) return;

    applyCardBackground(getCategoryMetaForIndex(currentQuestionIndex).questionBackground);

    if (watchedQuestionIndex !== currentQuestionIndex) {
        watchedQuestionIndex = currentQuestionIndex;
        editing = false;
        ownAnswerData = null;
        latestBuzzesForPlayer = [];
        answeredCount = 0;
        if (question.type === 'buzzer') {
            watchBuzzes(question);
        } else {
            watchOwnAnswer(question);
            watchAnswerCount(question);
        }
    }

    renderQuestionContent(question);
    updateAnswerView(question);
}

// quiz.categoryMeta holds per-category background/titleScreen/exampleScreen,
// matched to questions by category name (set the same way host-quiz.js does).
function getCategoryMetaForIndex(index) {
    const question = quiz.questions[index];
    const name = question ? (question.category || 'General') : null;
    return (quiz.categoryMeta || []).find(m => m.name === name) || { name };
}

function applyCardBackground(url) {
    joinCard.classList.toggle('themed-bg', !!url);
    joinCard.style.backgroundImage = url ? `url('${url}')` : '';
}

// =========================
// LIVE IN-SESSION REVIEW-WITH-EDIT — the host presses a button on the
// category-select screen (reviewAllowed) to let players revisit completed
// categories, see their answers, and re-submit if they choose. Grading and
// the player's own score are updated live to match the edit.
// =========================
function getCategoryBoundsForReview() {
    const bounds = [];
    let start = 0;

    for (let i = 1; i <= quiz.questions.length; i++) {
        const prevCategory = quiz.questions[i - 1].category;
        const currentCategory = i < quiz.questions.length ? quiz.questions[i].category : undefined;

        if (currentCategory !== prevCategory) {
            bounds.push({ start, end: i - 1, name: quiz.questions[start].category || 'General' });
            start = i;
        }
    }

    return bounds;
}

function showPlayerReviewCategories(session) {
    reviewCategoryContext = null;
    reviewQuestionContext = null;
    playerReviewCategoriesView.hidden = false;
    playerReviewQuestionsView.hidden = true;
    playerReviewDetailView.hidden = true;

    const completed = session.completedCategories || [];
    const categories = getCategoryBoundsForReview().filter(c => completed.includes(c.start));

    playerReviewCategoryList.innerHTML = '';

    if (!categories.length) {
        playerReviewCategoryList.innerHTML = '<p style="color:var(--secondary);">No completed categories yet.</p>';
        return;
    }

    categories.forEach(cat => {
        const count = cat.end - cat.start + 1;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';

        const name = document.createElement('span');
        name.textContent = cat.name;
        tile.appendChild(name);

        const meta = document.createElement('span');
        meta.className = 'tile-meta';
        meta.textContent = `${count} question${count === 1 ? '' : 's'}`;
        tile.appendChild(meta);

        tile.addEventListener('click', () => showPlayerReviewQuestions(cat));
        playerReviewCategoryList.appendChild(tile);
    });
}

async function showPlayerReviewQuestions(cat) {
    reviewCategoryContext = cat;
    reviewQuestionContext = null;
    playerReviewCategoriesView.hidden = true;
    playerReviewQuestionsView.hidden = false;
    playerReviewDetailView.hidden = true;
    playerReviewQuestionsTitle.textContent = cat.name;
    playerReviewQuestionList.innerHTML = '<p style="color:var(--secondary);">Loading...</p>';

    const indexes = [];
    for (let i = cat.start; i <= cat.end; i++) indexes.push(i);

    const rows = await Promise.all(indexes.map(async index => {
        const question = quiz.questions[index];

        if (question.type === 'buzzer') {
            const snap = await getDoc(doc(db, 'sessions', currentCode, 'buzzes', `${question.id}_${currentPlayerId}`));
            return { question, answerData: null, buzzData: snap.exists() ? snap.data() : null };
        }

        const snap = await getDoc(doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`));
        return { question, answerData: snap.exists() ? snap.data() : null, buzzData: null };
    }));

    playerReviewQuestionList.innerHTML = '';

    rows.forEach(({ question, answerData, buzzData }) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';

        const label = document.createElement('span');
        label.textContent = question.prompt;
        tile.appendChild(label);

        // Deliberately no correct/incorrect indication here — this is only
        // for changing what you submitted, not a scored recap.
        if (question.type === 'buzzer') {
            const meta = document.createElement('span');
            meta.className = 'tile-meta';
            meta.textContent = 'Not editable';
            tile.appendChild(meta);
        }

        tile.addEventListener('click', () => showPlayerReviewDetail(question, answerData));
        playerReviewQuestionList.appendChild(tile);
    });
}

function showPlayerReviewDetail(question, answerData) {
    reviewQuestionContext = question;
    playerReviewQuestionsView.hidden = true;
    playerReviewDetailView.hidden = false;

    playerReviewDetailPrompt.textContent = question.prompt;
    MediaUtils.render(question.media, playerReviewDetailMedia, false);

    playerReviewSaveStatus.textContent = '';
    playerReviewSaveStatus.className = '';

    if (question.type === 'buzzer') {
        playerReviewDetailPrevious.className = '';
        playerReviewDetailPrevious.textContent = 'This was judged live by the host — nothing to edit here.';
        playerReviewDetailAnswerMount.innerHTML = '';
        playerReviewSaveBtn.hidden = true;
        return;
    }

    playerReviewSaveBtn.hidden = false;
    playerReviewDetailPrevious.className = '';
    playerReviewDetailPrevious.textContent = answerData
        ? `Your submitted answer: ${formatAnswerValue(question, answerData.value)}`
        : "You didn't answer this one.";

    playerReviewDetailAnswerMount.innerHTML = '';
    AnswerTypeRegistry.get(question.type).renderInput(question, playerReviewDetailAnswerMount);
    prefillReviewAnswer(question, playerReviewDetailAnswerMount, answerData ? answerData.value : null);

    playerReviewSaveBtn.onclick = () => saveReviewedAnswer(question);
}

// Prefills the freshly-rendered input with the previous answer where it's
// straightforward to do so (plain inputs) — choice-based types (multiple
// choice/image-select/ordering) just show the previous answer as text above
// instead, rather than reaching into answer-types.js's rendering internals.
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

async function saveReviewedAnswer(question) {
    playerReviewSaveBtn.disabled = true;
    playerReviewSaveStatus.className = '';
    playerReviewSaveStatus.textContent = 'Saving...';

    try {
        const typeImpl = AnswerTypeRegistry.get(question.type);
        const value = typeImpl.getValue(playerReviewDetailAnswerMount, question);
        const answerRef = doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`);
        const existingSnap = await getDoc(answerRef);

        // Deliberately just overwrites what was submitted — no grading, no
        // score change. This is only here so a player can fix what they
        // typed, not to let them regrade or re-score themselves.
        if (existingSnap.exists()) {
            await updateDoc(answerRef, { value, updatedAt: serverTimestamp() });
        } else {
            await setDoc(answerRef, {
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
        }

        playerReviewSaveStatus.className = 'success';
        playerReviewSaveStatus.textContent = 'Saved!';
    } catch (err) {
        console.error(err);
        playerReviewSaveStatus.textContent = 'Failed to save — check console.';
    } finally {
        playerReviewSaveBtn.disabled = false;
    }
}

openReviewBtn.addEventListener('click', () => {
    playerReviewModeActive = true;
    hostScreenSection.hidden = true;
    playerReviewSection.hidden = false;
    if (latestSessionSnapshot) showPlayerReviewCategories(latestSessionSnapshot);
});

playerReviewCategoriesBackBtn.addEventListener('click', () => {
    playerReviewModeActive = false;
    playerReviewSection.hidden = true;
    hostScreenSection.hidden = false;
});

playerReviewQuestionsBackBtn.addEventListener('click', () => {
    if (latestSessionSnapshot) showPlayerReviewCategories(latestSessionSnapshot);
});

playerReviewDetailBackBtn.addEventListener('click', () => {
    if (reviewCategoryContext) showPlayerReviewQuestions(reviewCategoryContext);
});

function renderCategoryIntro(session) {
    const meta = getCategoryMetaForIndex(session.currentCategoryStart);
    const screen = session.introPhase === 'example' ? meta.exampleScreen : meta.titleScreen;

    applyCardBackground(null);

    categoryIntroLabelEl.textContent = session.introPhase === 'example'
        ? `${meta.name} — Example`
        : meta.name;
    categoryIntroTextEl.textContent = (screen && screen.text) || '';
}

function watchOwnAnswer(question) {
    if (unsubscribeOwnAnswer) unsubscribeOwnAnswer();

    const answerRef = doc(db, 'sessions', currentCode, 'answers', `${question.id}_${currentPlayerId}`);
    unsubscribeOwnAnswer = onSnapshot(answerRef, snap => {
        ownAnswerData = snap.exists() ? snap.data() : null;
        updateAnswerView(question);
    });
}

// Live count of submitted answers for the current question, used to show
// "Waiting on N more players..." once this player has locked in theirs (2.3).
function watchAnswerCount(question) {
    if (unsubscribeAnswerCount) unsubscribeAnswerCount();

    const answersQuery = query(
        collection(db, 'sessions', currentCode, 'answers'),
        where('questionId', '==', question.id)
    );

    unsubscribeAnswerCount = onSnapshot(answersQuery, snapshot => {
        answeredCount = snapshot.size;
        if (currentPhase === 'answering') updateAnswerView(question);
    });
}

function watchBuzzes(question) {
    if (unsubscribeBuzzes) unsubscribeBuzzes();

    const buzzesQuery = query(
        collection(db, 'sessions', currentCode, 'buzzes'),
        where('questionId', '==', question.id)
    );

    unsubscribeBuzzes = onSnapshot(buzzesQuery, snapshot => {
        latestBuzzesForPlayer = snapshot.docs.map(d => d.data());
        updateAnswerView(question);
    });
}

function renderQuestionContent(question) {
    const catBlock = getCategoryBoundsForReview().find(c => currentQuestionIndex >= c.start && currentQuestionIndex <= c.end)
        || { start: currentQuestionIndex, end: currentQuestionIndex, name: question.category || 'General' };

    questionProgressEl.textContent =
        `${catBlock.name} — Question ${currentQuestionIndex - catBlock.start + 1} of ${catBlock.end - catBlock.start + 1}`;
    questionPromptEl.textContent = question.prompt;

    MediaUtils.render(question.media, questionMediaEl, currentPhase === 'answering');
}

// The player's own view only changes on two triggers: the host revealing the
// correct answer (sessionAnswerRevealed) — never on individual per-player
// reveals on the host's results list, which are host-screen-only.
function updateAnswerView(question) {
    if (question.type === 'buzzer') {
        updateBuzzerView(question);
        return;
    }

    if (sessionAnswerRevealed) {
        showRevealed(question, ownAnswerData);
    } else if (currentPhase === 'answering' && (editing || !ownAnswerData)) {
        showAnswerInput(question);
    } else {
        showLocked(question, ownAnswerData);
    }
}

function updateBuzzerView(question) {
    answerActions.hidden = true;
    answerMount.hidden = true;
    lockedView.hidden = true;
    revealView.hidden = true;
    buzzerView.hidden = false;

    const own = latestBuzzesForPlayer.find(b => b.playerId === currentPlayerId);

    if (own && own.status === 'correct') {
        buzzInBtn.hidden = true;
        buzzerStatusText.textContent = `Correct! You earned ${question.points} points.`;
        return;
    }
    if (own && own.status === 'incorrect') {
        buzzInBtn.hidden = true;
        buzzerStatusText.textContent = 'Incorrect — the buzzer has moved to another player.';
        return;
    }
    if (own && own.status === 'pending') {
        buzzInBtn.hidden = true;
        buzzerStatusText.textContent = "You buzzed in! Waiting for the host...";
        return;
    }

    const someoneElsePending = latestBuzzesForPlayer.some(b => b.status === 'pending');
    buzzInBtn.hidden = false;
    buzzInBtn.disabled = someoneElsePending;
    buzzerStatusText.textContent = someoneElsePending ? 'Locked out — another player buzzed in first.' : '';
}

function showAnswerInput(question) {
    answerActions.hidden = false;
    answerMount.hidden = false;
    lockedView.hidden = true;
    revealView.hidden = true;
    buzzerView.hidden = true;

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
    buzzerView.hidden = true;
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

    // Live "waiting on X more players" — only meaningful while the host
    // hasn't locked answers yet (once locked, everyone's moved on together).
    const connectedCount = latestPlayersForJoin.filter(p => p.connected !== false).length;
    const remaining = Math.max(0, connectedCount - answeredCount);

    if (answerData && currentPhase === 'answering' && remaining > 0) {
        waitingOnPlayersEl.hidden = false;
        waitingOnPlayersEl.textContent = `Waiting on ${remaining} more player${remaining === 1 ? '' : 's'}...`;
    } else {
        waitingOnPlayersEl.hidden = true;
    }
}

function showRevealed(question, answerData) {
    answerActions.hidden = true;
    answerMount.hidden = true;
    lockedView.hidden = true;
    buzzerView.hidden = true;
    revealView.hidden = false;

    revealView.innerHTML = '';

    const label = document.createElement('div');
    if (answerData && question.type === 'multi-answer') {
        revealView.className = answerData.correct ? 'correct' : 'incorrect';
        label.textContent = `You earned ${answerData.pointsAwarded || 0} point(s).`;
    } else if (answerData) {
        revealView.className = answerData.correct ? 'correct' : 'incorrect';
        label.textContent = answerData.correct ? 'Correct!' : 'Incorrect.';
    } else {
        revealView.className = 'incorrect';
        label.textContent = "You didn't answer this one.";
    }
    revealView.appendChild(label);

    if (answerData && question.type !== 'buzzer') {
        const yourAnswer = document.createElement('span');
        yourAnswer.className = 'your-answer-line';
        yourAnswer.textContent = `Your answer: ${formatAnswerValue(question, answerData.value)}`;
        revealView.appendChild(yourAnswer);
    }

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

        case 'multi-answer':
            return (Array.isArray(value) && value.length) ? value.join(', ') : '(no answer)';

        default:
            return String(value);
    }
}
