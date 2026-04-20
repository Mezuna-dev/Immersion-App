import sqlite3
import json
import sys
import os
import threading
from collections import OrderedDict
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
_CACHE_SIZE   = 256

_COLS = ("e.kanji_json, e.reading_json, e.meanings_json, "
         "COALESCE(e.tags_json, '[]') AS tags_json, "
         "COALESCE(e.forms_json, 'null') AS forms_json")


class JitendexModule(DictionaryModule):
    """Jitendex Japanese-English dictionary backed by a local SQLite file.

    Build the file once by running  scripts/build_jitendex.py.
    """

    def __init__(self):
        self._source_cache: str | None = None
        self._con: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._cache: OrderedDict[str, dict] = OrderedDict()

    @property
    def name(self) -> str:
        return 'Jitendex (Japanese-English)'

    @property
    def language(self) -> str:
        return 'ja'

    @property
    def is_available(self) -> bool:
        return DB_PATH.exists()

    def _get_con(self) -> sqlite3.Connection | None:
        if self._con is not None:
            return self._con
        if not DB_PATH.exists():
            return None
        try:
            con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            con.row_factory = sqlite3.Row
            self._con = con
            return con
        except sqlite3.Error:
            return None

    def _source_title(self, con: sqlite3.Connection) -> str | None:
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
        if not text:
            return {'matched': None, 'entries': []}

        cached = self._cache.get(text)
        if cached is not None:
            self._cache.move_to_end(text)
            return cached

        with self._lock:
            # Re-check after acquiring the lock in case another thread populated it.
            cached = self._cache.get(text)
            if cached is not None:
                self._cache.move_to_end(text)
                return cached

            result = self._do_lookup(text)
            self._cache[text] = result
            if len(self._cache) > _CACHE_SIZE:
                self._cache.popitem(last=False)
            return result

    def _do_lookup(self, text: str) -> dict:
        con = self._get_con()
        if con is None:
            return {'matched': None, 'entries': []}

        source = self._source_title(con)

        for length in range(min(len(text), _MAX_SCAN_LEN), 0, -1):
            word = text[:length]
            # Candidates in priority order: exact match first, then deinflections.
            candidates = [(word, None)]
            for c in deinflect(word):
                candidates.append((c['word'], c['reason']))

            matched_reason, entries = _query_batch(candidates, con)
            if entries:
                result = {'matched': word, 'entries': entries}
                if matched_reason:
                    result['reason'] = matched_reason
                if source:
                    result['source'] = source
                return result

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


def _query_batch(
    candidates: list[tuple[str, str | None]],
    con: sqlite3.Connection,
) -> tuple[str | None, list[dict]]:
    """Look up every candidate form in a single SQL statement.

    Candidates are ordered by priority (exact match first, deinflections after).
    The winning candidate is the highest-priority one that returned any rows.
    Returns (reason_for_winner, entries). reason is None for exact matches.
    """
    if not candidates:
        return None, []

    words = [w for w, _ in candidates]
    placeholders = ','.join('?' * len(words))
    try:
        cur = con.cursor()
        cur.execute(
            f"""
            SELECT e.id AS entry_id, k.kanji AS matched_word, {_COLS}
            FROM entry e JOIN kanji_form k ON k.entry_id = e.id
            WHERE k.kanji IN ({placeholders})
            UNION
            SELECT e.id AS entry_id, r.reading AS matched_word, {_COLS}
            FROM entry e JOIN reading_form r ON r.entry_id = e.id
            WHERE r.reading IN ({placeholders})
            ORDER BY entry_id
            LIMIT 80
            """,
            words + words,
        )
        rows = cur.fetchall()
    except sqlite3.Error:
        return None, []

    if not rows:
        return None, []

    # Pick the highest-priority candidate that actually got hits.
    priority = {w: i for i, (w, _) in enumerate(candidates)}
    best_idx = len(candidates)
    best_word: str | None = None
    for row in rows:
        w = row['matched_word']
        idx = priority.get(w, len(candidates))
        if idx < best_idx:
            best_idx = idx
            best_word = w
            if idx == 0:
                break

    if best_word is None:
        return None, []

    winning_rows = [r for r in rows if r['matched_word'] == best_word]
    reason = candidates[best_idx][1]
    return reason, _rank_entries(_merge_reading_variants(_parse_rows(winning_rows)))


def _entry_score(entry: dict) -> int:
    """Ranking score: higher = show first.

    The Jitendex DB only carries two entry-level tags: 'common' (ichi1/news1/
    spec1 priority in JMdict) and 'priority form' (flags the primary kanji
    *within* an entry — not an entry-level signal).  Without a frequency
    dictionary there's no way to distinguish between two 'common' entries,
    so we rely on stable sort to keep JMdict sequence order for ties.
    """
    tags_lo = [t.lower() for t in (entry.get('tags') or [])]
    return 1 if 'common' in tags_lo else 0


def _rank_entries(entries: list[dict]) -> list[dict]:
    # `sorted` is stable, so ties keep original JMdict sequence order.
    return sorted(entries, key=_entry_score, reverse=True)


def _parse_rows(rows) -> list[dict]:
    results: list[dict] = []
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
    return results[:10]


def _merge_reading_variants(entries: list[dict]) -> list[dict]:
    # Jitendex exports one Yomitan row per (term, reading) pair, so the same
    # JMdict entry can appear N times when it has multiple kanji/reading
    # variants.  Use `forms.kanji` (when present) as the canonical kanji list
    # so rows from the same JMdict entry group together regardless of which
    # variant each row stores in its own kanji_forms field.
    for e in entries:
        forms = e.get('forms')
        if forms and forms.get('kanji'):
            e['kanji_forms'] = list(forms['kanji'])

    by_key: dict[tuple, dict] = {}
    order: list[tuple] = []
    for e in entries:
        key = (
            json.dumps(e['kanji_forms'], ensure_ascii=False, sort_keys=True),
            json.dumps(e['senses'],      ensure_ascii=False, sort_keys=True),
        )
        if key in by_key:
            existing = by_key[key]
            for r in e['reading_forms']:
                if r not in existing['reading_forms']:
                    existing['reading_forms'].append(r)
            # Keep the primary variant: the one with more tags (e.g. 'common',
            # 'priority form') wins.  Secondary rows only contribute readings.
            if len(e.get('tags') or []) > len(existing.get('tags') or []):
                e['reading_forms'] = existing['reading_forms']
                by_key[key] = e
        else:
            by_key[key] = e
            order.append(key)
    return [by_key[k] for k in order]
