// Single shared Firebase app instance for the whole site (collection-hub,
// quizhub, adminhub all point here now, directly or via their old
// firebase/firebase-config.js re-export shims) — initializeApp() throws if
// called more than once with the same (default) name, so every page that
// might load more than one of these modules together (which admin-auth.js
// now does, site-wide) needs them all resolving to this one module instance.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

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
export const storage = getStorage(app);
