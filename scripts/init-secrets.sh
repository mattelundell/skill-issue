#!/bin/sh
# Creates the database password used by docker-compose.yml, once. The file is
# not committed; an existing one is left alone so the database stays reachable.
set -eu

dir="$(cd "$(dirname "$0")/.." && pwd)/secrets"
file="$dir/db_password"

if [ -s "$file" ]; then
  echo "secrets/db_password already exists; left unchanged."
  exit 0
fi

mkdir -p "$dir"
umask 077
openssl rand -hex 24 > "$file"
echo "Created secrets/db_password."
