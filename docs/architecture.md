# Architecture

Skill Issue is a personal study application. You load a subject into it — source material, lessons and a bank of questions — and it takes you through the lessons, tests you, brings questions back when you are about to forget them, and keeps the notes you write on the way.

This document sets the frame the application is built inside. It states each choice with its reason, so that a later change can be weighed against what the choice was protecting.

## The four rules

Everything else follows from these.

1. **The application and the study material are separate things.** The application ships with no subjects. A subject is data, loaded through the API. Loading a subject, a lesson or a question never changes the application.
2. **The API is the only way in.** The browser app, the command-line tool and an AI assistant writing a new subject all use the same HTTP API. There is no second path that writes to the database.
3. **A function is a module.** Lessons, exams, review, notes and progress are separate modules on a small core. A new function is a new module; it does not require changing the others.
4. **What you did is recorded once, and everything else is derived from it.** Every answer is appended to a log that is never edited. Review schedules, mastery and statistics are computed from that log and can be rebuilt from it.

## Shape

```mermaid
flowchart LR
    browser["Browser app<br/>(React)"]
    cli["Command-line tool"]
    assistant["AI assistant<br/>authoring a subject"]
    server["Application server<br/>(Node, TypeScript)<br/>core + modules"]
    db[("PostgreSQL")]

    browser -->|HTTP API| server
    cli -->|HTTP API| server
    assistant -->|HTTP API| server
    server --> db
```

Two containers, started together with Docker Compose: the application server, which also serves the browser app, and the database. Nothing else is needed to run it.

## Technology

| Choice | Reason |
|---|---|
| **TypeScript throughout** — server, browser app, command-line tool | One definition of the content format serves all three and the published schema. The maintained reference implementation of the scheduling algorithm is a TypeScript library. A second language would mean writing the format and the scheduler twice. |
| **PostgreSQL**, one database | The application needs three kinds of storage: documents (lesson bodies, question definitions), relations (subject, area, lesson, question, source, prerequisite) and a time-stamped record of answers. PostgreSQL holds all three — JSON columns, foreign keys with recursive queries, and an append-only table — plus full-text search for notes. One database is one thing to install, back up and reason about. |
| **No separate graph or time-series database** | The relations are a shallow tree with a few cross-links, and the answer record grows by thousands of rows a year, not millions. Neither justifies its own server. Rule 4 keeps the door open: a derived store can be added later and filled by replaying the log. |
| **REST API described by OpenAPI**, generated from the schemas | The API is called by programs the application's author never sees — someone else's AI assistant, a script, `curl`. A plain HTTP API with a published description needs no client library. |
| **Zod schemas as the single definition of every content type** | The same schema validates an incoming request, types the server and browser code, and generates the JSON Schema and OpenAPI documents that authors read. The format cannot drift from its documentation. |
| **React single-page app, built with Vite, served by the application server** | One container serves both the API and the interface. Nothing in the interface needs server rendering. |
| **FSRS for review scheduling**, through its reference library | See "Review scheduling". |
| **oxlint with tsgolint for linting** | TypeScript 7 is the compiler, and typescript-eslint supports TypeScript only below 6.1. The rules that need types — a dropped promise, a `switch` that misses a case, an `any` leaking in from a library — run here on the TypeScript 7 compiler itself, so the linter cannot disagree with the build about a type. |
| **Docker Compose for running it** | One command starts everything, on any machine, with nothing installed but Docker. |

Library versions are pinned when the skeleton is built, from each project's current release page, and recorded in the lockfile, not here.

## Core and modules

### The core

The core is what every module needs and no module owns.

- **Catalogue** — subjects, areas, lessons, questions, sources and glossary terms: their identity, hierarchy, language and revisions.
- **Learning record** — the append-only log of everything the learner did.
- **Settings** — interface language, study preferences.
- **Module registry** — discovers modules and wires their routes, migrations, navigation entries and commands.
- **Platform** — database access, migrations, validation, error format, logging.

### The module contract

A module is a folder. It declares itself through one manifest and may contribute any of:

- API routes, mounted under its own prefix
- database migrations for tables it owns
- pages and navigation entries in the browser app
- commands in the command-line tool
- handlers for events in the learning record
- message catalogues for its interface text

Rules for modules:

- A module depends on the core. **It never imports another module.**
- A module owns its tables. No other module reads or writes them.
- Modules meet through the core: the catalogue for content, the learning record for what happened. Assessment appends an answer; review reads it. Neither knows the other exists.
- Removing a module's folder removes the function and breaks nothing else. A test asserts this for every module.

### Modules in the first version

| Module | What it does |
|---|---|
| `content` | Accepts, validates, versions and exports subject material. |
| `reader` | Shows source material, with its origin. |
| `lessons` | Runs a lesson step by step and tracks where you are. |
| `assessment` | Checks inside lessons, and final exams per lesson and per area. Grades answers. |
| `review` | Schedules questions to come back, and runs review sessions. |
| `notes` | Notes written beside a lesson, filed by subject, area and lesson; browsing and search. |
| `progress` | Mastery per lesson and area, and learning over time. |
| `diagnostics` | An opt-in recording of a study session — interface events, API calls, errors — kept locally, for finding faults. |

Functions that are expected later and must fit without rework: a glossary trainer, flashcards written by the learner, study streaks and goals, an assistant that explains a wrong answer. Each is a module by the contract above.

## Content model

```
Subject
├── Source            a piece of raw material, with where it came from
├── Glossary term
└── Area
    └── Lesson
        ├── Step      text, example, figure, or a check
        └── Question  belongs to the lesson's bank
```

- **Subject** — the unit that appears in the start menu.
- **Area** — a group of lessons with an order and optional prerequisites.
- **Lesson** — an ordered list of steps. A step is a block of teaching text, a worked example, or a check that asks one or more questions from the lesson's bank.
- **Question** — one item in the bank. It has a type, the correct answer, an explanation shown after answering, the lesson and concepts it tests, and the sources it rests on.
- **Source** — raw material: the text itself or a summary, with title, publisher, URL, the date it was read, and its licence where known. Lessons and questions cite sources by reference.
- **Exam** — not a fixed list. An exam is a blueprint: how many questions to draw, from which lessons or concepts, in what mix of types, and the mark needed to pass. Adding questions to a bank improves every exam drawn from it.

### Question types

A question type is a plug-in to the assessment module: a schema for the question, a schema for an answer, a grading function, and an interface component. The first version has:

- single choice, multiple choice, true or false
- numeric answer with unit and tolerance
- short text matched against accepted answers
- ordering and matching
- free recall, graded by the learner against a shown answer

A new type is added by registering these four parts. Nothing else changes.

### Identity, revisions and language

- Every item has a stable identifier chosen by its author, unique within its subject.
- Loading a changed item creates a new **revision**. The learning record refers to the revision that was answered, so a corrected question does not rewrite history.
- Every item carries a **language**. The same identifier may exist in several languages; these are translations of one item. Progress and scheduling attach to the identifier, not the language, so switching language keeps what you have learned.
- A subject states its default language. An item missing in the chosen language falls back to the default and says so.
- Interface text lives in message catalogues, one per module and language. Content language and interface language are chosen separately.

## Learning record

One append-only table. A row is written whenever the learner answers a question, completes a step, finishes a lesson or sits an exam. For an answer it holds:

- the item, its revision and the concepts it tests
- when, in UTC to the millisecond, with the learner's time zone
- what was answered, whether it was correct, and the score
- how long it took, the question type and the number of options
- the setting: lesson check, exam, scheduled review or extra practice
- for a review: the scheduler, its version and parameters, and the item's memory state before and after

Rows are never updated or deleted by the application. Everything a module shows about progress is a view over this table or a table rebuilt from it.

## Review scheduling

Review uses **FSRS**, the algorithm behind current Anki, through its reference TypeScript library, with the model version pinned.

- Each question the learner has met has a memory state: how hard it is for them, and how stable the memory is. From these the algorithm estimates the chance of recalling it today and schedules the next review for when that chance falls to the target, 90 % by default.
- Automatically graded answers map to two ratings: wrong is "again", right is "good". Free-recall questions offer all four.
- Scheduling is in whole days. A question answered wrongly in a session returns later in the same session, and then follows the schedule.
- The memory state per question is a table owned by the review module and can be rebuilt by replaying the learning record. Changing the algorithm, or fitting its parameters to the learner's own history, is a replay, not a migration.
- A check answered inside a lesson and an exam answer both count as observations, so a question does not need a separate "card" to enter review.

Open design points, to settle when the module is built: how a guessed multiple-choice answer should count, and how to behave when a bank is too small to avoid repeating the same question.

## API

- Versioned under `/api/v1`. The OpenAPI document is served by the application at `/api/v1/openapi.json`.
- **Content endpoints** accept one item or a whole subject. Loading is idempotent: the same content sent twice changes nothing. A whole subject is sent to `POST /api/v1/content/packs`, as JSON or as a zip archive of the pack folder.
- **Validation is strict and the errors are written to be acted on.** A rejected request returns a problem document listing every fault with the path to the offending field, what was expected and what was found. An AI assistant should be able to correct its output from the response alone.
- A **dry-run** flag validates without storing.
- **Export** returns a subject in the same format it is loaded in.

## Subject packs

A subject pack is a subject in file form: a folder of YAML and Markdown that mirrors the content model, with a `formatVersion`. The command-line tool validates a pack and loads it through the API; export writes one. A pack is the unit for sharing, reviewing and version-controlling a subject.

### Sharing a subject

A pack is made to be handed to someone else.

- Export writes a pack as a folder or as a single zip archive. Load accepts either.
- **A pack holds the subject and nothing about the person who studied it.** Notes, answers, progress and settings are never part of a pack; they belong to the personal backup.
- A pack names its format version and carries its own sources and assets, so it loads on any installation that supports that version, with no network access.
- Loading a pack whose subject identifier already exists is treated as an update of that subject and shows what would change before anything is stored. To keep both, the subject is loaded under a new identifier.
- An archive is unpacked defensively: entries that would land outside the pack folder are refused, and size and file count are bounded.

The format is specified in `content-format.md` and published as JSON Schema. It is versioned separately from the application: a pack written for an earlier format version keeps loading.

An **authoring guide** written for an AI assistant ships with the application. It explains how to research a subject, structure it into areas and lessons, write questions that test understanding, cite sources, validate and load the result.

## Storage

- Catalogue tables hold identity, hierarchy, language and revision; bodies are JSON validated by the schemas. They belong to the core, so that every module reads subject material the same way; the `content` module writes them through the core's catalogue service and owns no tables of its own.
- The core's migrations run before any module's, so a module's tables may refer to the catalogue. Migrations are ordered by code unit, never by the machine's locale, so that every installation applies them in the same order.
- The learning record is one table, indexed by time and by item.
- Each module's tables live in its own schema and are created by its own migrations.
- Notes are indexed for full-text search.
- **Backup** is two exports: subjects as packs, and personal data — notes, settings and the learning record — as one archive. Restoring both on a fresh install reproduces the learner's state.

## Security

The application is for one person on one machine, and the design keeps it that way.

- The server is published on the loopback interface only. It is not reachable from the network.
- Subject material is untrusted input, because it may be written by someone else's assistant. Markdown is rendered through a sanitiser with raw HTML disabled; links open in a new context; no script from a pack is ever run.
- Images and other files in a pack are stored and served by the application. Remote images are not fetched.
- All database access uses bound parameters.
- No credentials are stored in the repository. The database password is generated once by a script, before the first start, and kept in a local file that is not committed.

## Testing

- **Linting** with type information from the same compiler that builds the code, and no warnings: a finding fails the run or is not a rule. The rules that matter are held by fixtures of deliberate violations, each line naming the rule that must report it, so a rule that goes silent fails the run.
- **Unit tests** for grading, scheduling, exam drawing and validation.
- **API tests** against a real PostgreSQL in a container — no mocked database.
- **Contract tests**: the example pack in the repository loads cleanly, and a set of deliberately broken packs each produce the expected error.
- **Module isolation test**: the application starts and passes its tests with any one module removed.
- **Browser tests** for each flow, driven end to end.
- Every feature is done when its tests pass and a stated validation step — a real action in the running application — has been carried out.

## Extending

| To add | Do this | Touch the application? |
|---|---|---|
| A subject | Write a pack, load it | No |
| A lesson or questions | Add files to a pack, load it | No |
| A translation | Add the items in another language under the same identifiers | No |
| A question type | Register schema, answer schema, grader and component | One new folder |
| A function | Write a module with a manifest | One new folder |
| An interface language | Add message catalogues | Catalogue files only |
