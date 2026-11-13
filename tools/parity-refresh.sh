#!/bin/bash
# Renders every deck in tests/parity/decks with the pinned Hype build (Docker)
# into tests/parity/reference/<deck>/ (slide PNGs, slides.json, and Hype's PDF
# export as presentation.pdf) and writes reference/manifest.json.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=hypeslides/hype-reference
DECKS="$ROOT/tests/parity/decks"
REF="$ROOT/tests/parity/reference"

# HYPE_COMMIT / OMARCHY_COMMIT override the Dockerfile's pinned defaults.
build_args=""
[ -n "${HYPE_COMMIT:-}" ] && build_args="$build_args --build-arg HYPE_COMMIT=$HYPE_COMMIT"
[ -n "${OMARCHY_COMMIT:-}" ] && build_args="$build_args --build-arg OMARCHY_COMMIT=$OMARCHY_COMMIT"
# shellcheck disable=SC2086
docker build -q $build_args -t "$IMAGE" "$ROOT/tools/hype-reference" >/dev/null

BASE=$(sed -n 's/^FROM[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' "$ROOT/tools/hype-reference/Dockerfile" | head -n1)
COMMIT=$(docker run --rm --entrypoint cat "$IMAGE" /hype-commit | tr -d '[:space:]')

OMARCHY=$(docker run --rm --entrypoint cat "$IMAGE" /omarchy-commit | tr -d '[:space:]')

rm -rf "$REF"
mkdir -p "$REF"

# Hype writes video posters next to the deck, so render from a scratch copy.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R "$DECKS/." "$WORK/"

decks_json=""
warnings=0
for dir in "$DECKS"/*/; do
  name=$(basename "$dir")
  [ -f "$dir/presentation.md" ] || { echo "missing presentation.md in $name" >&2; exit 1; }
  echo "rendering $name"
  docker run --rm -u "$(id -u):$(id -g)" -v "$WORK:/in" -v "$REF:/out" "$IMAGE" \
    render "/in/$name/presentation.md" -o "/out/$name" >/dev/null \
    || { echo "FAILED: render of $name" >&2; exit 1; }
  [ -f "$REF/$name/slides.json" ] || { echo "FAILED: no slides.json for $name" >&2; exit 1; }
  docker run --rm -u "$(id -u):$(id -g)" -v "$WORK:/in" -v "$REF:/out" "$IMAGE" \
    export "/in/$name/presentation.md" "/out/$name/presentation.pdf" >/dev/null \
    || { echo "FAILED: PDF export of $name" >&2; exit 1; }
  count=$(grep -o '"image"' "$REF/$name/slides.json" | wc -l | tr -d ' ')
  [ "$count" -gt 0 ] || { echo "FAILED: $name rendered 0 slides" >&2; exit 1; }
  # print non-empty warnings (one slide object per line after normalising)
  w=$(tr -d '\n' < "$REF/$name/slides.json" | grep -o '"image": *"[^"]*", *"warning": *"[^"]\{1,\}"' || true)
  if [ -n "$w" ]; then
    echo "$w" | sed "s/^/  WARNING [$name] /"
    warnings=$((warnings + 1))
  fi
  decks_json="$decks_json${decks_json:+, }\"$name\": $count"
done

printf '{\n  "hypeCommit": "%s",\n  "omarchyCommit": "%s",\n  "image": "%s",\n  "generated": "%s",\n  "decks": { %s }\n}\n' \
  "$COMMIT" "$OMARCHY" "$BASE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$decks_json" > "$REF/manifest.json"

echo "done: $REF/manifest.json ($warnings deck(s) with warnings)"
