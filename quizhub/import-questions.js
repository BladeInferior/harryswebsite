// Parses and validates bulk-import spreadsheets (.csv / .xlsx) for the quiz
// builder. Column schema: question, type, answer(s), points, media_url, category.
//
// answer(s) format depends on type:
//   text          — accepted answers, separated by ";"
//   number        — a single exact value (ranges aren't supported via import)
//   multiple-choice — options separated by ";", correct one prefixed with "*"
//   multi-answer  — accepted answers, separated by ";" (each graded independently)
//   buzzer        — ignored

export const IMPORT_COLUMNS = ['question', 'type', 'answer(s)', 'points', 'media_url', 'category'];
export const IMPORT_TYPES = ['text', 'number', 'multiple-choice', 'multi-answer', 'buzzer'];

const TEMPLATE_CSV = [
    'question,type,answer(s),points,media_url,category',
    '"Who\'s that Pokémon?",text,snorlax; snorlacks,100,../collection-hub/sprites/pokemon_sprites/snorlax.png,General',
    'What type is Squirtle?,multiple-choice,Water*; Fire; Grass; Electric,100,,General',
    'Name 3 starter Pokémon types.,multi-answer,grass; fire; water,50,,General',
    'Buzz in if you know this one!,buzzer,,100,,General',
    'How many Pokémon are there in Gen 1?,number,151,50,,General'
].join('\r\n');

export function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}

// Returns a promise of an array of plain row objects, keyed by lower-cased,
// trimmed column name (so header casing/spacing in the source file doesn't
// matter).
export function parseFile(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.csv')) {
        return file.text().then(parseCsvText);
    }
    if (name.endsWith('.xlsx')) {
        return parseXlsxFile(file);
    }
    return Promise.reject(new Error('Unsupported file type — please upload a .csv or .xlsx file.'));
}

function parseCsvText(text) {
    const rows = splitCsvRows(text).filter(cols => cols.some(c => c.trim() !== ''));
    if (!rows.length) return [];

    const header = rows[0].map(h => h.trim().toLowerCase());
    return rows.slice(1).map(cols => {
        const obj = {};
        header.forEach((key, i) => { obj[key] = cols[i] !== undefined ? cols[i] : ''; });
        return obj;
    });
}

function splitCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }

    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

let xlsxLoadPromise = null;
function loadXlsxLibrary() {
    if (window.XLSX) return Promise.resolve(window.XLSX);

    if (!xlsxLoadPromise) {
        xlsxLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = () => resolve(window.XLSX);
            script.onerror = () => reject(new Error('Failed to load the spreadsheet library — check your internet connection.'));
            document.head.appendChild(script);
        });
    }

    return xlsxLoadPromise;
}

async function parseXlsxFile(file) {
    const XLSX = await loadXlsxLibrary();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return rows.map(row => {
        const obj = {};
        Object.keys(row).forEach(key => { obj[key.trim().toLowerCase()] = row[key]; });
        return obj;
    });
}

// Validates parsed rows and splits them into importable questions vs. errors.
// Returns { valid: [{ prompt, type, media, points, timeLimitSeconds, config,
// explanation, category }], errors: ['Row 5: missing answer(s)', ...] }.
export function validateRows(rows) {
    const valid = [];
    const errors = [];

    rows.forEach((row, i) => {
        const rowNum = i + 2; // +1 for 0-index, +1 for the header row

        const question = String(row.question || '').trim();
        const typeRaw = String(row.type || '').trim().toLowerCase();
        const answerRaw = String(row['answer(s)'] ?? row['answers'] ?? row['answer'] ?? '').trim();
        const pointsRaw = String(row.points ?? '').trim();
        const mediaUrl = String(row.media_url || '').trim();
        const category = String(row.category || '').trim() || 'General';

        if (!question) {
            errors.push(`Row ${rowNum}: missing question text`);
            return;
        }
        if (!typeRaw) {
            errors.push(`Row ${rowNum}: missing type`);
            return;
        }
        if (!IMPORT_TYPES.includes(typeRaw)) {
            errors.push(`Row ${rowNum}: invalid type "${row.type}" — must be one of ${IMPORT_TYPES.join(', ')}`);
            return;
        }

        let points = parseInt(pointsRaw, 10);
        if (!Number.isFinite(points) || points < 0) points = 1;

        let type, config;

        if (typeRaw === 'text') {
            const accepted = answerRaw.split(';').map(s => s.trim()).filter(Boolean);
            if (!accepted.length) {
                errors.push(`Row ${rowNum}: missing answer(s)`);
                return;
            }
            type = 'text';
            config = { acceptedAnswers: accepted };

        } else if (typeRaw === 'number') {
            const num = Number(answerRaw);
            if (answerRaw === '' || Number.isNaN(num)) {
                errors.push(`Row ${rowNum}: answer must be a single exact number (ranges aren't supported via import)`);
                return;
            }
            type = 'number';
            config = { mode: 'exact', correctValue: num };

        } else if (typeRaw === 'multiple-choice') {
            const parts = answerRaw.split(';').map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) {
                errors.push(`Row ${rowNum}: multiple-choice needs at least 2 options separated by ";"`);
                return;
            }

            const options = [];
            let correctOptionId = null;

            parts.forEach((part, idx) => {
                const isCorrect = part.startsWith('*');
                const label = (isCorrect ? part.slice(1) : part).trim();
                const id = 'opt' + (idx + 1);
                options.push({ id, label });
                if (isCorrect) correctOptionId = id;
            });

            if (options.some(o => !o.label)) {
                errors.push(`Row ${rowNum}: all options need text`);
                return;
            }
            if (!correctOptionId) {
                errors.push(`Row ${rowNum}: mark the correct option with a leading "*" (e.g. "Water*")`);
                return;
            }

            type = 'multiple-choice';
            config = { display: 'buttons', options, correctOptionId };

        } else if (typeRaw === 'multi-answer') {
            const accepted = answerRaw.split(';').map(s => s.trim()).filter(Boolean);
            if (!accepted.length) {
                errors.push(`Row ${rowNum}: missing answer(s)`);
                return;
            }
            type = 'multi-answer';
            config = { acceptedAnswers: accepted, maxAnswers: accepted.length };

        } else if (typeRaw === 'buzzer') {
            type = 'buzzer';
            config = {};
        }

        const media = mediaUrl ? { kind: MediaUtils.guessKind(mediaUrl), src: mediaUrl, alt: '' } : null;

        valid.push({
            prompt: question,
            type,
            media,
            points,
            timeLimitSeconds: null,
            config,
            explanation: '',
            category
        });
    });

    return { valid, errors };
}
