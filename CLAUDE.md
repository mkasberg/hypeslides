# Hype Web

A browser port of Hype (https://github.com/omacom/hype, MIT), a Markdown slide
editor. The original Qt/C++ source is at `~/code/hype` — port its behavior and
code liberally (`src/deck.cpp`, `src/renderer.cpp`, `src/Main.qml`,
`src/Markdown.js`, `src/format.md`, `README.md`, `tests/`).

Runs entirely in the browser from a static server. Stack: Vite + React +
TypeScript (strict), Zustand, CodeMirror 6, markdown-it, Shiki, dnd-kit,
fflate, Vitest.

## Layout

- `src/core/` — pure TS document model: parse/serialize, front matter, media
  options, slide commands, themes. **No DOM or browser APIs** (must run in Node
  for a future CLI / WebMCP tools). Contracts in `src/core/types.ts`.
- `src/storage/` — `PresentationStore` backends (File System Access on
  Chromium; OPFS working copy + import/export elsewhere). Contract in
  `src/storage/types.ts`.
- `src/render/` — `<Slide>` rendered at a fixed 1920×1080 logical size and
  scaled. One renderer for sidebar, overview, preview, present, and (later)
  PDF/PPTX export.
- `src/app/` — Zustand store, command dispatcher, undo/redo, autosave,
  keyboard shortcuts.
- `src/ui/` — React components.

## Rules

- The Markdown source string is the single source of truth.
- Every document edit is a named command in `src/core/commands.ts` (pure
  `(DocState, args) => DocState`). UI, shortcuts, undo, and future agent tools
  all go through these.
- MVP scope: editor, Visual / Markdown / Overview modes, open/save a folder,
  present mode. Not yet: PDF/PPTX export, presenter view, version history —
  but leave the seams (`PresentationStore.snapshot`, shared `<Slide>`).
- Tests: `npm test` (Vitest). Typecheck/build: `npm run build`.
- Commit only your own files with explicit paths (`git add <paths>`), never
  `git add -A`; other agents may be working in the same tree.
