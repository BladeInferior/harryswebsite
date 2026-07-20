import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// Same Firebase project as adminhub/firebase/firebase-config.js — auth and
// googleProvider are exported here too so quiz-hub pages can gate specific
// admin-only actions (delete quiz, add manual leaderboard entry) behind the
// same Google Sign-In, without requiring the whole page behind a login wall.
const firebaseConfig = {
    apiKey: "AIzaSyDPwcRipMP9Rq5Psz5BfpaU0GUx9baMvB0",
    authDomain: "quiz-mobile-data-retrieval.firebaseapp.com",
    projectId: "quiz-mobile-data-retrieval",
    storageBucket: "quiz-mobile-data-retrieval.firebasestorage.app",
    messagingSenderId: "657827851313",
    appId: "1:657827851313:web:2e11d335387fd66166b910"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
