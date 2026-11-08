// A new presentation, like `hype new` (cli.cpp): choosing a theme records its
// colors in the front matter so the file renders the same anywhere.

import { chooseThemeHeader } from './commands'
import { setScalar } from './parse'
import { DEFAULT_FONT, DEFAULT_THEME } from './themes'

export interface NewDeckOptions {
  title: string
  theme?: string
  font?: string
}

export function newDeckSource({ title, theme = DEFAULT_THEME, font = DEFAULT_FONT }: NewDeckOptions): string {
  let header = chooseThemeHeader('', theme)
  header = setScalar(header, 'font', font)
  return setScalar(header, 'title', title) + '\n# ' + title + '\n'
}
