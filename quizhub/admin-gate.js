// Gates specific admin-only actions (Delete Quiz, Add Manual Entry, the
// Delete Players/Delete Quiz Results admin tools) behind Google Sign-In,
// without putting the whole page behind a login wall like the Admin Hub
// does — hosts still need Manage Quizzes/Stats wide open. Built on top of
// the site-wide ../admin-auth-core.js (same module the bottom-right widget
// on every other page uses), so signing in there also satisfies this gate
// in the same browser, and vice versa.
import { OWNER_EMAIL, isSignedInAsAdmin, signInAdmin, adminReady } from '../admin-auth-core.js';

// Resolves true once signed in as the owner (immediately if already signed
// in), or false if the user cancels the prompt.
export async function ensureAdminSignedIn(actionLabel) {
    await adminReady;
    if (isSignedInAsAdmin()) return true;

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'admin-gate-overlay';
        overlay.innerHTML = `
            <div class="admin-gate-box">
                <h2>🔒 Admin Sign-In Required</h2>
                <p>${actionLabel || 'This action'} is admin-only — sign in with Google to continue.</p>
                <p class="admin-gate-error" hidden></p>
                <div class="admin-gate-buttons">
                    <button type="button" class="btn admin-gate-signin">Sign in with Google</button>
                    <button type="button" class="btn btn-secondary admin-gate-cancel">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const errorEl = overlay.querySelector('.admin-gate-error');
        const signInBtn = overlay.querySelector('.admin-gate-signin');

        function close(result) {
            overlay.remove();
            resolve(result);
        }

        overlay.querySelector('.admin-gate-cancel').addEventListener('click', () => close(false));
        overlay.addEventListener('click', e => {
            if (e.target === overlay) close(false);
        });

        signInBtn.addEventListener('click', async () => {
            errorEl.hidden = true;
            signInBtn.disabled = true;
            try {
                const result = await signInAdmin();
                if (result.user.email === OWNER_EMAIL) {
                    close(true);
                } else {
                    errorEl.textContent = `Signed in as ${result.user.email}, which isn't authorized for this — try a different account.`;
                    errorEl.hidden = false;
                }
            } catch (err) {
                console.error(err);
                errorEl.textContent = `Something went wrong (${err.code || err.message}) — try again.`;
                errorEl.hidden = false;
            } finally {
                signInBtn.disabled = false;
            }
        });
    });
}
