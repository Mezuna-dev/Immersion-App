import database

database.initialize_database()

deck_id1 = database.create_deck("Kaishi")
deck_id2 = database.create_deck("Core2k/6k")

card_id1 = database.create_card(1, "Arigato", "Thank you")
card_id2 = database.create_card(1, "Arigato Gozaimsu", "Polite Thank you")

print(deck_id1)
print(card_id1)
print(card_id2)

print(database.get_all_decks())