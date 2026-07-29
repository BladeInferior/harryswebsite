function renderHeart(liked) {
    const el = document.getElementById("latest-film-heart");
    el.textContent = liked ? "♥" : "♡";
    el.classList.toggle("liked", !!liked);
}

function renderStars(rating) {
    const starsEl = document.getElementById("latest-film-stars");
    starsEl.innerHTML = "";

    const value = parseFloat(rating) || 0;

    for (let i = 1; i <= 5; i++) {
        const star = document.createElement("span");
        star.className = "star";
        star.textContent = "★"; // empty/outline base

        // how much of this star should be filled (0, 0.5, or 1)
        let fillAmount = Math.min(Math.max(value - (i - 1), 0), 1);

        if (fillAmount > 0) {
            const fill = document.createElement("span");
            fill.className = "fill";
            fill.textContent = "★";
            fill.style.width = (fillAmount * 100) + "%";
            star.appendChild(fill);
        }

        starsEl.appendChild(star);
    }
}

async function loadLatestWatch() {
    try {
        const res = await fetch("https://orange-bar-b027.harrycummins.workers.dev/", {
            cache: "no-store"
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => null);
            console.error("Worker error body:", errBody);
            throw new Error("Worker request failed: " + res.status);
        }

        const data = await res.json();

        document.getElementById("latest-film-title").textContent =
            data.cleanTitle || "Unknown Title";

        document.getElementById("latest-film-date").textContent =
            data.watchedDate || "";

        document.getElementById("latest-film-review").textContent =
            data.review || "";

        document.getElementById("latest-film-card").href =
            "https://letterboxd.com/bladeinferior/";

        const posterEl = document.getElementById("latest-film-poster");
        const posterFallback = document.getElementById("latest-film-poster-fallback");

        if (data.poster) {
            posterEl.onload = () => {
                posterEl.style.display = "block";
                posterFallback.style.display = "none";
            };
            posterEl.onerror = () => {
                posterEl.style.display = "none";
                posterFallback.style.display = "flex";
            };
            posterEl.src = data.poster;
            posterEl.alt = data.cleanTitle || "Latest film poster";
        } else {
            posterEl.style.display = "none";
            posterFallback.style.display = "flex";
        }

        renderHeart(data.liked);
        renderStars(data.rating);

        console.log("Latest film data:", data);

    } catch (err) {
        console.error("Latest film load failed:", err);
    }
}

loadLatestWatch();