# Writing a subject for Skill Issue

This guide is written for an AI assistant asked to write a subject: to research it, turn it into lessons and questions, and load it into a running Skill Issue. A person can follow it too. It assumes nothing but this guide, [`content-format.md`](content-format.md), which specifies every file, and a running application at `http://127.0.0.1:4747` (the address below; use another port if the installation chose one).

The figures in this guide — how many areas, steps and questions — are advice, which makes a subject good to study. What the application enforces is listed in `content-format.md`, "Rules the application enforces"; a pack that keeps those loads, whether or not it follows the advice.

What you produce is a **pack**: a folder of YAML and Markdown files. The application checks every pack against the format and refuses one that breaks a rule, with a list of every fault, each naming the file, the item and the field to correct. You fix those and send it again. You never need to guess whether a pack is right: the application tells you.

`examples/example-subject/` in the application's repository is a small, complete pack that uses every part of the format: every question type, a translated lesson, an image. Copy its shape; it is a model for writing, not a subject to study, and is not loaded into an installation.

## What makes a good subject

The learner reads a lesson a step at a time, answers short checks along the way, sits an exam at the end of each lesson and each area, and afterwards gets the questions back on a schedule set by how well they remembered them. So:

- **Every claim rests on a source.** The learner sees where each lesson, question and term comes from. Do not write what you cannot cite. A claim you could not verify does not become a question.
- **Questions test understanding, not recall of wording.** A question that can be answered by recognising a phrase from the lesson teaches nothing. Ask the learner to apply, compare, calculate or explain.
- **Lessons are small.** One lesson covers one idea or a few closely tied ones, in about five to twelve steps. A learner should finish one in ten to twenty minutes.
- **Write in the language the learner studies in**, and use the terms practitioners in the field use, even when they are borrowed words. The subject states its default language; the learner reads everything in it.

## Step 1 — Research the sources

Collect the material the subject rests on before you write anything else: official guidance, standards bodies, textbooks, reputable publishers. For each source note its title as published, the publisher, the address if it is on the web, the day you read it and its licence as stated (`unknown` if none is given).

Each source becomes a file `sources/<source-id>.md`: front matter with those facts, then the material itself. Write a **summary** in your own words — the normal case. Quote an **excerpt** only where the licence allows it, and include the **full** text only of material whose licence permits copying. Say which it is in `kind`.

Write a source in the subject's language, as a summary, even when the material is in another: the learner reads it beside the lessons. An excerpt keeps the language it was published in. A source file without a language suffix belongs to the subject's default language either way; the suffix is only for a translation of the same source.

`accessed` is a date written `YYYY-MM-DD`. `licence` is the licence as the source states it, short: `CC BY-SA 4.0`, `© Boverket, all rights reserved`, or `unknown`.

Mark in your own notes anything you could not confirm. Do not build a question on it.

## Step 2 — Shape the subject

Decide, before writing lessons:

1. **Areas**: three to eight groups of related lessons, in the order the path recommends. An area may `require` earlier ones; nothing is locked, it is a recommendation.
2. **Lessons** in each area, in order. Give each a title and a one-sentence summary.
3. **Concepts**: the things the subject teaches, each with an identifier and the name the learner reads. Every lesson lists the concepts it teaches; every question names the concepts it tests. The learner's weak spots are reported by concept, so a concept should be something worth practising on its own — "U-value", "payback time" — not a whole area, and not a single fact.
4. **Identifiers** for the subject, every area, lesson, question, source, glossary term and concept: lowercase letters and digits in words joined by hyphens, such as `payback-time`. An identifier is permanent once the subject has been loaded: the learner's history attaches to it, and changing it makes a new item and orphans the old one's history. Choose them with care and write letters without accents (`varmepump`, not `värmepump`). Identifiers are unique per kind, so a concept and a glossary term may share one; they are not linked by it.

Write `subject.yaml` (with every area in path order and every concept with its name) and an `area.yaml` per area.

## Step 3 — Write each lesson

A lesson is `areas/<area-id>/lessons/<lesson-id>/lesson.md`: front matter with its title, summary, concepts, sources and exam, then steps. Use three kinds of step:

- **text** teaches one idea. Short paragraphs, plain words, a definition the first time a term appears.
- **example** works through a case: a calculation with real numbers, a building, a decision. Use one after every idea that is applied rather than just known.
- **check** asks one to three questions from the lesson's own bank about what was just covered. Put one after every two or three teaching steps. The learner answers before going on; a wrong answer is asked again at the end of the lesson.

A good shape: text, example, check; text, text, example, check; and so on, ending with a check.

A lesson's `sources` lists what its text rests on; its questions cite their own. Use `##` and lower for headings inside a step: the lesson's title is the page's heading.

These fields are Markdown: a step's body, a source's body, a question's `prompt` and `explanation`, a free-recall `answer` and a glossary term's `definition`. Everything else — titles, summaries, option texts, ordering items, matching sides, accepted short answers — is plain text, shown as written.

Markdown may hold headings, lists, tables, emphasis, links and images. It may not hold raw HTML. An image is a file in `assets/` (PNG, JPEG, GIF or WebP; never SVG), written `![what it shows](assets/file.png "optional caption")`; the description in brackets is read aloud to a learner who cannot see it, so say what the image shows.

## Step 4 — Write the questions

Each lesson's bank is `questions.yaml` beside its `lesson.md`. Every question has an `id`, a `type`, the `concepts` it tests, the `sources` it rests on, a `prompt` and an `explanation` shown after it is answered, right or wrong.

Choose the type by what you want to know:

| Type | Use it to ask | Write |
|---|---|---|
| `single-choice` | which one of several is right | `options` (each `{ id, text }`) and `answer`: one option id |
| `multiple-choice` | which several are right | `options` and `answer`: a list of option ids |
| `true-false` | whether a statement holds | `answer`: `true` or `false` |
| `numeric` | the result of a calculation | `answer: { value, unit, tolerance }` |
| `short-text` | a term or a short name | `accepted`: every answer to accept; `caseSensitive` if case matters |
| `ordering` | the order of steps or magnitudes | `items`, written in the correct order |
| `matching` | which belongs with which | `pairs`, each `{ left, right }` |
| `free-recall` | an explanation the learner gives themselves | `answer`: what a good answer says; the learner grades themselves |

Write them well:

- **Wrong options are plausible.** Each should be what someone with a specific misunderstanding would choose, never a joke or an obviously absurd value. Three or four options suit most choices.
- **Positions give nothing away.** Options and matching sides are shuffled every time a question is asked, and ordering items are never shown in their correct order, so write the answer wherever it reads best.
- **Numbers carry a unit and a tolerance.** The learner types only the number, with a decimal comma or point; the unit is shown beside the field. An answer is right when it lies within `tolerance` of `value`, either side, inclusive — an absolute amount in the question's unit, not a share. A tolerance of `0` demands the exact value; allow for rounding where the calculation invites it, and say in the prompt how to round. In the file, `value` is a YAML number, so it is written with a point.
- **Short answers match whole.** Spaces at the ends are ignored and runs of spaces count as one; case is ignored unless `caseSensitive: true`. Accents, hyphens and spelling must match an accepted answer exactly, so list every form a right answer may take: `Ohm`, `ohm`, `Georg Ohm`.
- **Free recall shows the answer, then the explanation.** The learner thinks of an answer, is shown `answer` — what a good answer says — and grades themselves; `explanation` then adds why, or what a weaker answer misses.
- **The explanation teaches.** It says why the right answer is right, and where a common wrong one goes wrong. A learner reads it after every answer.
- **True-or-false and two-way choices are easy to guess.** Use them for statements worth checking, not as the bulk of a bank.

**How many.** A lesson's exam draws `exam.questions` from its bank, so the bank holds at least that many; give it twice that, so two sittings differ. A good default: a bank of 10–16 questions per lesson, an exam of 6–8 with a `passMark` of `0.8`. An area's exam draws afresh from the whole of all its lessons' banks; give it about the sum of its lessons' exams.

## Step 5 — Glossary and figures

`glossary.yaml` lists the terms a learner may need to look up: each with its `term`, a short `definition`, any `alsoKnownAs` names and its `sources`.

You do not mark terms in the lessons. The application marks a glossary term in a text step the first time the step names it, by its `term` or any of its `alsoKnownAs` names, and shows its definition beside it. So write the term in the text as the glossary spells it, and put the other forms a lesson uses — another name, a plural, an abbreviation — in `alsoKnownAs`.

Put images in `assets/`. Draw figures with a plain background and labels large enough to read at a column's width. If a figure shows made-up data, say so in its caption.

## Step 6 — Check and load

Zip the pack folder and send it with `?dryRun=true` first, which checks everything and stores nothing:

```sh
cd my-subject && zip -r ../my-subject.zip . && cd ..
curl -s -X POST -H 'content-type: application/zip' --data-binary @my-subject.zip 'http://127.0.0.1:4747/api/v1/content/packs?dryRun=true'
```

A pack can also be sent as one JSON document of the shape the JSON Schema at `/api/v1/content/schema/pack.json` describes, with `content-type: application/json`.

A refused pack is answered `422` with `faults`, each:

```json
{ "code": "unknown-source", "file": "areas/grunder/lessons/u-varde/questions.yaml", "item": "question u-varde-enhet", "field": "sources[0]", "expected": "the id of a source in this pack", "found": "\"boverket-bbr\"" }
```

Correct every fault and send the pack again; the list is complete, not only the first. The common ones:

| Code | Means | Fix |
|---|---|---|
| `schema` | a field is missing or of the wrong type | follow `expected` |
| `unknown-field` | a field the format does not have, often a misspelling | correct its name, or remove it |
| `derived-field` | a field that follows from where the file is: a file never states its own language, a question never its lesson | remove it |
| `unknown-source`, `unknown-question`, `unknown-lesson`, `unknown-area`, `unknown-concept`, `unknown-asset`, `unknown-option` | a reference to something the pack does not hold | add the item, or correct the id |
| `lesson-not-in-area`, `lesson-in-two-areas`, `area-not-in-path` | an item is not placed exactly once | list it in its area's `lessons` or the subject's `areas` |
| `exam-larger-than-bank` | an exam draws more questions than its bank holds | write more questions, or draw fewer |
| `question-not-in-bank` | a check asks a question from another lesson | move the question, or ask one of this lesson's own |
| `raw-html`, `remote-image`, `unsafe-link` | Markdown that could run or fetch something | use Markdown only, images from `assets/`, links to `http`, `https` or `mailto` |
| `translation-mismatch`, `missing-original` | a translation that differs in structure, or has no original | see "Translations" |
| `invalid-yaml`, `invalid-front-matter`, `invalid-step`, `text-outside-step` | a file cannot be read | fix the syntax at the place named |
| `unexpected-file`, `id-mismatch`, `lesson-misfiled` | a file in the wrong place, or named for another item | a folder's or file's name is its item's id |

When the dry run answers `200`, send it without `?dryRun=true`. A new subject is answered `201`, an existing one `200`, with what changed: `added`, `changed` and `retired` items, how many were `unchanged`, `created` for a new subject, and `stored`. `stored` is `false` on a dry run and when nothing differed — sending the same pack twice is not a failure. Open `http://127.0.0.1:4747`, take the first lesson, and read it as the learner will.

## Correcting a subject later

**One item at a time.** A question, lesson, source or glossary term can be put into a loaded subject on its own, written as JSON in the same shape as in a pack sent as JSON — with its `language`, and a question with its `lesson`:

```sh
curl -s -X PUT -H 'content-type: application/json' --data-binary @question.json \
  http://127.0.0.1:4747/api/v1/content/subjects/<subject>/questions/<question-id>
```

The collections are `questions`, `lessons`, `sources` and `glossary`. The item replaces the one with the same id and language, or is added; the whole subject as it would then stand is checked, so the faults are the same as for a pack. The answer gives the item's revision: a changed item gets a new one, and the learner's earlier answers keep pointing at the revision they answered. A new lesson cannot be added alone, because its area must list it: load the whole pack.

**The whole pack.** Loading a pack for a subject that exists updates it: changed items get a new revision, and items the pack no longer holds are retired — kept with their history, no longer offered. Loading the same pack twice changes nothing. Keep the pack folder under version control and load it whole after larger changes.

## Translations

A subject can be written in several languages. A translation is the same file with a language code before the extension: `lesson.en.md` beside `lesson.md`, `subject.en.yaml` beside `subject.yaml`. It repeats the whole item in the other language, and changes words, never structure: the same steps, the same questions in each check, the same options and answers, the same concepts and sources. The table in `content-format.md` lists exactly what must stay the same. Translate the concepts' names in `subject.<lang>.yaml` too.

## Before you hand it over

- [ ] Every source states where it came from and when it was read, and nothing unverified became a question.
- [ ] Every concept a lesson teaches is declared in `subject.yaml` with a name a learner understands.
- [ ] Every lesson ends with a check, and its bank holds about twice its exam.
- [ ] Every question's explanation says why, and every wrong option is a real misunderstanding.
- [ ] A dry run answers `200`.
- [ ] The first lesson has been taken in the browser, start to finish.
