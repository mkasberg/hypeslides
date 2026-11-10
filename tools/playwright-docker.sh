#!/usr/bin/env bash
# Run the Playwright suite inside the official Playwright image, so screenshot
# baselines are identical on every machine (and in CI). Extra args go to
# `playwright test`, e.g. `tools/playwright-docker.sh --update-snapshots`.
#
# The repo is bind-mounted; node_modules is a separate host directory
# (.docker-node_modules) so host-native binaries never clash with the
# container's.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./node_modules/@playwright/test/package.json').version" 2>/dev/null \
  || node -p "require('./package.json').devDependencies['@playwright/test']")
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

mkdir -p .docker-node_modules

tty_flags=()
if [ -t 0 ] && [ -t 1 ]; then tty_flags=(-t); fi

exec docker run --rm --init --ipc=host "${tty_flags[@]}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home \
  -e npm_config_cache=/work/node_modules/.npm-cache \
  -e CI="${CI:-}" \
  -e PARITY_UPDATE="${PARITY_UPDATE:-}" \
  -v "$PWD":/work \
  -v "$PWD/.docker-node_modules":/work/node_modules \
  -w /work \
  "$IMAGE" \
  bash -c '
    set -e
    mkdir -p "$HOME"
    stamp=node_modules/.lock-stamp
    if [ ! -f "$stamp" ] || ! cmp -s package-lock.json "$stamp"; then
      npm ci --no-audit --no-fund
      cp package-lock.json "$stamp"
    fi
    exec npx playwright test "$@"
  ' bash "$@"
