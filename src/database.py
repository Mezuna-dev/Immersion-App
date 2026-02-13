from pathlib import Path
from datetime import date
import sqlite3
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
                Date_Created TEXT NOT NULL
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
                FOREIGN KEY (Deck_ID) REFERENCES Deck(ID)
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


# ===========================================================
# Section: Database CRUD Functions
# ===========================================================


# --- Deck Functions --------------------------------

def create_deck(name: str):
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Deck (Name, Date_Created)
        VALUES (?, ?)
    """, (name, creation_date))

    con.commit()
    new_deck_id = cur.lastrowid
    con.close()

    return new_deck_id


def get_all_decks():
    con = create_db_connection()
    cur = con.cursor()

    decks = []

    cur.execute("""SELECT ID, Name, Date_Created FROM Deck""")
    rows = cur.fetchall()
    
    for row in rows:
        deck = models.Deck(row[0], row[1], row[2])
        decks.append(deck)

    con.close()
    return decks

def get_deck_by_id(id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        SELECT ID, Name, Date_Created FROM Deck
        WHERE ID=?
    """, (id,))

    row = cur.fetchone()

    if row is None:
        con.close()
        return None
    else:
        deck = models.Deck(row[0], row[1], row[2])
        
        con.close()
        return deck

# --- Card Functions --------------------------------

def create_card(deck_id: int, front: str, back: str):
    creation_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO Card (Deck_ID, Card_Front, Card_Back, Date_Created)
        VALUES (?, ?, ?, ?)
    """, (deck_id, front, back, creation_date))

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
        Last_Reviewed FROM Card
        WHERE Deck_ID=?
        """, (deck_id,))
    
    rows = cur.fetchall()
    
    for row in rows:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10])
        cards.append(card)

    con.close()
    return cards

def get_card_by_id(id):
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, 
        Ease_Factor, Interval, Due_Date, Is_New, Date_Created, 
        Last_Reviewed FROM Card
        WHERE ID=?
        """, (id,))

    row = cur.fetchone()
    con.close()

    if row is None:
        return None
    else:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10])
        return card
    
def get_due_cards(deck_id=None):
    todays_date = date.today().strftime('%Y-%m-%d')

    con = create_db_connection()
    cur = con.cursor()

    cards = []

    query_string = "SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, Ease_Factor, " \
    "Interval, Due_Date, Is_New, Date_Created, Last_Reviewed FROM Card " \
    "WHERE Due_Date <= ? AND Due_Date IS NOT NULL"

    query_params = [todays_date]

    if deck_id is not None:
        query_string += " AND Deck_ID=?"
        query_params.append(deck_id)

    cur.execute(query_string, query_params)
        
    rows = cur.fetchall()
    
    for row in rows:
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10])
        cards.append(card)

    con.close()
    return cards

def get_new_cards(deck_id=None, limit=None):
    con = create_db_connection()
    cur = con.cursor()

    cards = []

    query_string = "SELECT ID, Deck_ID, Card_Front, Card_Back, Reps, Ease_Factor, " \
    "Interval, Due_Date, Is_New, Date_Created, Last_Reviewed FROM Card " \
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
        card = models.Card(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10])
        cards.append(card)

    con.close()
    return cards

def update_card_after_review(card_id, new_reps, new_ease_factor, new_interval, new_due_date, is_new):
    todays_date = date.today().strftime('%Y-%m-%d')
    con = create_db_connection()
    cur = con.cursor()

    cur.execute("""
        UPDATE Card
        SET Reps = ?, Ease_Factor = ?, Interval = ?, Due_Date = ?, 
        Is_New = ?, Last_Reviewed = ?
        WHERE ID=?
        """, (new_reps, new_ease_factor, new_interval, new_due_date, is_new, todays_date, card_id))
    
    con.commit()
    con.close()

# --- Review Functions --------------------------------

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