// Wraps admin-auth-core.js with a self-mounting bottom-right sign-in/status
// widget — load this via a <script type="module"> tag on any page that
// wants the generic widget (everywhere except adminhub, which mounts its
// own richer page-gate + pill on top of admin-auth-core.js directly, so it
// doesn't end up with two competing sign-in UIs).
export * from './admin-auth-core.js';
import { onAdminStateChange, signInAdmin, signOutAdmin } from './admin-auth-core.js';

function mountWidget() {

    if (document.getElementById('admin-auth-widget')) return;

    const style = document.createElement('style');
    style.textContent = `
        #admin-auth-widget {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 6000;
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: Arial, sans-serif;
            font-size: 13px;
        }

        #admin-auth-widget button {
            font-family: inherit;
            font-size: 13px;
            cursor: pointer;
            border-radius: 20px;
            padding: 8px 16px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(20, 20, 20, 0.85);
            color: #fff;
            backdrop-filter: blur(6px);
            transition: 0.15s ease;
            white-space: nowrap;
        }

        #admin-auth-widget button:hover:not(:disabled) {
            border-color: #86efac;
            background: rgba(30, 30, 30, 0.9);
        }

        #admin-auth-widget button:disabled {
            opacity: 0.6;
            cursor: default;
        }

        #admin-auth-widget .gaa-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            border-radius: 20px;
            padding: 6px 8px 6px 14px;
            background: rgba(20, 20, 20, 0.85);
            border: 1px solid rgba(134, 239, 172, 0.5);
            backdrop-filter: blur(6px);
            color: #fff;
        }

        #admin-auth-widget .gaa-pill.gaa-wrong-account {
            border-color: rgba(248, 113, 113, 0.6);
        }

        #admin-auth-widget .gaa-pill span {
            color: #86efac;
            font-weight: bold;
        }

        #admin-auth-widget .gaa-pill.gaa-wrong-account span {
            color: #f87171;
            font-weight: normal;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        #admin-auth-widget .gaa-pill button {
            padding: 4px 10px;
            font-size: 12px;
            border-radius: 14px;
        }

        #admin-auth-widget .gaa-error {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 8px;
            background: rgba(20, 20, 20, 0.95);
            border: 1px solid #f87171;
            color: #f87171;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            max-width: 240px;
            white-space: normal;
        }

        @media (max-width: 480px) {
            #admin-auth-widget {
                bottom: 10px;
                right: 10px;
            }
        }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'admin-auth-widget';
    widget.style.position = 'fixed';
    document.body.appendChild(widget);

    function render(isAdmin, user) {

        widget.innerHTML = '';

        if (isAdmin) {
            const pill = document.createElement('div');
            pill.className = 'gaa-pill';

            const label = document.createElement('span');
            label.textContent = '✓ Harry';

            const signOutBtn = document.createElement('button');
            signOutBtn.type = 'button';
            signOutBtn.textContent = 'Sign out';
            signOutBtn.addEventListener('click', () => signOutAdmin());

            pill.appendChild(label);
            pill.appendChild(signOutBtn);
            widget.appendChild(pill);
            return;
        }

        if (user) {
            // Signed in, but not the owner account.
            const pill = document.createElement('div');
            pill.className = 'gaa-pill gaa-wrong-account';

            const label = document.createElement('span');
            label.textContent = user.email;
            label.title = `Signed in as ${user.email} — not authorized`;

            const signOutBtn = document.createElement('button');
            signOutBtn.type = 'button';
            signOutBtn.textContent = 'Sign out';
            signOutBtn.addEventListener('click', () => signOutAdmin());

            pill.appendChild(label);
            pill.appendChild(signOutBtn);
            widget.appendChild(pill);
            return;
        }

        const signInBtn = document.createElement('button');
        signInBtn.type = 'button';
        signInBtn.textContent = '🔒 Admin Sign-In';

        signInBtn.addEventListener('click', async () => {
            signInBtn.disabled = true;
            clearError();
            try {
                await signInAdmin();
            } catch (err) {
                console.error(err);
                showError(`Sign-in failed (${err.code || err.message}) — try again.`);
            } finally {
                signInBtn.disabled = false;
            }
        });

        widget.appendChild(signInBtn);
    }

    function showError(message) {
        clearError();
        const err = document.createElement('div');
        err.className = 'gaa-error';
        err.textContent = message;
        widget.appendChild(err);
    }

    function clearError() {
        const existing = widget.querySelector('.gaa-error');
        if (existing) existing.remove();
    }

    onAdminStateChange((isAdmin, user) => render(isAdmin, user));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWidget);
} else {
    mountWidget();
}
