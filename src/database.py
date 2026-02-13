from pathlib import Path
import sqlite3


BASE_DIR = Path(__file__).resolve().parent.parent
Path(f"{BASE_DIR}/data").mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR / 'data' / 'app.db'

def create_db_connection():
    con = sqlite3.connect(DB_PATH)
    return con

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