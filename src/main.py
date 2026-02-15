import database
import cli

if __name__ == "__main__":
    database.initialize_database()
    cli.main_menu()