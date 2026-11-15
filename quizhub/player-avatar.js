// Player photos: taken (or picked) on the player's own device, shrunk to a small
// square JPEG data URL and stored on that player's doc for the length of the
// quiz only. No file storage is involved, and the player docs are deleted when
// the quiz ends (host-quiz.js / host-slides.js cleanup), so the photo is
// forgotten with the session.

// Centre-crops to a square and scales to size x size (about 5-8 KB as JPEG).
export function resizePhoto(file, size = 128) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;
            canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read that image.'));
        };
        img.src = url;
    });
}

export function anyPhoto(players) {
    return players.some(p => p && p.photo);
}

// Round avatar: the photo if there is one, otherwise the name's first letter on
// purple. Callers only add avatars when at least one player in that list has a
// photo, so quizzes where nobody uses the feature look exactly as before.
export function makeAvatar(player, px = 36) {
    const el = document.createElement('span');
    el.className = 'avatar';
    el.style.cssText = `display:inline-flex;align-items:center;justify-content:center;flex:0 0 ${px}px;`
        + `width:${px}px;height:${px}px;border-radius:50%;overflow:hidden;vertical-align:middle;`
        + `margin-right:10px;background:#5b2f86;color:#fff;font-weight:bold;font-size:${Math.round(px * 0.45)}px;`
        + 'background-size:cover;background-position:center;';
    if (player && player.photo) {
        el.style.backgroundImage = `url("${player.photo}")`;
    } else {
        el.textContent = ((player && player.name) || '?').trim().charAt(0).toUpperCase();
    }
    return el;
}


// A still from a live <video>, centre-cropped to a square and mirrored left to
// right so the saved photo looks exactly like the selfie-style preview the
// player lined themselves up in (the raw camera frame is the other way round).
export function frameToPhoto(video, size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;
    const ctx = canvas.getContext('2d');
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.72);
}
