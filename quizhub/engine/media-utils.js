// Shared question-media handling — image (existing), plus video (YouTube /
// Vimeo / direct file link) and audio embeds. Used by the builder (preview),
// host-quiz.js, join.js and play-test.js so every screen renders media the
// same way.
const MediaUtils = (function () {
    function guessKind(url) {
        const lower = String(url || '').toLowerCase();
        if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) return 'video';
        if (/\.(mp3|wav|ogg|m4a)(\?|$)/.test(lower)) return 'audio';
        if (isEmbedPlatform(lower)) return 'video';
        return 'image';
    }

    function isEmbedPlatform(url) {
        return /(^|\/\/)(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(url || '');
    }

    function toEmbedUrl(url) {
        const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/i);
        if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

        const vimeo = url.match(/vimeo\.com\/(\d+)/i);
        if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

        return url;
    }

    // Renders question media into `container` (clearing its previous
    // contents). `silhouetteActive` only affects images.
    function render(media, container, silhouetteActive) {
        container.innerHTML = '';
        if (!media || !media.src) return;

        const kind = media.kind || guessKind(media.src);

        if (kind === 'video') {
            if (isEmbedPlatform(media.src)) {
                const iframe = document.createElement('iframe');
                iframe.className = 'question-media question-video-embed';
                iframe.src = toEmbedUrl(media.src);
                iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
                iframe.allowFullscreen = true;
                iframe.frameBorder = '0';
                container.appendChild(iframe);
            } else {
                const video = document.createElement('video');
                video.className = 'question-media';
                video.src = media.src;
                video.controls = true;
                container.appendChild(video);
            }
        } else if (kind === 'audio') {
            const audio = document.createElement('audio');
            audio.className = 'question-audio';
            audio.src = media.src;
            audio.controls = true;
            container.appendChild(audio);
        } else {
            const img = document.createElement('img');
            img.src = media.src;
            img.alt = media.alt || '';
            img.className = 'question-media' + (media.silhouette && silhouetteActive ? ' silhouette' : '');
            container.appendChild(img);
        }
    }

    return { guessKind, render };
})();
