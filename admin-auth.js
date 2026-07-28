// Wraps admin-auth-core.js with a self-mounting bottom-right sign-in/status
// widget — load this via a <script type="module"> tag on any page that
// wants the generic widget (everywhere except adminhub, which mounts its
// own richer page-gate + pill on top of admin-auth-core.js directly, so it
// doesn't end up with two competing sign-in UIs).
export * from './admin-auth-core.js';
import { onAdminStateChange, signInAdmin, signOutAdmin, redirectResultReady } from './admin-auth-core.js';

// Matches each hub's existing navbar theme accent (see .site-nav.*-theme in
// ../navbar.css) so the widget doesn't look like a foreign element bolted
// onto the page — determined from the URL rather than waiting on the
// navbar's own async fetch()-and-inject, which may not have finished (or
// even started) by the time this widget first renders. The rgb triplet
// alongside each hex is for the pill button's tinted background (see
// --gaa-accent-rgb below) — same rgba()-from-hex pattern collection-hub's
// own style.css already uses for --accent/--accent-rgb.
// Each hub's *strong* navbar shade, not its paler one (e.g. quiz-theme's
// logo is the paler #c084fc, but its actual interactive/hover fill is the
// more saturated #a855f7; same split for admin-theme's #f87171 logo vs
// #ef4444 hover) — collection-theme and home-theme only ever had one shade
// to begin with. Using the strong tier here is what makes this widget's
// pill match adminhub's own #admin-session-pill in color strength, which
// also always uses its strong --accent (#ef4444), not --accent-light.
function getPageAccent() {
    const path = window.location.pathname;
    if (path.includes('/collection-hub/')) return { hex: '#4ade80', rgb: '74, 222, 128' };   // collection-theme
    if (path.includes('/quizhub/')) return { hex: '#a855f7', rgb: '168, 85, 247' };           // quiz-theme
    if (path.includes('/adminhub/')) return { hex: '#ef4444', rgb: '239, 68, 68' };           // admin-theme
    return { hex: '#d4af37', rgb: '212, 175, 55' };                                           // home-theme
}

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
            font-size: 12px;
        }

        #admin-auth-widget button {
            font-family: inherit;
            font-size: 12px;
            cursor: pointer;
            border-radius: 999px;
            padding: 8px 16px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(20, 20, 20, 0.85);
            color: #fff;
            backdrop-filter: blur(6px);
            transition: 0.15s ease;
            white-space: nowrap;
        }

        #admin-auth-widget button:hover:not(:disabled) {
            border-color: var(--gaa-accent, #86efac);
            background: rgba(30, 30, 30, 0.9);
        }

        #admin-auth-widget button:disabled {
            opacity: 0.6;
            cursor: default;
        }

        #admin-auth-widget .gaa-pill {
            display: flex;
            align-items: center;
            gap: 10px;
            border-radius: 999px;
            padding: 6px 8px 6px 14px;
            background: rgba(20, 20, 20, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.15);
            /* Matches adminhub's own #admin-session-pill exactly (same
               padding/gap/radius/shadow, no blur) so the signed-in pill is
               identical in size, shape and position everywhere — only the
               accent color varies per page. */
            box-shadow: 0 4px 16px rgba(0, 0, 0, .4);
            color: #bdbdbd;
        }

        #admin-auth-widget .gaa-pill.gaa-wrong-account {
            border-color: rgba(248, 113, 113, 0.5);
        }

        #admin-auth-widget .gaa-pill.gaa-wrong-account span {
            color: #f87171;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        #admin-auth-widget .gaa-pill button {
            padding: 5px 12px;
            font-size: 12px;
            border-radius: 999px;
            border-color: var(--gaa-accent, #86efac);
            /* Tinted by default (not just on hover) — matches adminhub's own
               #admin-session-pill button (adminhub/style.css), which always
               has a faint tinted fill even before hovering. */
            background: rgba(var(--gaa-accent-rgb, 134, 239, 172), 0.15);
            color: var(--gaa-accent, #86efac);
        }

        #admin-auth-widget .gaa-pill button:hover:not(:disabled) {
            background: var(--gaa-accent, #86efac);
            color: #14161a;
        }

        /* Wrong-account state stays a universal warning red regardless of
           page theme — unlike the signed-in-correctly state, this shouldn't
           blend in, it should stand out as "something's wrong here". */
        #admin-auth-widget .gaa-pill.gaa-wrong-account button {
            border-color: #f87171;
            background: rgba(248, 113, 113, 0.15);
            color: #f87171;
        }

        #admin-auth-widget .gaa-pill.gaa-wrong-account button:hover:not(:disabled) {
            background: #f87171;
            color: #14161a;
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

        /* Same positioning as .gaa-error, but a neutral heads-up rather than
           a failure — installed/standalone PWAs are a known-fragile
           combination with Google's redirect sign-in flow (the OAuth
           handoff can lose the app's session entirely), so this warns
           upfront instead of just failing silently later. */
        #admin-auth-widget .gaa-standalone-notice {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 8px;
            background: rgba(20, 20, 20, 0.95);
            border: 1px solid #f1c40f;
            color: #f1c40f;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            max-width: 220px;
            white-space: normal;
        }

        @media (max-width: 480px) {
            #admin-auth-widget {
                bottom: 10px;
                right: 10px;
            }

            /* The full "🔒 Admin Sign-In" label eats a big chunk of a phone
               screen's width sitting bottom-right — collapse it down to just
               the lock icon there; the label still reads fine as a title
               attribute (tooltip) and returns once the screen is wide enough. */
            #admin-auth-widget .gaa-signin-label {
                display: none;
            }

            #admin-auth-widget .gaa-signin-btn {
                padding: 8px 10px;
                font-size: 16px;
            }
        }
    `;
    document.head.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'admin-auth-widget';
    widget.style.position = 'fixed';
    const pageAccent = getPageAccent();
    widget.style.setProperty('--gaa-accent', pageAccent.hex);
    widget.style.setProperty('--gaa-accent-rgb', pageAccent.rgb);
    document.body.appendChild(widget);

    function render(isAdmin, user) {

        widget.innerHTML = '';

        if (isAdmin) {
            const pill = document.createElement('div');
            pill.className = 'gaa-pill';

            const label = document.createElement('span');
            label.textContent = 'Harry';

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
        signInBtn.className = 'gaa-signin-btn';
        signInBtn.title = 'Admin Sign-In';
        signInBtn.innerHTML = '🔒<span class="gaa-signin-label"> Admin Sign-In</span>';

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

        // Installed/standalone PWAs (Add to Home Screen) are a known-fragile
        // combination with Google's redirect sign-in flow — the OAuth
        // handoff can lose the installed app's session entirely and bounce
        // back before the account picker ever appears, with no reliable
        // client-side fix (it's a platform-level context switch, not
        // something retryable in JS). Warn upfront rather than leave it
        // looking broken with no explanation.
        if (window.matchMedia('(display-mode: standalone)').matches) {
            const notice = document.createElement('div');
            notice.className = 'gaa-standalone-notice';
            notice.textContent = "Sign-in can fail in the installed app — if it kicks you back out, open this site in your regular browser (not the home screen icon) to sign in instead.";
            widget.appendChild(notice);
        }
    }

    function showError(message) {
        clearError();

        // Both sit at the same position: absolute / bottom: 100% spot above
        // the widget — hide the standalone notice while an error is up so
        // they don't render on top of each other; clearError() below brings
        // it back.
        const notice = widget.querySelector('.gaa-standalone-notice');
        if (notice) notice.style.display = 'none';

        const err = document.createElement('div');
        err.className = 'gaa-error';
        err.textContent = message;
        widget.appendChild(err);
    }

    function clearError() {
        const existing = widget.querySelector('.gaa-error');
        if (existing) existing.remove();

        const notice = widget.querySelector('.gaa-standalone-notice');
        if (notice) notice.style.display = '';
    }

    // Surfaces a failed signInWithRedirect() (mobile) the same way a failed
    // signInWithPopup() (desktop) already is — the widget doesn't render
    // this itself, so the error only shows if render() has already put a
    // sign-in button (or anything else) on screen for it to attach to.
    redirectResultReady.catch(err => showError(`Sign-in failed (${err.code || err.message}) — try again.`));

    onAdminStateChange((isAdmin, user) => render(isAdmin, user));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWidget);
} else {
    mountWidget();
}
