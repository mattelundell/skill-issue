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

### Subject home

- **Due today** — the review queue, with a count and an estimate of the time it takes.
- **Path** — areas in order, each with its lessons and their state: not started, in progress, passed, mastered.
- **Material** — the source library.
- **Notes** — everything written in this subject.
- **Progress** — learning over time.

The path is a recommendation. Nothing is locked: a learner who already knows an area can sit its exam directly.

### Lesson

A lesson is a sequence of steps, one on screen at a time, with a progress bar.

- A **text step** teaches one idea. Terms from the glossary are marked and show their definition on hover.
- An **example step** works through a case.
- A **check step** asks one to three questions on what was just covered. The answer is graded at once, with the explanation and its source. A wrong answer brings the question back before the lesson ends.
- The lesson closes with a summary of what was covered, what was answered wrongly, and the offer to sit the lesson exam now or later.

The note pane sits beside the lesson. A note is attached to the lesson, and to the step it was written at, automatically. Selecting text in a step and pressing one key quotes it into the note.

Leaving mid-lesson is normal. The lesson resumes at the step you left.

### Exam

- A **lesson exam** draws questions from that lesson's bank; an **area exam** draws across the area's lessons.
- No feedback until the end. Then the mark, pass or fail against the blueprint's threshold, and a review of every answer with its explanation.
- Each sitting draws afresh, so an exam can be retaken without memorising its order.
- Wrong answers enter the review queue.

### Review

One question at a time from what is due across the subject — or across all subjects. Answer, see the explanation, continue. A session ends when the queue is empty or when you stop; stopping early is fine and the rest stays due.

A question answered wrongly returns later in the same session.

### Material

The source library: every piece of raw material in the subject, searchable, each with its title, publisher, link and the date it was read. A source shows which lessons and questions rest on it.

### Notes

All notes, browsable by subject, area and lesson, and searchable as text. A note links back to the step it was written at. Notes are written in Markdown and can be exported.

### Progress

- **Mastery per area and lesson** — the share of its questions you are currently expected to recall.
- **Over time** — reviews per day, the share answered correctly, and how the expected recall of the whole subject has moved.
- **Weak spots** — the concepts with the most wrong answers, each linking to its lesson.

## Mastery

A lesson has four states.

| State | Meaning |
|---|---|
| Not started | No step completed. |
| In progress | Some steps completed. |
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
