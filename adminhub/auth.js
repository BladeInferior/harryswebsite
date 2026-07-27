// Gates every admin-hub page behind Google Sign-In. This is only half the
// story client-side — the real enforcement is the Firestore security rule
// on the `notes` collection (and anything else added here later), which
// must require request.auth.token.email == OWNER_EMAIL too. Without that
// rule, this overlay is just a UI nicety, not actual privacy — anyone could
// still read/write notes directly via the Firestore SDK.
//
// Built on top of the site-wide ../admin-auth-core.js (same module the
// bottom-right widget on every other page uses) rather than its own
// Firebase wiring, so signing in here also satisfies that widget (and
// admin-gate.js's per-action prompts in quizhub) in the same browser, and
// vice versa. Keeps its own richer page-level gate + session pill UI here
// instead of the generic widget, since a whole-page lockout needs more than
// a small sign-in button.
import { signInAdmin, signOutAdmin, onAdminStateChange, getCurrentUser, redirectResultReady } from '../admin-auth-core.js';

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
        // onAdminStateChange callback below has a chance to hide it again.
        gate.classList.add('hidden');
        gate.innerHTML = `
            <div class="admin-auth-box">
                <h2>🔒 Admin Access</h2>
                <p>This area is just for me — sign in with Google to continue.</p>
                <button type="button" id="admin-google-signin">Sign in with Google</button>
                <p id="admin-auth-error" class="admin-auth-error hidden"></p>
                <a href="../index.html" class="admin-auth-back">← Back to site</a>
            </div>
        `;
        document.body.appendChild(gate);

        const signInBtn = gate.querySelector('#admin-google-signin');
        const errorEl = gate.querySelector('#admin-auth-error');

        // Surfaces a failed signInWithRedirect() (mobile) the same way a
        // failed signInWithPopup() (desktop) already is via the catch block
        // below.
        redirectResultReady.catch(err => {
            console.error(err);
            errorEl.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
            errorEl.classList.remove('hidden');
        });

        signInBtn.addEventListener('click', async () => {
            errorEl.classList.add('hidden');
            signInBtn.disabled = true;
            try {
                if (getCurrentUser()) {
                    await signOutAdmin();
                } else {
                    await signInAdmin();
                }
            } catch (err) {
                console.error(err);
                errorEl.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
                errorEl.classList.remove('hidden');
            } finally {
                signInBtn.disabled = false;
            }
        });

        onAdminStateChange((authorized, user) => {
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
        <span>Harry</span>
        <button type="button">Sign out</button>
    `;
    pill.querySelector('button').addEventListener('click', () => signOutAdmin());

    document.body.appendChild(pill);
}

function removeSessionPill() {
    const pill = document.getElementById('admin-session-pill');
    if (pill) pill.remove();
}
