// PowerPoint packaging, ported from ~/code/hype/src/pptx.cpp (writePptx).
//
// Like Hype, an exported deck preserves the rendered appearance rather than
// exposing editable text: each slide is one full-bleed picture of the rendered
// slide. A video is embedded as a second picture with a `p14:media` part and
// timing for autoplay / loop / mute; a spanning video gets a transparent
// overlay picture of the slide's text on top. Pure: bytes in, bytes out.

import { zipSync, strToU8 } from 'fflate'

const pns = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const ans = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
/** 16:9 slide size in EMU (13.333in × 7.5in). */
export const PPTX_SLIDE_WIDTH = 12192000
export const PPTX_SLIDE_HEIGHT = 6858000
const EMU_PER_PX = PPTX_SLIDE_WIDTH / 1920

export interface PptxImage {
  data: Uint8Array
  format: 'png' | 'jpeg'
}

export interface PptxVideo {
  /** An H.264 / AAC MP4. */
  data: Uint8Array
  /** File name (shown as the picture's name in PowerPoint). */
  name: string
  /** Identity for de-duplication: slides that share a key share one embedded movie. */
  key: string
  poster: PptxImage
  /** Transparent picture of the slide's text, drawn over a spanning video. */
  overlay?: PptxImage
  /** Where the video sits, in the 1920×1080 logical slide space. */
  rect: { x: number; y: number; w: number; h: number }
  autoplay: boolean
  loop: boolean
  muted: boolean
  /** Plays this many times when not looping (Hype's converted animations). */
  repeatCount?: number
}

export interface PptxSlide {
  /** The rendered slide (3840×2160 in Hype). */
  image: PptxImage
  video?: PptxVideo
}

export interface PptxDeck {
  title: string
  slides: PptxSlide[]
}

// ---- XML ------------------------------------------------------------------------

const escapeXml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

type Attrs = Record<string, string | number>
const attrs = (a: Attrs = {}) =>
  Object.entries(a).map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`).join('')
const el = (tag: string, a?: Attrs, ...children: string[]) =>
  children.length ? `<${tag}${attrs(a)}>${children.join('')}</${tag}>` : `<${tag}${attrs(a)}/>`
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`
const presentationNs = { 'xmlns:p': pns, 'xmlns:a': ans, 'xmlns:r': rns }

interface Relationship {
  id: string
  type: string
  target: string
}
const relationships = (items: Relationship[]) =>
  doc(
    el(
      'Relationships',
      { xmlns: packageNs },
      ...items.map((r) =>
        el('Relationship', { Id: r.id, Type: r.type.includes(':') ? r.type : `${rns}/${r.type}`, Target: r.target }),
      ),
    ),
  )

const shapeTree = (...shapes: string[]) =>
  el(
    'p:spTree',
    {},
    el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
    el('p:grpSpPr'),
    ...shapes,
  )

const masterColors = () => el('p:clrMapOvr', {}, el('a:masterClrMapping'))

interface Bounds {
  x: number
  y: number
  cx: number
  cy: number
}
const FULL_SLIDE: Bounds = { x: 0, y: 0, cx: PPTX_SLIDE_WIDTH, cy: PPTX_SLIDE_HEIGHT }

function picture(id: number, name: string, imageId: string, b: Bounds, movie = false): string {
  const nvPr = movie
    ? el(
        'p:nvPr',
        {},
        el('a:videoFile', { 'r:link': 'rId4' }),
        el(
          'p:extLst',
          {},
          el(
            'p:ext',
            { uri: '{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}' },
            el('p14:media', { 'xmlns:p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main', 'r:embed': 'rId3' }),
          ),
        ),
      )
    : el('p:nvPr')
  return el(
    'p:pic',
    {},
    el(
      'p:nvPicPr',
      {},
      movie
        ? el('p:cNvPr', { id, name }, el('a:hlinkClick', { 'r:id': '', action: 'ppaction://media' }))
        : el('p:cNvPr', { id, name }),
      el('p:cNvPicPr', {}, el('a:picLocks', { noChangeAspect: 1 })),
      nvPr,
    ),
    el('p:blipFill', {}, el('a:blip', { 'r:embed': imageId }), el('a:stretch', {}, el('a:fillRect'))),
    el(
      'p:spPr',
      {},
      el('a:xfrm', {}, el('a:off', { x: b.x, y: b.y }), el('a:ext', { cx: b.cx, cy: b.cy })),
      el('a:prstGeom', { prst: 'rect' }, el('a:avLst')),
    ),
  )
}

/** A video's bounds in EMU: spanning video fills the slide, otherwise its rect. */
function videoBounds(v: PptxVideo): Bounds {
  return {
    x: Math.trunc(v.rect.x * EMU_PER_PX),
    y: Math.trunc(v.rect.y * EMU_PER_PX),
    cx: Math.trunc(v.rect.w * EMU_PER_PX),
    cy: Math.trunc(v.rect.h * EMU_PER_PX),
  }
}

function slideXml(slide: PptxSlide): string {
  const v = slide.video
  const shapes = [picture(2, 'PowerPointSlide', 'rId2', FULL_SLIDE)]
  if (v) {
    shapes.push(picture(3, v.name, 'rId5', videoBounds(v), true))
    if (v.overlay) shapes.push(picture(4, 'Overlay', 'rId6', FULL_SLIDE))
  }
  let timing = ''
  if (v) {
    const media: Attrs = { id: 2, fill: 'hold', display: 0 }
    if (v.loop) media.repeatCount = 'indefinite'
    else if ((v.repeatCount ?? 1) > 1) media.repeatCount = (v.repeatCount ?? 1) * 1000
    timing = el(
      'p:timing',
      {},
      el(
        'p:tnLst',
        {},
        el(
          'p:par',
          {},
          el(
            'p:cTn',
            { id: 1, dur: 'indefinite', restart: 'never', nodeType: 'tmRoot' },
            el(
              'p:childTnLst',
              {},
              el(
                'p:video',
                {},
                el(
                  'p:cMediaNode',
                  { vol: v.muted ? 0 : 100000 },
                  el('p:cTn', media, el('p:stCondLst', {}, el('p:cond', { delay: v.autoplay ? 0 : 'indefinite' }))),
                  el('p:tgtEl', {}, el('p:spTgt', { spid: 3 })),
                ),
              ),
            ),
          ),
        ),
      ),
    )
  }
  return doc(el('p:sld', presentationNs, el('p:cSld', {}, shapeTree(...shapes)), masterColors(), timing))
}

function themeXml(): string {
  const colors: [string, string][] = [
    ['dk1', '000000'], ['lt1', 'FFFFFF'], ['dk2', '222222'], ['lt2', 'EEEEEE'],
    ['accent1', '4472C4'], ['accent2', 'ED7D31'], ['accent3', 'A5A5A5'], ['accent4', 'FFC000'],
    ['accent5', '5B9BD5'], ['accent6', '70AD47'], ['hlink', '0563C1'], ['folHlink', '954F72'],
  ]
  const fill = () => el('a:solidFill', {}, el('a:schemeClr', { val: 'phClr' }))
  const three = (f: (i: number) => string) => [0, 1, 2].map(f)
  const font = (tag: string) =>
    el(tag, {}, el('a:latin', { typeface: 'Arial' }), el('a:ea', { typeface: '' }), el('a:cs', { typeface: '' }))
  return doc(
    el(
      'a:theme',
      { 'xmlns:a': ans, name: 'Hype' },
      el(
        'a:themeElements',
        {},
        el('a:clrScheme', { name: 'Hype' }, ...colors.map(([k, v]) => el(`a:${k}`, {}, el('a:srgbClr', { val: v })))),
        el('a:fontScheme', { name: 'Hype' }, font('a:majorFont'), font('a:minorFont')),
        el(
          'a:fmtScheme',
          { name: 'Hype' },
          el('a:fillStyleLst', {}, ...three(fill)),
          el('a:lnStyleLst', {}, ...three((i) => el('a:ln', { w: 6350 * (i + 1) }, fill(), el('a:prstDash', { val: 'solid' })))),
          el('a:effectStyleLst', {}, ...three(() => el('a:effectStyle', {}, el('a:effectLst')))),
          el('a:bgFillStyleLst', {}, ...three(fill)),
        ),
      ),
    ),
  )
}

// ---- package --------------------------------------------------------------------

/**
 * Package rendered slides as a .pptx. Entries are stored uncompressed, as Hype
 * does: the pictures and movies are already compressed.
 */
export function buildPptx(deck: PptxDeck): Uint8Array {
  if (!deck.slides.length) throw new Error('There are no slides to export.')
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, text: string) => (files[path] = strToU8(text))

  put(
    '[Content_Types].xml',
    (() => {
      const prefix = 'application/vnd.openxmlformats-officedocument.'
      const defaults: [string, string][] = [
        ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
        ['xml', 'application/xml'],
        ['png', 'image/png'],
        ['jpg', 'image/jpeg'],
        ['mp4', 'video/mp4'],
      ]
      const part = (name: string, type: string) => el('Override', { PartName: name, ContentType: type })
      return doc(
        el(
          'Types',
          { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' },
          ...defaults.map(([e, t]) => el('Default', { Extension: e, ContentType: t })),
          part('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
          part('/ppt/presentation.xml', prefix + 'presentationml.presentation.main+xml'),
          part('/ppt/slideMasters/slideMaster1.xml', prefix + 'presentationml.slideMaster+xml'),
          part('/ppt/slideLayouts/slideLayout1.xml', prefix + 'presentationml.slideLayout+xml'),
          part('/ppt/theme/theme1.xml', prefix + 'theme+xml'),
          ...deck.slides.map((_, i) => part(`/ppt/slides/slide${i + 1}.xml`, prefix + 'presentationml.slide+xml')),
        ),
      )
    })(),
  )
  put(
    '_rels/.rels',
    relationships([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
      {
        id: 'rId2',
        type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        target: 'docProps/core.xml',
      },
    ]),
  )
  put(
    'docProps/core.xml',
    doc(
      el(
        'cp:coreProperties',
        {
          'xmlns:cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
          'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        },
        `<dc:title>${escapeXml(deck.title)}</dc:title>`,
        '<dc:creator>HypeSlides</dc:creator>',
      ),
    ),
  )
  put(
    'ppt/presentation.xml',
    doc(
      el(
        'p:presentation',
        { ...presentationNs, autoCompressPictures: 0 },
        el('p:sldMasterIdLst', {}, el('p:sldMasterId', { id: 2147483648, 'r:id': 'rId1' })),
        el('p:sldIdLst', {}, ...deck.slides.map((_, i) => el('p:sldId', { id: 256 + i, 'r:id': `rId${i + 2}` }))),
        el('p:sldSz', { cx: PPTX_SLIDE_WIDTH, cy: PPTX_SLIDE_HEIGHT, type: 'screen16x9' }),
        el('p:notesSz', { cx: 6858000, cy: 9144000 }),
      ),
    ),
  )
  put(
    'ppt/_rels/presentation.xml.rels',
    relationships([
      { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
      ...deck.slides.map((_, i) => ({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` })),
    ]),
  )
  const colorMap = ['bg1:lt1', 'tx1:dk1', 'bg2:lt2', 'tx2:dk2', 'accent1', 'accent2', 'accent3', 'accent4',
    'accent5', 'accent6', 'hlink', 'folHlink'].map((s) => s.split(':'))
  put(
    'ppt/slideMasters/slideMaster1.xml',
    doc(
      el(
        'p:sldMaster',
        presentationNs,
        el('p:cSld', {}, shapeTree()),
        el('p:clrMap', Object.fromEntries(colorMap.map(([k, v]) => [k, v ?? k]))),
        el('p:sldLayoutIdLst', {}, el('p:sldLayoutId', { id: 2147483649, 'r:id': 'rId1' })),
      ),
    ),
  )
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    relationships([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ]),
  )
  put(
    'ppt/slideLayouts/slideLayout1.xml',
    doc(
      el('p:sldLayout', { ...presentationNs, type: 'blank', preserve: 1 }, el('p:cSld', { name: 'Blank' }, shapeTree()), masterColors()),
    ),
  )
  put(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    relationships([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]),
  )
  put('ppt/theme/theme1.xml', themeXml())

  const media = (image: PptxImage, name: string) => {
    const target = `media/${name}.${image.format === 'jpeg' ? 'jpg' : 'png'}`
    files['ppt/' + target] = image.data
    return '../' + target
  }
  const movies = new Map<string, string>()
  deck.slides.forEach((slide, i) => {
    const number = i + 1
    const rels: Relationship[] = [
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'image', target: media(slide.image, `slide${number}`) },
    ]
    const v = slide.video
    if (v) {
      let movie = movies.get(v.key)
      if (!movie) {
        movie = `media/video${number}.mp4`
        files['ppt/' + movie] = v.data
        movies.set(v.key, movie)
      }
      rels.push(
        { id: 'rId3', type: 'http://schemas.microsoft.com/office/2007/relationships/media', target: '../' + movie },
        { id: 'rId4', type: 'video', target: '../' + movie },
        { id: 'rId5', type: 'image', target: media(v.poster, `poster${number}`) },
      )
      if (v.overlay) rels.push({ id: 'rId6', type: 'image', target: media(v.overlay, `overlay${number}`) })
    }
    put(`ppt/slides/slide${number}.xml`, slideXml(slide))
    put(`ppt/slides/_rels/slide${number}.xml.rels`, relationships(rels))
  })
  return zipSync(files, { level: 0 })
}

/**
 * Where a video sits on its slide (Hype's readSlide): a spanning video fills
 * the slide; otherwise it is fitted, centered, inside the media box.
 */
export function fitVideoRect(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const ratio = width / height
  const w = Math.min(box.w, box.h * ratio)
  const h = Math.min(box.h, box.w / ratio)
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}
