// Single shared Firebase app instance for the whole site (collection-hub,
// quizhub, adminhub all point here now, directly or via their old
// firebase/firebase-config.js re-export shims) — initializeApp() throws if
// called more than once with the same (default) name, so every page that
// might load more than one of these modules together (which admin-auth.js
// now does, site-wide) needs them all resolving to this one module instance.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, initializeFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
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

// Quiz Hub pages run live sessions across phones, often through a tunnel or
// mobile network, where Firestore's default streaming connection can stall: the
// page then only sees changes after it makes a write of its own (a host player's
// phone not following the main screen until they tapped something). Long polling
// is slower to start but doesn't stall, so the quiz pages use it. Everything
// else on the site keeps the default connection.
export const db = window.location.pathname.includes('/quizhub/')
    ? initializeFirestore(app, { experimentalForceLongPolling: true })
    : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const storage = getStorage(app);
