// Site-wide admin identity — one Google Sign-In (bladeinferior.hc@gmail.com)
// that unlocks every admin-only feature across collection-hub, quizhub, and
// adminhub, replacing the old "manually paste a secret into localStorage via
// devtools" (exportAuthKey) approach. Signing in on a device is a normal
// Google sign-in, so it works the same way on any device/browser — no more
// copying a key around.
//
// Pure state/API, no DOM side effects — safe to import from any page,
// including adminhub, which has its own richer page-level gate + session
// pill (adminhub/auth.js) built on top of these same exports. Pages that
// want the generic bottom-right widget instead should load admin-auth.js
// (which wraps this file and self-mounts that widget) via a <script> tag.
import { auth, googleProvider } from './firebase-config.js';
import {
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    setPersistence,
    indexedDBLocalPersistence,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';

export { auth };

// Change this (and the matching Firestore security rules / Cloudflare
// Worker check) if the owner ever needs to sign in with a different account.
export const OWNER_EMAIL = 'bladeinferior.hc@gmail.com';

let currentUser = null;
let firstStateResolved = false;
const listeners = new Set();

export function isAdminUser(user) {
    return !!(user && user.email === OWNER_EMAIL);
}

export function isSignedInAsAdmin() {
    return isAdminUser(currentUser);
}

export function getCurrentUser() {
    return currentUser;
}

// Resolves once Firebase's persisted-session check has completed (with the
// resulting admin state) — for a one-off "am I the admin" check on load
// (e.g. deciding whether to reveal a button) rather than reacting live.
let readyResolve;
export const adminReady = new Promise(resolve => { readyResolve = resolve; });

// For UI that needs to react live (e.g. the admin tab appearing/disappearing
// the moment sign-in state changes, not just at page load). Returns an
// unsubscribe function. Calls back immediately with the current state if
// the initial check has already resolved.
export function onAdminStateChange(callback) {
    listeners.add(callback);
    if (firstStateResolved) callback(isSignedInAsAdmin(), currentUser);
    return () => listeners.delete(callback);
}

// The token to send to anything that needs server-side proof of identity
// (e.g. the Cloudflare export Worker, via an `Authorization: Bearer <token>`
// header) — null if not signed in as the owner. The Worker verifies this JWT
// itself; nothing client-side "authorizes" it, this just hands over proof.
export async function getAdminIdToken() {
    if (!isSignedInAsAdmin()) return null;
    return currentUser.getIdToken();
}

// signInWithPopup's window.open()-based flow is unreliable on mobile
// browsers and installed PWAs — it's often blocked outright or gets treated
// as a top-level navigation away from the page, which can strand the user
// back on the calling page before they ever finish picking an account.
// Redirect the whole page to Google instead on those, and pick the result
// back up via getRedirectResult() below once the browser returns here.
function isMobileBrowser() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || window.matchMedia('(display-mode: standalone)').matches;
}

// signInWithRedirect() has to survive a full navigation away to Google and
// back, so the "we're in the middle of a redirect" state it relies on needs
// to be written somewhere durable across that navigation — but getAuth()
// can silently fall back to in-memory persistence in some mobile contexts
// (private browsing, certain WebViews, storage-partitioned browsers), which
// doesn't survive leaving the page at all. That produces exactly "the
// auth handler flashes and bounces straight back before the account picker
// ever shows" (Google's chooser is never reached, because Firebase's own
// handler page found no pending redirect to resume). Pin it to indexedDB
// explicitly before the redirect starts so the round trip has something to
// come back to.
export function signInAdmin() {
    if (isMobileBrowser()) {
        return setPersistence(auth, indexedDBLocalPersistence)
            .catch(() => {}) // fall through to the redirect attempt either way
            .then(() => signInWithRedirect(auth, googleProvider));
    }
    return signInWithPopup(auth, googleProvider);
}

export function signOutAdmin() {
    return signOut(auth);
}

// Surfaces a signInWithRedirect() error (e.g. the user backed out of the
// Google account chooser) once the browser navigates back here — resolved
// once at module load, mirroring adminReady's one-shot pattern. Consumed by
// admin-auth.js's widget to show the same error UI a failed popup would.
export const redirectResultReady = getRedirectResult(auth).catch(err => {
    console.error('Redirect sign-in failed:', err);
    throw err;
});

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (!firstStateResolved) {
        firstStateResolved = true;
        readyResolve(isSignedInAsAdmin());
    }
    listeners.forEach(cb => cb(isSignedInAsAdmin(), user));
});
