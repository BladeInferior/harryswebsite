import { db } from './firebase/firebase-config.js';
import { collection, getDocs, deleteDoc, doc, query, where } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// A quiz counts as "closed" once both the host and every player have left —
// even if the host never explicitly pressed Finish/End Quiz. Otherwise the
// session is still resumable/joinable under the same code. Ended sessions
// are deleted entirely by finishQuizCleanup(), so any doc that still exists
// is either in progress or abandoned (host tab closed without finishing).
//
// Sorted newest-first so that if more than one non-ended session somehow
// exists for a quiz (shouldn't happen once startSession() always calls
// deleteAllSessionsForQuiz() before minting a new one, but is a safe
// fallback for anything left over from before that), rejoining always lands
// on the most recent one rather than an arbitrary/stale one.
export async function findActiveSessionForQuiz(quizId) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('quizId', '==', quizId)));
    const candidates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.status !== 'ended')
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    for (const session of candidates) {
        const playersSnap = await getDocs(collection(db, 'sessions', session.id, 'players'));
        const anyPlayerConnected = playersSnap.docs.some(p => p.data().connected !== false);
        const isClosed = session.hostConnected === false && !anyPlayerConnected;

        if (!isClosed) return session;
    }

    return null;
}

// Wipes a session doc and every one of its subcollections.
export async function deleteSessionCompletely(sessionId) {
    const subcollections = ['players', 'messages', 'answers', 'events', 'buzzes'];

    await Promise.all(subcollections.map(async name => {
        const colSnap = await getDocs(collection(db, 'sessions', sessionId, name));
        await Promise.all(colSnap.docs.map(docSnap => deleteDoc(docSnap.ref)));
    }));

    await deleteDoc(doc(db, 'sessions', sessionId));
}

// Called right before minting a brand-new session ("Start Quiz") so that
// only the newest session for this quiz is ever active/rejoinable — without
// this, an old session the host never properly finished would stick around
// and rejoining could land on that stale one instead of the new one.
export async function deleteAllSessionsForQuiz(quizId) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('quizId', '==', quizId)));
    await Promise.all(snap.docs.map(d => deleteSessionCompletely(d.id)));
}
