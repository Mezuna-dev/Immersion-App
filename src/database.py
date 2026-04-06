from pathlib import Path
from datetime import date
import sqlite3
import json
import models

# ===========================================================
# Section: Create Database File and Directory
# ===========================================================

import sys as _sys
if getattr(_sys, 'frozen', False):
    # Running as a PyInstaller bundle — keep user data next to the .exe
    BASE_DIR = Path(_sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent.parent
Path(f"{BASE_DIR}/data").mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / 'data' / 'app.db'
SETTINGS_PATH = BASE_DIR / 'data' / 'settings.json'

DEFAULT_SETTINGS = {
    'accent_color': '#9067C6',
    'font_size': 'medium',
    'default_new_cards_limit': 15,
    'default_learning_steps': '1 10',
    'default_relearning_steps': '10',
    'default_study_order': 'new_first',
    'review_autoplay_audio': True,
    'review_shortcut_enabled': True,
    'review_shortcut_key': 'Space',
}

def get_app_settings() -> dict:
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH, 'r') as f:
                data = json.load(f)
            return {**DEFAULT_SETTINGS, **data}
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)

def save_app_settings(settings: dict):
    with open(SETTINGS_PATH, 'w') as f:
        json.dump(settings, f, indent=2)

def create_db_connection():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON;")
    return con

# ===========================================================
# Section: Database Initialization
# ===========================================================

# Check for database
def db_exists(table_name: str):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name=?
    """, (table_name,))
    result = cur.fetchone()
    con.close()
    return result

# Initialize Database tables if not present
def initialize_database():
    initialized_tables = db_exists("Deck")

    if initialized_tables is None:
        con = create_db_connection()
        cur = con.cursor()

        # Deck Table
        cur.execute("""
            CREATE TABLE Deck (
                ID INTEGER NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                Date_Created TEXT NOT NULL,
                New_Cards_Limit INTEGER NOT NULL DEFAULT 15,
                Description TEXT,
                Learning_Steps TEXT DEFAULT '1 10',
                Relearning_Steps TEXT DEFAULT '10',
                Study_Order TEXT DEFAULT 'new_first',
                Answer_Display TEXT DEFAULT 'replace'
                )
        """)

        # CardType Table
        cur.execute("""
            CREATE TABLE CardType (
                ID INTEGER NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL UNIQUE,
                Fields TEXT NOT NULL,
                Date_Created TEXT NOT NULL,
                Is_Default INTEGER NOT NULL DEFAULT 0,
                Front_Style TEXT DEFAULT '',
                Back_Style TEXT DEFAULT '',
                CSS_Style TEXT DEFAULT ''
                )
        """)

        # Card Table
        cur.execute("""
            CREATE TABLE Card (
                ID INTEGER NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT,
                Deck_ID INT NOT NULL,
                Card_Front TEXT NOT NULL,
                Card_Back TEXT NOT NULL,
                Reps INT NOT NULL DEFAULT 0,
                Ease_Factor FLOAT NOT NULL DEFAULT 2.5,
                Interval INT NOT NULL DEFAULT 0,
                Due_Date TEXT,
                Is_New BOOL NOT NULL DEFAULT 1,
                Date_Created TEXT NOT NULL,
                Last_Reviewed TEXT,
                Card_Type_ID INTEGER,
                Fields TEXT,
                Learning_Step INTEGER,
                FOREIGN KEY (Deck_ID) REFERENCES Deck(ID),
                FOREIGN KEY (Card_Type_ID) REFERENCES CardType(ID)
                )
        """)

        # Review Table
        cur.execute("""
            CREATE TABLE Review ( 
                ID INTEGER NOT NULL UNIQUE PRIMARY KEY AUTOINCREMENT, 
                Card_ID INT NOT NULL,
                Review_Date TEXT NOT NULL,
                Rating INT NOT NULL,
                Interval_After INT NOT NULL,
                Ease_Factor_After FLOAT NOT NULL,
                FOREIGN KEY (Card_ID) REFERENCES Card(ID)
                )
        """)

        con.commit()
        con.close()
        seed_default_card_type()


def migrate_database():
    con = create_db_connection()
    cur = con.cursor()
    for stmt in [
        "ALTER TABLE Deck ADD COLUMN Learning_Steps TEXT DEFAULT '1 10'",
        "ALTER TABLE Card ADD COLUMN Learning_Step INTEGER",
        "ALTER TABLE Deck ADD COLUMN Relearning_Steps TEXT DEFAULT '10'",
        "ALTER TABLE Deck ADD COLUMN Study_Order TEXT DEFAULT 'new_first'",
        "ALTER TABLE Deck ADD COLUMN Answer_Display TEXT DEFAULT 'replace'",
    ]:
        try:
            cur.execute(stmt)
            con.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists
    con.close()


# ===========================================================
# Section: Database CRUD Functions
# ===========================================================


# --- Deck Functions --------------------------------

def create_deck(name: str, description: str = "", new_cards_limit: int = 15,
                learning_steps: str = '1 10', relearning_steps: str = '10',
                study_order: str = 'new_first'):
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Deck (Name, Date_Created, Description, New_Cards_Limit,
                          Learning_Steps, Relearning_Steps, Study_Order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (name, creation_date, description, new_cards_limit,
          learning_steps, relearning_steps, study_order))

    con.commit()
    new_deck_id = cur.lastrowid
    con.close()

    return new_deck_id


def get_all_decks():
    con = create_db_connection()
    cur = con.cursor()

    decks = []

    cur.execute("""SELECT ID, Name, Date_Created, New_Cards_Limit, Description, Learning_Steps, Relearning_Steps, Study_Order, Answer_Display FROM Deck""")
    rows = cur.fetchall()

    for row in rows:
        deck = models.Deck(row[0], row[1], row[2], row[3], description=row[4], learning_steps=row[5] or '1 10', relearning_steps=row[6] or '10', study_order=row[7] or 'new_first', answer_display=row[8] or 'replace')
        decks.append(deck)

    con.close()
    return decks

def get_deck_by_id(id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        SELECT ID, Name, Date_Created, New_Cards_Limit, Learning_Steps, Relearning_Steps, Study_Order, Answer_Display FROM Deck
        WHERE ID=?
    """, (id,))

    row = cur.fetchone()

    if row is None:
        con.close()
        return None
    else:
        deck = models.Deck(row[0], row[1], row[2], row[3], learning_steps=row[4] or '1 10', relearning_steps=row[5] or '10', study_order=row[6] or 'new_first', answer_display=row[7] or 'replace')

        con.close()
        return deck

def update_deck_settings(deck_id: int, name: str, description: str, new_cards_limit: int, learning_steps: str = '1 10', relearning_steps: str = '10', study_order: str = 'new_first', answer_display: str = 'replace'):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE Deck SET Name = ?, Description = ?, New_Cards_Limit = ?, Learning_Steps = ?, Relearning_Steps = ?, Study_Order = ?, Answer_Display = ? WHERE ID = ?
    """, (name, description, new_cards_limit, learning_steps, relearning_steps, study_order, answer_display, deck_id))
    con.commit()
    con.close()

def delete_deck(deck_id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("DELETE FROM Review WHERE Card_ID IN (SELECT ID FROM Card WHERE Deck_ID=?)", (deck_id,))
    cur.execute("DELETE FROM Card WHERE Deck_ID=?", (deck_id,))
    cur.execute("DELETE FROM Deck WHERE ID=?", (deck_id,))

    con.commit()
    con.close()

def delete_deck_by_name(name):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        DELETE FROM Deck
        WHERE Name=?
    """, (name,))

    con.commit()
    con.close()

# --- CardType Functions --------------------------------

def seed_default_card_type():
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("SELECT ID FROM CardType WHERE Is_Default = 1")
    if cur.fetchone() is None:
        cur.execute("""
            INSERT INTO CardType (Name, Fields, Date_Created, Is_Default)
            VALUES (?, ?, ?, 1)
        """, ('Basic', '["Front", "Back"]', date.today().strftime('%Y-%m-%d')))
        con.commit()
    con.close()

def get_or_create_card_type(name: str, fields: list, front_style: str = '', back_style: str = '', css_style: str = '') -> int:
    """Return the ID of an existing CardType with this name, or create a new one."""
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("SELECT ID FROM CardType WHERE Name = ?", (name,))
    row = cur.fetchone()
    con.close()
    if row:
        return row[0]
    return create_card_type(name, fields, front_style, back_style, css_style)

def create_card_type(name: str, fields: list, front_style: str = '', back_style: str = '', css_style: str = '') -> int:
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO CardType (Name, Fields, Date_Created, Front_Style, Back_Style, CSS_Style)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (name, json.dumps(fields), creation_date, front_style, back_style, css_style))
    con.commit()
    new_id = cur.lastrowid
    con.close()
    return new_id

def get_all_card_types() -> list:
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        SELECT ID, Name, Fields, Date_Created, Is_Default, Front_Style, Back_Style, CSS_Style FROM CardType
        ORDER BY Is_Default DESC, Name ASC
    """)
    rows = cur.fetchall()
    con.close()
    return [models.CardType(r[0], r[1], json.loads(r[2]), r[3], r[4], r[5] or '', r[6] or '', r[7] or '') for r in rows]

def get_card_type_by_id(card_type_id: int):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        SELECT ID, Name, Fields, Date_Created, Is_Default, Front_Style, Back_Style, CSS_Style FROM CardType WHERE ID=?
    """, (card_type_id,))
    row = cur.fetchone()
    con.close()
    return models.CardType(row[0], row[1], json.loads(row[2]), row[3], row[4], row[5] or '', row[6] or '', row[7] or '') if row else None

def update_card_type(card_type_id: int, name: str, fields: list, front_style: str = '', back_style: str = '', css_style: str = ''):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE CardType SET Name = ?, Fields = ?, Front_Style = ?, Back_Style = ?, CSS_Style = ? WHERE ID = ? AND Is_Default = 0
    """, (name, json.dumps(fields), front_style, back_style, css_style, card_type_id))
    con.commit()
    con.close()

def delete_card_type(card_type_id: int):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE Card SET Card_Type_ID = NULL WHERE Card_Type_ID = ?
    """, (card_type_id,))
    cur.execute("""
        DELETE FROM CardType WHERE ID = ? AND Is_Default = 0
    """, (card_type_id,))
    con.commit()
    con.close()

# --- Card Functions --------------------------------

def create_card(deck_id: int, front: str, back: str,
                card_type_id: int = None, fields_json: str = None,
                reps: int = 0, ease_factor: float = 2.5, interval: int = 0,
                due_date: str = None, is_new: bool = True,
                last_reviewed: str = None) -> int:
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Card (Deck_ID, Card_Front, Card_Back, Card_Type_ID, Fields, Date_Created,
                          Reps, Ease_Factor, Interval, Due_Date, Is_New, Last_Reviewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (deck_id, front, back, card_type_id, fields_json, creation_date,
          reps, ease_factor, interval, due_date, int(is_new), last_reviewed))

    con.commit()
    new_card_id = cur.lastrowid
    con.close()

    return new_card_id

def get_cards_by_deck(deck_id):
    con = create_db_connection()
    cur = con.cursor()

    cards = []

    cur.execute("""
        SELECT ID, Deck_ID, Card_Front, Card_Back, Reps,
        Ease_Factor, Interval, Due_Date, Is_New, Date_Created,
        Last_Reviewed, Card_Type_ID FROM Card
        WHERE Deck_ID=?
        """, (deck_id,))

    rows = cur.fetchall()

    for row in rows:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11])
        cards.append(card)

    con.close()
    return cards

def get_card_by_id(id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        SELECT ID, Deck_ID, Card_Front, Card_Back, Reps,
        Ease_Factor, Interval, Due_Date, Is_New, Date_Created,
        Last_Reviewed, Card_Type_ID FROM Card
        WHERE ID=?
        """, (id,))

    row = cur.fetchone()
    con.close()

    if row is None:
        return None
    else:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11])
        return card
    
def get_due_cards(deck_id=None):
    todays_date = date.today().strftime('%Y-%m-%d')

    con = create_db_connection()
    cur = con.cursor()

    cards = []

    query_string = "SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, Ease_Factor, " \
    "Interval, Due_Date, Is_New, Date_Created, Last_Reviewed, Card_Type_ID, Fields, Learning_Step FROM Card " \
    "WHERE Due_Date <= ? AND Due_Date IS NOT NULL"

    query_params = [todays_date]

    if deck_id is not None:
        query_string += " AND Deck_ID=?"
        query_params.append(deck_id)

    cur.execute(query_string, query_params)

    rows = cur.fetchall()

    for row in rows:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13])
        cards.append(card)

    con.close()
    return cards

def get_new_cards(deck_id=None, limit=None):
    con = create_db_connection()
    cur = con.cursor()

    cards = []

    query_string = "SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, Ease_Factor, " \
    "Interval, Due_Date, Is_New, Date_Created, Last_Reviewed, Card_Type_ID, Fields, Learning_Step FROM Card " \
    "WHERE Is_New = 1 AND Due_Date IS NULL"

    query_params = []

    if deck_id is not None:
        query_string += " AND Deck_ID=?"
        query_params.append(deck_id)
    if limit is not None:
        query_string += " LIMIT ?"
        query_params.append(limit)

    cur.execute(query_string, query_params)

    rows = cur.fetchall()

    for row in rows:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13])
        cards.append(card)

    con.close()
    return cards

def delete_card(card_id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("DELETE FROM Review WHERE Card_ID=?", (card_id,))
    cur.execute("""
        DELETE FROM Card
        WHERE ID=?
    """, (card_id,))

    con.commit()
    con.close()


def browse_cards(deck_id=None, search_query=None, sort_by=None) -> list:
    con = create_db_connection()
    cur = con.cursor()

    query = """
        SELECT c.ID, c.Deck_ID, c.Card_Front, c.Card_Back, c.Reps,
               c.Ease_Factor, c.Interval, c.Due_Date, c.Is_New, c.Date_Created,
               c.Last_Reviewed, c.Card_Type_ID, c.Fields, c.Learning_Step,
               d.Name AS Deck_Name,
               COALESCE(ct.Name, '') AS Type_Name
        FROM Card c
        LEFT JOIN Deck d ON c.Deck_ID = d.ID
        LEFT JOIN CardType ct ON c.Card_Type_ID = ct.ID
        WHERE 1=1
    """
    params = []

    if deck_id is not None:
        query += " AND c.Deck_ID = ?"
        params.append(deck_id)

    if search_query:
        query += " AND (c.Card_Front LIKE ? OR c.Card_Back LIKE ? OR c.Fields LIKE ?)"
        like = f"%{search_query}%"
        params.extend([like, like, like])

    sort_map = {
        'date_created_desc': 'c.ID DESC',
        'date_created_asc': 'c.ID ASC',
        'due_date_asc': 'c.Due_Date ASC',
        'interval_asc': 'c.Interval ASC',
        'interval_desc': 'c.Interval DESC',
        'front_asc': 'c.Card_Front ASC',
    }
    order = sort_map.get(sort_by, 'c.ID DESC')
    query += f" ORDER BY {order}"

    cur.execute(query, params)
    rows = cur.fetchall()
    con.close()

    results = []
    for r in rows:
        results.append({
            'id': r[0],
            'deck_id': r[1],
            'front': r[2],
            'back': r[3],
            'reps': r[4],
            'ease_factor': round(r[5], 2),
            'interval': r[6],
            'due_date': r[7],
            'is_new': bool(r[8]),
            'date_created': r[9],
            'last_reviewed': r[10],
            'card_type_id': r[11],
            'fields': r[12],
            'learning_step': r[13],
            'deck_name': r[14] or '',
            'type_name': r[15] or '',
        })
    return results


def update_card_fields(card_id: int, deck_id: int, card_type_id: int, fields_json: str, front: str, back: str):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE Card SET Deck_ID = ?, Card_Type_ID = ?, Fields = ?, Card_Front = ?, Card_Back = ?
        WHERE ID = ?
    """, (deck_id, card_type_id, fields_json, front, back, card_id))
    con.commit()
    con.close()

def update_card_learning_step(card_id: int, learning_step: int):
    today = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE Card SET Learning_Step = ?, Due_Date = ? WHERE ID = ?
    """, (learning_step, today, card_id))
    con.commit()
    con.close()

def update_card_after_review(card_id, new_reps, new_ease_factor, new_interval, new_due_date, is_new):
    todays_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        UPDATE Card
        SET Reps = ?, Ease_Factor = ?, Interval = ?, Due_Date = ?,
        Is_New = ?, Last_Reviewed = ?, Learning_Step = NULL
        WHERE ID=?
        """, (new_reps, new_ease_factor, new_interval, new_due_date, is_new, todays_date, card_id))
    
    con.commit()
    con.close()

def get_young_card_count(deck_id=None):
    con = create_db_connection()
    cur = con.cursor()
    if deck_id is not None:
        cur.execute("""
            SELECT COUNT(*) FROM Card
            WHERE Is_New = 0 AND Learning_Step IS NULL AND Interval > 0 AND Interval < 21
            AND Deck_ID = ?
        """, (deck_id,))
    else:
        cur.execute("""
            SELECT COUNT(*) FROM Card
            WHERE Is_New = 0 AND Learning_Step IS NULL AND Interval > 0 AND Interval < 21
        """)
    count = cur.fetchone()[0]
    con.close()
    return count

def get_mature_card_count(deck_id=None):
    con = create_db_connection()
    cur = con.cursor()
    if deck_id is not None:
        cur.execute("""
            SELECT COUNT(*) FROM Card
            WHERE Is_New = 0 AND Learning_Step IS NULL AND Interval >= 21
            AND Deck_ID = ?
        """, (deck_id,))
    else:
        cur.execute("""
            SELECT COUNT(*) FROM Card
            WHERE Is_New = 0 AND Learning_Step IS NULL AND Interval >= 21
        """)
    count = cur.fetchone()[0]
    con.close()
    return count


def get_all_deck_stats():
    """Fetch per-deck card counts in a single query instead of N+1 queries per deck."""
    todays_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        SELECT
            Deck_ID,
            COUNT(*) AS total,
            SUM(CASE WHEN Is_New = 0 AND Learning_Step IS NULL AND Interval > 0 AND Interval < 21 THEN 1 ELSE 0 END) AS young,
            SUM(CASE WHEN Is_New = 0 AND Learning_Step IS NULL AND Interval >= 21 THEN 1 ELSE 0 END) AS mature,
            SUM(CASE WHEN Due_Date <= ? AND Due_Date IS NOT NULL THEN 1 ELSE 0 END) AS due,
            SUM(CASE WHEN Is_New = 1 AND Due_Date IS NULL THEN 1 ELSE 0 END) AS new_available
        FROM Card
        GROUP BY Deck_ID
    """, (todays_date,))
    rows = cur.fetchall()
    con.close()
    stats = {}
    for r in rows:
        stats[r[0]] = {
            'total': r[1],
            'young': r[2],
            'mature': r[3],
            'due': r[4],
            'new_available': r[5],
        }
    return stats

# --- Review Functions --------------------------------

def get_new_cards_introduced_today(deck_id=None):
    todays_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    # A card was "introduced today" if its earliest review entry is today
    if deck_id is not None:
        cur.execute("""
            SELECT COUNT(DISTINCT r.Card_ID) FROM Review r
            JOIN Card c ON r.Card_ID = c.ID
            WHERE c.Deck_ID = ?
            AND r.Review_Date = ?
            AND NOT EXISTS (
                SELECT 1 FROM Review r2
                WHERE r2.Card_ID = r.Card_ID
                AND r2.Review_Date < ?
            )
        """, (deck_id, todays_date, todays_date))
    else:
        cur.execute("""
            SELECT COUNT(DISTINCT r.Card_ID) FROM Review r
            WHERE r.Review_Date = ?
            AND NOT EXISTS (
                SELECT 1 FROM Review r2
                WHERE r2.Card_ID = r.Card_ID
                AND r2.Review_Date < ?
            )
        """, (todays_date, todays_date))

    count = cur.fetchone()[0]
    con.close()
    return count

def create_review(card_id, rating, interval_after, ease_factor_after):
    review_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Review (Card_ID, Review_Date, Rating, Interval_After, Ease_Factor_After)
        VALUES (?, ?, ?, ?, ?)
    """, (card_id, review_date, rating, interval_after, ease_factor_after))

    con.commit()
    con.close()


def import_review(card_id, review_date: str, rating, interval_after, ease_factor_after):
    """Insert a historical review record with an explicit date (used during deck import)."""
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Review (Card_ID, Review_Date, Rating, Interval_After, Ease_Factor_After)
        VALUES (?, ?, ?, ?, ?)
    """, (card_id, review_date, rating, interval_after, ease_factor_after))

    con.commit()
    con.close()


def get_data_info() -> dict:
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) FROM Deck")
    deck_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM Card")
    card_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM Review")
    review_count = cur.fetchone()[0]
    con.close()
    db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return {
        'db_path': str(DB_PATH),
        'db_size_bytes': db_size,
        'deck_count': deck_count,
        'card_count': card_count,
        'review_count': review_count,
    }


def export_all_data() -> dict:
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("SELECT ID, Name, Date_Created, New_Cards_Limit, Description, Learning_Steps, Relearning_Steps, Study_Order, Answer_Display FROM Deck")
    decks = [{'id': r[0], 'name': r[1], 'date_created': r[2], 'new_cards_limit': r[3], 'description': r[4],
               'learning_steps': r[5], 'relearning_steps': r[6], 'study_order': r[7], 'answer_display': r[8]}
             for r in cur.fetchall()]
    cur.execute("SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, Ease_Factor, Interval, Due_Date, Is_New, Date_Created, Last_Reviewed, Card_Type_ID, Fields, Learning_Step FROM Card")
    cards = [{'id': r[0], 'deck_id': r[1], 'front': r[2], 'back': r[3], 'reps': r[4], 'ease_factor': r[5],
               'interval': r[6], 'due_date': r[7], 'is_new': r[8], 'date_created': r[9], 'last_reviewed': r[10],
               'card_type_id': r[11], 'fields': r[12], 'learning_step': r[13]}
             for r in cur.fetchall()]
    cur.execute("SELECT ID, Name, Fields, Date_Created, Is_Default, Front_Style, Back_Style, CSS_Style FROM CardType")
    card_types = [{'id': r[0], 'name': r[1], 'fields': r[2], 'date_created': r[3], 'is_default': r[4],
                   'front_style': r[5], 'back_style': r[6], 'css_style': r[7]}
                  for r in cur.fetchall()]
    cur.execute("SELECT ID, Card_ID, Review_Date, Rating, Interval_After, Ease_Factor_After FROM Review")
    reviews = [{'id': r[0], 'card_id': r[1], 'review_date': r[2], 'rating': r[3],
                'interval_after': r[4], 'ease_factor_after': r[5]}
               for r in cur.fetchall()]
    con.close()
    return {'decks': decks, 'cards': cards, 'card_types': card_types, 'reviews': reviews}


def get_daily_review_counts(deck_id=None) -> dict:
    from datetime import date, timedelta
    today = date.today()
    start = today - timedelta(days=364)

    con = create_db_connection()
    cur = con.cursor()

    if deck_id is not None:
        cur.execute("""
            SELECT r.Review_Date, COUNT(*)
            FROM Review r
            JOIN Card c ON r.Card_ID = c.ID
            WHERE c.Deck_ID = ? AND r.Review_Date >= ? AND r.Review_Date <= ?
            GROUP BY r.Review_Date
        """, (deck_id, start.isoformat(), today.isoformat()))
    else:
        cur.execute("""
            SELECT Review_Date, COUNT(*)
            FROM Review
            WHERE Review_Date >= ? AND Review_Date <= ?
            GROUP BY Review_Date
        """, (start.isoformat(), today.isoformat()))

    counts = {row[0]: row[1] for row in cur.fetchall()}
    con.close()

    # Current streak: consecutive days ending today (or yesterday if no reviews today)
    current_streak = 0
    d = today if counts.get(today.isoformat(), 0) > 0 else today - timedelta(days=1)
    while counts.get(d.isoformat(), 0) > 0:
        current_streak += 1
        d -= timedelta(days=1)

    # Longest streak over the full year window
    longest_streak, run = 0, 0
    for i in range(365):
        if counts.get((start + timedelta(days=i)).isoformat(), 0) > 0:
            run += 1
            longest_streak = max(longest_streak, run)
        else:
            run = 0

    return {
        'counts': counts,
        'current_streak': current_streak,
        'longest_streak': longest_streak,
        'year_total': sum(counts.values()),
    }


def get_retention_stats(deck_id=None, start_date=None, end_date=None) -> dict:
    con = create_db_connection()
    cur = con.cursor()

    deck_filter = 'AND c.Deck_ID = ?' if deck_id is not None else ''
    params = [deck_id] if deck_id is not None else []
    params += [start_date, end_date]

    cur.execute(f"""
        WITH all_reviews AS (
            SELECT
                r.ID,
                r.Card_ID,
                r.Review_Date,
                r.Rating,
                ROW_NUMBER() OVER (PARTITION BY r.Card_ID, r.Review_Date ORDER BY r.ID) AS day_rn,
                LAG(r.Interval_After, 1, 0) OVER (PARTITION BY r.Card_ID ORDER BY r.ID) AS interval_before
            FROM Review r
            JOIN Card c ON r.Card_ID = c.ID
            WHERE 1=1 {deck_filter}
        ),
        filtered AS (
            SELECT * FROM all_reviews WHERE day_rn = 1 AND Review_Date >= ? AND Review_Date <= ?
        )
        SELECT
            SUM(CASE WHEN interval_before > 0 AND interval_before < 21 THEN 1 ELSE 0 END),
            SUM(CASE WHEN interval_before > 0 AND interval_before < 21 AND Rating >= 3 THEN 1 ELSE 0 END),
            SUM(CASE WHEN interval_before >= 21 THEN 1 ELSE 0 END),
            SUM(CASE WHEN interval_before >= 21 AND Rating >= 3 THEN 1 ELSE 0 END),
            COUNT(*),
            SUM(CASE WHEN Rating >= 3 THEN 1 ELSE 0 END)
        FROM filtered
    """, params)

    row = cur.fetchone()
    con.close()

    if not row or not row[4]:
        empty = {'total': 0, 'successful': 0, 'rate': None}
        return {'young': empty, 'mature': empty, 'total': empty}

    young_t, young_s = row[0] or 0, row[1] or 0
    mature_t, mature_s = row[2] or 0, row[3] or 0
    all_t, all_s = row[4] or 0, row[5] or 0

    def stat(t, s):
        return {'total': t, 'successful': s, 'rate': round(s / t * 100, 1) if t > 0 else None}

    return {'young': stat(young_t, young_s), 'mature': stat(mature_t, mature_s), 'total': stat(all_t, all_s)}


def clear_review_history():
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("DELETE FROM Review")
    con.commit()
    con.close()