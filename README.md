# Immersion Suite

A free, open-source desktop app for language learners. Spaced-repetition flashcards, immersion tracking, statistics, and a hover dictionary browser extension — all running locally, no account required.

**[Website](https://mezuna-dev.github.io/Immersion-Suite/) · [Releases](https://github.com/Mezuna-dev/Immersion-Suite/releases)**

---

## Features

### Spaced Repetition (SRS)
- SM2-based scheduling — cards show up right before you'd forget them
- Multiple decks with per-deck settings
- Custom card types with configurable fields and HTML/CSS front & back templates
- Configurable learning and relearning steps
- Study order: new first, mixed, or new last
- Keyboard shortcuts during review (configurable key or Space)
- Two-button mode (Know / Don't Know) or four-button mode
- Audio autoplay for listening cards

### Anki Import
- Import `.apkg` files directly from the File menu
- Supports both old and new (zstd-compressed) Anki formats
- Imports note types, card templates, and CSS styles
- Imports media files (images and audio)
- Full review history preserved

### Immersion Tracking
- Log immersed materials: books, shows, podcasts, visual novels, and more
- Track total immersion time per category and over time

### Statistics & Dashboard
- Review activity heatmap (GitHub-style, full year)
- Retention stats by period: today, yesterday, 7 days, 30 days, 1 year
- Young vs. mature retention rings
- Per-deck breakdown: due, new, young, and mature card counts
- Daily activity and streak tracking

### Data Management
- Export all data as a JSON backup
- Open the local data folder from the app
- All data stored locally in `data/` — no cloud, no sync, no account

### Settings
- Accent color customization
- Font size (small / medium / large)
- Daily new card limit, learning/relearning steps, study order
- Day start hour (for night-owl schedules)
- Review shortcut key and audio autoplay toggle

---

## Browser Extension

Immersion Suite includes a companion browser extension (Chrome and Firefox) that adds a hover dictionary to any webpage.

Hold **Shift** and hover over Japanese text to look up words instantly. The extension connects to the desktop app over a local WebSocket — the app handles all dictionary lookups using [Jitendex](https://jitendex.org/) (~295k entries).

**Extension features:**
- Shift+hover popup dictionary on any page
- Furigana, part-of-speech tags, and frequency info
- 512-entry LRU cache (avoids repeat lookups)
- Word highlight using the CSS Custom Highlight API
- Works in Chrome 88+ and Firefox 109+

See [`docs/browser-extension.md`](docs/browser-extension.md) for architecture details and the WebSocket protocol.

---

## Installation

### Windows
Download and run `ImmersionSuite_v1.3.0_Setup.exe` from the [latest release](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest).

### Linux
Download `ImmersionSuite_v1.3.0_Linux_x86_64.run` from the [latest release](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest) and run:

```bash
bash ImmersionSuite_v1.3.0_Linux_x86_64.run
```

---

## Building from Source

### Requirements

- Python 3.10+
- [PyQt6](https://pypi.org/project/PyQt6/)
- [PyQt6-WebEngine](https://pypi.org/project/PyQt6-WebEngine/)
- [websockets](https://pypi.org/project/websockets/)
- [zstandard](https://pypi.org/project/zstandard/)

```bash
pip install -r requirements.txt
```

### Run

```bash
cd src
python gui.py
```

### Dictionary (optional)

The browser extension uses a bundled Jitendex SQLite database. To rebuild it from the latest upstream data:

```bash
python scripts/build_jitendex.py
```

This downloads the latest Jitendex Yomitan release from jitendex.org and builds `data/dicts/jitendex.sqlite`.

---

## Project Structure

```
Immersion-App/
├── src/
│   ├── gui.py                  # Main window and app entry point
│   ├── database.py             # SQLite database layer
│   ├── scheduler.py            # SM2 spaced repetition algorithm
│   ├── anki_importer.py        # .apkg import (old & new Anki formats)
│   ├── ws_server.py            # Local WebSocket server (extension bridge)
│   ├── models.py               # Data models (Deck, Card, CardType)
│   ├── dictionary/
│   │   ├── handler.py          # Dictionary module selector
│   │   ├── jitendex.py         # Jitendex SQLite backend (primary)
│   │   ├── jmdict.py           # JMdict SQLite backend (fallback)
│   │   └── deinflect.py        # Japanese verb/adjective deinflection
│   └── widgets/
│       ├── app_widget.py       # PyQt6 widget hosting the web frontend
│       └── browser.py          # immersion:// URL scheme handler
├── extension/
│   ├── manifest.json           # MV3, Chrome + Firefox compatible
│   ├── background/
│   │   └── background.js       # WebSocket connection owner and router
│   └── content/
│       ├── content.js          # Text detection and popup renderer
│       └── content.css         # Word highlight rule
├── web/
│   ├── pages/                  # HTML/JS frontend (app.html, app.js)
│   ├── styles/                 # Bootstrap and custom CSS
│   └── fonts/                  # Bundled Inter font
├── data/
│   └── dicts/
│       └── jitendex.sqlite     # Built by scripts/build_jitendex.py
├── scripts/
│   └── build_jitendex.py       # Dictionary build script
├── docs/                       # GitHub Pages site
└── requirements.txt
```

---

## License

GPL-3.0. See [LICENSE](LICENSE).

Dictionary data: [Jitendex](https://jitendex.org/) (CC BY-SA 4.0), based on JMdict (CC BY-SA 4.0).
