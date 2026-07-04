import { QUIZ_PATHS } from './quiz-registry.js';
import { db } from '../firebase/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// Resolves a quiz by id: static file first (hand-built quizzes registered in
// quiz-registry.js), then Firestore (builder-authored quizzes). Throws if
// neither has it, so the caller can show a "quiz not found" state.
export async function loadQuiz(quizId) {
    const staticPath = QUIZ_PATHS[quizId];
    if (staticPath) {
        return fetch(staticPath).then(res => res.json());
    }

    const snap = await getDoc(doc(db, 'quizzes', quizId));
    if (snap.exists()) return snap.data();

    throw new Error(`Quiz not found: ${quizId}`);
}
