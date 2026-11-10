---
title: "Hype examples"
theme: tokyo-night
color_background: "#1a1b26"
color_foreground: "#a9b1d6"
color_accent: "#7aa2f7"
color_green: "#9ece6a"
color_red: "#f7768e"
color_yellow: "#e0af68"
color_magenta: "#ad8ee6"
color_cyan: "#449dab"
color_dark_foreground: "#565f89"
font: "JetBrains Mono"
---

# The browser is forever

---

# Celebrating computers

---

```ruby
class Post < ApplicationRecord
  belongs_to :author
end
```

---

# Pro Computers

For & By The People Who Love ’Em

---

Pragmatic\
Ergonomic\
Aesthetic\
Sovereign

---

# LESS!!!

- Native Ruby + Docker DBs
- Serving `.localhost`
- Drop system tests
- Testing with local CI
- Scripted setup
- Deploy from local

---

> You become a man's Friend without knowing or caring whether he is
> married or single or how he earns his living. What have all these
> ‘unconcerning things, matters of fact’ to do with the real question,
>
> **Do you see the same truth?**

— C.S. Lewis, *The Four Loves*

---

> Part of the problem seems to be that nobody these days is content
> to merely put their dent in the universe. No, they have to
> **own the universe**. It’s not enough to be in the market,
> they have to **dominate it**. It’s not enough to serve customers,
> they have to **capture them**.

— Me, A Decade Ago, *RECONSIDER*

---

# 60,000 RPS

(on Kevin’s laptop)

---

# Bootstrap Budget

| Time | Task |
| ---: | :--- |
| 5m | Install OS |
| 3m | Setup app |
| 2m | Run Local CI |
| 3m | Deploy code |

---

| Single dev in 1999 | 50-strong team in 2025 |
| :--- | :--- |
| Deploys in 5s via SFTP | Deploys in 15m via CI/CD |
| From a Pentium III | From infinite cloud CPUs |

---

# Are YOU suffering from server-phobia?

---

# Are YOU suffering from server-phobia?

Don’t worry. There’s a cure.

---

# Are YOU suffering from server-phobia?

Don’t worry. There’s a cure.\
It’s called **LINUX**.

---

# Markdown responses

```ruby
class PagesController < ActionController::Base
  def show
    @page = Page.find(params[:id])

    respond_to do |format|
      format.html
      format.md { render markdown: @page }
    end
  end
end
```

---

![span](merchants-of-complexity.jpg)

---

# Local CI

![fit](config-ci-yml.png)

---

![](<RW Demo Final.mp4>)
