import database

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
        print("6. Exit")
        print("="*50)
        
        choice = input("\nEnter your choice (1-6): ").strip()
        
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
            print("\nGoodbye")
            break
        else:
            print("\nInvalid choice. Please enter a number from 1-6.")


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
    print("\n--- Review Cards ---")
    # TODO: Implement review session
    print("Feature not yet implemented")


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
    


if __name__ == "__main__":
    main_menu()