let quiz = null;
let currentIndex = 0;
let score = 0;
let totalPossible = 0;
let results = [];
let answered = false;

const questionContainer = document.getElementById('question-container');
const feedbackEl = document.getElementById('feedback');
const scoreDisplay = document.getElementById('score-display');
const submitBtn = document.getElementById('submit-btn');
const nextBtn = document.getElementById('next-btn');
const quizArea = document.getElementById('quiz-area');
const summaryEl = document.getElementById('summary');
const summaryScoreEl = document.getElementById('summary-score');
const summaryListEl = document.getElementById('summary-list');
const restartBtn = document.getElementById('restart-btn');

document.addEventListener('DOMContentLoaded', () => {
    fetch('data/sample-quiz.json')
        .then(res => res.json())
        .then(data => {
            quiz = data;
            totalPossible = quiz.questions.reduce((sum, q) => sum + q.points, 0);
            startQuiz();
        });

    submitBtn.addEventListener('click', handleSubmit);
    nextBtn.addEventListener('click', handleNext);
    restartBtn.addEventListener('click', startQuiz);
});

function startQuiz() {
    currentIndex = 0;
    score = 0;
    results = [];

    summaryEl.hidden = true;
    quizArea.hidden = false;

    updateScoreDisplay();
    renderQuestion(currentIndex);
}

function updateScoreDisplay() {
    scoreDisplay.textContent = `Score: ${score} / ${totalPossible}`;
}

function renderQuestion(index) {
    const question = quiz.questions[index];
    answered = false;

    questionContainer.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = question.prompt;
    questionContainer.appendChild(heading);

    if (question.media) {
        const img = document.createElement('img');
        img.className = 'question-media' + (question.media.silhouette ? ' silhouette' : '');
        img.src = question.media.src;
        img.alt = question.media.alt || '';
        questionContainer.appendChild(img);
    }

    const answerMount = document.createElement('div');
    answerMount.className = 'answer-mount';
    questionContainer.appendChild(answerMount);

    AnswerTypeRegistry.get(question.type).renderInput(question, answerMount);

    feedbackEl.hidden = true;
    feedbackEl.className = '';
    feedbackEl.innerHTML = '';

    submitBtn.hidden = false;
    submitBtn.disabled = false;
    nextBtn.hidden = true;
}

function handleSubmit() {
    if (answered) return;
    answered = true;

    const question = quiz.questions[currentIndex];
    const answerMount = questionContainer.querySelector('.answer-mount');
    const typeImpl = AnswerTypeRegistry.get(question.type);

    const value = typeImpl.getValue(answerMount, question);
    const gradeResult = typeImpl.grade(value, question);
    const pointsAwarded = gradeResult.correct ? question.points : 0;

    score += pointsAwarded;
    updateScoreDisplay();

    results.push({
        questionId: question.id,
        type: question.type,
        value,
        correct: gradeResult.correct,
        pointsAwarded,
        manualOverride: null
    });

    if (typeof typeImpl.reveal === 'function') {
        typeImpl.reveal(answerMount, question, value, gradeResult);
    }

    feedbackEl.hidden = false;
    feedbackEl.className = gradeResult.correct ? 'correct' : 'incorrect';
    feedbackEl.innerHTML = gradeResult.correct ? 'Correct!' : 'Incorrect.';

    if (question.explanation) {
        const explanation = document.createElement('span');
        explanation.className = 'explanation';
        explanation.textContent = question.explanation;
        feedbackEl.appendChild(explanation);
    }

    submitBtn.hidden = true;
    nextBtn.hidden = false;
}

function handleNext() {
    currentIndex++;

    if (currentIndex < quiz.questions.length) {
        renderQuestion(currentIndex);
    } else {
        renderSummary();
    }
}

function renderSummary() {
    quizArea.hidden = true;
    summaryEl.hidden = false;

    summaryScoreEl.textContent = `Final Score: ${score} / ${totalPossible}`;

    summaryListEl.innerHTML = '';
    results.forEach((result, i) => {
        const question = quiz.questions.find(q => q.id === result.questionId);
        const li = document.createElement('li');
        li.className = result.correct ? 'correct' : 'incorrect';
        li.textContent = `Q${i + 1}: ${question.prompt} — ${result.correct ? 'Correct' : 'Incorrect'} (${result.pointsAwarded} pts)`;
        summaryListEl.appendChild(li);
    });
}
