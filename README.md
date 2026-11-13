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

## Exporting

- **PDF** (Ctrl+P) prints through the browser's print dialog; text stays vector.
- **PowerPoint** (Ctrl+Shift+E) downloads a `.pptx` built the way Hype builds
  one: every slide is a 3840×2160 picture of the rendered slide (not editable
  text), so the receiving computer needs none of your fonts. H.264/AAC MP4
  videos are embedded with their autoplay, loop, and mute settings; other
  video formats are exported as a still for now (Hype converts them with
  ffmpeg). Animated GIF/WebP export their first frame.

Not yet ported: presenter view, and converting video and animations for
PowerPoint. See [TODO.md](TODO.md) for the full roadmap, including testing, CI,
and agent support.

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

`/harness.html` on the dev server is the render harness: `?deck=welcome&slide=3`
shows one slide of a deck from `tests/parity/decks/` at exactly 1920×1080, and
`?demo` shows a sample deck in every theme. Programmatic use:
`window.hypeHarness.render({ markdown, media, slide })`, and
`window.hypeHarness.renderPdf({ markdown, media })` to mount the PDF export's
print pages (then print, e.g. with Playwright's `page.pdf()`).

### Parity tests

Every slide of the fixture decks in `tests/parity/decks/` is rendered through
the harness and scored (SSIM, 0 to 1) against Hype's own render in
`tests/parity/reference/`. Per-slide baselines live in `tests/parity/scores.json`;
the suite fails when a score drops more than 0.005 below its baseline, or when
we split a deck into a different number of slides than Hype. Runs in Docker like
the e2e suite.

The same run checks PDF export (`tests/parity/pdf.spec.ts`): each deck is
printed through the app's `<PrintDeck>` by Chromium and compared with Hype's
`hype export` PDF in `tests/parity/reference/<deck>/presentation.pdf`. Page
count, page size, document title and each page's raster image count (embedded
media) must match exactly. Each page's text (word overlap, order ignored, read
with pdfjs-dist) is scored and baselined in `tests/parity/pdf-scores.json`
like the slide scores.

```sh
npm run parity           # compare; HTML report in parity-report/index.html (gitignored)
npm run parity:update    # raise baselines (PARITY_UPDATE=reset to rewrite them all)
npm run parity:refresh   # rebuild Hype in Docker and re-render tests/parity/reference/
```

Hype and the Omarchy themes are pinned to specific commits (recorded in
`tests/parity/reference/manifest.json`) and only change deliberately via
`parity:refresh`. The report shows Hype | ours | diff for each slide, worst
first, then the PDF comparison with both PDFs linked.

Code layout is described in [CLAUDE.md](CLAUDE.md).

## License

MIT. Ported from Hype, Copyright (c) 2026 David Heinemeier Hansson; see [LICENSE](LICENSE).

Bundled fonts (JetBrains Mono, Fira Code, Source Code Pro, Inter) are licensed
under the SIL Open Font License 1.1; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
