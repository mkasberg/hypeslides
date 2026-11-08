# Hype Web

A browser port of [Hype](https://github.com/omacom/hype): simple presentations
written in Markdown, with a visual editor to put everything in order. It runs
entirely in the browser and works from any static server.

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
and image compression on paste.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run build      # static site in dist/
```

`/render-demo.html` on the dev server shows every slide of a sample deck in
each theme, for checking the renderer.

Code layout is described in [CLAUDE.md](CLAUDE.md).

## License

MIT. Ported from Hype, © its authors, MIT.
