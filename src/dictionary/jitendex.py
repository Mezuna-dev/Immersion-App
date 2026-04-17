import sqlite3
import json
import sys
import os
from pathlib import Path
from .base import DictionaryModule
from .deinflect import deinflect

if getattr(sys, 'frozen', False):
    if sys.platform == 'win32':
        _BASE_DIR = Path(sys.executable).resolve().parent
    else:
        _xdg = os.environ.get('XDG_DATA_HOME', '')
        _BASE_DIR = (Path(_xdg) / 'ImmersionSuite' if _xdg
                     else Path.home() / '.local' / 'share' / 'ImmersionSuite')
else:
    _BASE_DIR = Path(__file__).resolve().parent.parent.parent

DB_PATH: Path = _BASE_DIR / 'data' / 'dicts' / 'jitendex.sqlite'
_MAX_SCAN_LEN = 20


class JitendexModule(DictionaryModule):
    """Jitendex Japanese-English dictionary backed by a local SQLite file.

    Build the file once by running  scripts/build_jitendex.py.
    """

    def __init__(self):
        self._source_cache: str | None = None

    @property
    def name(self) -> str:
        return 'Jitendex (Japanese-English)'

    @property
    def language(self) -> str:
        return 'ja'

    @property
    def is_available(self) -> bool:
        return DB_PATH.exists()

    def _source_title(self, con: sqlite3.Connection) -> str | None:
        """Return the dictionary's human-readable title (cached)."""
        if self._source_cache is not None:
            return self._source_cache or None
        try:
            row = con.execute("SELECT value FROM meta WHERE key = 'title'").fetchone()
            self._source_cache = row['value'] if row else ''
        except sqlite3.Error:
            self._source_cache = ''
        return self._source_cache or None

    def lookup_text(self, text: str) -> dict:
        text = _trim_to_japanese(text)
        if not text or not DB_PATH.exists():
            return {'matched': None, 'entries': []}

        try:
            con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            con.row_factory = sqlite3.Row
        except sqlite3.Error:
            return {'matched': None, 'entries': []}

        try:
            source = self._source_title(con)

            def _wrap(result: dict) -> dict:
                if source:
                    result['source'] = source
                return result

            for length in range(min(len(text), _MAX_SCAN_LEN), 0, -1):
                word = text[:length]

                # Exact match
                entries = _query(word, con)
                if entries:
                    return _wrap({'matched': word, 'entries': entries})

                # Deinflected forms
                for candidate in deinflect(word):
                    entries = _query(candidate['word'], con)
                    if entries:
                        return _wrap({
                            'matched': word,
                            'entries': entries,
                            'reason': candidate['reason'],
                        })
        finally:
            con.close()

        return {'matched': None, 'entries': []}


def _is_japanese(ch: str) -> bool:
    c = ord(ch)
    return (
        0x3040 <= c <= 0x30FF or
        0x4E00 <= c <= 0x9FFF or
        0x3400 <= c <= 0x4DBF or
        0xFF65 <= c <= 0xFF9F
    )


def _trim_to_japanese(text: str) -> str:
    for i, ch in enumerate(text):
        if _is_japanese(ch):
            return text[i:]
    return ''


def _query(word: str, con: sqlite3.Connection) -> list[dict]:
    """Return entries matching *word* using an existing connection."""
    _cols = ("e.kanji_json, e.reading_json, e.meanings_json, "
             "COALESCE(e.tags_json, '[]') AS tags_json, "
             "COALESCE(e.forms_json, 'null') AS forms_json")
    try:
        cur = con.cursor()
        cur.execute(f"""
            SELECT DISTINCT {_cols}
            FROM entry e
            JOIN kanji_form k ON k.entry_id = e.id
            WHERE k.kanji = ?
            LIMIT 10
        """, (word,))
        rows = cur.fetchall()

        if not rows:
            cur.execute(f"""
                SELECT DISTINCT {_cols}
                FROM entry e
                JOIN reading_form r ON r.entry_id = e.id
                WHERE r.reading = ?
                LIMIT 10
            """, (word,))
            rows = cur.fetchall()
    except sqlite3.Error:
        return []

    results = []
    for row in rows:
        try:
            results.append({
                'kanji_forms':   json.loads(row['kanji_json']    or '[]'),
                'reading_forms': json.loads(row['reading_json']  or '[]'),
                'senses':        json.loads(row['meanings_json'] or '[]'),
                'tags':          json.loads(row['tags_json']     or '[]'),
                'forms':         json.loads(row['forms_json']    or 'null'),
            })
        except (json.JSONDecodeError, IndexError):
            pass

    # Jitendex exports one Yomitan row per (term, reading) pair, so the same
    # JMdict entry appears N times when it has N readings.  Collapse rows that
    # share kanji + senses into one entry; readings get unioned.
    return _merge_reading_variants(results)


def _merge_reading_variants(entries: list[dict]) -> list[dict]:
    by_key: dict[tuple, dict] = {}
    order: list[tuple] = []
    for e in entries:
        key = (
            json.dumps(e['kanji_forms'],  ensure_ascii=False, sort_keys=True),
            json.dumps(e['senses'],       ensure_ascii=False, sort_keys=True),
        )
        if key in by_key:
            for r in e['reading_forms']:
                if r not in by_key[key]['reading_forms']:
                    by_key[key]['reading_forms'].append(r)
        else:
            by_key[key] = e
            order.append(key)
    return [by_key[k] for k in order]
