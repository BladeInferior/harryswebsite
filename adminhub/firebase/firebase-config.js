// Same Firebase project as quizhub/firebase/firebase-config.js — this app
// just also pulls in Auth, since the admin hub is gated by Google Sign-In
// rather than being wide open like the quiz collections.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

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
