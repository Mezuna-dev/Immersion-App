import sqlite3
import zipfile
from pathlib import Path
import json
import database

def extract_apkg(apkg_path):
    BASE_DIR = Path(__file__).resolve().parent.parent
    import_path = BASE_DIR / "imported"
    import_path.mkdir(parents=True, exist_ok=True)

    apkg_file = Path(apkg_path)

    if not apkg_file.exists():
        print(f"Error: File {apkg_path} not found")
        return None
    

    with zipfile.ZipFile(apkg_path) as zip_apkg:
        zip_apkg.extractall(import_path)

    for db_name in ["collection.anki21", "collection.anki2"]:
        db_path = import_path / db_name
        if db_path.exists():
            return db_path

    print("Error: No Anki database found in package")
    return None

def explore_anki_database(db_path):
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    cur.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table'
    """)

    tables = cur.fetchall()

    for table in tables:
        table_name = table[0]
        print(f'\n{table_name}\n')

        cur.execute(f"PRAGMA table_info({table_name})")
        schema = cur.fetchall()
        print(schema)

        columns = cur.execute(f"""SELECT * FROM {table_name} LIMIT 3""")
        for column in columns:
            print(column)

    con.close()

def import_anki_deck(apkg_path):
    db_path = extract_apkg(apkg_path)

    if not db_path.exists():
        return None
    
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    
    cur.execute("""
        SELECT decks FROM col
    """)

    decks_json = cur.fetchone()
    decks_dict = json.loads(decks_json[0])

    deck_id_mapping = {}

    cur.execute("SELECT COUNT(*) FROM notes")
    print(f"Total notes in Anki DB: {cur.fetchone()[0]}")

    for deck_data in decks_dict.values():
        deck_name = deck_data["name"]
        anki_deck_id = deck_data["id"]
        new_deck_id = database.create_deck(deck_name)
        deck_id_mapping[anki_deck_id] = new_deck_id    


    cur.execute("SELECT id, flds, mid FROM notes")
    notes = cur.fetchall()

    print(f"Processing {len(notes)} notes")

    for note in notes:
        note_id = note[0]
        flds = note[1]
        
        fields = flds.split('\x1f')
        
        if len(fields) >= 2:
            front = fields[0]
            back = fields[1]

            cur.execute("SELECT did FROM cards WHERE nid = ?", (note_id,))
            card_result = cur.fetchone()

            if card_result:
                anki_deck_id = card_result[0]
                
                your_deck_id = deck_id_mapping.get(anki_deck_id)
                
                if your_deck_id:
                    database.create_card(your_deck_id, front, back)

    con.close()
    return deck_id_mapping
