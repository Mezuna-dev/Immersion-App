# Immersion Suite v1.1.0

A desktop application for language learners featuring a built-in SRS flashcard system, statistics dashboard, and Anki deck importing. Immersion material tracking is coming soon.

## Features

### Flashcard System (SRS)
- SM2-based spaced repetition scheduling
- Create and manage multiple decks with per-deck settings
- Custom card types with configurable fields and HTML/CSS front & back templates
- Configurable learning steps and relearning steps
- Study order options: new first, mixed, or new last
- Keyboard shortcuts during review sessions
- Audio autoplay support for cards with audio media

### Anki Import
- Import `.apkg` files directly from the **File** menu
- Supports both the old Anki format, and the new compressed format
- Imports note types, card templates, and CSS styles
- Imports media files (images and audio), including zstd-compressed media from newer Anki exports
- Imports full review history

### Statistics & Dashboard
- Review activity heatmap
- Retention stats filterable by period: today, yesterday, last 7 days, last 30 days, or last year
- Per-deck breakdown: due cards, new cards, young cards, and mature cards

### Data Management
- Export all data as a JSON backup
- Open the local data folder directly from the app
- Clear review history

### Settings
- Accent color customization
- Font size (small / medium / large)
- Default new cards limit per day
- Default learning and relearning steps
- Default study order
- Review keyboard shortcut (configurable key)
- Review audio autoplay toggle

### Coming Soon
- **Immersion Tracking** — log and track immersed materials (books, shows, podcasts, etc.) and total immersion time

## Installing

### Windows
Download and run `ImmersionSuite_v1.x.x_Setup.exe` from the latest release.

### Linux

Download `ImmersionSuite_v1.x.x_Linux_x86_64.run` from latest release and run the installer:

```bash
bash ImmersionSuite_v1.x.x_Linux_x86_64.run
```

## Requirements

- Python 3.10+
- [PyQt6](https://pypi.org/project/PyQt6/)
- [PyQt6-WebEngine](https://pypi.org/project/PyQt6-WebEngine/)
- [zstandard](https://pypi.org/project/zstandard/)

Install dependencies with:

```bash
pip install -r requirements.txt
```

## Running the App

```bash
cd src
python gui.py
```

## Project Structure

```
Immersion-App/
├── src/
│   ├── gui.py              # Main window and application entry point
│   ├── database.py         # SQLite database layer
│   ├── scheduler.py        # SM2 spaced repetition algorithm
│   ├── anki_importer.py    # .apkg import logic (old & new Anki formats)
│   ├── models.py           # Data models (Deck, Card, CardType)
│   └── widgets/
│       └── app_widget.py   # PyQt6 widget hosting the web frontend
├── web/
│   ├── pages/              # HTML/JS frontend (app.html, app.js)
│   ├── styles/             # Bootstrap and custom CSS
│   └── fonts/              # Bundled fonts
├── data/                   # Auto-generated at runtime (DB, media, settings)
└── requirements.txt
```

## Data Storage

All user data is stored locally in the `data/` directory:

| Path | Contents |
|---|---|
| `data/app.db` | SQLite database (decks, cards, review history) |
| `data/settings.json` | App settings |
| `data/media/` | Imported media files (images, audio) |
