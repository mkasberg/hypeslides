import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { fixture, menuItem, slides } from './helpers.ts'
import { expect, test } from './fixtures.ts'

/** Width and height from a JPEG's SOF marker, or a PNG's IHDR. */
function imageSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] === 0x89) return [view.getUint32(16), view.getUint32(20)]
  for (let at = 2; at < bytes.length; ) {
    const marker = bytes[at + 1]
    if (marker >= 0xc0 && marker <= 0xc2) return [view.getUint16(at + 7), view.getUint16(at + 5)]
    at += 2 + view.getUint16(at + 2)
  }
  throw new Error('no JPEG size')
}

test('Ctrl+Shift+E exports a 4K picture per slide, embedding H.264 video', async ({ openOpfs }, testInfo) => {
  test.setTimeout(120_000)
  const page = await openOpfs()
  const chooser = page.waitForEvent('filechooser')
  await menuItem(page, 'File menu', /Import folder/)
  await (await chooser).setFiles(fixture('video-deck'))
  await expect(slides(page)).toHaveCount(4)

  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+Shift+E')
  await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible()
  const file = await download
  expect(file.suggestedFilename()).toBe('Video Deck.pptx')
  await expect(page.getByText('Exported Video Deck.pptx')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel export' })).toHaveCount(0)

  const files = unzipSync(new Uint8Array(readFileSync(await file.path())))
  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith('ppt/media/')) await testInfo.attach(name, { body: Buffer.from(data) })
  }
  expect(strFromU8(files['docProps/core.xml'])).toContain('<dc:title>Video Deck</dc:title>')
  for (let i = 1; i <= 4; i++) expect(imageSize(files[`ppt/media/slide${i}.jpg`])).toEqual([3840, 2160])

  // One movie, shared by both video slides; the spanning one gets a transparent text overlay.
  expect(files['ppt/media/video2.mp4']).toEqual(new Uint8Array(readFileSync(fixture('video-deck', 'demo.mp4'))))
  expect(files['ppt/media/video3.mp4']).toBeUndefined()
  expect(imageSize(files['ppt/media/poster2.jpg'])).toEqual([320, 180])
  expect(imageSize(files['ppt/media/overlay2.png'])).toEqual([3840, 2160])
  expect(files['ppt/media/overlay3.png']).toBeUndefined()
  expect(strFromU8(files['ppt/slides/slide3.xml'])).toContain('repeatCount="indefinite"')

  // The slide pictures are the real rendering: compare the title slide with the app's own preview.
  const shot = await page.evaluate(async (jpeg) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }))
    const canvas = new OffscreenCanvas(192, 108)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, 192, 108)
    const data = ctx.getImageData(0, 0, 192, 108).data
    // Count distinct-ish colors: a blank or failed capture is one flat color.
    const colors = new Set<number>()
    for (let i = 0; i < data.length; i += 4) colors.add((data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5))
    return { colors: colors.size, corner: [data[0], data[1], data[2]] }
  }, Array.from(files['ppt/media/slide1.jpg']))
  expect(shot.colors).toBeGreaterThan(2)
  // Tokyo Night's background, #1a1b26.
  for (const [got, want] of shot.corner.map((v, i) => [v, [0x1a, 0x1b, 0x26][i]])) expect(Math.abs(got - want)).toBeLessThan(6)
})
