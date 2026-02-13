
class Deck:
    def __init__(self, id, name, date_created) -> None:
        self.id = id
        self.name = name
        self.date_created = date_created

    def __repr__(self) -> str:
        return f"\nId: {self.id}\nName: {self.name}\nDate Created: {self.date_created}\n"
    
class Card:
    def __init__(self, id, deck_id, card_front, card_back, reps,
            ease_factor, interval, due_date, is_new, date_created, last_reviewed) -> None:
        self.id = id
        self.deck_id = deck_id
        self.card_front = card_front
        self.card_back = card_back
        self.reps = reps
        self.ease_factor = ease_factor
        self.interval = interval
        self.due_date = due_date
        self.is_new = is_new
        self.date_created = date_created
        self.last_reviewed = last_reviewed

    def __repr__(self) -> str:
        return f"\nId: {self.id}\nDeck Id: {self.deck_id}\nFront: {self.card_front}\n \
Back: {self.card_back}\nReps: {self.reps}\nEase Factor: {self.ease_factor}\n \
Interval: {self.interval}\nDue Date: {self.due_date}\nIs New: {self.is_new}\n \
Date Created: {self.date_created}\nLast Reviewed: {self.last_reviewed}\n"
