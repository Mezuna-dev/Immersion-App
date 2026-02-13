
class Deck:
    def __init__(self, id, name, date_created) -> None:
        self.id = id
        self.name = name
        self.date_created = date_created

    def __repr__(self) -> str:
        return f"\nId: {self.id}\nName: {self.name}\nDate Created: {self.date_created}\n"