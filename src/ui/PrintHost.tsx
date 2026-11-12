import { useCallback, useMemo } from 'react'
import { headerOf, parseDeck, title as docTitle } from '../core'
import { useApp } from '../app/useApp'
import { PrintDeck } from '../render/PrintDeck'
import { useDeckLook } from './slideHooks'

/** Mounts the print layer while a PDF export is in progress and drives the print dialog. */
export function PrintHost() {
  const printing = useApp((s) => s.printing)
  return printing ? <Printing /> : null
}

function Printing() {
  const { palette, font, resolveMedia } = useDeckLook()
  // Snapshot at the start of the export: stable inputs, or readiness would re-fire.
  const slides = useMemo(() => parseDeck(useApp.getState().doc.source).slides.map((s) => s.source), [])
  const stable = useMemo(() => ({ palette, font, resolveMedia }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const onReady = useCallback(() => {
    const { doc, store, finishPrint } = useApp.getState()
    const previous = document.title
    document.title = docTitle(headerOf(doc), store?.name ?? 'Untitled')
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('afterprint', finish)
      document.title = previous
      finishPrint()
    }
    window.addEventListener('afterprint', finish)
    // afterprint fires in Chrome once the dialog closes; the layer must stay mounted until then
    // (other browsers return from print() before the preview has rendered).
    window.print()
  }, [])

  return <PrintDeck slides={slides} {...stable} onReady={onReady} />
}
