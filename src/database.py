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