// Minimal declarations for browser APIs that the bundled TS DOM lib may lack.
// Everything is optional/loosely typed on purpose; feature-detect at runtime.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface DataTransferItem {
  webkitGetAsEntry(): FileSystemEntry | null
}

interface Window {
  showDirectoryPicker?(options?: {
    mode?: 'read' | 'readwrite'
    id?: string
    startIn?: unknown
  }): Promise<FileSystemDirectoryHandle>
  showOpenFilePicker?(options?: {
    multiple?: boolean
    types?: { description?: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle[]>
}
