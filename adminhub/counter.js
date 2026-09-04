import { requireAdminAuth } from './auth.js';

const STORAGE_CURRENT = 'streamCounterCurrent';
const STORAGE_TOTAL = 'streamCounterTotal';

// localStorage.getItem() returns null (not undefined) when unset, and
// Number(null) is 0 — a value that would otherwise pass the validity check
// below, so the "first ever load" case is handled separately here rather
// than folded into that check.
const storedCurrent = localStorage.getItem(STORAGE_CURRENT);
const storedTotal = localStorage.getItem(STORAGE_TOTAL);
let current = storedCurrent === null ? 737 : Number(storedCurrent);
let total = storedTotal === null ? 1034 : Number(storedTotal);
if (!Number.isInteger(current) || current < 0) current = 737;
if (!Number.isInteger(total) || total < 0) total = 1034;

let generating = false;

const currentEl = document.getElementById('counter-current');
const totalEl = document.getElementById('counter-total');
const statusEl = document.getElementById('counter-status');
const minusBtn = document.getElementById('counter-minus');
const plusBtn = document.getElementById('counter-plus');
const setForm = document.getElementById('counter-set-form');
const setSubmitBtn = setForm.querySelector('button[type="submit"]');
const setCurrentInput = document.getElementById('counter-set-current');
const setTotalInput = document.getElementById('counter-set-total');

function render() {
    currentEl.textContent = current;
    totalEl.textContent = total;
    setCurrentInput.value = current;
    setTotalInput.value = total;
}

function setStatus(text, isError = false) {
    statusEl.textContent = `Status: ${text}`;
    statusEl.classList.toggle('counter-status-error', isError);
}

function setButtonsDisabled(disabled) {
    minusBtn.disabled = disabled;
    plusBtn.disabled = disabled;
    setSubmitBtn.disabled = disabled;
}

// The displayed number only ever moves after the backend confirms Textcraft
// generated the image and it was written to disk — otherwise the panel
// would say e.g. 738 while the stream is still showing 737.
async function generate(newCurrent, newTotal) {
    if (generating) return;

    if (!Number.isInteger(newCurrent) || newCurrent < 0 || !Number.isInteger(newTotal) || newTotal < 0) {
        setStatus('Enter valid non-negative whole numbers.', true);
        return;
    }

    generating = true;
    setButtonsDisabled(true);
    setStatus('Generating…');

    try {
        const response = await fetch('/api/generate-counter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: newCurrent, total: newTotal }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok || !result || !result.success) {
            throw new Error((result && result.error) || `Server responded with ${response.status}`);
        }

        current = newCurrent;
        total = newTotal;
        localStorage.setItem(STORAGE_CURRENT, String(current));
        localStorage.setItem(STORAGE_TOTAL, String(total));
        render();
        setStatus('Updated');
    } catch (err) {
        console.error(err);
        setStatus(`Failed to generate image — current image was not changed. (${err.message})`, true);
    } finally {
        generating = false;
        setButtonsDisabled(false);
    }
}

minusBtn.addEventListener('click', () => generate(current - 1, total));
plusBtn.addEventListener('click', () => generate(current + 1, total));

setForm.addEventListener('submit', (e) => {
    e.preventDefault();
    generate(Number(setCurrentInput.value), Number(setTotalInput.value));
});

render();

requireAdminAuth().then(() => {
    document.getElementById('admin-content').classList.remove('hidden');
});
