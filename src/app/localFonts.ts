// Installed fonts via the Local Font Access API (Chromium). Querying needs a
// user gesture plus a permission prompt, so it is only triggered from an
// explicit picker action, and runs automatically once permission is granted.

import { useSyncExternalStore } from 'react'
import { installedFamilies } from '../core'

export type LocalFontsStatus = 'unsupported' | 'idle' | 'loading' | 'ready' | 'denied'

interface State { status: LocalFontsStatus; families: string[] }

const supported = () => typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function'

let state: State = { status: supported() ? 'idle' : 'unsupported', families: [] }
const listeners = new Set<() => void>()
function set(next: State) {
  state = next
  listeners.forEach((fn) => fn())
}

/** Ask for installed fonts (call from a user gesture). Never throws. */
export async function loadLocalFonts(): Promise<void> {
  if (!supported() || state.status === 'loading') return
  set({ ...state, status: 'loading' })
  try {
    const fonts = await window.queryLocalFonts!()
    set({ status: 'ready', families: installedFamilies(fonts) })
  } catch {
    // NotAllowedError / SecurityError (denied, or blocked by policy or iframe).
    set({ ...state, status: 'denied' })
  }
}

let probed = false
/** If permission was already granted, load without a prompt. */
function probe() {
  if (probed || !supported()) return
  probed = true
  try {
    void navigator.permissions
      ?.query({ name: 'local-fonts' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') void loadLocalFonts()
        else if (p.state === 'denied') set({ ...state, status: 'denied' })
      })
      .catch(() => {})
  } catch {
    // Permission name unsupported: stay idle.
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  probe()
  return () => void listeners.delete(fn)
}

export function useLocalFonts(): State {
  return useSyncExternalStore(subscribe, () => state)
}
