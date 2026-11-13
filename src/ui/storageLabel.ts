const isChromium = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export function storageLabel(s: { store: { kind: string; name: string } | null; doc: { source: string }; savedSource: string; saving: boolean }): string {
  const dirty = s.doc.source !== s.savedSource
  if (!s.store) return isChromium() ? (dirty ? 'Not saved yet. Ctrl+S chooses a folder' : 'New presentation. Ctrl+S chooses a folder') : 'Not saved. Export to keep a copy'
  if (s.store.kind === 'fs-access') return dirty || s.saving ? 'Saving…' : `Saved to disk · ${s.store.name}`
  return dirty || s.saving ? 'Saving…' : 'Stored in this browser. Export to save a copy'
}
