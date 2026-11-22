#!/bin/sh
# Installs the pnpm that package.json's packageManager names, from a tarball
# whose SHA-512 is pinned below, so that a registry serving other bytes under
# the same version is refused. A new pnpm version needs its checksum added
# here, or this refuses to install it:
#   npm view pnpm@<version> dist.integrity   (base64; the hex is below)
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -e "const m = /^pnpm@(\\d+\\.\\d+\\.\\d+)$/.exec(require(process.argv[1]).packageManager ?? ''); if (!m) process.exit(1); console.log(m[1])" "$root/package.json")" || {
  echo "install-pnpm: package.json's packageManager is not pnpm@<x.y.z>" >&2
  exit 1
}

case "$version" in
  12.21.0) expected=66fd8278ee28935ce951792d34367ff3af5c432a2756445823029533835b8da529bbe0be5130afd56ed0713fb8789e47bad82d93bd5ae2fe54b15562d6276ef0 ;;
  *)
    echo "install-pnpm: no checksum is pinned for pnpm $version; add it to scripts/install-pnpm.sh" >&2
    exit 1
    ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
npm pack "pnpm@$version" --silent > /dev/null
tarball="pnpm-$version.tgz"
actual="$(node -e "process.stdout.write(require('node:crypto').createHash('sha512').update(require('node:fs').readFileSync(process.argv[1])).digest('hex'))" "$tarball")"
if [ "$actual" != "$expected" ]; then
  echo "install-pnpm: pnpm $version's tarball does not match its pinned checksum; refusing it" >&2
  echo "  expected $expected" >&2
  echo "  found    $actual" >&2
  exit 1
fi
npm install --global --silent "./$tarball"
echo "install-pnpm: pnpm $version installed, checksum verified"
