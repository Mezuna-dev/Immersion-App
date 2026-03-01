import sqlite3
import zipfile
from pathlib import Path
import json
import re
import io
import database
import shutil
import zstandard as zstd


# ===========================================================
# Section: Extraction
# ===========================================================

def extract_apkg(apkg_path):
    BASE_DIR = Path(__file__).resolve().parent.parent
    import_path = BASE_DIR / "imported"

    if import_path.exists():
        shutil.rmtree(import_path)

    import_path.mkdir(parents=True, exist_ok=True)

    apkg_file = Path(apkg_path)
    if not apkg_file.exists():
        print(f"Error: File {apkg_path} not found")
        return None, None

    with zipfile.ZipFile(apkg_path) as zip_apkg:
        zip_apkg.extractall(import_path)

    new_anki_file_type = import_path / "collection.anki21b"
    if new_anki_file_type.exists():
        with open(new_anki_file_type, 'rb') as compressed:
            dctx = zstd.ZstdDecompressor()
            with open(import_path / "collection", 'wb') as decompressed:
                dctx.copy_stream(compressed, decompressed)
        db_path = import_path / "collection"
        if db_path.exists():
            return db_path, import_path
    else:
        for db_name in ["collection.anki21", "collection.anki2"]:
            db_path = import_path / db_name
            if db_path.exists():
                return db_path, import_path

    print("Error: No Anki database found in package")
    return None, import_path


# ===========================================================
# Section: Media Import
# ===========================================================

def import_media(import_path, apkg_path=None):
    """Copy media files from extracted apkg to data/media/. Returns set of imported filenames."""
    dest_dir = database.BASE_DIR / 'data' / 'media'
    dest_dir.mkdir(parents=True, exist_ok=True)
    imported = set()
    log = []

    # ---- Diagnostic: zip entry list ----
    if apkg_path:
        try:
            with zipfile.ZipFile(apkg_path) as zf:
                entries = zf.infolist()
                log.append(f"ZIP entries ({len(entries)} total):")
                for e in entries:
                    log.append(f"  {e.filename!r}  size={e.file_size}")
        except Exception as ex:
            log.append(f"Could not read zip: {ex}")

    # ---- Diagnostic: extracted files ----
    extracted = list(import_path.iterdir())
    log.append(f"\nExtracted files in {import_path}:")
    for f in sorted(extracted):
        log.append(f"  {'DIR' if f.is_dir() else 'file':4s}  {f.name!r}")

    media_path = import_path / "media"

    # Case A: media/ is a directory — newer Anki variant
    if media_path.is_dir():
        log.append("\nmedia is a DIRECTORY — copying contents directly")
        for src in media_path.iterdir():
            log.append(f"  {src.name}")
            if src.is_file():
                shutil.copy2(str(src), str(dest_dir / src.name))
                imported.add(src.name)
        _write_media_log(log, imported)
        return imported

    # Case B: media is a JSON file
    media_map = {}
    if media_path.is_file():
        try:
            raw_bytes = media_path.read_bytes()
            log.append(f"\nmedia file size: {len(raw_bytes)} bytes")
            log.append(f"media file first 4 bytes: {raw_bytes[:4]!r}")
            # New Anki format: media manifest is also zstd-compressed (magic = \x28\xb5\x2f\xfd)
            # Use stream_reader (not decompress) because the frame may omit the content size header
            if raw_bytes[:4] == b'\x28\xb5\x2f\xfd':
                dctx = zstd.ZstdDecompressor()
                with dctx.stream_reader(io.BytesIO(raw_bytes)) as reader:
                    raw_bytes = reader.read()
                log.append("media file was zstd-compressed — decompressed successfully")
            raw = json.loads(raw_bytes.decode('utf-8'))
            if isinstance(raw, dict):
                media_map = raw
                log.append(f"media JSON parsed — {len(media_map)} entries")
                for k, v in list(media_map.items())[:20]:
                    log.append(f"  {k!r}: {v!r}")
                if len(media_map) > 20:
                    log.append(f"  ... ({len(media_map) - 20} more)")
            else:
                log.append(f"media JSON is not a dict: {type(raw)}")
        except Exception as ex:
            log.append(f"media JSON parse error: {ex}")
    else:
        log.append("\nNo 'media' file or directory found in extracted path")

    # Try copying based on map entries
    log.append("\nCopy attempts:")
    for key, val in media_map.items():
        # Old format: {"0": "audio.mp3"} — numeric key, filename value, stored as "0"
        # New format: {"audio.mp3": "sha256"} — filename key, hash value, stored as hash or filename
        candidates = []
        if key.isdigit():
            # Old format
            candidates = [(import_path / key, val if isinstance(val, str) else key)]
        else:
            # New format — file may be stored by hash (val) or by actual name (key)
            if isinstance(val, str) and val:
                candidates.append((import_path / val, key))   # stored as hash
            candidates.append((import_path / key, key))        # stored by actual name

        copied = False
        for src, dest_name in candidates:
            if src.is_file():
                shutil.copy2(str(src), str(dest_dir / dest_name))
                imported.add(dest_name)
                log.append(f"  COPIED {src.name!r} -> {dest_name!r}")
                copied = True
                break
        if not copied:
            tried = [str(c[0].name) for c in candidates]
            log.append(f"  MISS  key={key!r} val={val!r}  tried: {tried}")

    if imported:
        _write_media_log(log, imported)
        return imported

    # Fallback: copy files with known media extensions that aren't collection/meta files
    log.append("\nFallback: scanning for media-extension files")
    NON_MEDIA = {'collection.anki21b', 'collection.anki21', 'collection.anki2',
                 'collection', 'meta', 'media'}
    MEDIA_EXT = {'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
                 '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
                 '.mp4', '.webm', '.ogv'}
    for src in import_path.iterdir():
        if src.is_file() and src.name not in NON_MEDIA and src.suffix.lower() in MEDIA_EXT:
            shutil.copy2(str(src), str(dest_dir / src.name))
            imported.add(src.name)
            log.append(f"  fallback copied {src.name!r}")

    _write_media_log(log, imported)
    return imported


def _write_media_log(log, imported):
    """Write media import diagnostic to data/media_import_debug.txt"""
    log.append(f"\nTotal imported: {len(imported)}")
    if imported:
        log.append("Files imported:")
        for f in sorted(imported):
            log.append(f"  {f}")
    try:
        debug_path = database.BASE_DIR / 'data' / 'media_import_debug.txt'
        debug_path.write_text('\n'.join(log), encoding='utf-8')
        print(f"[anki_importer] Media debug log written to: {debug_path}")
    except Exception as ex:
        print(f"[anki_importer] Could not write debug log: {ex}")


def convert_anki_media_refs(text):
    """
    Convert Anki field media references to our marker format.
    - <img src="filename.jpg">  →  [image:filename.jpg]
    - [sound:filename.mp3]      →  kept as-is (same format)
    """
    if not text:
        return text
    # Only convert bare filenames (no path separators or protocols)
    text = re.sub(
        r'<img\s[^>]*src="([^"\/\\:]+)"[^>]*\/?>',
        r'[image:\1]',
        text,
        flags=re.IGNORECASE
    )
    return text


# ===========================================================
# Section: Protobuf String Extraction (for new Anki format)
# ===========================================================

def extract_proto_strings(data):
    """
    Naively extract (field_number, string) pairs from a protobuf blob.
    Only handles top-level wire-type-2 (length-delimited) fields that
    decode cleanly as UTF-8. Used to pull qfmt/afmt/css from Anki configs.
    """
    results = []
    i = 0
    while i < len(data):
        b = data[i]
        field_num = b >> 3
        wire_type = b & 0x7
        i += 1

        if wire_type == 0:  # varint — skip
            while i < len(data) and (data[i] & 0x80):
                i += 1
            i += 1
        elif wire_type == 2:  # length-delimited (strings, bytes, embedded messages)
            length = 0
            shift = 0
            while i < len(data):
                b2 = data[i]; i += 1
                length |= (b2 & 0x7F) << shift
                shift += 7
                if not (b2 & 0x80):
                    break
            end = i + length
            if end <= len(data):
                try:
                    s = data[i:end].decode('utf-8')
                    results.append((field_num, s))
                except UnicodeDecodeError:
                    pass
            i = end
        elif wire_type == 1:  # 64-bit fixed
            i += 8
        elif wire_type == 5:  # 32-bit fixed
            i += 4
        else:
            break  # unknown wire type — stop

    return results


def get_template_formats(config_bytes):
    """
    Extract (qfmt, afmt) from a CardTemplateConfig protobuf blob.
    Anki proto: field 1 = q_format, field 2 = a_format.
    Falls back to heuristic string matching if field-specific extraction fails.
    """
    if not config_bytes:
        return '', ''
    strings = extract_proto_strings(bytes(config_bytes))
    qfmt = next((s for fnum, s in strings if fnum == 1), '')
    afmt = next((s for fnum, s in strings if fnum == 2), '')
    # Heuristic fallback: pick strings that look like Anki template syntax
    if not qfmt and not afmt:
        candidates = [s for _, s in strings if '{{' in s]
        qfmt = candidates[0] if len(candidates) >= 1 else ''
        afmt = candidates[1] if len(candidates) >= 2 else ''
    return qfmt, afmt


def get_css_from_config(config_bytes):
    """
    Extract CSS string from a NoteTypeConfig protobuf blob.
    Anki proto: field 4 = css.
    Falls back to heuristic if field-specific extraction fails.
    """
    if not config_bytes:
        return ''
    strings = extract_proto_strings(bytes(config_bytes))
    css = next((s for fnum, s in strings if fnum == 4), '')
    if not css:
        # Heuristic: any string that looks like CSS
        for _, s in strings:
            if '{' in s and ':' in s:
                css = s
                break
    return css


# ===========================================================
# Section: Note Type Parsing
# ===========================================================

def get_note_types_old(cur):
    """
    Parse note types from col.models JSON (old Anki format).
    Returns {anki_model_id: {name, fields, qfmt, afmt, css}}.
    """
    try:
        cur.execute("SELECT models FROM col")
        row = cur.fetchone()
        if not row or not row[0]:
            return {}
        models = json.loads(row[0])
    except Exception:
        return {}

    result = {}
    for mid_str, model in models.items():
        try:
            mid = int(mid_str)
        except (ValueError, TypeError):
            continue
        field_defs = sorted(model.get('flds', []), key=lambda x: x.get('ord', 0))
        fields = [f['name'] for f in field_defs]
        tmpls = model.get('tmpls', [])
        first_tmpl = tmpls[0] if tmpls else {}
        result[mid] = {
            'name': model.get('name', f'NoteType_{mid}'),
            'fields': fields if fields else ['Front', 'Back'],
            'qfmt': first_tmpl.get('qfmt', ''),
            'afmt': first_tmpl.get('afmt', ''),
            'css': model.get('css', ''),
        }
    return result


def get_note_types_new(cur):
    """
    Parse note types from notetypes/fields/templates tables (new Anki format).
    Returns {anki_model_id: {name, fields, qfmt, afmt, css}}.
    """
    result = {}
    try:
        cur.execute("SELECT id, name, config FROM notetypes")
        nts = cur.fetchall()
    except Exception:
        return result

    for nt_id, nt_name, nt_config in nts:
        # Field names
        try:
            cur.execute("SELECT name FROM fields WHERE ntid = ? ORDER BY ord", (nt_id,))
            fields = [row[0] for row in cur.fetchall()]
        except Exception:
            fields = []

        # CSS from notetype config
        css = get_css_from_config(nt_config)

        # Templates
        qfmt, afmt = '', ''
        try:
            cur.execute("SELECT config FROM templates WHERE ntid = ? ORDER BY ord LIMIT 1", (nt_id,))
            tmpl_row = cur.fetchone()
            if tmpl_row:
                qfmt, afmt = get_template_formats(tmpl_row[0])
        except Exception:
            pass

        result[nt_id] = {
            'name': nt_name or f'NoteType_{nt_id}',
            'fields': fields if fields else ['Front', 'Back'],
            'qfmt': qfmt,
            'afmt': afmt,
            'css': css,
        }

    return result


# ===========================================================
# Section: Debug Helper
# ===========================================================

def explore_anki_database(db_path):
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    for (table_name,) in cur.fetchall():
        print(f'\n{table_name}')
        cur.execute(f"PRAGMA table_info({table_name})")
        print(cur.fetchall())
        for row in cur.execute(f"SELECT * FROM {table_name} LIMIT 3"):
            print(row)
    con.close()


# ===========================================================
# Section: Main Import Function
# ===========================================================

def import_anki_deck(apkg_path):
    db_path, import_path = extract_apkg(apkg_path)
    if not db_path or not db_path.exists():
        return None

    # --- Import media files ---
    import_media(import_path, apkg_path=apkg_path)

    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # --- Detect format and load note types ---
    note_types = get_note_types_old(cur)
    if not note_types:
        note_types = get_note_types_new(cur)

    # --- Create card types in our DB (one per Anki note type) ---
    note_type_mapping = {}  # anki_mid -> our card_type_id
    for anki_mid, nt in note_types.items():
        ct_id = database.get_or_create_card_type(
            name=nt['name'],
            fields=nt['fields'],
            front_style=nt['qfmt'],
            back_style=nt['afmt'],
            css_style=nt['css'],
        )
        note_type_mapping[anki_mid] = ct_id

    # --- Import decks ---
    deck_id_mapping = {}  # anki_deck_id -> our deck_id

    cur.execute("PRAGMA table_info(decks)")
    has_decks_table = len(cur.fetchall()) > 0

    if has_decks_table:
        cur.execute("SELECT id, name FROM decks WHERE id != 1")
        for deck_id, deck_name in cur.fetchall():
            deck_id_mapping[deck_id] = database.create_deck(deck_name)
    else:
        try:
            cur.execute("SELECT decks FROM col")
            row = cur.fetchone()
            if row:
                for deck_data in json.loads(row[0]).values():
                    anki_did = deck_data.get("id")
                    if anki_did and anki_did != 1:
                        deck_id_mapping[anki_did] = database.create_deck(deck_data["name"])
        except Exception:
            pass

    # --- Import notes as cards ---
    cur.execute("SELECT id, flds, mid FROM notes")
    notes = cur.fetchall()

    for note_id, flds, mid in notes:
        raw_fields = flds.split('\x1f')

        # Get field names for this note type
        nt = note_types.get(mid, {})
        field_names = nt.get('fields', [])

        # Build fields_json with converted media references
        fields_json = {}
        for i, value in enumerate(raw_fields):
            name = field_names[i] if i < len(field_names) else f'Field{i + 1}'
            fields_json[name] = convert_anki_media_refs(value)

        converted_values = list(fields_json.values())
        front = converted_values[0] if converted_values else ''
        back = ' / '.join(converted_values[1:]) if len(converted_values) > 1 else ''

        # Find the deck this note's card belongs to
        cur.execute("SELECT did FROM cards WHERE nid = ?", (note_id,))
        card_row = cur.fetchone()
        if not card_row:
            continue

        our_deck_id = deck_id_mapping.get(card_row[0])
        if not our_deck_id:
            continue

        our_card_type_id = note_type_mapping.get(mid)

        database.create_card(
            our_deck_id,
            front,
            back,
            card_type_id=our_card_type_id,
            fields_json=json.dumps(fields_json),
        )

    con.close()
    return deck_id_mapping
