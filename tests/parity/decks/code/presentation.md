---
title: "Code"
theme: catppuccin
color_background: "#1e1e2e"
color_foreground: "#cdd6f4"
color_accent: "#89b4fa"
color_green: "#a6e3a1"
color_red: "#f38ba8"
color_yellow: "#f9e2af"
color_magenta: "#f5c2e7"
color_cyan: "#94e2d5"
color_dark_foreground: "#6c7086"
font: "JetBrains Mono"
---

```ruby
class Greeter
  def initialize(name) = @name = name
  def hello = puts "Hello, #{@name}!"
end
```

---

# Python

```python
def fib(n: int) -> int:
    # naive recursion
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])
```

---

# TypeScript

```typescript
interface User { id: number; name: string }
const users: User[] = [{ id: 1, name: "Ada" }]
export const names = users.map((u) => u.name.toUpperCase())
```

---

# Shell

```bash
#!/bin/bash
for f in *.md; do
  echo "Processing $f"
done
```

---

# C++

```cpp
#include <iostream>
int main() {
    std::cout << "Hello" << 42 << '\n';
    return 0;
}
```

---

# JSON

```json
{ "name": "hype", "version": 1, "tags": ["slides", "markdown"], "ok": true }
```

---

# No language

```
plain text fence
    with indentation
  and no highlighting
```

---

# Unknown language

```notalanguage
some text here
```

---

Fence containing a slide separator:

```markdown
# Slide one

---

# Slide two
```

---

Inline `code` in a paragraph with **bold** and *italic* text.
