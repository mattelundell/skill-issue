# Skill Issue

A study application for one person. Load a subject, take its lessons, get tested, and have the questions you are about to forget come back at the right time.

The application ships with no subjects. A subject is a pack of source material, lessons and questions that you — or an AI assistant working for you — write and load through the API.

**Status: skeleton.** The application starts and answers, with its modules registered and empty. It cannot load a subject yet.

## Running it

Needs Docker with Compose.

```sh
./scripts/init-secrets.sh    # once: creates the database password
docker-compose up -d --build --wait
```

Then open <http://127.0.0.1:4747>. The application listens on this machine only.

## Working on it

Needs Node 26 and pnpm.

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test

docker-compose -f docker-compose.test.yml up -d --wait   # throwaway database
pnpm run test:integration
```

`pnpm run lint` does two things. It lints the code, and then it lints the deliberate violations kept in each `lint-fixtures` folder and fails unless every marked line is reported by the rule it names — so a rule that has been switched off, or has stopped working, fails the run instead of passing quietly. A rule worth relying on gets a line in a fixture.

## Documents

- [`docs/architecture.md`](docs/architecture.md) — how it is built, and why
- [`docs/design.md`](docs/design.md) — how it behaves for the person studying
- [`docs/content-format.md`](docs/content-format.md) — the subject pack format (draft)
