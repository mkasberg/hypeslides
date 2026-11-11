# TODO

Remaining work, in the order we plan to tackle it. Testing infrastructure comes
early: most later items change rendering, and the screenshot and Hype-parity
suites are what catch regressions.

## 1. Verify what's built

- [x] Hands-on pass in real browsers (done 2026-11-09). Exercised:
  - Chrome's real folder picker: Open, Save, Save As, reopening the last
    presentation, live reload of external edits.
  - Media paste/drop and the Layout menu with real photos.
  - Video playback in present mode. Found that Chrome on Linux can't decode
    HEVC (common for phone videos); the slide now says so instead of
    showing black.
  - Real Firefox and Safari (OPFS working copy, import/export, the Safari
    worker fallback for `createWritable`).

## 2. Testing and CI

- [x] **CI basics** (`.github/workflows/ci.yml`, on push and PR): `npm ci`,
      lint (oxlint), typecheck, Vitest, build.
- [x] **Bundle fonts.** Ship JetBrains Mono (OFL) and the other picker fonts
      with the app. Needed for correct typography everywhere and for
      deterministic screenshots and parity comparisons. Update our license as
      needed to call these files out.
- [x] **Playwright suite** (`@playwright/test`):
  - Functional tests on Chromium: import a folder, edit,
    reload and check persistence, save through a faked
    `showDirectoryPicker`, add media, reorder slides.
  - A small screenshot regression suite on Chromium (`toHaveScreenshot` with a
    small tolerance): Visual, Markdown, Overview, Present, Appearance menu,
    a light theme, dialogs, drop overlay.
  - Determinism: bundled fonts, fixed viewport, animations and view
    transitions disabled, frozen clock.
  - Generate and compare baselines inside the official Playwright Docker image
    (locally via `npm run test:e2e:update`, and in CI), so local machines and
    CI render identical pixels.
- [x] **Hype parity suite.** Compare our slide rendering against Hype's.
  - Build Hype in Docker (`tools/hype-reference/Dockerfile`: Arch base, Hype's
    PKGBUILD deps, JetBrains Mono) at a pinned commit.
  - `npm run parity:refresh` runs `hype render <deck> -o <dir>` on fixture
    decks and commits the PNGs plus `slides.json` under
    `tests/parity/reference/`, with the Hype commit recorded in a manifest.
    Use Hype's fixture decks as a start, add our own if we need additional
    verification.
  - Fixture decks: `welcome.md`, Hype's `tests/fixtures`, the example slides
    in Hype's `plans/hype.md`, plus decks covering tables, code languages,
    every media mode (small committed images and a short video), placed
    images, svg blocks, light and dark themes, and text that forces shrinking.
  - Turn `render-demo.html` into a harness page (`?deck=…&slide=N`) that
    renders one slide at 1920×1080. The same page later backs PPTX export and
    the agent `render_slide` tool.
  - Score each slide's similarity (SSIM or pixelmatch). Pixel equality is
    impossible across Qt and Chrome text rendering, so commit per-slide
    baseline scores and fail only when a score drops below its baseline;
    raise baselines as gaps close.
  - Emit an HTML report (Hype | ours | diff) as a CI artifact.
- [x] **CI, extended:** run the Playwright and parity suites in the Playwright
      container; upload reports as artifacts.
- [x] **`parity-refresh.yml`** (manual `workflow_dispatch`): rebuild Hype in
      Docker, re-render the reference images, and open a PR with the changes. Inputs move the Hype and Omarchy pins.
      Needs "Allow GitHub Actions to create pull requests" in repo settings.
- [x] **Deploy to GitHub Pages** on push to `main` via
      `actions/upload-pages-artifact` + `actions/deploy-pages`. See
      [Hosting](#hosting).

## 3. Close MVP gaps

- [ ] **Media on a new, unsaved deck (Chromium).** Today you must save before
      adding media. Hold pending media in OPFS and write it into the folder on
      first save.
- [ ] **Paste naming and image compression.** Hype prompts for a name, resizes
      stills to fit 4K, and picks lossless PNG or WebP. Do it with
      `OffscreenCanvas` in a worker, with a progress bar and cancel.
- [ ] **`check` problems in the editor.** Port Hype's
      `slideProblems`/`findProblems` into `src/core` (missing media, invalid
      layout options, unfinished code fences, text that shrinks below a
      readable size) and show them on the slide banner and status line. Also
      half of the future agent tools.
- [ ] **Polish:**
  - Stronger editor selection color on Tokyo Night.
  - "Rosé Pine" display name.
  - Smaller bundle: drop the HTML/JS/CSS parsers that
    `@codemirror/lang-markdown` pulls in by default.
  - Local Font Access API on Chromium for installed fonts.

## 4. Safety net

- [ ] **Version history and crash recovery.** Implement
      `PresentationStore.snapshot()`: OPFS snapshots everywhere, plus
      `.hype-backups/` in the folder on Chromium. "Version history" in the
      file menu, and restoring unsaved drafts after a crash. The OPFS working
      copy is the only copy for Firefox/Safari users, so this comes before
      exports.

## 5. Sharing

- [ ] **PDF export.** Print all slides via `window.print()` with `@page` CSS
      sized 16:9; text stays vector. The browser's print dialog appears.
  - [ ] Once PDF/PPTX export exists, extend the parity suite to compare
        against Hype's own PDF/PPTX of the same decks (page count,
        `pdftotext` text, embedded media).
- [ ] **PPTX export.** Rasterize slides at 3840×2160 (snapdom or
      html-to-image) and package with PptxGenJS; embed videos as-is.
      Converting animated GIF/WebP to MP4 (WebCodecs + an MP4 muxer) can come
      later.
- [ ] **Presenter view.** A second window synced over `BroadcastChannel`:
      current and next slide, speaker notes (`<!-- comments -->`), timer.
      Window Management API on Chromium to place slides on the external
      display.

## 6. Agents

Hype's CLI exists so agents can build decks. Equivalents for the web app:

- [ ] **Published format spec.** Serve `format.md` and `llms.txt` from the
      site so coding agents can write decks directly; on Chromium the editor
      already live-reloads external edits. Nearly free; can move earlier.
- [ ] **WebMCP tools** (feature-detected; `document.modelContext`, falling
      back to `navigator.modelContext`; still an origin trial):
      `get_format`, `list_slides`, `check`, `render_slide` (PNG from the
      parity/PPTX harness), the edit commands, and `export`. Needs `check`
      and the slide rasterizer first.
- [ ] **npm package / `npx` CLI**, if needed. The DOM-free core is shared;
      rendering via headless Playwright.

## 7. Nice-to-have

- [ ] **Installable PWA:** offline via a service worker, open `.md` files from
      the OS (`file_handlers` + `launchQueue`), and Ctrl+N works (browsers
      reserve it in normal tabs).
- [ ] Remaining Hype niceties: slide-level `<!-- hype: … -->` directives
      everywhere, `followSlide` selection tracking across external reloads,
      edge-color matching for video first frames, muted-autoplay fallback,
      touch and mobile editing.

## Hosting

GitHub Pages can host the build as-is:

- **No routing.** The usual React-on-Pages problem is client-side routes
  that 404 on reload; this is a single page.
- **Relative paths.** `base: './'` in `vite.config.ts` makes the build work
  under `/<repo>/` or a custom domain.
- **HTTPS by default**, which File System Access, OPFS, service workers, and
  View Transitions require.
- **Hashed asset names** keep Pages' 10-minute cache from serving a stale mix
  after a deploy.
- **Deploy via Actions** (`upload-pages-artifact` + `deploy-pages`), which
  skips Jekyll; no `gh-pages` branch or `.nojekyll` needed.

The one limitation is that Pages can't set custom headers. That matters only
if we use multithreaded ffmpeg.wasm, which needs COOP/COEP for
`SharedArrayBuffer`. Prefer WebCodecs; fallbacks are `coi-serviceworker` or
hosting on Cloudflare Pages or Netlify.
