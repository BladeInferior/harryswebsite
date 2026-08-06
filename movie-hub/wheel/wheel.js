import { Wheel } from 'https://cdn.jsdelivr.net/npm/spin-wheel@5.0.2/dist/spin-wheel-esm.js';
import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.module.mjs';

// Same Cloudflare Worker the homepage's "latest film" widget already uses —
// see /watchlist and /tmdb/movie routes added alongside its existing
// diary-RSS and GitHub-export routes.
const WORKER_URL = 'https://orange-bar-b027.harrycummins.workers.dev';
const REGION = 'GB';
const ENRICH_CONCURRENCY = 6;
const CACHE_KEY = 'movieHubEnrichmentCache_v2';

const WHEEL_COLORS = ['#8a3a00', '#b35400', '#e67300', '#ff8000'];

const refreshBtn = document.getElementById('refresh-btn');
const refreshStatus = document.getElementById('refresh-status');
const enrichStatus = document.getElementById('enrich-status');

const filtersToggle = document.getElementById('filters-toggle');
const filtersSummary = document.getElementById('filters-summary');
const filtersPanel = document.getElementById('filters-panel');
const runtimeInput = document.getElementById('runtime-input');
const genreOptions = document.getElementById('genre-options');
const streamableOnlyInput = document.getElementById('streamable-only-input');
const skipSequelsInput = document.getElementById('skip-sequels-input');
const applyFiltersBtn = document.getElementById('apply-filters');
const clearFiltersBtn = document.getElementById('clear-filters');

const wheelContainer = document.getElementById('wheel-container');
const wheelEmptyMessage = document.getElementById('wheel-empty-message');
const wheelCount = document.getElementById('wheel-count');
const spinBtn = document.getElementById('spin-btn');
const spinMessage = document.getElementById('spin-message');

// The result is shown in two places at once — the panel below the wheel and
// a celebratory modal — so rendering is written once against a "refs"
// bundle and called for each target rather than duplicated.
const panelRefs = {
    root: document.getElementById('result-panel'),
    poster: document.getElementById('result-poster'),
    posterFallback: document.getElementById('result-poster-fallback'),
    title: document.getElementById('result-title'),
    meta: document.getElementById('result-meta'),
    genres: document.getElementById('result-genres'),
    overview: document.getElementById('result-overview'),
    providers: document.getElementById('result-providers'),
    letterboxdLink: document.getElementById('result-letterboxd-link')
};

const modalRefs = {
    root: document.getElementById('result-modal'),
    poster: document.getElementById('modal-result-poster'),
    posterFallback: document.getElementById('modal-result-poster-fallback'),
    title: document.getElementById('modal-result-title'),
    meta: document.getElementById('modal-result-meta'),
    genres: document.getElementById('modal-result-genres'),
    overview: document.getElementById('modal-result-overview'),
    providers: document.getElementById('modal-result-providers'),
    letterboxdLink: document.getElementById('modal-result-letterboxd-link')
};

const resultModal = document.getElementById('result-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalSpinAgainBtn = document.getElementById('modal-spin-again-btn');

let filmCache = loadCache();
let allFilms = [];
let currentWheelFilms = [];
let wheel = null;
let isSpinning = false;
let enrichRunId = 0;

// =========================
// Cache
// =========================

function loadCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveCache() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(filmCache));
    } catch (err) {
        console.warn('Could not save Movie Hub cache:', err);
    }
}

// =========================
// Watchlist + enrichment
// =========================

async function refreshWatchlist(forceReEnrich = false) {
    if (isSpinning) return;

    const runId = ++enrichRunId;
    refreshBtn.disabled = true;
    refreshStatus.classList.remove('error');
    refreshStatus.textContent = 'Loading your watchlist…';

    if (forceReEnrich) {
        filmCache = {};
        saveCache();
    }

    try {
        const res = await fetch(`${WORKER_URL}/watchlist`);
        if (!res.ok) throw new Error(`Watchlist request failed (${res.status})`);
        const data = await res.json();

        allFilms = (data.films || []).map(f => ({
            ...f,
            enrichment: filmCache[f.slug] || null
        }));

        refreshStatus.textContent =
            `${allFilms.length} film${allFilms.length === 1 ? '' : 's'} on your watchlist` +
            (data.truncated ? ' (list truncated — very large watchlist)' : '');

        rebuildWheel();
        refreshGenreOptions();
        backgroundEnrich(runId);

    } catch (err) {
        console.error('Failed to load watchlist:', err);
        refreshStatus.classList.add('error');
        refreshStatus.textContent = 'Could not load your watchlist. Is the Cloudflare Worker deployed with the /watchlist route?';
    } finally {
        refreshBtn.disabled = false;
    }
}

async function fetchEnrichment(film) {
    const params = new URLSearchParams({ title: film.title, region: REGION });
    if (film.year) params.set('year', film.year);

    const res = await fetch(`${WORKER_URL}/tmdb/movie?${params.toString()}`);
    if (!res.ok) throw new Error(`TMDB proxy request failed (${res.status})`);
    return res.json();
}

async function enrichFilm(film) {
    if (film.enrichment) return film.enrichment;

    if (filmCache[film.slug]) {
        film.enrichment = filmCache[film.slug];
        return film.enrichment;
    }

    const data = await fetchEnrichment(film);
    film.enrichment = data;
    filmCache[film.slug] = data;
    saveCache();
    return data;
}

async function runPool(items, limit, worker) {
    let index = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (index < items.length) {
            const i = index++;
            await worker(items[i]);
        }
    });
    await Promise.all(runners);
}

async function backgroundEnrich(runId) {
    const films = allFilms;
    let done = films.filter(f => f.enrichment).length;

    const updateProgress = () => {
        if (runId !== enrichRunId) return;
        if (done >= films.length) {
            enrichStatus.textContent = '';
        } else {
            enrichStatus.textContent = `Loading film details… ${done}/${films.length}`;
        }
    };

    updateProgress();

    await runPool(films, ENRICH_CONCURRENCY, async (film) => {
        if (runId !== enrichRunId || film.enrichment) return;

        try {
            await enrichFilm(film);
        } catch (err) {
            console.warn('Enrichment failed for', film.title, err);
            film.enrichment = { found: false, tmdbId: null, genres: [], runtime: null, watchProviders: null };
        }

        if (runId !== enrichRunId) return;
        done++;
        updateProgress();
        refreshGenreOptions();

        // The subscriptions filter defaults to checked, so without this the
        // wheel would sit empty ("No films match…") for the whole
        // enrichment run instead of filling in as details arrive. Never
        // touch wheel.items mid-spin — spinToItem's target index would no
        // longer line up with whatever the filtered list becomes.
        if (!isSpinning) rebuildWheel();
    });
}

// =========================
// Filters
// =========================

function getSelectedGenres() {
    return new Set(
        Array.from(genreOptions.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value)
    );
}

// Matched against TMDB's provider_name strings for the GB region — these
// are the services actually subscribed to, so this filter defaults to
// checked on page load rather than opt-in.
const MY_SUBSCRIPTION_PATTERNS = [
    /prime video/i,
    /netflix/i,
    /disney\s*\+|disney plus/i,
    /itvx|itv hub|\bitv\b/i,
    /sky cinema/i
];

function isOnMySubscriptions(enrichment) {
    const providers = enrichment.watchProviders;
    if (!providers) return false;
    const candidates = [...(providers.flatrate || []), ...(providers.free || [])];
    return candidates.some(p => MY_SUBSCRIPTION_PATTERNS.some(re => re.test(p.name || '')));
}

// A film is the "earliest" in its franchise if no other film on the
// watchlist sharing the same TMDB collection has a strictly earlier release
// date — comparison is against the full watchlist (not the already-filtered
// set), so it holds regardless of what other filters happen to be active.
function isEarliestInFranchise(film, allFilms) {
    const enrichment = film.enrichment;
    if (!enrichment || enrichment.found === false) return false;

    const collection = enrichment.belongsToCollection;
    if (!collection) return true;

    const myDate = enrichment.releaseDate;
    if (!myDate) return true;

    return !allFilms.some(other => {
        if (other === film) return false;
        const oe = other.enrichment;
        if (!oe || oe.found === false) return false;
        if (!oe.belongsToCollection || oe.belongsToCollection.id !== collection.id) return false;
        if (!oe.releaseDate) return false;
        return oe.releaseDate < myDate;
    });
}

function applyFilters(films) {
    const selectedGenres = getSelectedGenres();
    const maxRuntime = parseInt(runtimeInput.value, 10);
    const hasRuntimeFilter = Number.isFinite(maxRuntime) && maxRuntime > 0;
    const hasGenreFilter = selectedGenres.size > 0;
    const hasStreamableFilter = streamableOnlyInput.checked;
    const hasSequelFilter = skipSequelsInput.checked;

    if (!hasGenreFilter && !hasRuntimeFilter && !hasStreamableFilter && !hasSequelFilter) {
        return films;
    }

    return films.filter(f => {
        if (!f.enrichment || f.enrichment.found === false) return false;
        if (hasGenreFilter && !(f.enrichment.genres || []).some(g => selectedGenres.has(g))) return false;
        if (hasRuntimeFilter && (!f.enrichment.runtime || f.enrichment.runtime > maxRuntime)) return false;
        if (hasStreamableFilter && !isOnMySubscriptions(f.enrichment)) return false;
        if (hasSequelFilter && !isEarliestInFranchise(f, films)) return false;
        return true;
    });
}

let lastGenreKey = null;

function refreshGenreOptions() {
    const genreSet = new Set();
    allFilms.forEach(f => {
        (f.enrichment?.genres || []).forEach(g => genreSet.add(g));
    });

    const sorted = Array.from(genreSet).sort();

    // Rebuilding this list happens after every single film finishes
    // enriching in the background (could be 200+ times per refresh) —
    // skip the DOM rebuild when the genre set hasn't actually changed.
    const genreKey = sorted.join('|');
    if (genreKey === lastGenreKey) return;
    lastGenreKey = genreKey;

    const currentlyChecked = getSelectedGenres();

    genreOptions.innerHTML = '';

    if (sorted.length === 0) {
        const p = document.createElement('p');
        p.className = 'filter-empty';
        p.textContent = 'Genres will appear here once your watchlist details finish loading.';
        genreOptions.appendChild(p);
        return;
    }

    sorted.forEach(genre => {
        const label = document.createElement('label');
        label.className = 'filter-chip';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = genre;
        input.checked = currentlyChecked.has(genre);

        label.appendChild(input);
        label.appendChild(document.createTextNode(genre));
        genreOptions.appendChild(label);
    });
}

function updateFiltersSummary() {
    const selectedGenres = getSelectedGenres();
    const maxRuntime = parseInt(runtimeInput.value, 10);
    const parts = [];
    if (selectedGenres.size > 0) parts.push(`${selectedGenres.size} genre${selectedGenres.size === 1 ? '' : 's'}`);
    if (Number.isFinite(maxRuntime) && maxRuntime > 0) parts.push(`≤${maxRuntime}m`);
    if (streamableOnlyInput.checked) parts.push('films I can stream');
    if (skipSequelsInput.checked) parts.push('no sequels');
    filtersSummary.textContent = parts.length ? `(${parts.join(', ')})` : '';
}

filtersToggle.addEventListener('click', () => {
    const isOpen = !filtersPanel.hidden;
    filtersPanel.hidden = isOpen;
    filtersToggle.setAttribute('aria-expanded', String(!isOpen));
});

applyFiltersBtn.addEventListener('click', () => {
    rebuildWheel();
    updateFiltersSummary();
});

clearFiltersBtn.addEventListener('click', () => {
    runtimeInput.value = '';
    streamableOnlyInput.checked = false;
    skipSequelsInput.checked = false;
    genreOptions.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    rebuildWheel();
    updateFiltersSummary();
});

// =========================
// Wheel
// =========================

function truncateLabel(title, max = 24) {
    return title.length > max ? title.slice(0, max - 1).trim() + '…' : title;
}

function updateWheelCount() {
    if (allFilms.length === 0) {
        wheelCount.hidden = true;
        return;
    }
    wheelCount.hidden = false;
    wheelCount.textContent = `${currentWheelFilms.length} option${currentWheelFilms.length === 1 ? '' : 's'} on the wheel`;
}

function rebuildWheel() {
    currentWheelFilms = applyFilters(allFilms);
    updateWheelCount();

    if (currentWheelFilms.length === 0) {
        spinBtn.disabled = true;
        spinMessage.textContent = allFilms.length === 0
            ? ''
            : 'No films match your current filters.';
    } else {
        spinBtn.disabled = isSpinning;
        spinMessage.textContent = '';
    }

    const items = currentWheelFilms.map(f => ({ label: truncateLabel(f.title) }));

    if (currentWheelFilms.length === 0) {
        if (wheel) {
            wheel.remove();
            wheel = null;
        }
        wheelEmptyMessage.textContent = allFilms.length === 0
            ? 'Click Refresh Watchlist to load your wheel.'
            : 'No films match your current filters.';
        wheelEmptyMessage.style.display = 'block';
        return;
    }

    wheelEmptyMessage.style.display = 'none';

    if (!wheel) {
        wheel = new Wheel(wheelContainer, {
            items,
            itemBackgroundColors: WHEEL_COLORS,
            itemLabelColors: ['#fff'],
            itemLabelFont: 'Arial, sans-serif',
            itemLabelFontSizeMax: 24,
            itemLabelRadius: 0.86,
            itemLabelRadiusMax: 0.35,
            lineColor: '#2a1a08',
            lineWidth: 1,
            borderColor: '#2a1a08',
            borderWidth: 3,
            radius: 0.92,
            rotationResistance: -60,
            onRest: onWheelRest
        });
    } else {
        wheel.items = items;
    }
}

function onSpinClick() {
    if (isSpinning || !wheel || currentWheelFilms.length === 0) return;

    isSpinning = true;
    spinBtn.disabled = true;
    spinBtn.textContent = 'Spinning…';
    spinMessage.textContent = '';
    hideResult();

    const targetIndex = Math.floor(Math.random() * currentWheelFilms.length);
    wheel.spinToItem(targetIndex, 4500, true, 6, 1, null);
}

async function onWheelRest(event) {
    isSpinning = false;
    spinBtn.textContent = 'Spin Again';
    spinBtn.disabled = currentWheelFilms.length === 0;

    const film = currentWheelFilms[event.currentIndex];
    if (!film) return;

    fireConfetti();
    presentResult(film, { loading: !film.enrichment });
    openModal();

    if (!film.enrichment) {
        try {
            await enrichFilm(film);
            presentResult(film, { loading: false });
            refreshGenreOptions();
        } catch (err) {
            console.error('Failed to load details for', film.title, err);
            presentResult(film, { loading: false, error: true });
        }
    }
}

spinBtn.addEventListener('click', onSpinClick);
refreshBtn.addEventListener('click', () => refreshWatchlist(true));
modalSpinAgainBtn.addEventListener('click', onSpinClick);

// =========================
// Result panel + modal
// =========================

function hideResult() {
    panelRefs.root.hidden = true;
    closeModal();
}

function openModal() {
    resultModal.hidden = false;
}

function closeModal() {
    resultModal.hidden = true;
}

modalCloseBtn.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !resultModal.hidden) closeModal();
});

function fireConfetti() {
    const colors = ['#ff8000', '#ffaa40', '#ffffff', '#e67300'];
    confetti({ particleCount: 90, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors });
    confetti({ particleCount: 90, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors });
    confetti({ particleCount: 60, spread: 100, origin: { x: 0.5, y: 0.4 }, colors });
}

// Renders into both the inline panel and the popup modal at once — they
// always show the same result, just in two places.
function presentResult(film, opts) {
    showResult(panelRefs, film, opts);
    showResult(modalRefs, film, opts);
}

function showResult(refs, film, { loading = false, error = false } = {}) {
    refs.root.hidden = false;

    refs.title.textContent = film.title;
    refs.letterboxdLink.href = film.letterboxdLink || '#';

    const enrichment = film.enrichment;

    if (loading) {
        refs.meta.textContent = film.year ? `${film.year} · Loading details…` : 'Loading details…';
        refs.genres.innerHTML = '';
        refs.overview.textContent = '';
        refs.providers.innerHTML = '';
        setPoster(refs, null);
        return;
    }

    if (error || !enrichment || enrichment.found === false) {
        refs.meta.textContent = film.year || '';
        refs.genres.innerHTML = '';
        refs.overview.textContent = "Couldn't find extra details for this film on TMDB.";
        refs.providers.innerHTML = '';
        setPoster(refs, null);
        return;
    }

    const metaParts = [];
    if (enrichment.year) metaParts.push(enrichment.year);
    if (enrichment.runtime) metaParts.push(`${enrichment.runtime} min`);
    refs.meta.textContent = metaParts.join(' · ');

    refs.genres.innerHTML = '';
    (enrichment.genres || []).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'result-genre-tag';
        tag.textContent = genre;
        refs.genres.appendChild(tag);
    });

    refs.overview.textContent = enrichment.overview || '';

    setPoster(refs, enrichment.poster, film.title);
    renderProviders(refs, enrichment.watchProviders);
}

function setPoster(refs, posterUrl, altText) {
    if (posterUrl) {
        refs.poster.onload = () => {
            refs.poster.hidden = false;
            refs.posterFallback.hidden = true;
        };
        refs.poster.onerror = () => {
            refs.poster.hidden = true;
            refs.posterFallback.hidden = false;
        };
        refs.poster.src = posterUrl;
        refs.poster.alt = altText || '';
    } else {
        refs.poster.hidden = true;
        refs.posterFallback.hidden = false;
    }
}

function renderProviders(refs, watchProviders) {
    refs.providers.innerHTML = '';

    if (!watchProviders) return;

    const groups = [
        { key: 'flatrate', label: 'Stream' },
        { key: 'rent', label: 'Rent' },
        { key: 'buy', label: 'Buy' },
        { key: 'free', label: 'Free' }
    ];

    let hasAny = false;

    groups.forEach(({ key, label }) => {
        const providers = watchProviders[key];
        if (!providers || providers.length === 0) return;

        hasAny = true;

        const group = document.createElement('div');
        group.className = 'provider-group';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'provider-group-label';
        groupLabel.textContent = label;
        group.appendChild(groupLabel);

        const logos = document.createElement('div');
        logos.className = 'provider-logos';

        providers.forEach(p => {
            if (!p.logo) return;
            const img = document.createElement('img');
            img.className = 'provider-logo';
            img.src = p.logo;
            img.alt = p.name;
            img.title = p.name;
            logos.appendChild(img);
        });

        group.appendChild(logos);
        refs.providers.appendChild(group);
    });

    if (!hasAny) {
        const p = document.createElement('p');
        p.className = 'filter-empty';
        p.textContent = `No streaming info found for ${REGION}.`;
        refs.providers.appendChild(p);
    } else if (watchProviders.link) {
        const link = document.createElement('a');
        link.href = watchProviders.link;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'filter-hint';
        link.style.display = 'inline-block';
        link.style.marginTop = '4px';
        link.textContent = 'More info on JustWatch →';
        refs.providers.appendChild(link);
    }
}

// =========================
// Init
// =========================

updateFiltersSummary();
refreshWatchlist();
