import { db } from '../firebase/firebase-config.js';
import { collection, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { embedUrl, normalizeEmbedInput } from '../slides/slides-flow.js';

const $ = id => document.getElementById(id);

const titleInput = $('title-input');
const descInput = $('desc-input');
const embedInput = $('embed-input');
const countInput = $('count-input');
const revealInput = $('reveal-input');
const homeInput = $('home-input');
const thumbsToggle = $('thumbs-toggle');
const slideListEl = $('slide-list');
const stageFrame = $('stage-frame');
const drawLayer = $('draw-layer');
const typeInput = $('type-input');
const nextInput = $('next-input');
const saveBtn = $('save-btn');
const saveStatus = $('save-status');

// One entry per slide. q holds the editable question form for question slides.
let items = [];
let selected = 1;
let existingPasswordHash = null;

const params = new URLSearchParams(window.location.search);
const quizIdParam = params.get('quiz');
let activeQuizId = quizIdParam;

function blankItem(n) {
    return {
        n,
        type: 'plain',
        next: null,
        answerFor: null,
        hotspots: [],
        q: {
            qtype: 'text', points: 1, prompt: '', explanation: '',
            accepted: '', numMode: 'exact', numExact: '', numMin: '', numMax: '',
            mcOptions: [{ label: '' }, { label: '' }], mcCorrect: 0
        }
    };
}

function itemFor(n) {
    return items.find(i => i.n === n);
}

// ---------------------------------------------------------------------
// load
// ---------------------------------------------------------------------

init();

async function init() {
    if (quizIdParam) {
        $('back-button-link').href = '../manage-quizzes/manage-quizzes.html';
        const snap = await getDoc(doc(db, 'quizzes', quizIdParam));
        if (snap.exists()) {
            const quiz = snap.data();
            existingPasswordHash = quiz.editPasswordHash || null;
            titleInput.value = quiz.title || '';
            descInput.value = quiz.description || '';

            if (quiz.kind === 'slides' && quiz.slides) {
                loadFromQuiz(quiz);
                return;
            }
            // A normal quiz being converted: keep name/description only.
            if ((quiz.questions || []).length) $('convert-warning').hidden = false;
        }
    } else {
        try {
            const draft = JSON.parse(sessionStorage.getItem('slidesQuizDraft') || 'null');
            if (draft) {
                titleInput.value = draft.title || '';
                descInput.value = draft.description || '';
            }
        } catch (err) { /* no draft */ }
    }

    resizeItems(Number(countInput.value) || 10);
    renderAll();
}

function loadFromQuiz(quiz) {
    const s = quiz.slides;
    embedInput.value = s.embedUrl || '';
    countInput.value = s.count;
    revealInput.value = s.revealMode || 'immediate';

    items = [];
    for (let n = 1; n <= s.count; n++) {
        const saved = s.items.find(i => i.n === n);
        const item = blankItem(n);
        if (saved) {
            item.type = saved.type;
            item.next = saved.next || null;
            item.answerFor = saved.answerFor || null;
            item.hotspots = (saved.hotspots || []).map(h => ({ ...h }));
            if (saved.type === 'question' && saved.questionIndex != null) {
                const question = quiz.questions[saved.questionIndex];
                if (question) item.q = questionToForm(question);
            }
        }
        items.push(item);
    }

    renderAll();
    homeInput.value = String(s.homeSlide || 1);
}

function questionToForm(question) {
    const q = blankItem(0).q;
    q.points = question.points;
    q.prompt = question.prompt && !question.prompt.startsWith('Question ') ? question.prompt : (question.prompt || '');
    q.explanation = question.explanation || '';
    q.qtype = question.type;

    if (question.type === 'text') {
        q.accepted = question.config.acceptedAnswers.join(', ');
    } else if (question.type === 'number') {
        q.numMode = question.config.mode || 'exact';
        q.numExact = question.config.correctValue ?? '';
        q.numMin = question.config.min ?? '';
        q.numMax = question.config.max ?? '';
    } else if (question.type === 'multiple-choice') {
        q.mcOptions = question.config.options.map(o => ({ label: o.label }));
        q.mcCorrect = Math.max(0, question.config.options.findIndex(o => o.id === question.config.correctOptionId));
    }
    return q;
}

function resizeItems(count) {
    count = Math.max(1, Math.min(300, count));
    while (items.length < count) items.push(blankItem(items.length + 1));
    items.length = count;
    if (selected > count) selected = count;
}

// ---------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------

function renderAll() {
    renderHomeOptions();
    renderSlideList();
    renderPanel();
    $('slide-total').textContent = `${items.length}`;
    refreshMissing();
}

function renderHomeOptions() {
    const current = homeInput.value;
    homeInput.innerHTML = '';
    items.forEach(i => {
        const o = document.createElement('option');
        o.value = String(i.n);
        o.textContent = i.type === 'board' ? `Slide ${i.n} (board)` : `Slide ${i.n}`;
        homeInput.appendChild(o);
    });
    // Keep the current choice; otherwise slide 1 (the usual home screen).
    homeInput.value = [...homeInput.options].some(o => o.value === current) ? current : '1';
}

const TYPE_TEXT = {
    plain: 'Plain',
    board: 'Board (touchable)',
    question: 'Question',
    answer: 'Answer'
};

let thumbObserver = null;

function renderSlideList() {
    slideListEl.innerHTML = '';
    if (thumbObserver) thumbObserver.disconnect();

    thumbObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const holder = entry.target;
            thumbObserver.unobserve(holder);
            const url = embedUrl(embedInput.value, holder.dataset.n);
            if (!url) return;
            const frame = document.createElement('iframe');
            frame.loading = 'lazy';
            frame.src = url;
            holder.appendChild(frame);
        });
    }, { root: slideListEl, rootMargin: '200px' });

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'slide-row' + (item.n === selected ? ' selected' : '');

        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb';
        thumb.dataset.n = item.n;
        const num = document.createElement('div');
        num.className = 'num';
        num.textContent = item.n;
        thumb.appendChild(num);
        if (thumbsToggle.checked && normalizeEmbedInput(embedInput.value)) thumbObserver.observe(thumb);

        const meta = document.createElement('div');
        meta.className = 'meta';
        const select = document.createElement('select');
        Object.entries(TYPE_TEXT).forEach(([value, text]) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = text;
            select.appendChild(o);
        });
        select.value = item.type;
        select.addEventListener('click', e => e.stopPropagation());
        select.addEventListener('change', () => {
            setType(item, select.value);
            renderAll();
        });

        const badge = document.createElement('div');
        badge.className = 'type-badge';
        badge.textContent = item.next ? `then → slide ${item.next}` : '';

        meta.append(select, badge);
        row.append(thumb, meta);
        row.addEventListener('click', () => {
            selected = item.n;
            renderSlideList();
            renderPanel();
        });
        slideListEl.appendChild(row);
    });

    const sel = slideListEl.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function setType(item, type) {
    item.type = type;
    if (type !== 'board') item.hotspots = [];
    if (type !== 'answer') item.answerFor = null;
}

let lastStageSlide = null;

function renderPanel() {
    const item = itemFor(selected);
    if (!item) return;

    $('panel-title').textContent = `Slide ${item.n}`;
    typeInput.value = item.type;
    nextInput.value = item.next || '';
    $('answerfor-field').hidden = item.type !== 'answer';
    $('answerfor-input').value = item.answerFor || '';

    const url = embedUrl(embedInput.value, item.n);
    const key = url;
    if (key !== lastStageSlide) {
        stageFrame.src = url || 'about:blank';
        lastStageSlide = key;
    }

    const isBoard = item.type === 'board';
    drawLayer.hidden = !isBoard;
    $('board-card').hidden = !isBoard;
    $('question-card').hidden = item.type !== 'question';
    $('stage-hint').textContent = isBoard
        ? 'Drag on the slide to draw a touchable area.'
        : (url ? '' : 'Paste your embed link above to see the slides.');

    renderHotspots(item);
    if (item.type === 'question') renderQuestionForm(item);
}

// ---------------------------------------------------------------------
// hotspots
// ---------------------------------------------------------------------

function renderHotspots(item) {
    drawLayer.innerHTML = '';
    item.hotspots.forEach((h, i) => {
        const box = document.createElement('div');
        box.className = 'hotspot-box';
        box.style.cssText = `left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%`;
        box.textContent = h.label || `Option ${i + 1}`;
        drawLayer.appendChild(box);
    });

    const list = $('hotspot-list');
    list.innerHTML = '';
    item.hotspots.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'hotspot-row';

        const label = document.createElement('input');
        label.type = 'text';
        label.placeholder = `Option ${i + 1} name`;
        label.value = h.label || '';
        label.addEventListener('input', () => {
            h.label = label.value;
            drawLayer.children[i].textContent = h.label || `Option ${i + 1}`;
        });

        const target = document.createElement('select');
        target.innerHTML = '<option value="">Goes to…</option>';
        items.forEach(other => {
            if (other.n === item.n) return;
            const o = document.createElement('option');
            o.value = String(other.n);
            o.textContent = `Slide ${other.n}`;
            target.appendChild(o);
        });
        target.value = h.target ? String(h.target) : '';
        target.addEventListener('change', () => { h.target = Number(target.value) || null; });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-danger btn-small';
        del.textContent = '✕';
        del.addEventListener('click', () => {
            item.hotspots.splice(i, 1);
            renderHotspots(item);
        });

        row.append(label, target, del);
        list.appendChild(row);
    });
}

// Drawing a rectangle: pointer events, so it works with a mouse or a finger.
let drawStart = null;
let drawBox = null;

drawLayer.addEventListener('pointerdown', e => {
    if (e.target !== drawLayer) return;
    const rect = drawLayer.getBoundingClientRect();
    drawStart = { x: (e.clientX - rect.left) / rect.width * 100, y: (e.clientY - rect.top) / rect.height * 100 };
    drawBox = document.createElement('div');
    drawBox.className = 'hotspot-box drawing';
    drawLayer.appendChild(drawBox);
    drawLayer.setPointerCapture(e.pointerId);
});

drawLayer.addEventListener('pointermove', e => {
    if (!drawStart) return;
    const r = currentDrawRect(e);
    drawBox.style.cssText = `left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%`;
});

drawLayer.addEventListener('pointerup', e => {
    if (!drawStart) return;
    const r = currentDrawRect(e);
    drawStart = null;
    drawBox.remove();
    drawBox = null;

    // Ignore accidental clicks / tiny drags.
    if (r.w < 2 || r.h < 2) return;

    const item = itemFor(selected);
    item.hotspots.push({
        x: round1(r.x), y: round1(r.y), w: round1(r.w), h: round1(r.h),
        label: '', target: null
    });
    renderHotspots(item);
});

function currentDrawRect(e) {
    const rect = drawLayer.getBoundingClientRect();
    const x2 = Math.min(100, Math.max(0, (e.clientX - rect.left) / rect.width * 100));
    const y2 = Math.min(100, Math.max(0, (e.clientY - rect.top) / rect.height * 100));
    return {
        x: Math.min(drawStart.x, x2),
        y: Math.min(drawStart.y, y2),
        w: Math.abs(x2 - drawStart.x),
        h: Math.abs(y2 - drawStart.y)
    };
}

function round1(v) { return Math.round(v * 10) / 10; }

// ---------------------------------------------------------------------
// question form
// ---------------------------------------------------------------------

function renderQuestionForm(item) {
    const q = item.q;
    refreshMissing();
    $('qtype-input').value = q.qtype;
    $('qpoints-input').value = q.points;
    $('qprompt-input').value = q.prompt;
    $('qexplain-input').value = q.explanation;
    $('qaccepted-input').value = q.accepted;
    $('qnummode-input').value = q.numMode;
    $('qnumexact-input').value = q.numExact;
    $('qnummin-input').value = q.numMin;
    $('qnummax-input').value = q.numMax;

    $('q-text-fields').hidden = q.qtype !== 'text';
    $('q-number-fields').hidden = q.qtype !== 'number';
    $('q-mc-fields').hidden = q.qtype !== 'multiple-choice';
    $('q-num-exact').hidden = q.numMode !== 'exact';
    $('q-num-range').hidden = q.numMode !== 'range';
    $('q-num-range2').hidden = q.numMode !== 'range';

    const list = $('mc-list');
    list.innerHTML = '';
    q.mcOptions.forEach((opt, i) => {
        const row = document.createElement('div');
        row.className = 'hotspot-row';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'mc-correct';
        radio.style.cssText = 'width:auto;flex:0 0 auto;';
        radio.checked = q.mcCorrect === i;
        radio.addEventListener('change', () => { q.mcCorrect = i; });

        const label = document.createElement('input');
        label.type = 'text';
        label.placeholder = `Option ${i + 1}`;
        label.value = opt.label;
        label.addEventListener('input', () => { opt.label = label.value; refreshMissing(); });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-danger btn-small';
        del.textContent = '✕';
        del.disabled = q.mcOptions.length <= 2;
        del.addEventListener('click', () => {
            q.mcOptions.splice(i, 1);
            if (q.mcCorrect >= q.mcOptions.length) q.mcCorrect = 0;
            renderQuestionForm(item);
        });

        row.append(radio, label, del);
        list.appendChild(row);
    });
}

function bindQuestionField(id, key, transform) {
    $(id).addEventListener('input', () => {
        const item = itemFor(selected);
        if (!item) return;
        item.q[key] = transform ? transform($(id).value) : $(id).value;
        refreshMissing();
    });
}
bindQuestionField('qpoints-input', 'points', v => (v === '' ? 1 : Number(v) || 0));
bindQuestionField('qprompt-input', 'prompt');
bindQuestionField('qexplain-input', 'explanation');
bindQuestionField('qaccepted-input', 'accepted');
bindQuestionField('qnumexact-input', 'numExact');
bindQuestionField('qnummin-input', 'numMin');
bindQuestionField('qnummax-input', 'numMax');

$('qtype-input').addEventListener('change', () => {
    const item = itemFor(selected);
    item.q.qtype = $('qtype-input').value;
    renderQuestionForm(item);
});
$('qnummode-input').addEventListener('change', () => {
    const item = itemFor(selected);
    item.q.numMode = $('qnummode-input').value;
    renderQuestionForm(item);
});
$('mc-add').addEventListener('click', () => {
    const item = itemFor(selected);
    item.q.mcOptions.push({ label: '' });
    renderQuestionForm(item);
});

// ---------------------------------------------------------------------
// top-level controls
// ---------------------------------------------------------------------

typeInput.addEventListener('change', () => {
    setType(itemFor(selected), typeInput.value);
    renderAll();
});

$('answerfor-input').addEventListener('input', () => {
    const n = Number($('answerfor-input').value);
    itemFor(selected).answerFor = n >= 1 && n <= items.length ? n : null;
});

nextInput.addEventListener('input', () => {
    const n = Number(nextInput.value);
    itemFor(selected).next = n >= 1 && n <= items.length ? n : null;
    renderSlideList();
});

let embedTimer = null;
embedInput.addEventListener('input', () => {
    clearTimeout(embedTimer);
    embedTimer = setTimeout(() => { lastStageSlide = null; renderSlideList(); renderPanel(); }, 400);
});

countInput.addEventListener('change', () => {
    resizeItems(Number(countInput.value) || 1);
    countInput.value = items.length;
    renderAll();
});

thumbsToggle.addEventListener('change', renderSlideList);

// Fills from the starting slide to the LAST slide, repeating one category's
// layout until the slides run out (a title card, then the questions / answers).
$('pattern-apply').addEventListener('click', () => {
    const start = Math.max(1, Number($('pattern-start').value) || 1);
    const count = Math.max(1, Number($('pattern-count').value) || 1);
    const layout = $('pattern-layout').value;
    const hasTitle = $('pattern-title').checked;
    const returnHome = $('pattern-home').checked;
    const home = Number(homeInput.value) || 1;
    const lastSlide = items.length;

    if (start > lastSlide) {
        alert('The starting slide is after the last slide. Raise the number of slides, or pick an earlier start.');
        return;
    }

    // One category as a list of slide roles. `of` = which question (0-based)
    // an answer slide belongs to, for the "all questions, then all answers" layout.
    const block = [];
    if (hasTitle) block.push({ type: 'plain' });
    if (layout === 'qa') {
        for (let i = 0; i < count; i++) {
            block.push({ type: 'question' });
            block.push({ type: 'answer' });
        }
    } else if (layout === 'q-then-a') {
        const firstQ = block.length;
        for (let i = 0; i < count; i++) block.push({ type: 'question' });
        for (let i = 0; i < count; i++) block.push({ type: 'answer', answerAtOffset: firstQ + i });
    } else {
        for (let i = 0; i < count; i++) block.push({ type: 'question' });
    }
    const length = block.length;

    // Boards inside the range would be overwritten: stop and say so rather than guess.
    for (let n = start; n <= lastSlide; n++) {
        if (itemFor(n).type === 'board') {
            alert('Slide ' + n + ' is a board slide, and the pattern runs to the end of the slides. Move the board out of the way, or pick a different starting slide.');
            return;
        }
    }

    let blocks = 0;
    for (let n = start; n <= lastSlide; n++) {
        const offset = (n - start) % length;
        const blockStart = n - offset;
        const role = block[offset];
        const item = itemFor(n);

        setType(item, role.type);
        item.next = null;
        item.answerFor = role.answerAtOffset !== undefined ? blockStart + role.answerAtOffset : null;

        // The last slide of each category goes back to the home slide.
        if (returnHome && offset === length - 1) item.next = home;
        if (offset === 0) blocks++;
    }

    const total = lastSlide - start + 1;
    const leftover = total % length;

    // Answer slides only make sense with the "after each question" reveal.
    if (layout !== 'q') revealInput.value = 'immediate';

    saveStatus.className = 'status success';
    saveStatus.textContent = 'Set slides ' + start + '-' + lastSlide + ' (' + blocks + ' categor' + (blocks === 1 ? 'y' : 'ies') + ').'
        + (leftover ? ' The last category is cut short by ' + (length - leftover) + ' slide(s): add slides or check your counts.' : '');
    selected = start;
    renderAll();
});

// ---------------------------------------------------------------------
// save
// ---------------------------------------------------------------------

function fail(message) {
    saveStatus.className = 'status failure';
    saveStatus.textContent = message;
}

function buildQuestion(item, index) {
    const q = item.q;
    const prompt = q.prompt.trim() || `Question ${index + 1}`;
    const base = {
        id: 'q' + (index + 1),
        type: q.qtype,
        prompt,
        media: null,
        points: q.points,
        timeLimitSeconds: null,
        explanation: q.explanation.trim() || '',
        category: 'Slides',
        slide: item.n
    };

    if (q.qtype === 'text') {
        const accepted = q.accepted.split(',').map(x => x.trim()).filter(Boolean);
        return { question: { ...base, config: { acceptedAnswers: accepted } } };
    }

    // Number / multiple choice: an unfinished answer is saved as blank (null) and
    // can never be marked correct, so a half-built quiz can still be saved.
    if (q.qtype === 'number') {
        const num = v => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));
        if (q.numMode === 'range') {
            return { question: { ...base, config: { mode: 'range', min: num(q.numMin), max: num(q.numMax) } } };
        }
        return { question: { ...base, config: { mode: 'exact', correctValue: num(q.numExact) } } };
    }

    const options = q.mcOptions.map((o, i) => ({ id: 'opt' + (i + 1), label: o.label.trim() }));
    return {
        question: {
            ...base,
            config: { display: 'buttons', options, correctOptionId: options[q.mcCorrect].id }
        }
    };
}

// ---------------------------------------------------------------------
// questions still missing their answer
// ---------------------------------------------------------------------

// Counts as answered as soon as any characters are entered.
function questionMissingAnswer(item) {
    if (item.type !== 'question') return false;
    const q = item.q;
    if (q.qtype === 'text') return q.accepted.trim() === '';
    if (q.qtype === 'number') {
        return q.numMode === 'range'
            ? (String(q.numMin).trim() === '' || String(q.numMax).trim() === '')
            : String(q.numExact).trim() === '';
    }
    // multiple choice: the correct option and every option need some text
    return q.mcOptions.some(o => o.label.trim() === '');
}

function refreshMissing() {
    const toggle = $('missing-toggle');
    const list = $('missing-list');
    const missing = items.filter(questionMissingAnswer);
    const questionNumber = new Map(items.filter(i => i.type === 'question').map((i, idx) => [i.n, idx + 1]));

    list.innerHTML = '';
    missing.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Slide ' + item.n + ' · question ' + questionNumber.get(item.n);
        btn.addEventListener('click', () => {
            selected = item.n;
            renderSlideList();
            renderPanel();
            window.scrollTo({ top: $('slide-panel').offsetTop - 100, behavior: 'smooth' });
        });
        list.appendChild(btn);
    });

    if (!missing.length) {
        toggle.textContent = '✔ Every question has an answer';
        toggle.classList.remove('has-missing');
        toggle.disabled = true;
        list.hidden = true;
    } else {
        toggle.textContent = '⚠ ' + missing.length + ' question' + (missing.length === 1 ? '' : 's') + ' missing an answer ' + (list.hidden ? '▾' : '▴');
        toggle.classList.add('has-missing');
        toggle.disabled = false;
    }
}

$('missing-toggle').addEventListener('click', () => {
    const list = $('missing-list');
    list.hidden = !list.hidden;
    refreshMissing();
});

saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const embed = normalizeEmbedInput(embedInput.value);

    if (!title) return fail('Please enter a quiz name.');
    if (!embed || !embedUrl(embed, 1)) return fail('Paste the Google Slides embed link first.');

    const questions = [];
    const outItems = [];
    for (const item of items) {
        const out = { n: item.n, type: item.type, next: item.next || null, answerFor: item.answerFor || null, hotspots: [], questionIndex: null };

        if (item.type === 'board') {
            if (item.hotspots.some(h => !h.target)) return fail(`Slide ${item.n}: every touchable area needs a "Goes to" slide.`);
            out.hotspots = item.hotspots.map((h, i) => ({ ...h, label: (h.label || '').trim() || `Option ${i + 1}` }));
        }

        if (item.type === 'question') {
            const built = buildQuestion(item, questions.length);
            if (built.error) return fail(built.error);
            out.questionIndex = questions.length;
            questions.push(built.question);
        }
        outItems.push(out);
    }

    if (!questions.length) return fail('Mark at least one slide as a question.');

    // Each answer slide shows the result of the question that leads to it.
    const bySlide = new Map(outItems.map(i => [i.n, i]));
    outItems.filter(i => i.type === 'answer' && i.answerFor).forEach(aItem => {
        const qItem = bySlide.get(aItem.answerFor);
        if (qItem && qItem.type === 'question') aItem.questionIndex = qItem.questionIndex;
    });
    outItems.filter(i => i.type === 'question').forEach(qItem => {
        const target = qItem.next || qItem.n + 1;
        const targetItem = bySlide.get(target);
        if (targetItem && targetItem.type === 'answer' && targetItem.questionIndex == null) {
            targetItem.questionIndex = qItem.questionIndex;
        }
    });
    const orphan = outItems.find(i => i.type === 'answer' && i.questionIndex == null);
    if (orphan && revealInput.value === 'immediate') {
        return fail(`Slide ${orphan.n} is an answer slide but no question leads to it. Make the slide before it a question, or set the question's "Then go to".`);
    }

    saveBtn.disabled = true;
    saveStatus.className = 'status pending';
    saveStatus.textContent = 'Saving...';

    const quizRef = activeQuizId ? doc(db, 'quizzes', activeQuizId) : doc(collection(db, 'quizzes'));

    try {
        await setDoc(quizRef, {
            id: quizRef.id,
            kind: 'slides',
            title,
            description: descInput.value.trim(),
            version: 1,
            answerRevealMode: 'immediate',
            isBuzzerQuiz: false,
            buzzerShowScoreThroughout: false,
            buzzersDefaultOpen: false,
            defaultExplanationsOn: false,
            reviewEnabled: false,
            categoryMeta: [],
            editPasswordHash: existingPasswordHash,
            slides: {
                embedUrl: embed,
                count: items.length,
                homeSlide: Number(homeInput.value) || 1,
                revealMode: revealInput.value,
                items: outItems
            },
            questions
        });

        if (!activeQuizId) {
            activeQuizId = quizRef.id;
            history.replaceState(null, '', `builder-slides.html?quiz=${encodeURIComponent(quizRef.id)}`);
            $('back-button-link').href = '../manage-quizzes/manage-quizzes.html';
        }
        $('convert-warning').hidden = true;
        saveStatus.className = 'status success';
        const stillMissing = items.filter(questionMissingAnswer).length;
        saveStatus.textContent = stillMissing
            ? 'Saved. ' + stillMissing + ' question' + (stillMissing === 1 ? ' is' : 's are') + ' still missing an answer (see the list at the top right).'
            : 'Slides quiz saved!';
    } catch (err) {
        console.error(err);
        fail('Failed to save — check the console.');
    } finally {
        saveBtn.disabled = false;
    }
});
