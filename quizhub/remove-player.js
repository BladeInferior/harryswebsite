// Kicks a player out of a live session (any quiz type): deletes their answers
// and buzzes first so nothing is left pointing at a player who no longer
// exists, then the player doc. The player's own phone notices its doc is gone
// (join.js) and sends them back to the join screen.
import { db } from './firebase/firebase-config.js';
import {
    collection, doc, getDocs, deleteDoc, query, where
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

export async function removePlayer(code, playerId) {
    for (const sub of ['answers', 'buzzes']) {
        const snap = await getDocs(query(collection(db, 'sessions', code, sub), where('playerId', '==', playerId)));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(db, 'sessions', code, 'players', playerId));
}

// Small ✕ button for a player row; asks first.
export function makeRemoveButton(code, player, onError) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-small remove-player-btn';
    btn.textContent = '✕';
    btn.title = `Remove ${player.name}`;
    btn.style.cssText = 'margin-left:8px;padding:2px 8px;';
    btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Remove "${player.name}" from the quiz? They'll be sent back to the join screen.`)) return;
        btn.disabled = true;
        try {
            await removePlayer(code, player.id);
        } catch (err) {
            console.error('Failed to remove player:', err);
            btn.disabled = false;
            if (onError) onError(err);
        }
    });
    return btn;
}


// Forget everything a finished session holds about its players, photos included
// (the player docs are where each photo lives). The session doc itself stays so
// phones can still show the "Quiz Complete" screen.
export async function deleteSessionPlayerData(code) {
    for (const sub of ['players', 'answers', 'buzzes', 'messages', 'events']) {
        const snap = await getDocs(collection(db, 'sessions', code, sub));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
}
