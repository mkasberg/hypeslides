import type { StorageCapabilities } from './types.ts'
import { hasDirectoryPicker } from './fsAccess.ts'
import { hasOpfs } from './opfs.ts'

export type { PresentationStore, StorageCapabilities, StoreKind, SnapshotInfo, SnapshotSource } from './types.ts'
export * from './fsAccess.ts'
export * from './opfs.ts'
export * from './history.ts'
export * from './recent.ts'
export * from './importExport.ts'
export * from './mediaUrlCache.ts'
export { mediaKind, pickMarkdown, uniqueName, IMAGE_EXTS, VIDEO_EXTS } from './common.ts'

export function capabilities(): StorageCapabilities {
  return { fsAccess: hasDirectoryPicker(), opfs: hasOpfs() }
}
