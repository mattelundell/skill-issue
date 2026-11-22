# Installing Skill Issue

Skill Issue runs on your own computer, for you alone. It needs nothing but Docker, and it is reachable only from the computer it runs on. It starts with no subjects: you load one, written by you or by an AI assistant from [the authoring guide](authoring-guide.md).

The application comes with a command-line tool, run through Docker as `docker compose run --rm cli <command>` from the application's folder. It sees that folder, so a pack or a backup file is named relative to it.

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

A subject is a pack: a folder of text files (`docs/content-format.md`). Put the folder inside the application's folder — `subjects/my-subject/`, say — and load it:

```sh
docker compose run --rm cli load subjects/my-subject
```

It says what will be added, or lists every fault, each naming the file and field to correct; nothing is stored until the pack is right. `docker compose run --rm cli validate subjects/my-subject` checks a pack without the application. Loading the same subject again updates it, after showing what changes; your history with it is kept.

A new installation opens on a short introduction to the application, loaded on its first start; once taken, it leaves the start page. To see a fuller subject before writing one of your own, load the example: `docker compose run --rm cli load examples/example-subject`.

A subject you no longer want is removed with `curl -X DELETE http://127.0.0.1:4747/api/v1/content/subjects/<subject-id>`. It leaves the application, but nothing is deleted: loading its pack again brings it back with your history.

Without the command-line tool, a pack can be sent as a zip archive of its folder: `curl -X POST -H 'content-type: application/zip' --data-binary @my-subject.zip http://127.0.0.1:4747/api/v1/content/packs`.

## 5. Study in the terminal, and keep a backup

The browser is where lessons are read, but questions that are due can be answered in a terminal too:

```sh
docker compose run --rm cli status    # what is due
docker compose run --rm cli review    # answer it; q stops
```

Everything you have done — subjects, answers, notes, where each lesson was left — comes out as one file:

```sh
docker compose run --rm cli backup skill-issue-backup.json
```

Take one before updating the application. A backup restores into an empty installation of the same version: `docker compose run --rm cli restore skill-issue-backup.json`.

## Updating

```sh
docker compose run --rm cli backup skill-issue-backup.json   # first
git pull                                                     # or unpack the new zip over the folder
docker compose up -d --build --wait
```

The database is upgraded on start and keeps your data. A backup taken before an update cannot yet be restored into the updated version, so keep the old folder until you are sure the update works.

## When something is wrong

- **Nothing at <http://127.0.0.1:4747>**: is Docker running? `docker compose ps` shows the two containers, and the application's as `healthy` once it answers; `docker compose logs app` shows why it did not start.
- **`secrets/db_password: no such file`**: run `./scripts/init-secrets.sh`, then start again.
- **Port 4747 is taken**: something else uses it. Stop that, or change the first `4747` under `ports:` in `docker-compose.yml` and open that port instead.
- **Starting over**: `docker compose down -v` removes the application *and all your data*. Take a backup first.

## For developers

Building from source, running the tests and running the command-line tool outside Docker are in the README, "Working on it".
