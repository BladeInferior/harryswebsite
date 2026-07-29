import { db } from './firebase/firebase-config.js';
import {
    collection,
    getDocs,
    getDoc,
    doc,
    query,
    where
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('review-name-input');
const statusMessage = document.getElementById('status-message');

const nameEntryView = document.getElementById('name-entry-view');
const quizListView = document.getElementById('quiz-list-view');
const statsSummary = document.getElementById('stats-summary');
const quizList = document.getElementById('quiz-list');

const categoryListView = document.getElementById('category-list-view');
const categoryListTitle = document.getElementById('category-list-title');
const categoryList = document.getElementById('category-list');

const questionListView = document.getElementById('question-list-view');
const questionListTitle = document.getElementById('question-list-title');
const questionList = document.getElementById('question-list');

const questionDetailView = document.getElementById('question-detail-view');
const detailCategory = document.getElementById('detail-category');
const detailPrompt = document.getElementById('detail-prompt');
const detailYourAnswer = document.getElementById('detail-your-answer');
const detailCorrectAnswer = document.getElementById('detail-correct-answer');
const detailPoints = document.getElementById('detail-points');
const detailExplanationRow = document.getElementById('detail-explanation-row');
const detailExplanation = document.getElementById('detail-explanation');

let reviews = [];
let history = [];
let leaderboardData = null;
let currentReview = null;
let currentCategory = null;

function normalizeName(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Pre-fill from ?name= (linked from join.js's "Review My Answers" button)
// and jump straight to the quiz list.
const prefilledName = new URLSearchParams(window.location.search).get('name');
if (prefilledName) {
    nameInput.value = prefilledName;
    lookupReviews(prefilledName);
}

nameForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (name) lookupReviews(name);
});

async function lookupReviews(name) {
    statusMessage.className = 'pending';
    statusMessage.textContent = 'Looking up your quizzes...';

    const nameKey = normalizeName(name);

    try {
        const [leaderboardSnap, resultsSnap, reviewsSnap] = await Promise.all([
            getDoc(doc(db, 'leaderboard', nameKey)),
            getDocs(collection(db, 'quizResults')),
            getDocs(query(collection(db, 'playerReviews'), where('nameKey', '==', nameKey)))
        ]);

        leaderboardData = leaderboardSnap.exists() ? leaderboardSnap.data() : null;

        reviews = reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        history = resultsSnap.docs
            .map(d => d.data())
            .map(result => {
                const mine = (result.players || []).find(p => normalizeName(p.name) === nameKey);
                return mine ? { ...result, mine } : null;
            })
            .filter(Boolean)
            .sort((a, b) => (b.playedAt?.toMillis?.() || 0) - (a.playedAt?.toMillis?.() || 0));

        if (!leaderboardData && !history.length) {
            statusMessage.className = 'failure';
            statusMessage.textContent = "No quizzes found for that name — either you haven't played one yet, or the name doesn't match exactly.";
            return;
        }

        statusMessage.className = '';
        statusMessage.textContent = '';
        showQuizList();
    } catch (err) {
        console.error(err);
        statusMessage.className = 'failure';
        statusMessage.textContent = 'Something went wrong looking that up — check the console.';
    }
}

// Picks the playerReviews doc (question-level detail, opt-in per quiz) that
// corresponds to this quizResults entry. Both matching by quizId, and — for
// the rare case of replaying the same quiz — by whichever is closest in time.
function findMatchingReview(result) {
    const candidates = reviews.filter(r => r.quizId && r.quizId === result.quizId);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const resultMillis = result.playedAt?.toMillis?.() || 0;
    return candidates.reduce((best, r) => {
        const bestDiff = Math.abs((best.playedAt?.toMillis?.() || 0) - resultMillis);
        const rDiff = Math.abs((r.playedAt?.toMillis?.() || 0) - resultMillis);
        return rDiff < bestDiff ? r : best;
    });
}

function hideAllViews() {
    nameEntryView.hidden = true;
    quizListView.hidden = true;
    categoryListView.hidden = true;
    questionListView.hidden = true;
    questionDetailView.hidden = true;
}

function showQuizList() {
    hideAllViews();
    quizListView.hidden = false;

    document.getElementById('breadcrumb').innerHTML = '';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = '← Search a different name';
    backBtn.addEventListener('click', () => {
        hideAllViews();
        nameEntryView.hidden = false;
    });
    document.getElementById('breadcrumb').appendChild(backBtn);

    renderStatsSummary();

    quizList.innerHTML = '';

    if (!history.length) {
        quizList.innerHTML = '<p class="empty-hint">No quiz history found — just aggregate stats above.</p>';
        return;
    }

    history.forEach(result => {
        const tile = document.createElement('div');
        tile.className = 'tile history-tile ' + result.mine.outcome;

        const main = document.createElement('div');
        main.className = 'tile-main';
        main.innerHTML = `
            <span>${escapeHtml(result.quizTitle)}</span>
            <span class="tile-meta">${formatDate(result.playedAt)} — ${result.mine.score} pts, ${capitalize(result.mine.outcome)}</span>
        `;
        tile.appendChild(main);

        const matchedReview = findMatchingReview(result);
        if (matchedReview) {
            const viewBtn = document.createElement('button');
            viewBtn.type = 'button';
            viewBtn.className = 'view-answers-btn';
            viewBtn.textContent = 'View Answers';
            viewBtn.addEventListener('click', () => showCategoryList(matchedReview));
            tile.appendChild(viewBtn);
        } else {
            const note = document.createElement('span');
            note.className = 'no-review-note';
            note.textContent = 'No answer review saved';
            tile.appendChild(note);
        }

        quizList.appendChild(tile);
    });
}

function renderStatsSummary() {
    if (!leaderboardData) {
        statsSummary.innerHTML = '<p class="empty-hint">No aggregate stats yet.</p>';
        return;
    }

    const stats = [
        { label: 'Total Score', value: leaderboardData.totalScore || 0 },
        { label: 'Best Score', value: leaderboardData.bestScore || 0 },
        { label: 'Games Played', value: leaderboardData.gamesPlayed || 0 },
        { label: 'Wins', value: leaderboardData.wins || 0 },
        { label: 'Draws', value: leaderboardData.draws || 0 },
        { label: 'Losses', value: leaderboardData.losses || 0 }
    ];

    statsSummary.innerHTML = stats.map(s => `
        <div class="stat-tile">
            <div class="stat-value">${s.value}</div>
            <div class="stat-label">${s.label}</div>
        </div>
    `).join('');
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function showCategoryList(review) {
    currentReview = review;
    hideAllViews();
    categoryListView.hidden = false;
    categoryListTitle.textContent = review.quizTitle;

    document.getElementById('breadcrumb-categories').innerHTML = '';
    document.getElementById('breadcrumb-categories').appendChild(makeBackBtn('← Back to your quizzes', showQuizList));

    const categories = [...new Set(review.entries.map(e => e.category))];

    categoryList.innerHTML = '';
    categories.forEach(category => {
        const entries = review.entries.filter(e => e.category === category);
        const correctCount = entries.filter(e => e.correct).length;

        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile';
        tile.innerHTML = `
            <span>${escapeHtml(category)}</span>
            <span class="tile-meta">${correctCount}/${entries.length} correct</span>
        `;
        tile.addEventListener('click', () => showQuestionList(category));
        categoryList.appendChild(tile);
    });
}

function showQuestionList(category) {
    currentCategory = category;
    hideAllViews();
    questionListView.hidden = false;
    questionListTitle.textContent = category;

    document.getElementById('breadcrumb-questions').innerHTML = '';
    document.getElementById('breadcrumb-questions').appendChild(
        makeBackBtn('← Back to categories', () => showCategoryList(currentReview)));

    const entries = currentReview.entries.filter(e => e.category === category);

    questionList.innerHTML = '';
    entries.forEach(entry => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile ' + (entry.correct ? 'correct' : 'incorrect');
        tile.innerHTML = `
            <span>${escapeHtml(entry.prompt)}</span>
            <span class="tile-meta">${entry.pointsAwarded || 0} pts</span>
        `;
        tile.addEventListener('click', () => showQuestionDetail(entry));
        questionList.appendChild(tile);
    });
}

function showQuestionDetail(entry) {
    hideAllViews();
    questionDetailView.hidden = false;

    document.getElementById('breadcrumb-detail').innerHTML = '';
    document.getElementById('breadcrumb-detail').appendChild(
        makeBackBtn('← Back to questions', () => showQuestionList(currentCategory)));

    detailCategory.textContent = entry.category;
    detailPrompt.textContent = entry.prompt;
    detailYourAnswer.textContent = entry.yourAnswer;
    detailYourAnswer.className = entry.correct ? 'correct' : 'incorrect';
    detailCorrectAnswer.textContent = entry.correctAnswer;
    detailPoints.textContent = `${entry.pointsAwarded || 0}`;

    detailExplanationRow.hidden = !entry.explanation;
    detailExplanation.textContent = entry.explanation || '';
}

function makeBackBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function formatDate(timestamp) {
    if (!timestamp || !timestamp.toDate) return '';
    return timestamp.toDate().toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
