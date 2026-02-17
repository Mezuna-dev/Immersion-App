import database
import scheduler
import ankiimport

def main_menu():
    """Display main menu and handle user choices"""
    while True:
        print("\n" + "="*50)
        print("IMMERSION SUITE - MAIN MENU")
        print("="*50)
        print("1. Create a new deck")
        print("2. List all decks")
        print("3. Add cards to a deck")
        print("4. Review cards")
        print("5. Show statistics")
        print("6. Delete a card")
        print("7. Import Anki Deck")
        print("8. Exit")
        print("="*50)
        
        choice = input("\nEnter your choice (1-8): ").strip()
        
        if choice == "1":
            create_deck_menu()
        elif choice == "2":
            list_decks_menu()
        elif choice == "3":
            add_cards_menu()
        elif choice == "4":
            review_menu()
        elif choice == "5":
            show_stats_menu()
        elif choice == "6":
            delete_card_menu()
        elif choice == "7":
            import_anki_deck()
        elif choice == "8":
            print("\nGoodbye")
            break
        else:
            print("\nInvalid choice. Please enter a number from 1-8.")


def create_deck_menu():
    print("\n--- Create New Deck ---")
    new_deck_name = input("\nEnter deck name (or press Enter to cancel): ").strip()
    if new_deck_name != "":
        new_deck_id = database.create_deck(new_deck_name)
        print(f'Deck "{new_deck_name}" created successfully! (ID: {new_deck_id})')
    

def list_decks_menu():
    print("\n--- List All Decks ---")
    decks = database.get_all_decks()

    if len(decks) == 0:
        print("\nNo decks found. Please create one first!")
    else:
        for deck in decks:
            print(deck)


def add_cards_menu():
    print("\n--- Add Cards to Deck ---")

    decks = database.get_all_decks()

    if len(decks) == 0:
        print("No decks available. Create a deck first!")
        return

    print("\nAvaliable Decks:")
    for deck in decks:
        print(f"\n{deck.name} | Deck ID: {deck.id}")

    try:
        deck_id = int(input('\nWhich deck would you like to add a card (Use the deck ID): ').strip())
        deck_check = database.get_deck_by_id(deck_id)

        while deck_check is None:
            deck_id = int(input('\nInvalid deck id. Please enter a deck from the previous list: '))
            deck_check = database.get_deck_by_id(deck_id)
    except ValueError:
        print("Error: Please enter a valid number!")
        return

    while True:
        card_front = input('\nCard Front (or Enter to finish): ').strip()
        if card_front == "":
            break

        card_back = input("\nCard Back: ").strip()
        if card_back == "":
            print("Card back cannot be empty")
            continue

        new_card_id = database.create_card(deck_id, card_front, card_back)

        print(f'\n New Card | ID: {new_card_id} has been created successfully!')

def review_menu():
    print('\n--- Review Flashcards ---:')
    print("\nAvaliable Decks:")

    decks = database.get_all_decks()

    for deck in decks:
        print(f"\n{deck.name} | Deck ID: {deck.id}")

    try:
        deck_id = int(input('\nWhich deck would you like to review (Use the deck ID): ').strip())
        deck_check = database.get_deck_by_id(deck_id)

        while deck_check is None:
            deck_id = int(input('\nInvalid deck id. Please enter a deck from the previous list: '))
            deck_check = database.get_deck_by_id(deck_id)
    except ValueError:
        print("Error: Please enter a valid number!")
        return
    
    review_cards = database.get_due_cards(deck_id)
    new_cards = database.get_new_cards(deck_id, limit=10)

    all_cards = review_cards + new_cards

    for card in all_cards:
        print(card.card_front)
        input('Press enter to reveal card back...')
        print(card.card_back)
        try:
            rating = input('Rating? "Again" (0) or "Good" (4): ').strip()

            while rating != "0" and rating != "4":
                rating = input('Please answer with "Again" (0) or "Good" (4):').strip()
            
            rating = int(rating)

            new_reps, new_ease_factor, new_interval, due_date = scheduler.calculate_next_review(card.reps, card.ease_factor, card.interval, rating)

            database.update_card_after_review(card.id, new_reps, new_ease_factor, new_interval, due_date, is_new=0)
            database.create_review(card.id, rating, new_interval, new_ease_factor)

        except ValueError:
            print("Error: Please enter a valid number!")
            return


def show_stats_menu():
    print("\n--- Statistics ---")

    decks = database.get_all_decks()
    print(f'\nTotal decks: {len(decks)}')
    print(f'\nCurrent decks:')
    
    for deck in decks:
        print (deck)
    
    cards_due = database.get_due_cards()
    print(f'\nCards due today: {len(cards_due)}')

    new_cards = database.get_new_cards(limit = 20)
    print(f'\nNew cards available: {len(new_cards)}')

def delete_card_menu():
    print("\n--- Delete a Card ---")
    try:
        card_id = int(input('Enter the ID of the card you want to delete: ').strip())
        card_check = database.get_card_by_id(card_id)

        while card_check is None:
            card_id = int(input('Invalid card id. Please enter a valid card ID: ').strip())
            card_check = database.get_card_by_id(card_id)
        
        database.delete_card(card_id)
        print(f'Card with ID {card_id} has been deleted successfully!')

    except ValueError:
        print("Error: Please enter a valid number!")
        return
    
    
def import_anki_deck():
    apkg_path = input('Please provide path to apkg file: ').strip()
    ankiimport.import_anki_deck(apkg_path)

if __name__ == "__main__":
    main_menu()


