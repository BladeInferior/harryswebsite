const AnswerTypeRegistry = (function () {
    const types = {};

    function register(type, impl) {
        types[type] = impl;
    }

    function get(type) {
        const impl = types[type];
        if (!impl) throw new Error(`Unknown answer type: ${type}`);
        return impl;
    }

    function gradeSingleChoice(value, correctId) {
        return {
            correct: value === correctId,
            correctValue: correctId
        };
    }

    // ---------------------------------------------------------------
    // text
    // ---------------------------------------------------------------
    register('text', {
        renderInput(question, container) {
            container.innerHTML = '';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'text-answer-input';
            input.placeholder = 'Type your answer...';
            input.autocomplete = 'off';

            container.appendChild(input);
            input.focus();
        },

        getValue(container) {
            const input = container.querySelector('.text-answer-input');
            return input ? input.value : '';
        },

        grade(value, question) {
            return {
                correct: !!AnswerMatching.findMatch(value, question.config.acceptedAnswers),
                correctValue: question.config.acceptedAnswers[0]
            };
        },

        reveal(container, question, value, gradeResult) {
            const input = container.querySelector('.text-answer-input');
            if (!input) return;

            input.disabled = true;
            input.classList.add(gradeResult.correct ? 'correct' : 'incorrect');
        }
    });

    // ---------------------------------------------------------------
    // multiple-choice (buttons or dropdown — same type, display variant)
    // ---------------------------------------------------------------
    register('multiple-choice', {
        renderInput(question, container) {
            container.innerHTML = '';
            container.dataset.selected = '';

            const { display, options } = question.config;

            if (display === 'dropdown') {
                const select = document.createElement('select');
                select.className = 'mc-dropdown';

                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Select an answer...';
                placeholder.disabled = true;
                placeholder.selected = true;
                select.appendChild(placeholder);

                options.forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.id;
                    o.textContent = opt.label;
                    select.appendChild(o);
                });

                select.addEventListener('change', () => {
                    container.dataset.selected = select.value;
                });

                container.appendChild(select);
            } else {
                const wrap = document.createElement('div');
                wrap.className = 'answer-option-list';

                options.forEach(opt => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'answer-option';
                    btn.textContent = opt.label;
                    btn.dataset.optionId = opt.id;

                    btn.addEventListener('click', () => {
                        wrap.querySelectorAll('.answer-option').forEach(b => b.classList.remove('selected'));
                        btn.classList.add('selected');
                        container.dataset.selected = opt.id;
                    });

                    wrap.appendChild(btn);
                });

                container.appendChild(wrap);
            }
        },

        getValue(container) {
            return container.dataset.selected || null;
        },

        grade(value, question) {
            return gradeSingleChoice(value, question.config.correctOptionId);
        },

        reveal(container, question, value, gradeResult) {
            const correctId = question.config.correctOptionId;
            const buttons = container.querySelectorAll('.answer-option');

            if (buttons.length) {
                buttons.forEach(btn => {
                    btn.disabled = true;
                    if (btn.dataset.optionId === correctId) btn.classList.add('correct');
                    else if (btn.dataset.optionId === value) btn.classList.add('incorrect');
                });
            } else {
                const select = container.querySelector('.mc-dropdown');
                if (select) {
                    select.disabled = true;
                    select.classList.add(gradeResult.correct ? 'correct' : 'incorrect');
                }
            }
        }
    });

    // ---------------------------------------------------------------
    // image-select
    // ---------------------------------------------------------------
    register('image-select', {
        renderInput(question, container) {
            container.innerHTML = '';
            container.dataset.selected = '';

            const wrap = document.createElement('div');
            wrap.className = 'image-option-grid';

            question.config.options.forEach(opt => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'answer-option image-option';
                btn.dataset.optionId = opt.id;

                const img = document.createElement('img');
                img.src = opt.src;
                img.alt = opt.alt || '';
                btn.appendChild(img);

                btn.addEventListener('click', () => {
                    wrap.querySelectorAll('.image-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    container.dataset.selected = opt.id;
                });

                wrap.appendChild(btn);
            });

            container.appendChild(wrap);
        },

        getValue(container) {
            return container.dataset.selected || null;
        },

        grade(value, question) {
            return gradeSingleChoice(value, question.config.correctOptionId);
        },

        reveal(container, question, value) {
            const correctId = question.config.correctOptionId;

            container.querySelectorAll('.image-option').forEach(btn => {
                btn.disabled = true;
                if (btn.dataset.optionId === correctId) btn.classList.add('correct');
                else if (btn.dataset.optionId === value) btn.classList.add('incorrect');
            });
        }
    });

    // ---------------------------------------------------------------
    // ordering (up/down reorder buttons — mechanism is swappable later)
    // ---------------------------------------------------------------
    register('ordering', {
        renderInput(question, container) {
            container.innerHTML = '';

            let order = question.config.items.map(i => i.id);
            const list = document.createElement('div');
            list.className = 'ordering-list';

            function renderList() {
                list.innerHTML = '';

                order.forEach((id, idx) => {
                    const item = question.config.items.find(i => i.id === id);

                    const row = document.createElement('div');
                    row.className = 'ordering-item';
                    row.dataset.itemId = id;

                    const label = document.createElement('span');
                    label.className = 'ordering-item-label';
                    label.textContent = item.label;
                    row.appendChild(label);

                    const controls = document.createElement('div');
                    controls.className = 'ordering-item-controls';

                    const upBtn = document.createElement('button');
                    upBtn.type = 'button';
                    upBtn.textContent = '↑';
                    upBtn.disabled = idx === 0;
                    upBtn.addEventListener('click', () => {
                        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                        renderList();
                    });

                    const downBtn = document.createElement('button');
                    downBtn.type = 'button';
                    downBtn.textContent = '↓';
                    downBtn.disabled = idx === order.length - 1;
                    downBtn.addEventListener('click', () => {
                        [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
                        renderList();
                    });

                    controls.appendChild(upBtn);
                    controls.appendChild(downBtn);
                    row.appendChild(controls);
                    list.appendChild(row);
                });

                container.dataset.order = JSON.stringify(order);
            }

            renderList();
            container.appendChild(list);
        },

        getValue(container) {
            try {
                return JSON.parse(container.dataset.order || '[]');
            } catch (e) {
                return [];
            }
        },

        grade(value, question) {
            const correct = JSON.stringify(value) === JSON.stringify(question.config.correctOrder);
            return { correct, correctValue: question.config.correctOrder };
        },

        reveal(container, question) {
            container.querySelectorAll('.ordering-item button').forEach(btn => btn.disabled = true);

            const correctOrder = question.config.correctOrder;
            container.querySelectorAll('.ordering-item').forEach((row, idx) => {
                row.classList.add(correctOrder[idx] === row.dataset.itemId ? 'correct' : 'incorrect');
            });
        }
    });

    // ---------------------------------------------------------------
    // number — config is either { mode: 'exact', correctValue } or
    // { mode: 'range', min, max } (inclusive)
    // ---------------------------------------------------------------
    register('number', {
        renderInput(question, container) {
            container.innerHTML = '';

            const input = document.createElement('input');
            input.type = 'number';
            input.inputMode = 'decimal';
            input.className = 'number-answer-input text-answer-input';
            input.placeholder = 'Enter a number...';

            container.appendChild(input);
            input.focus();
        },

        getValue(container) {
            const input = container.querySelector('.number-answer-input');
            if (!input || input.value.trim() === '') return null;

            const num = Number(input.value);
            return Number.isNaN(num) ? null : num;
        },

        grade(value, question) {
            const cfg = question.config;
            const correctValue = cfg.mode === 'range' ? `${cfg.min}–${cfg.max}` : cfg.correctValue;

            if (value === null || value === undefined) {
                return { correct: false, correctValue };
            }

            const correct = cfg.mode === 'range'
                ? (value >= cfg.min && value <= cfg.max)
                : value === cfg.correctValue;

            return { correct, correctValue };
        },

        reveal(container, question, value, gradeResult) {
            const input = container.querySelector('.number-answer-input');
            if (!input) return;

            input.disabled = true;
            input.classList.add(gradeResult.correct ? 'correct' : 'incorrect');
        }
    });

    // ---------------------------------------------------------------
    // multi-answer — config: { acceptedAnswers: [...], maxAnswers }. Each
    // submitted answer is graded independently; points are awarded per
    // correct, distinct answer rather than all-or-nothing (partial credit).
    // ---------------------------------------------------------------
    register('multi-answer', {
        renderInput(question, container) {
            container.innerHTML = '';

            const max = question.config.maxAnswers || question.config.acceptedAnswers.length;

            for (let i = 0; i < max; i++) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'multi-answer-input text-answer-input';
                input.placeholder = `Answer ${i + 1}`;
                input.autocomplete = 'off';
                container.appendChild(input);
            }

            const first = container.querySelector('.multi-answer-input');
            if (first) first.focus();
        },

        getValue(container) {
            return Array.from(container.querySelectorAll('.multi-answer-input'))
                .map(input => input.value.trim())
                .filter(Boolean);
        },

        // Dedupes repeated submissions (by normalized text) before matching,
        // and each accepted answer can only be claimed once — so submitting
        // two different phrasings of the same correct answer only scores once.
        grade(value, question) {
            const accepted = question.config.acceptedAnswers;
            const submitted = Array.isArray(value) ? value : [];

            const seenNormalized = new Set();
            const claimedAcceptedIndexes = new Set();
            const perAnswerResults = [];
            let correctCount = 0;

            submitted.forEach(raw => {
                const trimmed = (raw || '').trim();
                if (!trimmed) return;

                const norm = AnswerMatching.normalize(trimmed);
                if (seenNormalized.has(norm)) {
                    perAnswerResults.push({ value: trimmed, correct: false });
                    return;
                }
                seenNormalized.add(norm);

                const acceptedIndex = accepted.findIndex((a, i) =>
                    !claimedAcceptedIndexes.has(i) && AnswerMatching.matches(trimmed, a));

                if (acceptedIndex !== -1) {
                    claimedAcceptedIndexes.add(acceptedIndex);
                    correctCount++;
                    perAnswerResults.push({ value: trimmed, correct: true });
                } else {
                    perAnswerResults.push({ value: trimmed, correct: false });
                }
            });

            return {
                correct: correctCount > 0,
                correctCount,
                pointsAwarded: correctCount * question.points,
                perAnswerResults,
                correctValue: accepted.join(', ')
            };
        },

        reveal(container, question, value, gradeResult) {
            const inputs = container.querySelectorAll('.multi-answer-input');
            const results = (gradeResult && gradeResult.perAnswerResults) || [];

            inputs.forEach(input => { input.disabled = true; });
            results.forEach((r, i) => {
                if (inputs[i]) inputs[i].classList.add(r.correct ? 'correct' : 'incorrect');
            });
        }
    });

    // ---------------------------------------------------------------
    // buzzer — no player-submitted value to grade; the host resolves each
    // buzz live (see host-quiz.js). This registration only covers generic
    // contexts (like play-test.js) that drive every type the same way.
    // ---------------------------------------------------------------
    register('buzzer', {
        renderInput(question, container) {
            container.innerHTML = '';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'buzz-in-btn';
            btn.textContent = '🔔 Buzz In!';

            container.appendChild(btn);
        },

        getValue() {
            return null;
        },

        grade() {
            return { correct: false, correctValue: '(host-judged)' };
        },

        reveal(container) {
            const btn = container.querySelector('.buzz-in-btn');
            if (btn) btn.disabled = true;
        }
    });

    return { register, get };
})();
