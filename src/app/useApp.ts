import { realEnv } from './env'
import { createAppStore } from './store'

/** The app's store hook (real browser environment). */
export const useApp = createAppStore(realEnv())
