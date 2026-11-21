# Subject pack format — draft of version 1

A subject pack is one subject as a folder of files. This document describes the format; the JSON Schema generated from the application's own definitions is the authority, and the application rejects anything that does not match it.

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

A translation is the same file with a language suffix before the extension — `lesson.en.md` beside `lesson.md`. A file with no suffix is in the subject's default language.

## Identifiers

Lowercase letters, digits and hyphens. Unique within the subject for their kind. An identifier is permanent: changing it makes a new item and orphans the history of the old one.

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

Every source states where it came from and when it was read. A lesson or question that cites a source the pack does not contain is rejected.

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

Step types in version 1: `text`, `example`, `check`.

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
| `short-text` | `accepted` (list of accepted answers), `caseSensitive` |
| `ordering` | `items`, in the correct order |
| `matching` | `pairs` |
| `free-recall` | `answer` (shown to the learner, who grades themselves) |

## glossary.yaml

```yaml
- id: atemp
  term: Atemp
  definition: Den area som värms till mer än 10 °C, mätt innanför klimatskärmen.
  alsoKnownAs: [tempererad area]
  sources: [authority-handbook]
```

## Rules the application enforces

- Every reference — to a source, a question, an area, a concept — resolves inside the pack.
- Every question has an explanation and at least one source.
- A lesson's bank holds at least as many questions as its exam draws.
- An area's exam can be drawn from the banks of its lessons.
- Markdown contains no raw HTML.
- Asset files are referenced by relative path and exist in `assets/`.

A pack that breaks a rule is rejected with a list of every fault, the file and field each is in, what was expected and what was found.
