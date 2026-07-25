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

export function signInAdmin() {
    return signInWithPopup(auth, googleProvider);
}

export function signOutAdmin() {
    return signOut(auth);
}

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (!firstStateResolved) {
        firstStateResolved = true;
        readyResolve(isSignedInAsAdmin());
    }
    listeners.forEach(cb => cb(isSignedInAsAdmin(), user));
});
