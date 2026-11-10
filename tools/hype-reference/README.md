# hype-reference

Docker image that builds [Hype](https://github.com/omacom/hype) (the Qt/C++
original) from a pinned commit, so HypeSlides' renderer can be compared against
real Hype output. Rendering is headless (`QT_QPA_PLATFORM=offscreen`) with
JetBrains Mono installed.

Pinned commit: `278d9805769c61286bd8246dd9b71da475c01ec9` (also stored in
`/hype-commit` inside the image).

## Build

    docker build -t hypeslides/hype-reference tools/hype-reference
    # another commit:
    docker build --build-arg HYPE_COMMIT=<sha> -t hypeslides/hype-reference tools/hype-reference

## Render

    docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/work:/work" \
      hypeslides/hype-reference render /work/deck.md -o /work/out

Writes `slide-NNN.png` (1920x1080 by default; `--width N` changes it) plus
`slides.json` (`{"title", "slides": [{"image", "warning"}]}`) into `out/`.
Other subcommands: `hype help`, e.g. `check`, `render --slide N`, `--json`.
