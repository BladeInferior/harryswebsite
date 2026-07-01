async function loadLatestWatch(){

    try{

        const data = await fetch("latest-film.json")
            .then(r=>r.json());

        document.getElementById("latest-film-title").textContent =
            data.title;

        document.getElementById("latest-film-rating").textContent =
            data.rating;

        document.getElementById("latest-film-date").textContent =
            data.date;

        document.getElementById("latest-film-card").href =
            data.link;

        document.getElementById("latest-film-poster").src =
            data.poster;

    }

    catch(err){

        console.error(err);

    }

}

loadLatestWatch();

