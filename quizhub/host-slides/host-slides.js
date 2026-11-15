// Main shared screen for a slides quiz: lobby, then nothing but the Google
// Slides embed, full screen — no bar, scores or sign-in widget, so it can be
// screen-shared as is. All control happens from the host player's phone
// (join page) or the keyboard here; both write the same session doc via
// ../slides/slides-flow.js. Board areas are clickable but not drawn.
import { db } from '../firebase/firebase-config.js';
import { loadQuiz } from '../data/quiz-loader.js';
import { findActiveSessionForQuiz, deleteAllSessionsForQuiz } from '../session-lookup.js';
import { makeRemoveButton, deleteSessionPlayerData } from '../remove-player.js';
import { makeAvatar, anyPhoto } from '../player-avatar.js';
import {
    isSlidesQuiz, embedUrl, slideItem, goToSlide, goBack, goHome, advanceSlide, rankPlayers, rankPositions, revealAllResults, startSlidesQuiz, setScoresVisible
} from '../slides/slides-flow.js';
import {
    doc, setDoc, updateDoc, collection, query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz');
const forceNewSession = params.get('new') === '1';

const $ = id => document.getElementById(id);
const lobbyView = $('lobby-view');
const lobbyHero = $('lobby-hero');
const lobbyBack = $('lobby-back');
const slidesView = $('slides-view');
const endedView = $('ended-view');
const frame = $('slides-frame');
const hotspotLayer = $('slides-hotspots');
const playerListEl = $('player-list');
const messageListEl = $('message-list');

let quiz = null;
let code = null;
let sessionRef = null;
let session = null;
let players = [];
let shownFrameUrl = '';
let cleanedUp = false;

init();

async function init() {
    if (!quizId) { $('quiz-title').textContent = 'No quiz specified.'; return; }

    try {
        quiz = await loadQuiz(quizId);
    } catch (err) {
        console.error(err);
        $('quiz-title').textContent = 'Quiz not found.';
        return;
    }

    if (!isSlidesQuiz(quiz)) {
        window.location.replace(`../host-quiz/host-quiz.html?quiz=${encodeURIComponent(quizId)}${forceNewSession ? '&new=1' : ''}`);
        return;
    }

    $('quiz-title').textContent = quiz.title;
    $('quiz-description').textContent = quiz.description || '';
    await startSession();
}

async function startSession() {
    if (!forceNewSession) {
        try {
            const existing = await findActiveSessionForQuiz(quizId);
            if (existing) {
                code = existing.id;
                sessionRef = doc(db, 'sessions', code);
                $('code-display').textContent = code;
                await updateDoc(sessionRef, { hostConnected: true });
                attach();
                return;
            }
        } catch (err) {
            console.error('Failed to look up an existing session:', err);
        }
    } else {
        try { await deleteAllSessionsForQuiz(quizId); }
        catch (err) { console.error('Failed to clean up previous sessions:', err); }
    }

    code = String(Math.floor(1000 + Math.random() * 9000));
    $('code-display').textContent = code;
    sessionRef = doc(db, 'sessions', code);

    await setDoc(sessionRef, {
        quizId,
        status: 'lobby',
        currentQuestionIndex: -1,
        currentCategoryStart: null,
        completedCategories: [],
        questionPhase: 'locked',
        answerRevealed: false,
        reviewMode: false,
        introPhase: null,
        scoreboardVisible: false,
        reviewAllowed: false,
        buzzersOpen: false,
        hostConnected: true,
        createdAt: serverTimestamp(),
        // slides-specific
        currentSlide: 1,
        slideTrail: [],
        visited: [],
        hostPlayerId: null,
        scoresVisible: false,
        revealedNames: [],
        revealedScores: []
    });

    attach();
}

function attach() {
    window.addEventListener('pagehide', () => {
        updateDoc(sessionRef, { hostConnected: false }).catch(() => {});
    });

    onSnapshot(query(collection(db, 'sessions', code, 'players'), orderBy('joinedAt', 'asc')), snap => {
        players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPlayers();
        if (session) renderScoresOverlay();
    });

    onSnapshot(query(collection(db, 'sessions', code, 'messages'), orderBy('sentAt', 'asc')), snap => {
        messageListEl.innerHTML = '';
        snap.forEach(d => {
            const li = document.createElement('li');
            li.textContent = `${d.data().name}: ${d.data().message}`;
            messageListEl.appendChild(li);
        });
    });

    onSnapshot(sessionRef, snap => {
        if (!snap.exists()) return;
        session = snap.data();
        renderSession();
    });

    $('begin-btn').addEventListener('click', async () => {
        // Must happen straight from the click or the browser refuses it.
        document.documentElement.requestFullscreen().catch(() => {});

        $('begin-btn').disabled = true;
        try {
            await startSlidesQuiz(sessionRef, code, quiz, session);
        } catch (err) {
            console.error('Failed to begin:', err);
            $('begin-btn').disabled = false;
        }
    });

    // ✕ (top right): leave full screen and show the small control bar. Going back
    // into full screen hides the bar again.
    const bar = $('recover-bar');
    $('exit-fs-btn').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        bar.hidden = false;
    });
    $('rb-hide').addEventListener('click', () => { bar.hidden = true; });
    $('rb-full').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) bar.hidden = true; });
    $('rb-prev').addEventListener('click', () => goBack(sessionRef, code, quiz, session).catch(err => console.error(err)));
    $('rb-next').addEventListener('click', () => advanceSlide(sessionRef, code, quiz, session).catch(err => console.error(err)));
    $('rb-home').addEventListener('click', () => goHome(sessionRef, code, quiz, session).catch(err => console.error(err)));
    $('rb-scores').addEventListener('click', () => setScoresVisible(sessionRef, !session.scoresVisible).catch(err => console.error(err)));
    $('rb-unhost').addEventListener('click', () => updateDoc(sessionRef, { hostPlayerId: null }));

    $('close-session-btn').addEventListener('click', () => updateDoc(sessionRef, { status: 'ended' }));
    $('reveal-all-btn').addEventListener('click', () => revealAllResults(sessionRef, rankPlayers(players, session)));

    // Clicking the slides moves on. (The layer sits over the embed, so the
    // embed's own click-through animations aren't reachable — by design.)
    let advancing = false;
    hotspotLayer.addEventListener('click', async e => {
        if (e.target !== hotspotLayer || advancing) return; // hotspots handle their own clicks
        advancing = true;
        try { await advanceSlide(sessionRef, code, quiz, session); }
        catch (err) { console.error('Failed to advance the slide:', err); }
        finally { advancing = false; }
    });

    setupKeys();
    renderJoinQr();
}

// ---------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------

function renderPlayers() {
    playerListEl.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-row' + (p.connected === false ? ' disconnected' : '');

        const name = document.createElement('span');
        name.textContent = p.name;
        if (anyPhoto(players)) name.prepend(makeAvatar(p, 32));
        const isHost = session && session.hostPlayerId === p.id;
        if (isHost) {
            const tag = document.createElement('span');
            tag.className = 'host-player-tag';
            tag.textContent = '🎮 host player';
            name.appendChild(tag);
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-small';
        btn.textContent = isHost ? 'Remove host' : 'Make host player';
        btn.addEventListener('click', () => {
            updateDoc(sessionRef, { hostPlayerId: isHost ? null : p.id });
        });

        li.append(name, btn, makeRemoveButton(code, p));
        playerListEl.appendChild(li);
    });
}

function renderJoinQr() {
    try {
        const basePath = window.location.hostname === 'bladeinferior.github.io' ? '/harryswebsite/' : '/';
        const joinUrl = `${window.location.origin}${basePath}quizhub/join/join.html?code=${code}`;
        const img = $('join-qr-img');
        img.onload = () => { img.hidden = false; };
        img.onerror = () => {
            img.hidden = true;
            $('join-qr-caption').textContent = `Or go to join.html and enter code ${code}`;
        };
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}`;
    } catch (err) {
        console.error('QR code render failed:', err);
    }
}

// ---------------------------------------------------------------------
// session rendering
// ---------------------------------------------------------------------

function renderSession() {
    renderPlayers(); // the host-player tag depends on the session

    const status = session.status;
    const inSlides = status === 'slides';

    // Slides and the final results are both full-screen, with no page chrome.
    document.body.classList.toggle('slides-live', inSlides || status === 'slides-final');
    document.body.classList.toggle('session-ended', status === 'ended');
    if (status === 'ended' && !cleanedUp) {
        cleanedUp = true;
        // A few seconds' grace so every phone gets to show its closing screen first.
        setTimeout(() => deleteSessionPlayerData(code).catch(err => console.error('Cleanup failed:', err)), 5000);
    }
    $('exit-fs-btn').hidden = !(inSlides || status === 'slides-final');
    if (!(inSlides || status === 'slides-final')) $('recover-bar').hidden = true;
    $('rb-unhost').hidden = !session.hostPlayerId;
    lobbyView.hidden = status !== 'lobby';
    lobbyHero.hidden = status !== 'lobby';
    lobbyBack.hidden = status !== 'lobby';
    slidesView.hidden = !inSlides;
    endedView.hidden = status !== 'ended';

    renderScoresOverlay();
    if (!inSlides) return;

    const n = session.currentSlide || 1;
    const url = embedUrl(quiz.slides.embedUrl, n);
    if (url !== shownFrameUrl) {
        shownFrameUrl = url;
        frame.src = url;
    }

    renderHotspots(n);
}

function renderHotspots(n) {
    hotspotLayer.innerHTML = '';
    const item = slideItem(quiz, n);
    if (!item || item.type !== 'board') return;

    (item.hotspots || []).forEach(h => {
        const el = document.createElement('div');
        el.className = 'hot';
        el.style.cssText = `left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%`;
        el.addEventListener('click', () => {
            goToSlide(sessionRef, code, quiz, session, h.target)
                .catch(err => console.error('Failed to open that area:', err));
        });
        hotspotLayer.appendChild(el);
    });
}

// One scoreboard, two uses: the mid-game scores the host player can pull up, and
// the final results, which look identical except that names and scores stay
// hidden ("???") until the host player reveals them one by one.
function renderScoresOverlay() {
    const overlay = $('scores-overlay');
    const isFinal = !!session && session.status === 'slides-final';
    const show = !!session && (isFinal || (session.status === 'slides' && !!session.scoresVisible));
    overlay.hidden = !show;
    if (!show) return;

    $('scores-overlay-title').textContent = isFinal ? 'Final Results' : 'Scores';
    const names = new Set(session.revealedNames || []);
    const scores = new Set(session.revealedScores || []);

    const list = $('scores-overlay-list');
    list.innerHTML = '';
    const ranked = rankPlayers(players, session);
    const positions = rankPositions(ranked);
    ranked.forEach((p, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="rank"></span><span class="who"></span><strong></strong>';
        li.children[0].textContent = positions[i];
        // On the final results a photo would give the name away, so it stays a "?"
        // until that name has been revealed.
        if (anyPhoto(ranked)) {
            const showFace = !isFinal || names.has(p.id);
            li.insertBefore(makeAvatar(showFace ? p : { name: '?' }, 48), li.children[1]);
        }
        li.querySelector('.who').textContent = !isFinal || names.has(p.id) ? p.name : '???';
        li.querySelector('strong').textContent = !isFinal || scores.has(p.id) ? (p.score || 0) : '???';
        list.appendChild(li);
    });

    // With no host player there is no phone to do the revealing, so the
    // buttons are here instead.
    $('final-controls').hidden = !(isFinal && !session.hostPlayerId);
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
}

// Keyboard still works as a backup when there's no host player (not while
// focus is inside the slides iframe — the embed keeps the keys).
function setupKeys() {
    document.addEventListener('keydown', e => {
        if (!session || session.status !== 'slides') return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

        if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            advanceSlide(sessionRef, code, quiz, session).catch(err => console.error(err));
        } else if (e.key === 'ArrowLeft') {
            goBack(sessionRef, code, quiz, session).catch(err => console.error(err));
        } else if (e.key === 'h' || e.key === 'H') {
            goHome(sessionRef, code, quiz, session).catch(err => console.error(err));
        } else if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
        }
    });
}
