import { QUIZ_PATHS } from './quiz-registry.js';
import { db } from '../firebase/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

// Resolves a quiz by id: static file first (hand-built quizzes registered in
// quiz-registry.js), then Firestore (builder-authored quizzes), then falls
// back to the sample quiz if neither exists.
export async function loadQuiz(quizId) {
    const staticPath = QUIZ_PATHS[quizId];
    if (staticPath) {
        return fetch(staticPath).then(res => res.json());
    }

    const snap = await getDoc(doc(db, 'quizzes', quizId));
    if (snap.exists()) return snap.data();

    return fetch(QUIZ_PATHS['sample-quiz-1']).then(res => res.json());
}
