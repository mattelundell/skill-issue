# Subject pack format — draft of version 1

A subject pack is one subject as a folder of files. This document describes the format; the JSON Schema generated from the application's own definitions is the authority, and the application rejects anything that does not match it. A running application serves that schema at `/api/v1/content/schema/pack.json`, and `examples/example-subject/` in the repository is a complete pack that uses every part of the format.

**Status: draft.** The format becomes version 1 when the first real subject has been written to it and loaded. Until then it may change.

## Layout

```
my-subject/
├── subject.yaml
├── glossary.yaml
├── sources/
│   └── <source-id>.md
├── assets/
│   └── <file>
└── areas/
    └── <area-id>/
        ├── area.yaml
        └── lessons/
            └── <lesson-id>/
                ├── lesson.md
                └── questions.yaml
```

A translation is the same file with a language suffix before the extension — `lesson.en.md` beside `lesson.md`, `questions.en.yaml` beside `questions.yaml`. A file with no suffix is in the subject's default language. A translation repeats the whole item, and an item in another language must also exist in the default language.

A file never states its own language, and a question never states its lesson: both follow from where the file is, and a file that states them is rejected.

A pack folder may also hold a `README` and a `LICENSE` at its root, which the application ignores, and hidden files and folders such as `.git/`, which it skips. Any other file the layout does not describe is rejected, so that a misplaced file is reported rather than silently left out.

A folder's name is the identifier of what it holds: `areas/grunder/area.yaml` has `id: grunder`, and a source's file name is its identifier.

## Identifiers

Lowercase letters and digits, in words separated by single hyphens, at most 64 characters: `energi-och-effekt`. Unique within the subject for their kind. An identifier is permanent: changing it makes a new item and orphans the history of the old one.

## subject.yaml

```yaml
formatVersion: 1
id: example-subject
defaultLanguage: sv
title: Exempelämne
summary: En mening om vad ämnet täcker.
areas:            # order of the path
  - grunder
  - fordjupning
```

## sources/&lt;source-id&gt;.md

```markdown
---
id: authority-handbook
title: Handbook title as published
publisher: The publishing organisation
url: https://example.org/handbook
accessed: 2026-01-15
licence: unknown        # or the stated licence
kind: summary           # summary | excerpt | full
---

The raw material itself: a summary in the author's own words, or an excerpt
where the licence allows it.
```

Every source states where it came from and when it was read. `url` is optional, for material that is not on the web, and must be `http` or `https` when given. A lesson, question or glossary term that cites a source the pack does not contain is rejected.

## area.yaml

```yaml
id: grunder
title: Grunder
summary: Vad området täcker.
requires: []          # area identifiers recommended first
lessons:
  - energi-och-effekt
exam:
  questions: 20
  passMark: 0.8
```

## lesson.md

Front matter, then steps separated by a line holding only `---step---`.

```markdown
---
id: energi-och-effekt
title: Energi och effekt
summary: Skillnaden mellan kWh och kW, och varför båda spelar roll.
concepts: [energi, effekt]
sources: [authority-handbook]
exam:
  questions: 8
  passMark: 0.8
---

---step---
type: text

Teaching text in Markdown. One idea per step.

---step---
type: example

A worked example.

---step---
type: check
questions: [kwh-eller-kw, berakna-energi]
```

Step types in version 1: `text`, `example`, `check`. After the separator comes the step's header — YAML up to the first blank line — and then, for `text` and `example`, its body. A `check` has no body and names one to three questions from the lesson's own `questions.yaml`.

`concepts` lists what the lesson teaches. A question names the concepts it tests, and each must be one that some lesson in the subject lists.

## questions.yaml

```yaml
- id: kwh-eller-kw
  type: single-choice
  concepts: [energi, effekt]
  sources: [authority-handbook]
  prompt: Vilken enhet anger effekt?
  options:
    - { id: a, text: kWh }
    - { id: b, text: kW }
    - { id: c, text: kWh/m² }
  answer: b
  explanation: >
    Effekt är energi per tidsenhet och mäts i watt. kWh är en energimängd.

- id: berakna-energi
  type: numeric
  concepts: [energi]
  sources: [authority-handbook]
  prompt: En motor på 2 kW går i 3 timmar. Hur mycket energi använder den?
  answer: { value: 6, unit: kWh, tolerance: 0 }
  explanation: Energi = effekt × tid = 2 kW × 3 h = 6 kWh.
```

Common to every question: `id`, `type`, `concepts`, `sources`, `prompt`, `explanation`. Each type adds its own fields:

| Type | Fields |
|---|---|
| `single-choice` | `options`, `answer` (one option id) |
| `multiple-choice` | `options`, `answer` (list of option ids) |
| `true-false` | `answer` (boolean) |
| `numeric` | `answer` with `value`, `unit`, `tolerance` |
| `short-text` | `accepted` (list of accepted answers), `caseSensitive` (default `false`) |
| `ordering` | `items`, in the correct order |
| `matching` | `pairs`, each `{ left, right }` |
| `free-recall` | `answer` (shown to the learner, who grades themselves) |

## glossary.yaml

```yaml
- id: atemp
  term: Atemp
  definition: Den area som värms till mer än 10 °C, mätt innanför klimatskärmen.
  alsoKnownAs: [tempererad area]
  sources: [authority-handbook]
```

## assets/

Images a lesson shows: `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`. Not SVG, because an SVG file can carry script and the application serves assets from its own address. Markdown refers to one as `assets/<file>`, from the root of the pack, wherever the Markdown is. The description in brackets is the image's alt text, and an optional title becomes its caption: `![Energiflöde genom en byggnad](assets/energiflode.png "Effekt över ett dygn")`.

## Rules the application enforces

- Every reference — to a source, a question, an area, a lesson, a concept — resolves inside the pack, and names its target once.
- Every area is in the subject's `areas`, every lesson in exactly one area's `lessons`, and `requires` never leads back to the area it starts from.
- Every question has an explanation and at least one source; so does every glossary term.
- Every lesson and area has an exam. A lesson's bank holds at least as many questions as its exam draws, and an area's exam can be drawn from the banks of its lessons.
- A choice question's answer names its own options, and option identifiers, ordering items and each side of the matching pairs differ from one another.
- Markdown contains no raw HTML. An image comes from `assets/` and nowhere else; a link goes to `http`, `https`, `mailto` or a file in `assets/`.
- Fields the format does not name are rejected, so that a misspelt field is reported rather than ignored.

A pack that breaks a rule is rejected with a list of every fault: a stable `code` naming the rule, the `file` it is in, the `item` within that file, the `field`, what was `expected` and what was `found`. A pack sent as JSON gets the same faults, naming the file each item would be in. When a file cannot be read at all — invalid YAML, broken front matter, text that is not UTF-8 — only the faults in the files are reported, because the items missing from those files would make every reference to them a fault as well.

## Archives and limits

A pack can be sent as a zip archive of its folder: either the folder's contents at the archive's root, or everything inside one top-level folder. The whole archive is refused if any entry would land outside the pack — an absolute path, `..`, a backslash or a drive letter — or if it holds more than 2,000 files, any file larger than 16 MB, or more than 64 MB in all.

## Loading and revisions

Loading a pack makes it the current state of its subject. An item whose content differs from what is stored gets a new revision, and the earlier revision is kept, because answers refer to the revision that was answered. An item the pack no longer holds is retired: kept, with its history, but no longer offered. Loading the same pack twice changes nothing. A dry run reports all of this without storing anything.
