// All-themes demo: every slide of a sample deck in each theme. Shown by the
// harness page (/harness.html?demo) for eyeballing the renderer.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { THEMES, paletteFor, parseDeck, scalar } from '../core'
import { SlideView } from './index'
import welcome from './fixtures/welcome.md?raw'

const svgData = (body: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(body)
const MEDIA: Record<string, string> = {
  'city.svg': svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1b4b"/><stop offset="1" stop-color="#c0407a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><g fill="#0a0a1a"><rect x="100" y="400" width="200" height="500"/><rect x="400" y="250" width="160" height="650"/><rect x="900" y="450" width="260" height="450"/><rect x="1250" y="300" width="180" height="600"/></g></svg>',
  ),
  'portrait.svg': svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><rect width="600" height="900" fill="#d94f2b"/><circle cx="300" cy="400" r="200" fill="#fff3c4"/></svg>',
  ),
  'logo.svg': svgData(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" fill="#e8b339"/><text x="100" y="125" font-size="80" text-anchor="middle" fill="#222">H</text></svg>',
  ),
}

const extra = `# Over a picture

![](city.svg)

---

![fit background=auto](portrait.svg)

---

![fit background=blur](portrait.svg)

# Blurred fit

---

![position=bottom-right size=15%](logo.svg)

# Placed logo

---

![](missing.png)

Text on missing media

---

\`\`\`svg
<svg viewBox="0 0 300 120">
  <rect x="20" y="20" width="60" height="80" fill="var(--accent)"/>
  <rect x="120" y="40" width="60" height="60" fill="var(--magenta)"/>
  <text x="210" y="70">svg</text>
</svg>
\`\`\`

---

# Italic and bold

*italic* **bold** _underline_ \`inline\`

1. One
2. Two

\`\`\`python
def hello(name):
    return f"hi {name}"  # greet
\`\`\`

---

![demo.mp4](demo.mp4)

# Video`

const header = parseDeck(welcome).header
const font = scalar(header, 'font', 'JetBrains Mono')
const slides = [...parseDeck(welcome).slides.map((s) => s.source), ...extra.split(/\n\n---\n\n/)]

const resolve = async (name: string) => MEDIA[name] ?? null

// Dev-only entry page (render-demo.html), not hot-reloaded as a module.
// oxlint-disable-next-line react/only-export-components
function Demo() {
  const [theme, setTheme] = useState('tokyo-night')
  const [mode, setMode] = useState<'thumbnail' | 'preview' | 'present'>('preview')
  const palette = paletteFor(`theme: ${theme}`)
  return (
    <div style={{ padding: 16, color: '#ddd', font: '14px system-ui' }}>
      <label>
        Theme{' '}
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.name}>{t.name}</option>
          ))}
        </select>
      </label>{' '}
      <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option>thumbnail</option>
        <option>preview</option>
        <option>present</option>
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: 16, marginTop: 16 }}>
        {slides.map((s, i) => (
          <div key={i} style={{ outline: '1px solid #444' }}>
            <SlideView source={s} palette={palette} font={font} resolveMedia={resolve} mode={mode} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function mountDemo(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  )
}
