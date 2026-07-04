// Client-side SHA-256 hashing for quiz edit/delete passwords. This is a
// casual deterrent, not real security — the Firestore rules for this app
// are wide open (no auth), so anyone reading the quizzes collection
// directly can see the hash. It's enough to stop someone from
// accidentally/casually editing or deleting a quiz that isn't theirs.
export async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
