---
title: "SVG"
theme: rose-pine
font: "JetBrains Mono"
---

```svg
<svg viewBox="0 0 300 120">
  <rect x="120" y="20" width="60" height="100" fill="var(--accent)"/>
</svg>
```

---

# Theme colors

```svg
<svg viewBox="0 0 450 100">
  <rect x="0" y="0" width="50" height="50" fill="var(--accent)"/>
  <rect x="60" y="0" width="50" height="50" fill="var(--red)"/>
  <rect x="120" y="0" width="50" height="50" fill="var(--green)"/>
  <rect x="180" y="0" width="50" height="50" fill="var(--yellow)"/>
  <rect x="240" y="0" width="50" height="50" fill="var(--magenta)"/>
  <rect x="300" y="0" width="50" height="50" fill="var(--cyan)"/>
  <rect x="360" y="0" width="50" height="50" fill="var(--foreground)"/>
  <rect x="0" y="60" width="50" height="40" fill="var(--dark-foreground)" stroke="var(--foreground)"/>
</svg>
```

---

# Text and default colors

```svg
<svg viewBox="0 0 400 160">
  <circle cx="80" cy="80" r="50"/>
  <text x="160" y="90" font-size="28">Hello SVG</text>
  <path d="M160 110 L380 110" stroke="var(--accent)" stroke-width="4" fill="none"/>
</svg>
```

---

# Boxes and arrows

```svg
<svg viewBox="0 0 500 140">
  <rect x="10" y="40" width="120" height="60" fill="none" stroke="var(--cyan)" stroke-width="3"/>
  <text x="40" y="78" font-size="20">Write</text>
  <path d="M130 70 H190" stroke="var(--foreground)" stroke-width="3"/>
  <rect x="190" y="40" width="120" height="60" fill="none" stroke="var(--green)" stroke-width="3"/>
  <text x="215" y="78" font-size="20">Render</text>
  <path d="M310 70 H370" stroke="var(--foreground)" stroke-width="3"/>
  <rect x="370" y="40" width="120" height="60" fill="var(--magenta)"/>
  <text x="395" y="78" font-size="20" fill="var(--background)">Present</text>
</svg>
```

---

```svg
<svg viewBox="0 0 200 200">
  <polygon points="100,10 190,190 10,190" fill="var(--yellow)"/>
</svg>
```
