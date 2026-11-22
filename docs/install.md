# Installing Skill Issue

Skill Issue runs on your own computer, for you alone. It needs nothing but Docker, and it is reachable only from the computer it runs on. It starts with no subjects: you load one, written by you or by an AI assistant from [the authoring guide](authoring-guide.md).

## 1. Install Docker

Install **Docker Desktop** (macOS, Windows, Linux) from <https://www.docker.com/products/docker-desktop/> and start it. Any Docker that includes Compose works too, such as colima on a Mac.

Check it in a terminal:

```sh
docker compose version
```

If that prints a version, you are ready. Some installations call it `docker-compose` instead; use that spelling below if so.

## 2. Get the application

Download the repository as a zip from its page and unpack it, or clone it:

```sh
git clone <the repository's address> skill-issue
cd skill-issue
```

Every command below runs in that folder.

## 3. Start it

```sh
./scripts/init-secrets.sh            # once: creates the database password in secrets/
docker compose up -d --build --wait  # builds and starts; the first time takes a few minutes
```

Open <http://127.0.0.1:4747>. You see an empty start screen until a subject is loaded.

It keeps running in the background and starts again with Docker. To stop it: `docker compose stop`. Your answers, notes and subjects live in a Docker volume and survive stopping, restarting and rebuilding.

On Windows, run the commands in Git Bash or WSL, which can run the `.sh` script.

## 4. Load a subject

A subject is a pack: a folder of text files (`docs/content-format.md`). To load one, put the folder in a zip archive and send it:

```sh
cd my-subject && zip -r ../my-subject.zip . && cd ..
curl -X POST -H 'content-type: application/zip' --data-binary @my-subject.zip http://127.0.0.1:4747/api/v1/content/packs
```

The answer says what was added. If the pack breaks a rule, nothing is stored and the answer lists every fault, each naming the file and field to correct. Add `?dryRun=true` to the address to check a pack without storing it. Loading the same subject again updates it; your history with it is kept.

To try the application before writing a subject of your own, load the example: zip `examples/example-subject` the same way.

## 5. Keep a backup

Everything you have done — subjects, answers, notes, where each lesson was left — comes out as one file:

```sh
curl -o skill-issue-backup.json http://127.0.0.1:4747/api/v1/backup
```

Take one before updating the application. A backup restores into an empty installation of the same version:

```sh
curl -X POST -H 'content-type: application/json' --data-binary @skill-issue-backup.json http://127.0.0.1:4747/api/v1/backup
```

## Updating

```sh
curl -o skill-issue-backup.json http://127.0.0.1:4747/api/v1/backup   # first
git pull                                                              # or unpack the new zip over the folder
docker compose up -d --build --wait
```

The database is upgraded on start and keeps your data. A backup taken before an update cannot yet be restored into the updated version, so keep the old folder until you are sure the update works.

## When something is wrong

- **Nothing at <http://127.0.0.1:4747>**: is Docker running? `docker compose ps` shows the two containers; `docker compose logs app` shows why the application stopped.
- **`secrets/db_password: no such file`**: run `./scripts/init-secrets.sh`, then start again.
- **Port 4747 is taken**: something else uses it. Stop that, or change the first `4747` under `ports:` in `docker-compose.yml` and open that port instead.
- **Starting over**: `docker compose down -v` removes the application *and all your data*. Take a backup first.

## For developers

Building from source, running the tests and using the command-line tool (which needs Node and pnpm) are in the README, "Working on it".
