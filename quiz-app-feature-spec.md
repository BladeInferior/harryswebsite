# Quiz Builder — Feature Spec for Implementation

Hand this file to Claude in VS Code / Claude Code as the implementation backlog. Each item includes the requirement, the reasoning behind it, and concrete acceptance criteria so it can be built and verified without further clarification. Items are grouped by area; within each area they're roughly ordered by dependency (earlier items may be prerequisites for later ones).

---

## 1. Quiz Creation & Import

### 1.1 Spreadsheet / bulk import for quiz questions
- Add an "Import from spreadsheet" option in the quiz builder (support `.csv` and `.xlsx`).
- Define a template/column schema (e.g., `question, type, answer(s), points, media_url, category`) and provide a downloadable template file.
- Parse the file, validate rows, and show a preview/error list (e.g., "Row 5: missing answer") before committing the import.
- Imported questions should be editable afterward like any manually created question.

---

## 2. Host Screen & Session Management

### 2.1 Persistent join code + QR code
- Join code and QR code should be pinned in the top-right corner of the host screen at all times (not just on a "lobby" screen), so a disconnected player always has a way back in.

### 2.2 Player reconnection by name
- If a connected player disconnects and later rejoins using the **same name**, they should be reconnected to their existing player session (same score, same answer history) — not created as a new player entry.
- Reconnect logic should be case-insensitive/trim whitespace where reasonable, but should also handle the edge case of two different people trying to use the same name (e.g., prompt "This name is already active — reconnect as this player?" if there's ambiguity, or lock names to session tokens/device IDs behind the scenes).
- On reconnect, show a "[Name] has reconnected" event to the host.

### 2.3 "Waiting on X players" indicator after locking in
- Once a player locks in their answer, show them how many other players have **not yet answered** (e.g., "Waiting on 3 more players...").
- This count should update live as other players answer.

### 2.4 "[Name] has joined" notification on host screen
- When a player initially joins the quiz (first-time join, not a reconnect), show a brief notification/toast on the host screen (e.g., "Alex has joined").
- This is distinct from the reconnect notification in 2.2 ("[Name] has reconnected") — joining and reconnecting should be visually/textually distinguishable to the host.

### 2.5 Persistent player list on host screen
- Add a list of all joined players on the host screen, displayed **at all times**, positioned directly under the join code and QR code (top-right area, per 2.1).
- If a player disconnects, their entry greys out (visually indicating disconnected) rather than being removed from the list.
- When that player reconnects (per 2.2), their entry returns to its normal (active) appearance.
- List should update live as players join, disconnect, and reconnect.

### 2.6 Hide/show scoreboard toggle on host screen
- Add a toggle on the host screen to hide or show the live scoreboard, for cases where the host wants to reveal standings only at the end (e.g., in-person/dramatic reveal use case).
- **Default: hidden.**
- **When hidden:** scores are not shown live; at the end of the quiz, results are revealed the way they currently work today (i.e., no change to existing end-of-quiz behavior).
- **When shown:** the live scoreboard is visible throughout, and at the end of the quiz the final results are automatically displayed immediately (no separate "reveal" step needed, since scores were already visible).
- This setting should be toggleable by the host at any point during the quiz, with the current state applying going forward (doesn't need to retroactively reveal/hide past standings, just controls current and future visibility).

---

## 3. Question Types

### 3.1 Buzzer-only question type
- New question type: **Buzzer**. No text/multiple-choice input for players — just a "Buzz In" button.
- Host sees the order in which players buzzed in (first to last).
- Host manually marks the buzzed-in player's verbal answer as correct/incorrect, which awards/withholds points accordingly.
- After a buzz, other players should be locked out until the host resolves it (correct, incorrect — allow next buzzer, or reset).

### 3.2 Multi-answer question type (partial credit)
- New question type where a player can enter **multiple answers** in response to one question (e.g., "Name 3 planets").
- Each submitted answer is checked independently against a list of accepted correct answers.
- Points are awarded **per correct answer**, not all-or-nothing.
- Define behavior for duplicate/repeated answers from the same player (should not double-count).

### 3.3 Fix number-type answer input
- Align the numeric answer input's UI/UX with the other answer-input types (currently inconsistent) — same styling, sizing, keyboard behavior (numeric keypad on mobile), and validation feedback.

---

## 4. Answer Matching / Validation

### 4.1 Fuzzy/normalized text matching for answers
- Text answers should be checked with normalization rather than exact string match:
  - Case-insensitive (upper/lower).
  - Whitespace-insensitive (ignore leading/trailing/extra spaces, and optionally ignore all spaces vs. with spaces — e.g., "New York" matches "newyork").
  - Applies to both single-answer and multi-answer question types (3.2).
- This should be a shared/reusable answer-checking utility so all question types use the same normalization logic.

---

## 5. Media Embeds

### 5.1 Video embed
- Add an option in question creation to embed a video (e.g., via URL — YouTube/Vimeo/direct file link) that plays on the host and/or player screen as part of the question.

### 5.2 Audio embed
- Add an option to embed/upload an audio clip that plays as part of a question (e.g., "name that sound/song").

---

## 6. Question Review Hub (Players)

### 6.1 Player-facing "past questions" hub
- Add a hub/section for players to review questions from quizzes they've already completed.
- Structure: click into a **category** → see a **list of all questions** in that category → click a question to view it in full (question, their answer, correct answer, points earned).
- This should be **opt-in per quiz** — an option in quiz management to allow/disallow this review feature for that specific quiz.

---

## 7. Quiz Preview Mode (Host/Management)

### 7.1 Host preview mode
- Add a "Preview Quiz" option in quiz management that lets the host click through the entire quiz as if playing it (seeing questions, media, answer options, timing) without needing real players connected — for QA/testing before running it live.

---

## 8. Quiz Management UI

### 8.1 Non-disruptive save
- Add a "Save" button for the whole quiz in the management screen that saves all changes **without navigating away** from the current quiz editing screen (no forced redirect/kick-out after saving).

### 8.2 Mobile reordering via up/down arrows
- On mobile quiz management, replace/supplement drag-and-drop reordering (currently unreliable on touch) with explicit up/down arrow buttons on each question/item to move it in the list.

---

## 9. Offline / Manual Scoring

### 9.1 Manual leaderboard entry modal
- Add a way to manually add players and points/stats directly to the leaderboard, for use when running a quiz offline (e.g., in person without the app tracking answers live).
- Implement as a modal: host can add a player name and enter their score/stats manually, which then appears on the leaderboard alongside (or instead of) live-tracked players.

---

## Suggested Build Order
1. Answer-matching utility (4.1) — foundational, used by multiple question types.
2. Question types: buzzer (3.1), multi-answer (3.2), number-input fix (3.3).
3. Media embeds (5.1, 5.2).
4. Spreadsheet import (1.1).
5. Session/reconnection logic (2.1, 2.2, 2.3, 2.4, 2.5, 2.6).
6. Quiz management UX (8.1, 8.2).
7. Preview mode (7.1).
8. Review hub (6.1).
9. Manual leaderboard entry (9.1).

---

## Open Questions to Resolve Before/During Build
- For player reconnection (2.2): should names be strictly unique per session, or do we need device/session tokens to disambiguate two different people picking the same name?
- For multi-answer questions (3.2): is there a cap on how many answers a player can submit, and is there a time limit per answer or for the whole question?
- For the review hub (6.1): should players be able to see the *correct* answer if they got a question wrong, or only their own submitted answer?
