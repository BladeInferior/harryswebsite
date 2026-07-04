import { db } from './firebase/firebase-config.js';
import {
    collection,
    getDocs,
    query,
    orderBy
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
    recent: document.getElementById('tab-recent'),
    leaderboard: document.getElementById('tab-leaderboard'),
    individual: document.getElementById('tab-individual')
};

const recentList = document.getElementById('recent-list');
const leaderboardBody = document.getElementById('leaderboard-body');
const leaderboardEmpty = document.getElementById('leaderboard-empty');
const individualBody = document.getElementById('individual-body');
const individualEmpty = document.getElementById('individual-empty');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

switchTab('recent');

function switchTab(tab) {
    tabButtons.forEach(btn => btn.classList.toggle('tab-active', btn.dataset.tab === tab));
    Object.entries(tabPanels).forEach(([key, panel]) => {
        panel.hidden = key !== tab;
    });
}

// =========================
// RECENT QUIZZES
// =========================
getDocs(query(collection(db, 'quizResults'), orderBy('playedAt', 'desc'))).then(snapshot => {
    recentList.innerHTML = '';

    if (snapshot.empty) {
        recentList.innerHTML = '<p class="empty-hint">No quizzes played yet.</p>';
        return;
    }

    snapshot.forEach(docSnap => {
        const result = docSnap.data();
        recentList.appendChild(createResultRow(result));
    });
});

function createResultRow(result) {
    const row = document.createElement('div');
    row.className = 'result-row';

    const header = document.createElement('div');
    header.className = 'result-row-header';

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = result.quizTitle || 'Untitled Quiz';
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.textContent = `${formatDate(result.playedAt)} — ${result.players.length} player${result.players.length === 1 ? '' : 's'}`;
    header.appendChild(meta);

    row.appendChild(header);

    const playersEl = document.createElement('div');
    playersEl.className = 'result-players';
    playersEl.hidden = true;

    [...result.players]
        .sort((a, b) => b.score - a.score)
        .forEach(player => {
            const playerRow = document.createElement('div');
            playerRow.className = 'result-player-row';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${player.name} — ${player.score} pts`;
            playerRow.appendChild(nameSpan);

            const badge = document.createElement('span');
            badge.className = 'outcome-badge outcome-' + player.outcome;
            badge.textContent = player.outcome;
            playerRow.appendChild(badge);

            playersEl.appendChild(playerRow);
        });

    row.appendChild(playersEl);

    row.addEventListener('click', () => {
        playersEl.hidden = !playersEl.hidden;
    });

    return row;
}

function formatDate(timestamp) {
    if (!timestamp || !timestamp.toDate) return '';
    return timestamp.toDate().toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// =========================
// LEADERBOARD + INDIVIDUAL STATS (share the same data)
// =========================
getDocs(collection(db, 'leaderboard')).then(snapshot => {
    const players = snapshot.docs.map(docSnap => docSnap.data());

    renderLeaderboard(players);
    renderIndividualStats(players);
});

function renderLeaderboard(players) {
    leaderboardBody.innerHTML = '';

    if (!players.length) {
        leaderboardEmpty.hidden = false;
        return;
    }

    [...players]
        .sort((a, b) => (b.wins || 0) - (a.wins || 0))
        .forEach(player => {
            const gamesPlayed = player.gamesPlayed || 0;
            const wins = player.wins || 0;
            const winPct = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(player.name)}</td>
                <td>${wins}</td>
                <td>${player.draws || 0}</td>
                <td>${player.losses || 0}</td>
                <td>${winPct}%</td>
                <td>${player.totalScore || 0}</td>
            `;
            leaderboardBody.appendChild(tr);
        });
}

function renderIndividualStats(players) {
    individualBody.innerHTML = '';

    if (!players.length) {
        individualEmpty.hidden = false;
        return;
    }

    [...players]
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
        .forEach(player => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(player.name)}</td>
                <td>${player.bestScore || 0}</td>
                <td>${player.totalScore || 0}</td>
                <td>${player.gamesPlayed || 0}</td>
            `;
            individualBody.appendChild(tr);
        });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
