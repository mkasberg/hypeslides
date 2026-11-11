export * from './types'
export { parseDeck, serializeDeck, scalar, setScalar, replaceSlides, replaceHeader, withoutSlidePadding, slideText } from './parse'
export {
  MEDIA_POSITIONS, DEFAULT_PLACED_SIZE, isVideoFile, mediaDir, outsideCode, speakerNotes, parseMedia, isPlaced,
  mediaItemCount, withMedia, withReplacedMedia, withMediaDirectives, mediaWithMode, mediaWithBackground, mediaWithPosition,
  mediaWithSize,
} from './media'
export * from './mediaImport'
export { isValidColor } from './colors'
export { findProblems, slideProblems, slideProblemStatus, lineAt, MIN_READABLE_TEXT_SIZE } from './check'
export type { CheckOptions, SlideProblem } from './check'
export * from './commands'
export {
  THEMES, DEFAULT_THEME, DEFAULT_FONT, DEFAULT_PALETTE, PALETTE_KEYS, themeNames, getTheme, themeName,
  fontFor, paletteFor, title,
} from './themes'
export { BUNDLED_FONTS, installedFamilies, pickerFonts } from './fonts'
export { newDeckSource,WELCOME_SLIDE } from './newDeck'
export type { NewDeckOptions } from './newDeck'
