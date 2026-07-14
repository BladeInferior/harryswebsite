import { db } from './firebase/firebase-config.js';
import {
    collection,
    getDocs,
    getDoc,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    query,
    orderBy,
    increment,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = {
    recent: document.getElementById('tab-recent'),
    leaderboard: document.getElementById('tab-leaderboard'),
    individual: document.getElementById('tab-individual'),
    combos: document.getElementById('tab-combos'),
    admin: document.getElementById('tab-admin')
};

const recentList = document.getElementById('recent-list');
const leaderboardBody = document.getElementById('leaderboard-body');
const leaderboardEmpty = document.getElementById('leaderboard-empty');
const individualBody = document.getElementById('individual-body');
const individualEmpty = document.getElementById('individual-empty');

const comboListView = document.getElementById('combo-list-view');
const comboList = document.getElementById('combo-list');
const comboEmpty = document.getElementById('combo-empty');
const comboDetailView = document.getElementById('combo-detail-view');
const comboDetailTitle = document.getElementById('combo-detail-title');
const comboDetailBody = document.getElementById('combo-detail-body');
const comboDetailQuizzes = document.getElementById('combo-detail-quizzes');
const comboBackBtn = document.getElementById('combo-back-btn');

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
// RECENT QUIZZES + COMBOS (both derived from quizResults)
// =========================
function loadQuizResults() {
    return getDocs(query(collection(db, 'quizResults'), orderBy('playedAt', 'desc'))).then(snapshot => {
        const results = snapshot.docs.map(d => d.data());

        recentList.innerHTML = '';
        if (!results.length) {
            recentList.innerHTML = '<p class="empty-hint">No quizzes played yet.</p>';
        } else {
            results.forEach(result => recentList.appendChild(createResultRow(result)));
        }

        renderCombos(results);
    });
}

loadQuizResults();

function renderCombos(results) {
    const combos = new Map(); // comboKey -> { names: Map(nameKey->displayName), perPlayer: Map(nameKey->stats), quizzes: [] }

    results.filter(r => r.comboKey).forEach(result => {
        if (!combos.has(result.comboKey)) {
            combos.set(result.comboKey, { names: new Map(), perPlayer: new Map(), quizzes: [] });
        }
        const combo = combos.get(result.comboKey);

        const maxScore = Math.max(...result.players.map(p => p.score));
        combo.quizzes.push({ title: result.quizTitle, playedAt: result.playedAt });

        result.players.forEach(player => {
            const nameKey = player.name.trim().toLowerCase().replace(/\s+/g, ' ');
            combo.names.set(nameKey, player.name);

            if (!combo.perPlayer.has(nameKey)) {
                combo.perPlayer.set(nameKey, { wins: 0, draws: 0, losses: 0, totalScore: 0 });
            }
            const stats = combo.perPlayer.get(nameKey);
            stats.totalScore += player.score || 0;
            if (player.outcome === 'win') stats.wins++;
            else if (player.outcome === 'draw') stats.draws++;
            else stats.losses++;
        });
    });

    comboList.innerHTML = '';
    comboEmpty.hidden = combos.size > 0;

    [...combos.entries()]
        .sort((a, b) => b[1].quizzes.length - a[1].quizzes.length)
        .forEach(([comboKey, combo]) => {
            const names = [...combo.names.values()];
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'tile';
            tile.innerHTML = `
                <span>${escapeHtml(names.join(', '))}</span>
                <span class="tile-meta">${combo.quizzes.length} quiz${combo.quizzes.length === 1 ? '' : 'zes'} together</span>
            `;
            tile.addEventListener('click', () => showComboDetail(names.join(', '), combo));
            comboList.appendChild(tile);
        });
}

function showComboDetail(title, combo) {
    comboListView.hidden = true;
    comboDetailView.hidden = false;
    comboDetailTitle.textContent = title;

    comboDetailBody.innerHTML = '';
    [...combo.perPlayer.entries()]
        .sort((a, b) => b[1].totalScore - a[1].totalScore)
        .forEach(([nameKey, stats]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(combo.names.get(nameKey))}</td>
                <td>${stats.wins}</td>
                <td>${stats.draws}</td>
                <td>${stats.losses}</td>
                <td>${stats.totalScore}</td>
            `;
            comboDetailBody.appendChild(tr);
        });

    comboDetailQuizzes.innerHTML = '';
    [...combo.quizzes]
        .sort((a, b) => (b.playedAt?.toMillis?.() || 0) - (a.playedAt?.toMillis?.() || 0))
        .forEach(quiz => {
            const row = document.createElement('div');
            row.className = 'tile';
            row.style.cursor = 'default';
            row.innerHTML = `
                <span>${escapeHtml(quiz.title || 'Untitled Quiz')}</span>
                <span class="tile-meta">${formatDate(quiz.playedAt)}</span>
            `;
            comboDetailQuizzes.appendChild(row);
        });
}

comboBackBtn.addEventListener('click', () => {
    comboDetailView.hidden = true;
    comboListView.hidden = false;
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
function loadLeaderboard() {
    return getDocs(collection(db, 'leaderboard')).then(snapshot => {
        const players = snapshot.docs.map(docSnap => docSnap.data());

        renderLeaderboard(players);
        renderIndividualStats(players);
    });
}

loadLeaderboard();

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

// =========================
// MANUAL LEADERBOARD ENTRY (9.1) — records a quizResults doc (with a
// comboKey, so it shows up under Combos too) and folds each player's result
// into the leaderboard, same as a live session's finishQuizCleanup — just
// entered by hand instead of tracked live.
// =========================
const addManualEntryBtn = document.getElementById('add-manual-entry-btn');
const manualEntryModal = document.getElementById('manual-entry-modal');
const manualEntryError = document.getElementById('manual-entry-error');
const manualEntryQuizNameInput = document.getElementById('manual-entry-quiz-name');
const manualEntryPlayers = document.getElementById('manual-entry-players');
const manualEntryAddPlayerBtn = document.getElementById('manual-entry-add-player-btn');
const saveManualEntryBtn = document.getElementById('save-manual-entry-btn');
const cancelManualEntryBtn = document.getElementById('cancel-manual-entry-btn');

addManualEntryBtn.addEventListener('click', () => {
    manualEntryError.hidden = true;
    manualEntryQuizNameInput.value = '';
    manualEntryPlayers.innerHTML = '';
    addManualEntryPlayerRow();
    addManualEntryPlayerRow();
    manualEntryModal.hidden = false;
    manualEntryQuizNameInput.focus();
});

manualEntryAddPlayerBtn.addEventListener('click', () => addManualEntryPlayerRow());

function addManualEntryPlayerRow() {
    const row = document.createElement('div');
    row.className = 'manual-entry-player-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'manual-entry-player-name';
    nameInput.placeholder = 'Player name';
    nameInput.autocomplete = 'off';

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.className = 'manual-entry-player-score';
    scoreInput.placeholder = 'Score';
    scoreInput.min = '0';
    scoreInput.value = '0';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(nameInput);
    row.appendChild(scoreInput);
    row.appendChild(removeBtn);
    manualEntryPlayers.appendChild(row);
}

cancelManualEntryBtn.addEventListener('click', () => {
    manualEntryModal.hidden = true;
});

manualEntryModal.addEventListener('click', e => {
    if (e.target === manualEntryModal) manualEntryModal.hidden = true;
});

saveManualEntryBtn.addEventListener('click', async () => {
    const quizTitle = manualEntryQuizNameInput.value.trim() || 'Manual Entry';

    const players = Array.from(manualEntryPlayers.querySelectorAll('.manual-entry-player-row'))
        .map(row => ({
            name: row.querySelector('.manual-entry-player-name').value.trim(),
            score: parseInt(row.querySelector('.manual-entry-player-score').value, 10)
        }))
        .filter(p => p.name);

    if (!players.length) {
        manualEntryError.textContent = 'Enter at least one player name.';
        manualEntryError.hidden = false;
        return;
    }
    if (players.some(p => !Number.isFinite(p.score) || p.score < 0)) {
        manualEntryError.textContent = 'Every player needs a valid score.';
        manualEntryError.hidden = false;
        return;
    }

    saveManualEntryBtn.disabled = true;

    try {
        const maxScore = Math.max(...players.map(p => p.score));
        const winnerCount = players.filter(p => p.score === maxScore).length;

        const resultPlayers = players.map(p => ({
            name: p.name,
            score: p.score,
            outcome: p.score !== maxScore ? 'loss' : (winnerCount > 1 ? 'draw' : 'win')
        }));

        await addDoc(collection(db, 'quizResults'), {
            quizId: null,
            quizTitle,
            playedAt: serverTimestamp(),
            players: resultPlayers,
            comboKey: computeComboKey(resultPlayers.map(p => p.name)),
            manualEntry: true
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

        manualEntryModal.hidden = true;
        await Promise.all([loadLeaderboard(), loadQuizResults()]);
    } catch (err) {
        console.error(err);
        manualEntryError.textContent = 'Failed to save — check console.';
        manualEntryError.hidden = false;
    } finally {
        saveManualEntryBtn.disabled = false;
    }
});

function slugifyName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function computeComboKey(names) {
    if (!names || names.length < 2) return null;
    return names.map(slugifyName).sort().join('|');
}

// =========================
// ADMIN: MERGE DUPLICATE PLAYERS — hidden unless the same "exportAuthKey"
// localStorage key used by collection-hub's export tool is present. Same
// trust model as that feature: this only hides the tool from casual
// visitors, it isn't real access control (there's no server-side check),
// since it just edits Firestore data this site already writes to openly.
// =========================
const ADMIN_KEY_STORAGE = 'exportAuthKey';
const isAdmin = !!localStorage.getItem(ADMIN_KEY_STORAGE);

const adminTabBtn = document.getElementById('admin-tab-btn');
const adminMergeError = document.getElementById('admin-merge-error');
const adminMergeCanonicalSelect = document.getElementById('admin-merge-canonical-select');
const adminMergeCanonicalNew = document.getElementById('admin-merge-canonical-new');
const adminMergeSourceList = document.getElementById('admin-merge-source-list');
const adminMergePreviewBtn = document.getElementById('admin-merge-preview-btn');
const adminMergePreview = document.getElementById('admin-merge-preview');
const adminMergePreviewList = document.getElementById('admin-merge-preview-list');
const adminMergeConfirmBtn = document.getElementById('admin-merge-confirm-btn');
const adminMergeCancelBtn = document.getElementById('admin-merge-cancel-btn');
const adminMergeStatus = document.getElementById('admin-merge-status');

let cachedLeaderboardPlayers = [];
let pendingMerge = null;

if (isAdmin) {
    adminTabBtn.hidden = false;
    loadAdminPlayerList();
}

async function loadAdminPlayerList() {
    const snap = await getDocs(collection(db, 'leaderboard'));
    cachedLeaderboardPlayers = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.name.localeCompare(b.name));

    renderAdminPlayerControls();
}

function renderAdminPlayerControls() {
    adminMergeCanonicalSelect.innerHTML = '<option value="">— choose an existing player —</option>';
    cachedLeaderboardPlayers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.gamesPlayed || 0} games)`;
        adminMergeCanonicalSelect.appendChild(opt);
    });

    adminMergeSourceList.innerHTML = '';
    cachedLeaderboardPlayers.forEach(p => {
        const row = document.createElement('label');
        row.className = 'checkbox-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = p.id;
        checkbox.className = 'admin-merge-source-checkbox';

        row.appendChild(checkbox);
        row.appendChild(document.createTextNode(
            `${p.name} (${p.gamesPlayed || 0} games, ${p.totalScore || 0} pts)`
        ));
        adminMergeSourceList.appendChild(row);
    });

    adminMergePreview.hidden = true;
    pendingMerge = null;
}

adminMergePreviewBtn.addEventListener('click', () => {
    adminMergeError.hidden = true;
    adminMergeStatus.textContent = '';
    adminMergeStatus.className = '';

    const canonicalNewName = adminMergeCanonicalNew.value.trim();
    const canonicalExistingId = adminMergeCanonicalSelect.value;
    const canonicalExisting = cachedLeaderboardPlayers.find(p => p.id === canonicalExistingId);

    const canonicalName = canonicalNewName || (canonicalExisting ? canonicalExisting.name : '');
    if (!canonicalName) {
        adminMergeError.textContent = 'Choose an existing player or type a new canonical name.';
        adminMergeError.hidden = false;
        return;
    }

    const canonicalNameKey = slugifyName(canonicalName);
    const sourceIds = Array.from(document.querySelectorAll('.admin-merge-source-checkbox:checked'))
        .map(cb => cb.value)
        .filter(id => id !== canonicalNameKey);

    if (!sourceIds.length) {
        adminMergeError.textContent = 'Select at least one player to merge in.';
        adminMergeError.hidden = false;
        return;
    }

    const sourcePlayers = sourceIds
        .map(id => cachedLeaderboardPlayers.find(p => p.id === id))
        .filter(Boolean);

    let totalScore = canonicalExisting ? (canonicalExisting.totalScore || 0) : 0;
    let gamesPlayed = canonicalExisting ? (canonicalExisting.gamesPlayed || 0) : 0;
    let bestScore = canonicalExisting ? (canonicalExisting.bestScore || 0) : 0;

    sourcePlayers.forEach(p => {
        totalScore += p.totalScore || 0;
        gamesPlayed += p.gamesPlayed || 0;
        bestScore = Math.max(bestScore, p.bestScore || 0);
    });

    pendingMerge = { canonicalName, canonicalNameKey, canonicalExistingId, sourcePlayers };

    adminMergePreviewList.innerHTML = '';
    const summary = [
        `Everything merges into "${canonicalName}" — combined: ${gamesPlayed} games, ${totalScore} total points, best score ${bestScore}.`,
        `Removed as separate leaderboard entries: ${sourcePlayers.map(p => p.name).join(', ')}.`,
        `Past match history (Recent Quizzes / Combos) and the review hub are updated to show "${canonicalName}" instead of the merged names.`
    ];
    summary.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        adminMergePreviewList.appendChild(li);
    });

    adminMergePreview.hidden = false;
});

adminMergeCancelBtn.addEventListener('click', () => {
    adminMergePreview.hidden = true;
    pendingMerge = null;
});

adminMergeConfirmBtn.addEventListener('click', async () => {
    if (!pendingMerge) return;

    adminMergeConfirmBtn.disabled = true;
    adminMergeStatus.className = '';
    adminMergeStatus.textContent = 'Merging...';

    try {
        await performPlayerMerge(pendingMerge);

        adminMergeStatus.className = 'success';
        adminMergeStatus.textContent = 'Merged!';
        adminMergePreview.hidden = true;
        adminMergeCanonicalNew.value = '';
        pendingMerge = null;
    } catch (err) {
        console.error(err);
        adminMergeStatus.className = 'failure';
        adminMergeStatus.textContent = err.message || 'Merge failed — check console.';
    } finally {
        await Promise.all([loadAdminPlayerList(), loadLeaderboard(), loadQuizResults()]);
        adminMergeConfirmBtn.disabled = false;
    }
});

// Runs every write as its own settled attempt instead of one big Promise.all:
// a single write denied by Firestore rules used to abort the whole merge
// mid-flight (Promise.all rejects on the first failure but doesn't cancel
// the writes already in flight), so it looked like the merge half-failed
// with no indication of what actually didn't go through. Now every stage
// runs to completion and failures are collected into one clear error.
async function performPlayerMerge({ canonicalName, canonicalNameKey, canonicalExistingId, sourcePlayers }) {
    const failures = [];

    async function attempt(label, fn) {
        try {
            await fn();
        } catch (err) {
            failures.push(`${label}: ${err.message || err}`);
        }
    }

    const canonicalRef = doc(db, 'leaderboard', canonicalNameKey);
    const canonicalSnap = await getDoc(canonicalRef);
    const canonicalExisting = canonicalSnap.exists() ? canonicalSnap.data() : null;

    let totalScore = canonicalExisting ? (canonicalExisting.totalScore || 0) : 0;
    let gamesPlayed = canonicalExisting ? (canonicalExisting.gamesPlayed || 0) : 0;
    let wins = canonicalExisting ? (canonicalExisting.wins || 0) : 0;
    let draws = canonicalExisting ? (canonicalExisting.draws || 0) : 0;
    let losses = canonicalExisting ? (canonicalExisting.losses || 0) : 0;
    let bestScore = canonicalExisting ? (canonicalExisting.bestScore || 0) : 0;

    sourcePlayers.forEach(p => {
        totalScore += p.totalScore || 0;
        gamesPlayed += p.gamesPlayed || 0;
        wins += p.wins || 0;
        draws += p.draws || 0;
        losses += p.losses || 0;
        bestScore = Math.max(bestScore, p.bestScore || 0);
    });

    await attempt(`Save merged totals for "${canonicalName}"`, () =>
        setDoc(canonicalRef, { name: canonicalName, totalScore, gamesPlayed, wins, draws, losses, bestScore }));

    await Promise.all(sourcePlayers
        .filter(p => p.id !== canonicalNameKey)
        .map(p => attempt(`Delete old leaderboard entry "${p.name}"`, () =>
            deleteDoc(doc(db, 'leaderboard', p.id)))));

    // Also covers the case where canonicalExistingId pointed at a doc whose
    // id doesn't match the (possibly re-typed) canonical name's slug.
    if (canonicalExistingId && canonicalExistingId !== canonicalNameKey) {
        await deleteDoc(doc(db, 'leaderboard', canonicalExistingId)).catch(() => {});
    }

    const sourceNameKeys = new Set(sourcePlayers.map(p => p.id));

    const resultsSnap = await getDocs(collection(db, 'quizResults'));
    await Promise.all(resultsSnap.docs.map(async docSnap => {
        const data = docSnap.data();
        let changed = false;

        const newPlayers = (data.players || []).map(p => {
            if (sourceNameKeys.has(slugifyName(p.name))) {
                changed = true;
                return { ...p, name: canonicalName };
            }
            return p;
        });

        if (!changed) return;

        // Merging can collapse two distinct teammates in the same quiz into
        // the same canonical person — that quiz is no longer a multi-person
        // combo, so the key must come from the deduplicated name set (falls
        // back to null, i.e. "not a combo", once only one name is left).
        const distinctNames = [...new Set(newPlayers.map(p => p.name))];

        await attempt(`Update quiz result "${data.quizTitle || docSnap.id}"`, () =>
            updateDoc(docSnap.ref, {
                players: newPlayers,
                comboKey: computeComboKey(distinctNames)
            }));
    }));

    const reviewsSnap = await getDocs(collection(db, 'playerReviews'));
    await Promise.all(reviewsSnap.docs.map(async docSnap => {
        const data = docSnap.data();
        if (sourceNameKeys.has(data.nameKey)) {
            await attempt(`Update review for "${data.playerName || data.nameKey}"`, () =>
                updateDoc(docSnap.ref, { nameKey: canonicalNameKey, playerName: canonicalName }));
        }
    }));

    if (failures.length) {
        throw new Error(`${failures.length} write(s) failed:\n${failures.join('\n')}`);
    }
}
