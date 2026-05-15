<div align="center">

<img src="docs/icon.png" width="100" height="100" alt="Immersion Suite" />

# Immersion Suite

**The all-in-one desktop toolkit for language immersion learners.**

Flashcards · Immersion tracking · Statistics · Hover dictionary

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-aa00ff.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-aa00ff)](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-aa00ff)](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest)
[![Python](https://img.shields.io/badge/python-3.10%2B-aa00ff)](https://www.python.org/)

[**Download**](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest) · [**Website**](https://mezuna-dev.github.io/Immersion-Suite/) · [**Report a Bug**](https://github.com/Mezuna-dev/Immersion-Suite/issues) · [**Request a Feature**](https://github.com/Mezuna-dev/Immersion-Suite/issues)

</div>

---

![Immersion Suite Dashboard](docs/Screenshot%202026-05-15%20014956.png)

---

## What is Immersion Suite?

Immersion Suite is a free, open-source desktop app built for learners who use the immersion method. It combines everything you need into one place — a full spaced-repetition system, an immersion log, detailed statistics, and a browser extension that lets you look up any word on any webpage without breaking your reading flow.

No subscriptions. No cloud. Everything runs on your machine.

---

## Features

### 🧠 Spaced Repetition (SRS)
- SM2 scheduling — cards surface exactly when you need them
- Multiple decks with independent settings
- Custom card types with HTML/CSS front & back templates
- Configurable learning and relearning steps
- Study order: new first, mixed, or new last
- Two-button or four-button review mode
- Keyboard shortcuts and audio autoplay

### 📦 Anki Import
- Import `.apkg` files directly from the File menu
- Supports both old and new (zstd-compressed) Anki formats
- Full import of note types, templates, CSS, media, and review history

### ⏱️ Immersion Tracking
- Log immersed content: books, shows, podcasts, visual novels, and more
- Track total time per category over time

### 📊 Statistics & Dashboard
- Full-year review activity heatmap
- Retention rings (young, mature, total)
- Retention stats filterable by day, week, month, or year
- Streak tracking and daily averages

### 🔍 Browser Extension
- Hold **Shift** and hover over any Japanese text in Chrome or Firefox
- Instant popup dictionary powered by [Jitendex](https://jitendex.org/) (~295k entries)
- Furigana, part-of-speech, frequency tags, and deinflection
- Connects to the desktop app over a local WebSocket — no external requests
- Works on any website

---

## Installation

### Windows

Download and run the installer from the [latest release](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest):

```
ImmersionSuite_v1.3.0_Setup.exe
```

### Linux

Download the installer from the [latest release](https://github.com/Mezuna-dev/Immersion-Suite/releases/latest) and run:

```bash
bash ImmersionSuite_v1.3.0_Linux_x86_64.run
```

---

## Building from Source

**Requirements:** Python 3.10+

```bash
# 1. Clone the repo
git clone https://github.com/Mezuna-dev/Immersion-Suite.git
cd Immersion-Suite

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
cd src
python gui.py
```

<details>
<summary>Optional: rebuild the Jitendex dictionary</summary>

The browser extension ships with a prebuilt `data/dicts/jitendex.sqlite`. To rebuild it from the latest upstream data:

```bash
python scripts/build_jitendex.py
```

This downloads the latest Jitendex release from jitendex.org and rebuilds the SQLite database (~103 MB, ~295k entries).

</details>

---

## Browser Extension

The extension is located in `extension/`. To load it:

**Chrome:** `chrome://extensions` → Enable Developer Mode → Load Unpacked → select the `extension/` folder

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `extension/manifest.json`

The desktop app must be running for lookups to work. The extension connects automatically over `ws://127.0.0.1:8765`.

---

## Project Structure

```
Immersion-Suite/
├── src/
│   ├── gui.py                  # Entry point and main window
│   ├── database.py             # SQLite database layer
│   ├── scheduler.py            # SM2 algorithm
│   ├── anki_importer.py        # .apkg import logic
│   ├── ws_server.py            # WebSocket server (extension bridge)
│   ├── models.py               # Core data models
│   ├── dictionary/             # Dictionary backends + deinflection
│   └── widgets/                # PyQt6 widgets and URL scheme handler
├── extension/
│   ├── manifest.json           # MV3 manifest (Chrome + Firefox)
│   ├── background/             # Service worker / background page
│   └── content/                # Injected content script and CSS
├── web/
│   ├── pages/                  # HTML + JS frontend
│   ├── styles/                 # Bootstrap and custom CSS
│   └── fonts/                  # Bundled Inter font
├── data/
│   └── dicts/
│       └── jitendex.sqlite     # Prebuilt dictionary (built by scripts/)
├── scripts/
│   └── build_jitendex.py       # Dictionary build script
└── docs/                       # GitHub Pages site + documentation
```

---

## Contributing

Issues and pull requests are welcome. If you're reporting a bug, please include your OS, app version, and steps to reproduce.

---

## License

GPL-3.0 — see [LICENSE](LICENSE).

Dictionary data: [Jitendex](https://jitendex.org/) (CC BY-SA 4.0), derived from [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) (CC BY-SA 4.0).
