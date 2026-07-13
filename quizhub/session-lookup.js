import { db } from './firebase/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// A quiz counts as "closed" once both the host and every player have left —
// even if the host never explicitly pressed Finish/End Quiz. Otherwise the
// session is still resumable/joinable under the same code. Ended sessions
// are deleted entirely by finishQuizCleanup(), so any doc that still exists
// is either in progress or abandoned (host tab closed without finishing).
export async function findActiveSessionForQuiz(quizId) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('quizId', '==', quizId)));
    const candidates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.status !== 'ended');

    for (const session of candidates) {
        const playersSnap = await getDocs(collection(db, 'sessions', session.id, 'players'));
        const anyPlayerConnected = playersSnap.docs.some(p => p.data().connected !== false);
        const isClosed = session.hostConnected === false && !anyPlayerConnected;

        if (!isClosed) return session;
    }

    return null;
}
