import sqlite3
import json
import sys
import os
from pathlib import Path
from .base import DictionaryModule
from .deinflect import deinflect

# Resolve BASE_DIR the same way database.py does so the dict lives alongside
# the rest of the app data.
if getattr(sys, 'frozen', False):
    if sys.platform == 'win32':
        _BASE_DIR = Path(sys.executable).resolve().parent
    else:
        _xdg = os.environ.get('XDG_DATA_HOME', '')
        _BASE_DIR = (Path(_xdg) / 'ImmersionSuite' if _xdg
                     else Path.home() / '.local' / 'share' / 'ImmersionSuite')
else:
    _BASE_DIR = Path(__file__).resolve().parent.parent.parent

DB_PATH: Path = _BASE_DIR / 'data' / 'dicts' / 'jmdict.sqlite'

# Maximum characters to scan from the cursor position when looking for a match.
_MAX_SCAN_LEN = 20


class JMdictModule(DictionaryModule):
    """JMdict Japanese-English dictionary backed by a local SQLite file.

    The SQLite file is built by running ``scripts/build_jmdict.py`` once.
    If the file is missing, ``is_available`` returns False and lookups
    return an empty result rather than raising.
    """

    @property
    def name(self) -> str:
        return 'JMdict (Japanese-English)'

    @property
    def language(self) -> str:
        return 'ja'

    @property
    def is_available(self) -> bool:
        return DB_PATH.exists()

    def lookup_text(self, text: str) -> dict:
        """Longest-match scan with deinflection support."""
        text = _trim_to_japanese(text)
        if not text or not DB_PATH.exists():
            return {'matched': None, 'entries': []}

        try:
            con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            con.row_factory = sqlite3.Row
        except sqlite3.Error:
            return {'matched': None, 'entries': []}

        try:
            for length in range(min(len(text), _MAX_SCAN_LEN), 0, -1):
                word = text[:length]

                entries = _query(word, con)
                if entries:
                    return {'matched': word, 'entries': entries}

                for candidate in deinflect(word):
                    entries = _query(candidate['word'], con)
                    if entries:
                        return {
                            'matched': word,
                            'entries': entries,
                            'reason': candidate['reason'],
                        }
        finally:
            con.close()

        return {'matched': None, 'entries': []}


# ── helpers ───────────────────────────────────────────────────────────────────

def _is_japanese(ch: str) -> bool:
    c = ord(ch)
    return (
        0x3040 <= c <= 0x30FF or   # Hiragana + Katakana
        0x4E00 <= c <= 0x9FFF or   # CJK unified ideographs (common)
        0x3400 <= c <= 0x4DBF or   # CJK Extension A
        0xFF65 <= c <= 0xFF9F      # Halfwidth Katakana
    )


def _trim_to_japanese(text: str) -> str:
    """Return text starting from its first Japanese character."""
    for i, ch in enumerate(text):
        if _is_japanese(ch):
            return text[i:]
    return ''


def _query(word: str, con: sqlite3.Connection) -> list[dict]:
    """Return entries matching *word* using an existing connection."""
    try:
        cur = con.cursor()
        cur.execute("""
            SELECT DISTINCT e.kanji_json, e.reading_json, e.meanings_json,
                   COALESCE(e.tags_json, '[]') AS tags_json
            FROM entry e
            JOIN kanji_form k ON k.entry_id = e.id
            WHERE k.kanji = ?
            LIMIT 8
        """, (word,))
        rows = cur.fetchall()

        if not rows:
            cur.execute("""
                SELECT DISTINCT e.kanji_json, e.reading_json, e.meanings_json,
                       COALESCE(e.tags_json, '[]') AS tags_json
                FROM entry e
                JOIN reading_form r ON r.entry_id = e.id
                WHERE r.reading = ?
                LIMIT 8
            """, (word,))
            rows = cur.fetchall()
    except sqlite3.Error:
        return []

    results = []
    for row in rows:
        try:
            results.append({
                'kanji_forms':   json.loads(row['kanji_json']   or '[]'),
                'reading_forms': json.loads(row['reading_json'] or '[]'),
                'senses':        json.loads(row['meanings_json'] or '[]'),
                'tags':          json.loads(row['tags_json']    or '[]'),
            })
        except (json.JSONDecodeError, IndexError):
            pass

    return results
