import { db } from '../firebase/firebase-config.js';
import { loadQuiz } from '../data/quiz-loader.js';
import { removePlayer } from '../remove-player.js';
import { resizePhoto, frameToPhoto, makeAvatar, anyPhoto } from '../player-avatar.js';
import {
    isSlidesQuiz, homeSlideOf, goToSlide, goBack, goHome, primaryAction, runPrimaryAction, boardOptions, slideItem,
    formatAnswer, correctAnswerText, overrideAnswer, setScoresVisible, scoringPlayers, finishSlidesQuiz, revealResult, revealAllResults, rankPlayers, rankPositions, startSlidesQuiz
} from '../slides/slides-flow.js';
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
let buzzersOpen = true;
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

const joinSubmitBtn = joinForm.querySelector('button[type="submit"]');

// This device's token for the player it joined as; another device joining under
// the same name overwrites the token on the player doc, which signs this one out.
let myDeviceToken = null;

// Optional photo, shrunk on this device and stored on the player doc for the
// length of the quiz only (the doc is deleted when the quiz ends).
let pendingPhoto = null;
const photoInput = document.getElementById('photo-input');
const photoBtn = document.getElementById('photo-btn');
const photoPreview = document.getElementById('photo-preview');
const cameraOverlay = document.getElementById('camera-overlay');
const cameraVideo = document.getElementById('camera-video');
let cameraStream = null;

function setPhoto(dataUrl) {
    pendingPhoto = dataUrl;
    photoPreview.style.backgroundImage = `url("${dataUrl}")`;
    photoBtn.textContent = '📷 Retake photo';
}

function closeCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraOverlay.hidden = true;
}

// Own in-page camera rather than the phone's camera app. The preview is shown
// mirrored (like a mirror, easier to line up) and the saved photo is mirrored
// the same way, so what you see is what everyone else gets.
async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        photoInput.click(); // no live camera access (e.g. plain http): use the file picker
        return;
    }
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
            audio: false
        });
        cameraVideo.srcObject = cameraStream;
        cameraOverlay.hidden = false;
        await cameraVideo.play().catch(() => {});
    } catch (err) {
        console.error('Camera unavailable:', err);
        closeCamera();
        photoInput.click(); // permission refused or no camera: fall back to the picker
    }
}

photoBtn.addEventListener('click', openCamera);
document.getElementById('camera-cancel').addEventListener('click', closeCamera);
document.getElementById('camera-capture').addEventListener('click', () => {
    if (!cameraVideo.videoWidth) return; // not ready yet
    setPhoto(frameToPhoto(cameraVideo));
    closeCamera();
});
photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    try {
        setPhoto(await resizePhoto(file));
    } catch (err) {
        console.error('Photo failed:', err);
        joinStatus.className = 'failure';
        joinStatus.textContent = "That photo couldn't be used. You can join without one.";
    }
});

// Phones on patchy connections sometimes leave a Firestore read hanging with no
// error. Reads (never writes, which could double up) are given 10s and one
// automatic retry, so a bad moment doesn't need a page refresh.
function withTimeout(makePromise, ms = 10000) {
    return Promise.race([
        makePromise(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

async function readWithRetry(makePromise) {
    try {
        return await withTimeout(makePromise);
    } catch (err) {
        joinStatus.className = 'pending';
        joinStatus.textContent = 'Slow connection, trying again...';
        return withTimeout(makePromise);
    }
}

// Shown once after another device joins under this player's name.
try {
    if (sessionStorage.getItem('quizhub_replaced')) {
        sessionStorage.removeItem('quizhub_replaced');
        joinStatus.className = 'failure';
        joinStatus.textContent = 'You joined from another device, so this one was signed out.';
    }
} catch (err) { /* storage blocked */ }

// Shown once after the host removes a player.
try {
    if (sessionStorage.getItem('quizhub_removed')) {
        sessionStorage.removeItem('quizhub_removed');
        joinStatus.className = 'failure';
        joinStatus.textContent = 'You were removed from the quiz by the host.';
    }
} catch (err) { /* storage blocked */ }

joinForm.addEventListener('submit', async e => {
    e.preventDefault();

    const code = codeInput.value.trim();
    const name = nameInput.value.trim();
    if (!code || !name) return;

    joinSubmitBtn.disabled = true;
    joinStatus.className = 'pending';
    joinStatus.textContent = 'Checking code...';

    try {
        const sessionRef = doc(db, 'sessions', code);
        const snapshot = await readWithRetry(() => getDoc(sessionRef));

        if (!snapshot.exists()) {
            joinStatus.className = 'failure';
            joinStatus.textContent = 'That code was not found. Check with the host and try again.';
            codeFieldWrapper.hidden = false; // a QR link hides this; let them fix the code
            codeInput.focus();
            return;
        }

        currentCode = code;

        const nameKey = AnswerMatching.normalize(name);
        const playersRef = collection(db, 'sessions', code, 'players');
        const existingSnap = await readWithRetry(() => getDocs(query(playersRef, where('nameKey', '==', nameKey))));
        const existingDoc = existingSnap.docs[0] || null;

        const deviceTokenKey = `quizhub_device_${code}_${nameKey}`;

        if (existingDoc) {
            const data = existingDoc.data();

            // Joining under a name that is already in the quiz replaces whoever was
            // using it (same player, so score, answers and the host player role all
            // carry over). The old device notices below and is signed out.
            currentPlayerId = existingDoc.id;
            currentName = data.name;

            const deviceToken = generateDeviceToken();
            myDeviceToken = deviceToken;
            localStorage.setItem(deviceTokenKey, deviceToken);

            await updateDoc(doc(db, 'sessions', code, 'players', currentPlayerId), {
                connected: true,
                deviceToken,
                ...(pendingPhoto ? { photo: pendingPhoto } : {})
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
            myDeviceToken = deviceToken;
            localStorage.setItem(deviceTokenKey, deviceToken);

            const playerRef = await addDoc(playersRef, {
                name,
                nameKey,
                joinedAt: serverTimestamp(),
                score: 0,
                connected: true,
                deviceToken,
                photo: pendingPhoto || null
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

        let ownDocSeen = false;
        onSnapshot(doc(db, 'sessions', code, 'players', currentPlayerId), snap => {
            if (!snap.exists()) {
                // Only counts as "removed" once we've actually seen our own doc,
                // so a slow first snapshot can't kick someone who just joined.
                if (ownDocSeen) {
                    // The host wipes every player (photos included) once a quiz ends;
                    // that is not "being removed", so look again after a moment.
                    setTimeout(() => {
                        if (latestSessionSnapshot && latestSessionSnapshot.status === 'ended') return;
                        try { sessionStorage.setItem('quizhub_removed', '1'); } catch (err) { /* ignore */ }
                        window.location.href = 'join.html';
                    }, 2500);
                }
                return;
            }
            ownDocSeen = true;

            const remoteToken = snap.data().deviceToken;
            if (myDeviceToken && remoteToken && remoteToken !== myDeviceToken) {
                try { sessionStorage.setItem('quizhub_replaced', '1'); } catch (err) { /* ignore */ }
                window.location.href = 'join.html';
                return;
            }
            const score = snap.data().score || 0;

            // A running score above the question is only shown for buzzer quizzes
            // that specifically opt into it — otherwise it stays hidden throughout
            // so it doesn't spoil pacing on a normal paced quiz.
            playerScoreEl.hidden = !(quiz.isBuzzerQuiz && quiz.buzzerShowScoreThroughout);
            playerScoreEl.textContent = `Score: ${score}`;
            const iAmHost = latestSessionSnapshot && latestSessionSnapshot.hostPlayerId === currentPlayerId;
            finalScoreEl.textContent = iAmHost ? 'Thanks for playing!' : `Your final score: ${score}`;
        });

        onSnapshot(playersRef, snap => {
            latestPlayersForJoin = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderWaitingPlayerList();
            if (latestSessionSnapshot) renderSlidesController(latestSessionSnapshot);

            const question = currentQuestionIndex !== null ? quiz.questions[currentQuestionIndex] : null;
            if (question) updateAnswerView(question);
        });
    } catch (err) {
        // Previously an error here (rules hiccup, dropped connection) left the
        // form stuck on "Checking code..." with the button still clickable —
        // the fix looked like "click Join twice" when really the first click's
        // request had silently failed.
        console.error('Join failed:', err);
        joinStatus.className = 'failure';
        joinStatus.textContent = 'Something went wrong joining — check your connection and tap Join again.';
        codeFieldWrapper.hidden = false; // in case the code (not the connection) was the problem
    } finally {
        joinSubmitBtn.disabled = false;
    }
});

function renderWaitingPlayerList() {
    waitingPlayerList.innerHTML = '';

    latestPlayersForJoin.forEach(player => {
        const li = document.createElement('li');
        // The host player is only a remote control, so players see them marked
        // "- host" here (the scoreboards leave them out entirely).
        const isHost = latestSessionSnapshot && latestSessionSnapshot.hostPlayerId === player.id;
        li.textContent = isHost ? `${player.name} - host` : player.name;
        if (anyPhoto(latestPlayersForJoin)) li.prepend(makeAvatar(player, 26));
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
    if (!buzzersOpen) return;

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
    renderWaitingPlayerList(); // keeps the "- host" label in step if the host player changes
    renderSlidesController(session);

    // The host player is a second control device, not a player: while the
    // slides are running they see only the controls (their join card, with
    // every question screen in it, is hidden).
    const hostControllerActive = isSlidesQuiz(quiz)
        && session.hostPlayerId
        && session.hostPlayerId === currentPlayerId
        && (session.status === 'lobby' || session.status === 'slides' || session.status === 'slides-final');
    joinCard.hidden = hostControllerActive;
    if (hostControllerActive) {
        applyCardBackground(null);
        return;
    }

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

    if (session.status === 'slides-final') {
        hostScreenSection.hidden = false;
        hostScreenMessage.textContent = 'The host is revealing the final results...';
        applyCardBackground(null);
        return;
    }

    if (session.status === 'ended') {
        endedSection.hidden = false;
        if (isSlidesQuiz(quiz) && session.hostPlayerId === currentPlayerId) {
            finalScoreEl.textContent = 'Thanks for playing!';
        }
        applyCardBackground(null);

        reviewAnswersLink.hidden = !quiz.reviewEnabled;
        if (quiz.reviewEnabled) {
            reviewAnswersLink.href = `../review/review.html?name=${encodeURIComponent(currentName)}`;
        }
        return;
    }

    // Slides quizzes: on a board/plain slide there's nothing to answer.
    if (isSlidesQuiz(quiz) && !(session.currentQuestionIndex >= 0)) {
        hostScreenSection.hidden = false;
        hostScreenMessage.textContent = 'Watch the main screen.';
        applyCardBackground(null);
        return;
    }

    quizSection.hidden = false;

    currentPhase = session.questionPhase;
    currentQuestionIndex = session.currentQuestionIndex;
    sessionAnswerRevealed = !!session.answerRevealed;
    buzzersOpen = session.buzzersOpen !== false;

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

    questionProgressEl.textContent = isSlidesQuiz(quiz)
        ? `Question ${currentQuestionIndex + 1} of ${quiz.questions.length}`
        : `${catBlock.name} — Question ${currentQuestionIndex - catBlock.start + 1} of ${catBlock.end - catBlock.start + 1}`;
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

    if (!buzzersOpen) {
        buzzInBtn.hidden = false;
        buzzInBtn.disabled = true;
        buzzerStatusText.textContent = 'Buzzers are closed — wait for the host to open them.';
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
    // (the host player of a slides quiz is a remote control, not a contestant)
    const connectedCount = scoringPlayers(latestPlayersForJoin, latestSessionSnapshot).filter(p => p.connected !== false).length;
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


// =========================
// SLIDES QUIZ — host player's controls
// The host picks one player on the main screen; that player's phone shows the
// same controls the main screen's bar has (back / next / lock / home / board
// options) plus the scores. Everything goes through slides-flow.js, which
// writes the session doc the main screen is watching.
// =========================
const slidesControllerSection = document.getElementById('slides-controller-section');
const slidesControllerInfo = document.getElementById('slides-controller-info');
const slidesBoardOptions = document.getElementById('slides-board-options');
const slidesMainBtn = document.getElementById('slides-main-btn');
const slidesPrevBtn = document.getElementById('slides-prev-btn');
const slidesHomeBtn = document.getElementById('slides-home-btn');
const slidesControllerScores = document.getElementById('slides-controller-scores');
const slidesStartBtn = document.getElementById('slides-start-btn');
const slidesScoresLabel = document.getElementById('slides-scores-label');
const slidesResultsControls = document.getElementById('slides-results-controls');
const slidesFinalBoard = document.getElementById('slides-final-board');
const slidesRevealAllBtn = document.getElementById('slides-reveal-all-btn');
const slidesCloseSessionBtn = document.getElementById('slides-close-session-btn');
const slidesEndQuizBtn = document.getElementById('slides-end-quiz-btn');
const slidesScoresBtn = document.getElementById('slides-scores-btn');
const slidesScoresHomeBtn = document.getElementById('slides-scores-home-btn');

function slidesCtx() {
    return { sessionRef: doc(db, 'sessions', currentCode), code: currentCode, session: latestSessionSnapshot };
}

// This phone loaded the quiz's questions and answers once, when it joined. The
// host player grades and marks answers from that copy, so a question edited
// since (an answer filled in, a typo fixed) would be marked against the old
// version. Fetch a fresh copy once when this device becomes the controller.
let controllerQuizRefreshed = false;
function refreshQuizForController(session) {
    if (controllerQuizRefreshed || !session.quizId) return;
    controllerQuizRefreshed = true;
    loadQuiz(session.quizId)
        .then(fresh => {
            quiz = fresh;
            if (latestSessionSnapshot) renderSlidesController(latestSessionSnapshot);
        })
        .catch(err => { console.error('Could not refresh the quiz:', err); controllerQuizRefreshed = false; });
}

function renderSlidesController(session) {
    const isController = isSlidesQuiz(quiz)
        && session.hostPlayerId
        && session.hostPlayerId === currentPlayerId
        && (session.status === 'lobby' || session.status === 'slides' || session.status === 'slides-final');

    slidesControllerSection.hidden = !isController;
    if (!isController) return;
    refreshQuizForController(session);

    // The host player (this device) isn't a scoring player.
    const sorted = rankPlayers(latestPlayersForJoin, session);
    slidesControllerScores.innerHTML = '';
    const positions = rankPositions(sorted);
    sorted.forEach((p, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="rank"></span><span class="nm"></span><strong></strong>';
        li.children[0].textContent = positions[i];
        li.children[1].textContent = p.name;
        li.children[2].textContent = p.score || 0;
        if (anyPhoto(sorted)) li.insertBefore(makeAvatar(p, 28), li.children[1]);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.title = `Remove ${p.name}`;
        removeBtn.style.cssText = 'margin-left:10px;background:none;border:1px solid var(--border);color:var(--incorrect);border-radius:6px;padding:0 8px;';
        removeBtn.addEventListener('click', async () => {
            if (!(await askConfirm('Remove player?', `"${p.name}" will be sent back to the join screen.`, 'Yes, remove'))) return;
            try { await removePlayer(currentCode, p.id); }
            catch (err) { console.error('Failed to remove player:', err); }
        });
        li.appendChild(removeBtn);
        slidesControllerScores.appendChild(li);
    });

    const inSlides = session.status === 'slides';
    const inFinal = session.status === 'slides-final';
    const inLobby = session.status === 'lobby';
    slidesStartBtn.hidden = !inLobby;
    slidesScoresLabel.textContent = inLobby ? 'Players joined' : 'Scores';
    slidesEndQuizBtn.hidden = !inSlides;
    slidesResultsControls.hidden = !inFinal;
    // The final results replace the ordinary scores list.
    slidesScoresLabel.hidden = inFinal;
    slidesControllerScores.hidden = inFinal;
    if (inFinal) renderFinalBoard(session);
    slidesMainBtn.hidden = !inSlides;
    slidesPrevBtn.hidden = !inSlides;
    slidesHomeBtn.hidden = !inSlides;
    slidesBoardOptions.hidden = !inSlides;
    slidesScoresBtn.hidden = !inSlides;
    slidesScoresHomeBtn.hidden = !(inSlides && session.scoresVisible);
    slidesScoresBtn.textContent = session.scoresVisible ? '↩ Back to slide' : '📊 Show scores';
    if (!inSlides) {
        slidesControllerInfo.textContent = inLobby
            ? `${scoringPlayers(latestPlayersForJoin, session).length} player(s) joined. Begin when everyone is in.`
            : (inFinal ? 'Final results.' : 'Quiz finished.');
        return;
    }

    const item = slideItem(quiz, session.currentSlide);
    const kind = item ? ({ plain: 'slide', board: 'board', question: 'question', answer: 'answer' }[item.type] || 'slide') : 'slide';
    slidesControllerInfo.textContent = `Slide ${session.currentSlide} of ${quiz.slides.count} · ${kind}`;

    const action = primaryAction(quiz, session);
    slidesMainBtn.textContent = action.label;
    slidesMainBtn.disabled = action.disabled;
    slidesPrevBtn.disabled = !(session.slideTrail && session.slideTrail.length);
    slidesHomeBtn.disabled = session.currentSlide === homeSlideOf(quiz);

    watchControllerAnswers(session);
    renderControllerAnswers(session);

    slidesBoardOptions.innerHTML = '';
    boardOptions(quiz, session).forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary' + (option.visited ? ' visited' : '');
        btn.textContent = option.visited ? `✔ ${option.label}` : option.label;
        btn.addEventListener('click', () => {
            const c = slidesCtx();
            goToSlide(c.sessionRef, c.code, quiz, c.session, option.target)
                .catch(err => console.error('Failed to open that option:', err));
        });
        slidesBoardOptions.appendChild(btn);
    });
}

// The host player sees every player's answer for the current question and can
// flip any mark once answers are locked (same idea as the host page's override).
let controllerAnswersQuestionId = null;
let controllerAnswersUnsub = null;
let controllerAnswers = [];

function watchControllerAnswers(session) {
    const idx = session.currentQuestionIndex;
    const question = idx >= 0 ? quiz.questions[idx] : null;
    const qid = question ? question.id : null;
    if (qid === controllerAnswersQuestionId) return;

    controllerAnswersQuestionId = qid;
    controllerAnswers = [];
    if (controllerAnswersUnsub) { controllerAnswersUnsub(); controllerAnswersUnsub = null; }
    if (!qid) return;

    controllerAnswersUnsub = onSnapshot(
        query(collection(db, 'sessions', currentCode, 'answers'), where('questionId', '==', qid)),
        snap => {
            controllerAnswers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (latestSessionSnapshot) renderControllerAnswers(latestSessionSnapshot);
        }
    );
}

function renderControllerAnswers(session) {
    const wrap = document.getElementById('slides-answers-wrap');
    const idx = session.currentQuestionIndex;
    const question = idx >= 0 ? quiz.questions[idx] : null;
    wrap.hidden = !question;
    if (!question) return;

    document.getElementById('slides-correct-answer').textContent = `Correct: ${correctAnswerText(question)}`;

    const list = document.getElementById('slides-answers');
    list.innerHTML = '';

    const names = new Map(latestPlayersForJoin.map(p => [p.id, p.name]));
    const rows = [...controllerAnswers].sort((a, b) => (names.get(a.playerId) || '').localeCompare(names.get(b.playerId) || ''));

    if (!rows.length) {
        const li = document.createElement('li');
        li.textContent = 'No answers yet.';
        list.appendChild(li);
        return;
    }

    rows.forEach(answer => {
        // Once locked the stored grade is used. Before that, each answer is marked
        // the moment it arrives by running the same grader the lock uses (display
        // only, nothing is written), so the host player sees right/wrong straight away.
        // (A just-sent answer is stored with correct: null, so null counts as ungraded.)
        let correct = answer.correct;
        if (correct === null || correct === undefined) {
            try { correct = AnswerTypeRegistry.get(question.type).grade(answer.value, question).correct; }
            catch (err) { correct = undefined; }
        }
        const graded = correct !== undefined;
        const li = document.createElement('li');

        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = names.get(answer.playerId) || answer.playerId;
        const small = document.createElement('small');
        small.textContent = formatAnswer(question, answer.value);
        who.appendChild(small);
        li.appendChild(who);

        if (graded) {
            const mark = document.createElement('span');
            mark.className = correct ? 'mark-correct' : 'mark-incorrect';
            mark.textContent = correct ? '✔' : '✘';
            li.appendChild(mark);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary';
            btn.textContent = correct ? 'Mark wrong' : 'Mark right';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    // flips whatever is showing now, even if it has not been locked/graded yet
                    await overrideAnswer(currentCode, quiz, idx, answer.id, { ...answer, correct });
                } catch (err) {
                    console.error('Override failed:', err);
                    btn.disabled = false;
                }
            });
            li.appendChild(btn);
        }

        list.appendChild(li);
    });
}

// In-page yes/no (the native confirm() can be silently suppressed on phones,
// which is how an accidental End quiz could slip through without a warning).
function askConfirm(title, text, yesLabel) {
    return new Promise(resolve => {
        const overlay = document.getElementById('slides-confirm');
        const yes = document.getElementById('slides-confirm-yes');
        const no = document.getElementById('slides-confirm-no');
        document.getElementById('slides-confirm-title').textContent = title;
        document.getElementById('slides-confirm-text').textContent = text;
        yes.textContent = yesLabel;
        overlay.hidden = false;

        const finish = result => {
            overlay.hidden = true;
            yes.removeEventListener('click', onYes);
            no.removeEventListener('click', onNo);
            resolve(result);
        };
        const onYes = () => finish(true);
        const onNo = () => finish(false);
        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
    });
}

// The host player sees the whole scoreboard; whatever is still hidden on the
// main screen is red, and tapping it reveals just that name or score there.
function renderFinalBoard(session) {
    const names = new Set(session.revealedNames || []);
    const scores = new Set(session.revealedScores || []);
    slidesFinalBoard.innerHTML = '';

    const rankedPlayers = rankPlayers(latestPlayersForJoin, session);
    const positions = rankPositions(rankedPlayers);
    rankedPlayers.forEach((p, i) => {
        const li = document.createElement('li');

        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = positions[i];
        li.appendChild(rank);

        const makeCell = (text, revealed, kind) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = text;
            if (kind === 'score') btn.classList.add('score-cell');
            if (revealed) {
                btn.disabled = true;
            } else {
                btn.classList.add('hidden-on-screen');
                btn.addEventListener('click', () => {
                    btn.disabled = true;
                    revealResult(doc(db, 'sessions', currentCode), kind, p.id)
                        .catch(err => { console.error('Failed to reveal:', err); btn.disabled = false; });
                });
            }
            return btn;
        };

        li.appendChild(makeCell(p.name, names.has(p.id), 'name'));
        li.appendChild(makeCell(String(p.score || 0), scores.has(p.id), 'score'));
        slidesFinalBoard.appendChild(li);
    });
}

function runSlidesControl(button, fn) {
    button.addEventListener('click', async () => {
        if (!isSlidesQuiz(quiz) || !latestSessionSnapshot) return;
        button.disabled = true;
        try {
            await fn(slidesCtx());
        } catch (err) {
            console.error('Slide control failed:', err);
        }
        // The next session snapshot re-renders the button's real state.
        button.disabled = false;
    });
}

runSlidesControl(slidesEndQuizBtn, async c => {
    if (!(await askConfirm('End the quiz?', 'This stops the quiz now and goes to the final results. It can\'t be undone.', 'Yes, end quiz'))) return;
    await finishSlidesQuiz(c.sessionRef, c.code, quiz, c.session);
});
runSlidesControl(slidesStartBtn, c => startSlidesQuiz(c.sessionRef, c.code, quiz, c.session));
runSlidesControl(slidesRevealAllBtn, c => revealAllResults(c.sessionRef, rankPlayers(latestPlayersForJoin, c.session)));
runSlidesControl(slidesCloseSessionBtn, async c => {
    if (!(await askConfirm('End the session?', 'This closes the quiz for everyone.', 'Yes, end session'))) return;
    await updateDoc(c.sessionRef, { status: 'ended' });
});
runSlidesControl(slidesMainBtn, async c => {
    // "Finish quiz" ends the whole thing, so it gets the same warning as End quiz.
    if (primaryAction(quiz, c.session).kind === 'finish') {
        if (!(await askConfirm('Finish the quiz?', 'This was the last slide. Finishing goes to the final results.', 'Yes, finish'))) return;
    }
    await runPrimaryAction(c.sessionRef, c.code, quiz, c.session);
});
runSlidesControl(slidesPrevBtn, c => goBack(c.sessionRef, c.code, quiz, c.session));
// Scores go up over the slides on the main screen; this brings them down again
// either to the slide that was showing or to the home slide.
runSlidesControl(slidesScoresBtn, c => setScoresVisible(c.sessionRef, !c.session.scoresVisible));
runSlidesControl(slidesScoresHomeBtn, c => {
    const home = homeSlideOf(quiz);
    if (c.session.currentSlide === home) return setScoresVisible(c.sessionRef, false);
    return goHome(c.sessionRef, c.code, quiz, c.session); // moving slides also closes the scores
});
runSlidesControl(slidesHomeBtn, c => goHome(c.sessionRef, c.code, quiz, c.session));
