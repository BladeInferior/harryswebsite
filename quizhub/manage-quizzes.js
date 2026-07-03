import { QUIZ_PATHS } from './data/quiz-registry.js';

const QUIZZES = Object.entries(QUIZ_PATHS).map(([id, dataPath]) => ({ id, dataPath }));

const quizList = document.getElementById('quiz-list');

Promise.all(
    QUIZZES.map(quizRef =>
        fetch(quizRef.dataPath)
            .then(res => res.json())
            .then(data => ({ ...quizRef, ...data }))
    )
).then(quizzes => {
    quizList.innerHTML = '';

    quizzes.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'card';

        const h3 = document.createElement('h3');
        h3.textContent = quiz.title;

        const p = document.createElement('p');
        p.textContent = quiz.description || '';

        const link = document.createElement('a');
        link.className = 'btn';
        link.href = `host-quiz.html?quiz=${encodeURIComponent(quiz.id)}`;
        link.textContent = 'Start Quiz';

        card.appendChild(h3);
        card.appendChild(p);
        card.appendChild(link);
        quizList.appendChild(card);
    });
});
