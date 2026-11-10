# HypeSlides

**[hypeslides.app](https://hypeslides.app)**

A browser port of [Hype](https://github.com/omacom/hype): simple presentations
written in Markdown, with a visual editor to put everything in order. It runs
entirely in the browser and works from any static server.

> HypeSlides is an unofficial, independent port. It is not affiliated with or
> endorsed by Omacom or the Hype project. Hype's code is used under its MIT
> license.

A presentation is a folder holding a Markdown file, with its media beside it:

```text
my-talk/
  presentation.md
  images/
  videos/
```

The format is the same as Hype's, so a deck moves freely between the two. See
Hype's [format reference](https://github.com/omacom/hype/blob/main/src/format.md).

## Opening and saving

- **Chrome, Edge, and other Chromium browsers** edit a folder on disk directly
  (File System Access API). Open a folder with Ctrl+O; saves and autosaves go
  straight to disk, and edits made to the file by other tools appear in the
  editor. The last presentation reopens on the next visit (after a one-click
  permission grant).
- **Firefox and Safari** keep a working copy in browser storage (Origin Private
  File System). Import a folder, a `.md`, or a `.zip` from the file menu or by
  dropping it on the window; edits persist across reloads. Export downloads the
  `.md`, or a `.zip` when the deck uses local media.

## Editing

Visual, Markdown, and Overview modes, slide reordering by drag or keyboard,
formatting shortcuts, media layout options, themes, and fullscreen present mode
all follow Hype. Press `?` in the app for the shortcuts.

Not yet ported: PDF and PowerPoint export, presenter view, version history,
and image compression on paste. See [TODO.md](TODO.md) for the full roadmap,
including testing, CI, and agent support.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run build      # static site in dist/
```

### End-to-end tests

Playwright (Chromium) functional tests plus a screenshot regression suite live
in `e2e/`. Screenshot baselines are only valid when rendered inside the
official Playwright Docker image, so the default scripts run there (Docker
required; the first run installs dependencies into `.docker-node_modules/`).

```sh
npm run test:e2e          # run the suite in Docker
npm run test:e2e:update   # same, regenerating screenshot baselines
npm run test:e2e:local    # run on the host (needs `npx playwright install chromium`;
                          # screenshots will differ, use for debugging functional tests)
```

Pass extra Playwright flags after `--`, e.g. `npm run test:e2e -- -g overview`.

`/render-demo.html` on the dev server shows every slide of a sample deck in
each theme, for checking the renderer.

Code layout is described in [CLAUDE.md](CLAUDE.md).

## License

MIT. Ported from Hype, Copyright (c) 2026 David Heinemeier Hansson; see [LICENSE](LICENSE).

Bundled fonts (JetBrains Mono, Fira Code, Source Code Pro, Inter) are licensed
under the SIL Open Font License 1.1; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
