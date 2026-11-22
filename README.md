# Skill Issue

A study application for one person. Load a subject, take its lessons, get tested, and have the questions you are about to forget come back at the right time.

The application ships with no subjects. A subject is a pack of source material, lessons and questions that you — or an AI assistant working for you — write and load through the API.

**Status: in development, before 1.0.** A subject can be loaded, studied lesson by lesson with checks, examined, reviewed on a schedule, annotated and followed over time in the browser; reviewed, examined, backed up and restored from the command line.

- **Installing it:** [`docs/install.md`](docs/install.md) — Docker and three commands.
- **Writing a subject**, yourself or with an AI assistant: [`docs/authoring-guide.md`](docs/authoring-guide.md); hand it to the assistant.

## Running it

Needs Docker with Compose.

```sh
./scripts/init-secrets.sh    # once: creates the database password
docker-compose up -d --build --wait
```

Then open <http://127.0.0.1:4747>. The application listens on this machine only.

## Loading a subject

`examples/example-subject/` is a small, complete pack. With the command-line tool built (`pnpm run build`):

```sh
node apps/cli/dist/main.js validate examples/example-subject    # check it, without the application
node apps/cli/dist/main.js load examples/example-subject        # load it; an update asks for --yes
node apps/cli/dist/main.js export example-subject out.zip       # write it back out, as a .zip or a new folder
```

## Studying and keeping your data from the command line

```sh
node apps/cli/dist/main.js status                                  # is it up, and what is due in each subject
node apps/cli/dist/main.js review                                  # answer what is due today, in every subject; q stops
node apps/cli/dist/main.js review example-subject                  # … or in one
node apps/cli/dist/main.js exam example-subject lesson enhetsprefix # sit a lesson exam; - leaves a question, q stops without handing in
node apps/cli/dist/main.js exam example-subject area grunder       # … or an area exam
node apps/cli/dist/main.js export-notes example-subject notes.md   # your notes as one Markdown file, by area, lesson and step
node apps/cli/dist/main.js backup skill-issue-backup.json          # everything: subjects, answers, notes, where each lesson was left
node apps/cli/dist/main.js restore skill-issue-backup.json         # into an empty installation of the same version
```

A backup holds every revision of every subject, because your answers name the revision you answered; a pack holds only the current one, so packs alone cannot restore your history. It restores only into an empty installation, of the version that wrote it — `--dry-run` checks that without writing. The interface language and the other choices the browser remembers stay with the browser.

Or straight against the API — the OpenAPI document is at <http://127.0.0.1:4747/api/v1/openapi.json>:

```sh
curl -X POST 'http://127.0.0.1:4747/api/v1/content/packs?dryRun=true' \
  -H 'content-type: application/zip' --data-binary @pack.zip
```

A rejected pack is answered with every fault, each naming the file, item and field it is in.

## Working on it

Needs Node 26 and pnpm.

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test

docker-compose -f docker-compose.test.yml up -d --wait   # throwaway database
pnpm run test:integration
pnpm run test:e2e                                        # builds, then drives the app in a browser
```

`pnpm run test:e2e` starts the built server, serving the built browser app, on a fresh database in the throwaway PostgreSQL, and drives it with Playwright. The first run needs the browser: `pnpm --filter @skill-issue/e2e exec playwright install chromium`.

`pnpm run lint` does two things. It lints the code, and then it lints the deliberate violations kept in each `lint-fixtures` folder and fails unless every marked line is reported by the rule it names — so a rule that has been switched off, or has stopped working, fails the run instead of passing quietly. A rule worth relying on gets a line in a fixture.

## Documents

- [`docs/architecture.md`](docs/architecture.md) — how it is built, and why
- [`docs/design.md`](docs/design.md) — how it behaves for the person studying
- [`docs/content-format.md`](docs/content-format.md) — the subject pack format, version 1
- [`docs/authoring-guide.md`](docs/authoring-guide.md) — writing a subject, for a person or an AI assistant
- [`docs/install.md`](docs/install.md) — installing, loading a subject, backing up
