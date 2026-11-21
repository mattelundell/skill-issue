# Skill Issue

A study application for one person. Load a subject, take its lessons, get tested, and have the questions you are about to forget come back at the right time.

The application ships with no subjects. A subject is a pack of source material, lessons and questions that you — or an AI assistant working for you — write and load through the API.

**Status: in development.** A subject can be loaded, updated and exported through the API and the command-line tool, and the browser app lists the subjects and shows each one's path of areas and lessons. There are no study screens yet.

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
- [`docs/content-format.md`](docs/content-format.md) — the subject pack format (draft)
