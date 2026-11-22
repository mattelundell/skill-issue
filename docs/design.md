# Design

How Skill Issue behaves for the person studying. `architecture.md` says how it is built; this says what it is like to use, and why.

## Who it is for

One person who wants to learn a subject properly on their own, in sessions of ten minutes to an hour, over weeks. They chose the subject. They do not need to be coaxed into opening the application, but they do need it to tell them what to do next without thinking.

## Principles

1. **Always one obvious next thing.** Opening the application shows what is due and where you left off. One button continues.
2. **Recall beats rereading.** The application asks before it tells where it can, asks again later, and treats a wrong answer as the useful moment, not a failure.
3. **Every claim has an origin.** A lesson shows its sources. A question's explanation links to where the answer comes from.
4. **Notes are part of studying, not a separate chore.** The note pane is always one keystroke away and never takes you out of the lesson.
5. **Honest numbers.** Progress shows what you can recall, not how many screens you clicked through.
6. **Quiet.** No mascots guilt-tripping, no confetti for every answer. A streak is shown; it is not used as a threat.

## Screens

### Start

A list of subjects, each with its mastery, the number of reviews due and the lesson you were last in. One primary action per subject: **Continue**. An empty installation explains how to load a first subject.

Under the lesson you were last in, one line gives the questions due in every subject together and about how long they take, with **Repetera allt** leading into one session of them all. With one subject holding them, the line names it — the only place an installation of one subject sees its figure while that subject's row is hidden behind the lesson offered above. Nothing is said when nothing is due.

### Subject home

- **Due today** — the review queue, with a count and an estimate of the time it takes.
- **Path** — areas in order, each with its lessons and their state: not started, in progress, passed, mastered.
- **Material** — the source library.
- **Notes** — everything written in this subject.
- **Progress** — learning over time.

The path is a recommendation. Nothing is locked: a learner who already knows an area can sit its exam directly.

### Lesson

A lesson is a sequence of steps, one on screen at a time, with a progress bar.

- A **text step** teaches one idea. Terms from the glossary are marked, and their definition, the other names they go by and the sources they rest on stand beside the text on the workbench, lit while the term is pointed at or focused; in focus mode and on a phone they open in a card at the term, on hover, on focus or on a press. A term is marked once per step, the first time the step names it, so the text is not strewn with marks; an example step applies what a text step marked and is not marked again.
- An **example step** works through a case.
- A **check step** asks one to three questions on what was just covered. The answer is graded at once, with the explanation and its source. A wrong answer brings the question back before the lesson ends, even when the lesson was left and resumed in between. A check step come back to — after leaving, or by going back a step — shows the answers already given in this pass through the lesson rather than asking them again; a pass begins when a lesson gone through to its end is opened again.
- The lesson closes with a summary of what was covered, what was answered wrongly, and the offer to sit the lesson exam now or later.

A lesson is read in one of two ways, switched with **Fokusläge** in its header or **F**, and remembered on the device:

- **The workbench**, the default: the lesson's steps and the sources it rests on in a column to the left of the text, the note pane and the step's terms in a column to its right. Explanation stands beside what it explains, so the eye does not leave the page to find it. Below 1280px the left column gives way.
- **Focus mode**, for reading without clutter: one centred column with nothing beside it; the note pane opens as a drawer at the window's edge that never narrows the text, and a figure may be wider than the text.

Either way the text keeps about 65 characters a line and its type grows with the window; a phone has one column and no switch.

The note pane sits beside the lesson, closed until **N** or **Anteckna** under the step opens it; **N** again, or Escape from inside it, closes it. A note is attached to the lesson, and to the step it was written at, automatically: each step has one note, the pane shows the one for the step on screen, and it is saved as it is written, with no button to press. Selecting text in a step and pressing **Q** quotes it into the note as a Markdown quote.

Leaving mid-lesson is normal and needs no confirmation; the lesson says on its way out where it will take up. It resumes at the step you left, says so once, and offers a way back to the first step. A lesson already gone through to its end opens at its first step. When the subject has been reloaded and the lesson changed since you were in it, the lesson says so and resumes at the same step number — or at its last step, if it became shorter — because a step number is all that can be kept across a change.

The start screen offers the lesson you were last in, if it is unfinished, or else the next one on that subject's path not yet gone through; the subject home suggests the same for its own lessons.

### Exam

- A **lesson exam** draws questions from that lesson's bank; an **area exam** draws across the area's lessons.
- No feedback until the end. Then the mark, pass or fail against the blueprint's threshold, and a review of every answer with its explanation.
- Each sitting draws afresh, so an exam can be retaken without memorising its order.
- Wrong answers enter the review queue.

### Review

One question at a time from what is due across the subject — or across all subjects, at `/review`, where the most overdue comes first whichever subject holds it, and each question says which subject it is from. Answer, see the explanation, continue. A session ends when the queue is empty or when you stop; stopping early is fine and the rest stays due.

A question answered wrongly returns later in the same session, behind the next three questions, or at the end when fewer are left; the session is over when each of its questions has been answered right once.

The subject home says how many questions are due today and about how long they take at the learner's own pace, or, with nothing due, when the next review is. Each subject's row on the start screen says the same in a line.

### Material

The source library: every piece of raw material in the subject, searchable, each with its title, publisher, link and the date it was read. A source shows which lessons and questions rest on it.

- The library opens with the sources most of the subject rests on first, and can be ordered by title or by the date read instead, or narrowed to one publisher.
- A search looks through titles, publishers and the material itself, and matches from the start of a word: "etal" finds Etal, not the middle of "återbetalningstid", because someone searching for a term wants the term.
- One source has its own address. It shows its origin, the material, and what rests on it: the citing lessons by area, how many questions in each cite it, and the terms that do. The questions themselves are not shown, so reading the material does not give away answers before a lesson asks them.
- A source the subject no longer holds still opens, as it last stood and marked as removed, so that an answer once given on its strength keeps an origin.

### Notes

All notes, browsable by subject, area and lesson in the order of the path, and searchable as text: a search finds notes in which every word given starts a word. A note links back to the step it was written at, and opens the lesson there. Notes are written in Markdown and can be exported.

### Progress

- **Mastery per area and lesson** — the share of its questions you are currently expected to recall.
- **Over time** — reviews per day, the share answered correctly, and how the expected recall of the whole subject has moved.
- **Weak spots** — the concepts with the most wrong answers, each linking to its lesson.

## Mastery

A lesson has four states.

| State | Meaning |
|---|---|
| Not started | No step completed. |
| In progress | Some steps completed — or all of them, while the lesson exam is not yet passed: then it reads "all steps gone through", so a finished lesson does not look abandoned. |
| Passed | The lesson exam was passed. |
| Mastered | Passed, and the expected recall of its questions is at or above the target. |

Mastery can be lost. If the questions of a mastered lesson fall due and are not reviewed, the lesson drops back to passed. That is the application being honest, and it is shown without drama.

## Language

Interface language and content language are separate settings. A subject available in several languages offers the choice on its home screen. Where an item is missing in the chosen language it is shown in the subject's default language, marked as such.

## Command line

The command-line tool is a second front end on the same API.

- **Content**: validate a pack, load it, export a subject, back up and restore personal data.
- **Study**: run a review session and sit a quiz in the terminal.
- **Status**: what is due, per subject.

Reading lessons is designed for the browser, where figures, the glossary and the note pane have room.

## Keyboard

Every study flow works without a mouse: number keys choose an option, Enter confirms and continues, one key opens the note pane, one key quotes the selection.

## Accessibility

Text scales with the browser setting. Colour is never the only signal for right and wrong. Every interactive element is reachable and labelled for a screen reader.

## Session recording

For finding faults, a session can be recorded: with the learner's consent, switched on from settings, the application keeps a local log of interface events, API calls and errors for that session, and can export it as one file. Nothing is recorded unless it is switched on, and nothing leaves the machine.
