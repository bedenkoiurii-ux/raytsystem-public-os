"""Доказом може бути лише проза — не службова розмітка markdown."""

from raytsystem.extractors import NativeTextExtractor

SAMPLE = """---
title: Камінь — Розділ 19
uid: ent-evt-1f98ffc0
---

# Між державою і руїною

Після 1659 року Київ не пережив поразки як катастрофи.

| | |
|---|---|
| Абзац | переписано |

```python
print("не твердження")
```

---

Він пережив її як розлад.

## Технічний апарат розділу

### Джерела — 16 (перевірені)

- [Pope Gregory I — Wikipedia](https://en.wikipedia.org/wiki/Pope_Gregory_I)

## Пов'язане

- [[Августин]] — інтуїція «людина поранена»
"""


def test_prose_only() -> None:
    spans = NativeTextExtractor().extract(SAMPLE.encode(), source_path="ch19.md").spans
    excerpts = [span.excerpt for span in spans]

    assert excerpts[0] == "Після 1659 року Київ не пережив поразки як катастрофи."
    assert excerpts[-1] == "Він пережив її як розлад."
    assert not any(e.strip() == "---" for e in excerpts)          # frontmatter і роздільник
    assert not any(e.startswith("#") for e in excerpts)           # заголовки — назви, не судження
    assert not any("print(" in e for e in excerpts)               # уміст огорожі коду
    assert not any(set(e) <= set(" |-:") for e in excerpts)       # розмітка таблиці
    assert not any("wikipedia" in e.lower() for e in excerpts)    # бібліографія апарату
    assert not any("Августин" in e for e in excerpts)             # зворотні посилання

    # Локатори лишаються дослівними: доказ має збігатися з джерелом посимвольно.
    for span in spans:
        assert SAMPLE[span.locator.char_start : span.locator.char_end] == span.excerpt


if __name__ == "__main__":
    test_prose_only()
    print("ok")
