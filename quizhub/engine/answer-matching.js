// Shared normalization/matching used by every answer type that grades free
// text — single text answers (answer-types.js) and multi-answer questions
// (engine/multi-answer-types.js) both go through this so they stay in sync.
const AnswerMatching = (function () {
    function normalize(value) {
        return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function normalizeNoSpaces(value) {
        return normalize(value).replace(/\s+/g, '');
    }

    // Case-insensitive, whitespace-insensitive equality — also matches when
    // all spaces are stripped from both sides (so "New York" matches "newyork").
    function matches(input, accepted) {
        if (normalize(input) === normalize(accepted)) return true;
        return normalizeNoSpaces(input) === normalizeNoSpaces(accepted);
    }

    // First entry in acceptedList that input matches, or undefined.
    function findMatch(input, acceptedList) {
        return (acceptedList || []).find(accepted => matches(input, accepted));
    }

    return { normalize, normalizeNoSpaces, matches, findMatch };
})();
