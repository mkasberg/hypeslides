// A new presentation, like `hype new` (cli.cpp): choosing a theme records its
// colors in the front matter so the file renders the same anywhere.

import { chooseThemeHeader } from './commands'
import { setScalar } from './parse'
import { DEFAULT_FONT, DEFAULT_THEME } from './themes'

export interface NewDeckOptions {
  title: string
  theme?: string
  font?: string
  /** First-slide Markdown; defaults to `# <title>`. */
  body?: string
}

/** The welcome slide a fresh, unnamed deck starts with. */
export const WELCOME_SLIDE = `# HypeSlides

* Simple Markdown presentations with a visual slide editor, in your Browser.

* Your presentation is a Markdown file with its media alongside it.

* Choose a theme, pick a font, export to PDF or PowerPoint.

* Compatible with [Omacom Hype](https://github.com/omacom/hype/).

* Use [Chrome](https://www.google.com/chrome/) for the best experience.
`

export function newDeckSource({ title, theme = DEFAULT_THEME, font = DEFAULT_FONT, body }: NewDeckOptions): string {
  let header = chooseThemeHeader('', theme)
  header = setScalar(header, 'font', font)
  return setScalar(header, 'title', title) + '\n' + (body ?? '# ' + title + '\n')
}
