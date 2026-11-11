import { describe, expect, it } from 'vitest'
import { BUNDLED_FONTS, installedFamilies, pickerFonts } from './fonts'
import { headerOf, setFont } from './commands'
import { fontFor } from './themes'

describe('installedFamilies', () => {
  it('dedupes faces by family, sorts, and drops bundled families', () => {
    const faces = [
      { family: 'Zapfino' }, { family: 'Alegreya' }, { family: 'alegreya' }, { family: 'Alegreya' },
      { family: 'Arial' }, { family: ' ' }, {}, { family: 'Éclair' },
    ]
    expect(installedFamilies(faces)).toEqual(['Alegreya', 'Éclair', 'Zapfino'])
  })
})

describe('pickerFonts', () => {
  it('keeps the bundled list, adding an unknown current font first', () => {
    expect(pickerFonts('Inter')).toEqual(BUNDLED_FONTS)
    expect(pickerFonts('Alegreya', ['Alegreya'])).toEqual(BUNDLED_FONTS)
    expect(pickerFonts('Gone Font')[0]).toBe('Gone Font')
  })
})

describe('setFont with an installed family', () => {
  it('round-trips through the front matter', () => {
    const next = setFont({ source: '# a\n', selected: 0, anchor: 0 }, 'Alegreya Sans')
    expect(fontFor(headerOf(next))).toBe('Alegreya Sans')
  })
})
