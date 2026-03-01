from pathlib import Path
from datetime import date
import sqlite3
import json
import models

# ===========================================================
# Section: Create Database File and Directory
# ===========================================================

BASE_DIR = Path(__file__).resolve().parent.parent
Path(f"{BASE_DIR}/data").mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / 'data' / 'app.db'

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
                Learning_Steps TEXT DEFAULT '1 10'
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

def create_deck(name: str, description: str = ""):
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Deck (Name, Date_Created, Description)
        VALUES (?, ?, ?)
    """, (name, creation_date, description))

    con.commit()
    new_deck_id = cur.lastrowid
    con.close()

    return new_deck_id


def get_all_decks():
    con = create_db_connection()
    cur = con.cursor()

    decks = []

    cur.execute("""SELECT ID, Name, Date_Created, New_Cards_Limit, Description, Learning_Steps FROM Deck""")
    rows = cur.fetchall()

    for row in rows:
        deck = models.Deck(row[0], row[1], row[2], row[3], description=row[4], learning_steps=row[5] or '1 10')
        decks.append(deck)

    con.close()
    return decks

def get_deck_by_id(id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        SELECT ID, Name, Date_Created, New_Cards_Limit, Learning_Steps FROM Deck
        WHERE ID=?
    """, (id,))

    row = cur.fetchone()

    if row is None:
        con.close()
        return None
    else:
        deck = models.Deck(row[0], row[1], row[2], row[3], learning_steps=row[4] or '1 10')

        con.close()
        return deck

def update_deck_settings(deck_id: int, new_cards_limit: int, learning_steps: str = '1 10'):
    con = create_db_connection()
    cur = con.cursor()
    cur.execute("""
        UPDATE Deck SET New_Cards_Limit = ?, Learning_Steps = ? WHERE ID = ?
    """, (new_cards_limit, learning_steps, deck_id))
    con.commit()
    con.close()

def delete_deck(deck_id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        DELETE FROM Deck
        WHERE ID=?
    """, (deck_id,))

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

    cur.execute("""
        DELETE FROM Card
        WHERE ID=?
    """, (card_id,))

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