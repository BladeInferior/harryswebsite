// Gates every admin-hub page behind Google Sign-In. This is only half the
// story client-side — the real enforcement is the Firestore security rule
// on the `notes` collection (and anything else added here later), which
// must require request.auth.token.email == OWNER_EMAIL too. Without that
// rule, this overlay is just a UI nicety, not actual privacy — anyone could
// still read/write notes directly via the Firestore SDK.
import { auth, googleProvider } from './firebase/firebase-config.js';
import {
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';

// Change this (and the matching Firestore rule) if you ever want to sign in
// with a different Google account.
const OWNER_EMAIL = "bladeinferior.hc@gmail.com";

// Resolves once with the signed-in user, the first time the account
// actually matches OWNER_EMAIL. Keeps listening after that so the gate
// re-covers the page if you sign out later (e.g. via the session pill).
export function requireAdminAuth() {
    return new Promise(resolve => {
        let resolved = false;

        const gate = document.createElement('div');
        gate.id = 'admin-auth-gate';
        // Starts hidden — Firebase's persisted-session check is async, so
        // without this the gate would flash visible for a moment on every
        // load even when already signed in, before the first
        // onAuthStateChanged callback below has a chance to hide it again.
        gate.classList.add('hidden');
        gate.innerHTML = `
            <div class="admin-auth-box">
                <h2>🔒 Admin Access</h2>
                <p>This area is just for me — sign in with Google to continue.</p>
                <button type="button" id="admin-google-signin">Sign in with Google</button>
                <p id="admin-auth-error" class="admin-auth-error hidden"></p>
            </div>
        `;
        document.body.appendChild(gate);

        const signInBtn = gate.querySelector('#admin-google-signin');
        const errorEl = gate.querySelector('#admin-auth-error');

        signInBtn.addEventListener('click', async () => {
            errorEl.classList.add('hidden');
            signInBtn.disabled = true;
            try {
                if (auth.currentUser) {
                    await signOut(auth);
                } else {
                    await signInWithPopup(auth, googleProvider);
                }
            } catch (err) {
                console.error(err);
                errorEl.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
                errorEl.classList.remove('hidden');
            } finally {
                signInBtn.disabled = false;
            }
        });

        onAuthStateChanged(auth, user => {
            const authorized = !!(user && user.email === OWNER_EMAIL);

            gate.classList.toggle('hidden', authorized);

            if (user && !authorized) {
                errorEl.textContent =
                    `Signed in as ${user.email}, which isn't authorized for this. Sign out and try a different account.`;
                errorEl.classList.remove('hidden');
                signInBtn.textContent = 'Sign out';
            } else {
                errorEl.classList.add('hidden');
                signInBtn.textContent = 'Sign in with Google';
            }

            if (authorized) {
                showSessionPill(user);
                if (!resolved) {
                    resolved = true;
                    resolve(user);
                }
            } else {
                removeSessionPill();
            }
        });
    });
}

function showSessionPill(user) {
    if (document.getElementById('admin-session-pill')) return;

    const pill = document.createElement('div');
    pill.id = 'admin-session-pill';
    pill.innerHTML = `
        <span>${user.email}</span>
        <button type="button">Sign out</button>
    `;
    pill.querySelector('button').addEventListener('click', () => signOut(auth));

    document.body.appendChild(pill);
}

function removeSessionPill() {
    const pill = document.getElementById('admin-session-pill');
    if (pill) pill.remove();
}
