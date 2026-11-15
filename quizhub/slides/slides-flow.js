// Shared logic for "slides quizzes" (quiz.kind === 'slides'): a Google Slides
// "Publish to web" embed drives the screen, the session doc says which slide
// is showing, and ordinary quiz questions are attached to chosen slides.
// Used by the setup page, the main-screen host page and the host player's
// phone (join page), so all three agree on what "next" means.
//
// quiz.slides = {
//   embedUrl, count, homeSlide, revealMode: 'immediate' | 'end',
//   items: [{ n, type: 'plain'|'board'|'question'|'answer', next, label,
//             hotspots: [{ x, y, w, h, label, target }],   // board only, % of slide
//             questionIndex }]                              // question + answer
// }
// session (slides quizzes) uses status 'slides' plus: currentSlide, slideTrail
// (slides to go back through), visited, hostPlayerId, currentQuestionIndex /
// questionPhase / answerRevealed (so the normal answer box on phones works).

import { db } from '../firebase/firebase-config.js';
import {
    doc,
    getDoc,
    updateDoc,
    getDocs,
    collection,
    query,
    where,
    increment,
    arrayUnion,
    writeBatch
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// Accepts either the bare embed link or the whole <iframe ...> snippet.
export function normalizeEmbedInput(text) {
    let v = (text || '').trim();
    const m = v.match(/src\s*=\s*["']([^"']+)["']/i);
    if (m) v = m[1];
    return v.replace(/&amp;/g, '&');
}

// Published embed URL jumped to slide n with the toolbar hidden (tested:
// ?slide=N and rm=minimal both work on a published embed).
export function embedUrl(base, n) {
    try {
        const url = new URL(normalizeEmbedInput(base));
        url.hash = '';
        url.searchParams.set('slide', String(n));
        url.searchParams.set('rm', 'minimal');
        return url.toString();
    } catch (err) {
        return '';
    }
}

// The slide every "Home" goes to: the one picked in setup, else slide 1 (the
// first slide is normally the home/board screen, and a quiz saved without a
// choice must still have somewhere to go home to).
export function homeSlideOf(quiz) {
    const home = quiz.slides.homeSlide;
    return home >= 1 && home <= quiz.slides.count ? home : 1;
}

export function slideItem(quiz, n) {
    return quiz.slides.items.find(item => item.n === n) || null;
}

// Where "Next" goes from a slide: its explicit "then go to", else the slide
// after it. null when there's nothing after (last slide).
export function nextSlideOf(quiz, n) {
    const item = slideItem(quiz, n);
    const target = item && item.next ? item.next : n + 1;
    return target >= 1 && target <= quiz.slides.count ? target : null;
}

export function isSlidesQuiz(quiz) {
    return !!quiz && quiz.kind === 'slides' && !!quiz.slides;
}

// ---------------------------------------------------------------------
// grading / scoring (same rules as host-quiz.js's lock + reveal)
// ---------------------------------------------------------------------

export async function lockQuestion(sessionRef, code, quiz, questionIndex) {
    // Locking can be triggered from more than one device (the host player's
    // button, a click on the main screen, Finish) and a device may still be
    // holding an out-of-date "answering" state. Check the real session first:
    // a question that is already locked must not be graded again, or any
    // Mark right/wrong the host player has made since would be wiped.
    const live = await getDoc(sessionRef);
    if (live.exists()) {
        const data = live.data();
        if (data.currentQuestionIndex === questionIndex && data.questionPhase === 'locked') return;
    }

    const question = quiz.questions[questionIndex];
    const typeImpl = AnswerTypeRegistry.get(question.type);

    const answersSnap = await getDocs(
        query(collection(db, 'sessions', code, 'answers'), where('questionId', '==', question.id))
    );

    const writes = [];
    for (const docSnap of answersSnap.docs) {
        const data = docSnap.data();
        // Already counted (stepped back to this question), or the host player
        // has marked it by hand: either way the grade stays exactly as it is.
        if (data.scored || data.manualOverride) continue;
        const gradeResult = typeImpl.grade(data.value, question);
        const pointsAwarded = gradeResult.pointsAwarded !== undefined
            ? gradeResult.pointsAwarded
            : (gradeResult.correct ? question.points : 0);

        writes.push(batch => batch.update(docSnap.ref, {
            correct: gradeResult.correct,
            pointsAwarded,
            textRevealed: false,
            manualOverride: false
        }));
    }
    await commitWrites(writes);

    await updateDoc(sessionRef, { questionPhase: 'locked' });
}

// Firestore batches take at most 500 writes; chunks go up in parallel.
async function commitWrites(writes) {
    const jobs = [];
    for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        writes.slice(i, i + 400).forEach(write => write(batch));
        jobs.push(batch.commit());
    }
    await Promise.all(jobs);
}

// Marks graded-but-uncounted answers as counted and adds each player's total in
// ONE increment (not one per answer): a handful of batched writes however many
// answers there are. The `scored` flag stops a second pass double counting.
async function scoreAnswerDocs(code, answerDocs) {
    const perPlayer = new Map();
    const writes = [];

    answerDocs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.scored || data.correct == null) return; // counted, or not graded yet
        writes.push(batch => batch.update(docSnap.ref, { scored: true, textRevealed: true }));
        if (data.pointsAwarded > 0) {
            perPlayer.set(data.playerId, (perPlayer.get(data.playerId) || 0) + data.pointsAwarded);
        }
    });
    perPlayer.forEach((points, playerId) => {
        writes.push(batch => batch.update(doc(db, 'sessions', code, 'players', playerId), { score: increment(points) }));
    });

    await commitWrites(writes);
}

export async function scoreQuestion(code, quiz, questionIndex) {
    const question = quiz.questions[questionIndex];
    const answersSnap = await getDocs(
        query(collection(db, 'sessions', code, 'answers'), where('questionId', '==', question.id))
    );
    await scoreAnswerDocs(code, answersSnap.docs);
}

// "Reveal at the end" mode and Finish: every answer of every question, read once.
// (This used to be one read and a run of awaited writes per question, which
// took many seconds on a long quiz.)
export async function scoreAllQuestions(code, quiz) {
    const answersSnap = await getDocs(collection(db, 'sessions', code, 'answers'));
    await scoreAnswerDocs(code, answersSnap.docs);
}

// ---------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------

export async function goToSlide(sessionRef, code, quiz, session, n, opts = {}) {
    const item = slideItem(quiz, n);
    if (!item) return;

    // Moving anywhere closes the scores screen if the host player had it up.
    const updates = { currentSlide: n, scoresVisible: false };

    // Going forward remembers where we came from; going back pops it.
    const trail = Array.isArray(session.slideTrail) ? [...session.slideTrail] : [];
    if (opts.back) {
        trail.pop();
    } else if (session.currentSlide && session.currentSlide !== n) {
        trail.push(session.currentSlide);
    }
    updates.slideTrail = trail.slice(-60);
    if (opts.extra) Object.assign(updates, opts.extra);
    if (!opts.back) updates.visited = arrayUnion(n);

    if (item.type === 'question' && item.questionIndex != null) {
        updates.currentQuestionIndex = item.questionIndex;
        updates.questionPhase = 'answering';
        updates.answerRevealed = false;
    } else if (item.type === 'answer' && item.questionIndex != null) {
        const immediate = quiz.slides.revealMode === 'immediate';
        // Make sure the question is graded even if the host skipped Lock.
        if (immediate) {
            if (session.currentQuestionIndex === item.questionIndex && session.questionPhase === 'answering') {
                await lockQuestion(sessionRef, code, quiz, item.questionIndex);
            }
            await scoreQuestion(code, quiz, item.questionIndex);
        }
        updates.currentQuestionIndex = item.questionIndex;
        updates.questionPhase = 'locked';
        updates.answerRevealed = immediate;
    } else {
        updates.currentQuestionIndex = -1;
        updates.questionPhase = 'locked';
        updates.answerRevealed = false;
    }

    await updateDoc(sessionRef, updates);
}

// Begin the quiz (main screen's button or the host player's phone): one
// write that flips the session to 'slides' and lands on slide 1.
export function startSlidesQuiz(sessionRef, code, quiz, session) {
    const fresh = { ...session, currentSlide: 0, slideTrail: [] };
    return goToSlide(sessionRef, code, quiz, fresh, 1, { extra: { status: 'slides' } });
}

export function goBack(sessionRef, code, quiz, session) {
    const trail = Array.isArray(session.slideTrail) ? session.slideTrail : [];
    if (!trail.length) return Promise.resolve();
    return goToSlide(sessionRef, code, quiz, session, trail[trail.length - 1], { back: true });
}

export function goHome(sessionRef, code, quiz, session) {
    const home = homeSlideOf(quiz);
    if (session.currentSlide === home) return Promise.resolve();
    return goToSlide(sessionRef, code, quiz, session, home);
}

// What the one big "main" button should say/do right now.
//   kind: 'lock' | 'next' | 'finish' | 'none'
export function primaryAction(quiz, session) {
    const n = session.currentSlide;
    const item = slideItem(quiz, n);
    if (!item) return { kind: 'none', label: '—', disabled: true };

    if (item.type === 'question' && session.questionPhase === 'answering') {
        return { kind: 'lock', label: '🔒 Lock answers', disabled: false };
    }
    if (item.type === 'board' && item.hotspots && item.hotspots.length) {
        return { kind: 'none', label: 'Pick an option ↓', disabled: true };
    }
    if (nextSlideOf(quiz, n) == null) {
        return { kind: 'finish', label: '🏁 Finish quiz', disabled: false };
    }
    return { kind: 'next', label: 'Next ▶', disabled: false };
}

export async function runPrimaryAction(sessionRef, code, quiz, session) {
    const action = primaryAction(quiz, session);
    if (action.disabled) return;

    if (action.kind === 'lock') {
        return lockQuestion(sessionRef, code, quiz, session.currentQuestionIndex);
    }
    if (action.kind === 'next') {
        return goToSlide(sessionRef, code, quiz, session, nextSlideOf(quiz, session.currentSlide));
    }
    if (action.kind === 'finish') {
        return finishSlidesQuiz(sessionRef, code, quiz, session);
    }
}

export async function finishSlidesQuiz(sessionRef, code, quiz, session) {
    // A question still open when Finish is pressed gets locked first.
    if (session.questionPhase === 'answering' && session.currentQuestionIndex >= 0) {
        await lockQuestion(sessionRef, code, quiz, session.currentQuestionIndex);
    }
    // Switch screens first: names and scores are hidden until the host player
    // reveals them, so by then the totals below have long since landed.
    await updateDoc(sessionRef, { status: 'slides-final', revealedNames: [], revealedScores: [], scoresVisible: false });
    await scoreAllQuestions(code, quiz);
}

// Final results: the main screen shows the scoreboard with every name and score
// hidden; the host player taps any single name or score on their phone to show
// it (so they can be revealed in any order). Stored as the ids of whatever has
// been revealed so far.
export function revealResult(sessionRef, kind, playerId) {
    return updateDoc(sessionRef, { [kind === 'name' ? 'revealedNames' : 'revealedScores']: arrayUnion(playerId) });
}

export function revealAllResults(sessionRef, players) {
    const ids = players.map(p => p.id);
    return updateDoc(sessionRef, { revealedNames: ids, revealedScores: ids });
}

// Board options the host player sees as buttons: label + target, with
// whether that slide has been visited already.
export function boardOptions(quiz, session) {
    const item = slideItem(quiz, session.currentSlide);
    if (!item || item.type !== 'board') return [];
    const visited = new Set(session.visited || []);
    return (item.hotspots || []).map((h, i) => ({
        label: h.label || `Option ${i + 1}`,
        target: h.target,
        visited: visited.has(h.target)
    }));
}

// ---------------------------------------------------------------------
// host-player helpers: reading answers and overriding marks
// ---------------------------------------------------------------------

// Human-readable version of a player's stored answer value.
export function formatAnswer(question, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (question.type === 'multiple-choice') {
        const opt = question.config.options.find(o => o.id === value);
        return opt ? opt.label : String(value);
    }
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

// What the correct answer is, as short text for the host player.
export function correctAnswerText(question) {
    const cfg = question.config || {};
    const none = '(no answer set yet)';
    const has = v => v !== null && v !== undefined && v !== '';

    if (question.type === 'text' || question.type === 'multi-answer') {
        const list = (cfg.acceptedAnswers || []);
        return list.length ? list.join(' / ') : none;
    }
    if (question.type === 'number') {
        if (cfg.mode === 'range') return has(cfg.min) && has(cfg.max) ? `${cfg.min}–${cfg.max}` : none;
        return has(cfg.correctValue) ? String(cfg.correctValue) : none;
    }
    if (question.type === 'multiple-choice') {
        const opt = (cfg.options || []).find(o => o.id === cfg.correctOptionId);
        return opt && opt.label ? opt.label : none;
    }
    return '';
}

// Flip one answer between correct and incorrect. If its points were already
// added to the player's score, the score is adjusted by the difference.
export async function overrideAnswer(code, quiz, questionIndex, answerId, answer) {
    const question = quiz.questions[questionIndex];
    const newCorrect = !answer.correct;
    const newPoints = newCorrect ? question.points : 0;

    await updateDoc(doc(db, 'sessions', code, 'answers', answerId), {
        correct: newCorrect,
        pointsAwarded: newPoints,
        manualOverride: true
    });

    if (answer.scored) {
        const delta = newPoints - (answer.pointsAwarded || 0);
        if (delta !== 0) {
            await updateDoc(doc(db, 'sessions', code, 'players', answer.playerId), {
                score: increment(delta)
            });
        }
    }
}

// "Click the screen" / keyboard advance on the main screen: leaves the
// current slide for its next one, locking an open question on the way (so
// answers are graded even if the host never pressed Lock). Boards are left
// alone — they only move via their touchable areas — and so is the last slide
// (the host player finishes the quiz from the phone).
export async function advanceSlide(sessionRef, code, quiz, session) {
    const n = session.currentSlide;
    const item = slideItem(quiz, n);
    if (!item) return;
    if (item.type === 'board' && item.hotspots && item.hotspots.length) return;

    const next = nextSlideOf(quiz, n);
    if (next == null) return;

    let current = session;
    if (item.type === 'question' && session.questionPhase === 'answering' && session.currentQuestionIndex >= 0) {
        await lockQuestion(sessionRef, code, quiz, session.currentQuestionIndex);
        current = { ...session, questionPhase: 'locked' };
    }
    await goToSlide(sessionRef, code, quiz, current, next);
}

// The host player can put the scoreboard on the main screen at any time; it
// covers the slides until hidden (or until they move to another slide).
export function setScoresVisible(sessionRef, visible) {
    return updateDoc(sessionRef, { scoresVisible: !!visible });
}

// Players that count for scores/answers: the host player is only a remote
// control, so they never appear anywhere except the lobby's join list.
export function scoringPlayers(players, session) {
    return players.filter(p => !session || !session.hostPlayerId || p.id !== session.hostPlayerId);
}

// Scoring players in scoreboard order: highest score first, ties by name, so
// the main screen and the host player's phone always list them identically.
export function rankPlayers(players, session) {
    return scoringPlayers(players, session).sort((a, b) =>
        (b.score || 0) - (a.score || 0) || String(a.name).localeCompare(String(b.name)));
}

// Position numbers for an already-sorted scoreboard: players on the same score
// share a position (1, 1, 3...).
export function rankPositions(sorted) {
    const ranks = [];
    sorted.forEach((p, i) => {
        ranks.push(i > 0 && (p.score || 0) === (sorted[i - 1].score || 0) ? ranks[i - 1] : i + 1);
    });
    return ranks;
}
