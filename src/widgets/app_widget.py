from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import QObject, pyqtSlot, QUrl
from PyQt6.QtGui import QColor
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebChannel import QWebChannel
from pathlib import Path
import json
import database
import scheduler


class AppBridge(QObject):
    def __init__(self, web_view):
        super().__init__()
        self.web_view = web_view

    @pyqtSlot()
    def refreshStats(self):
        due_cards = database.get_due_cards()
        decks = database.get_all_decks()
        total_new = sum(
            len(database.get_new_cards(
                deck_id=deck.id,
                limit=max(0, deck.new_cards_limit - database.get_new_cards_introduced_today(deck_id=deck.id))
            )) for deck in decks
        )
        self.web_view.page().runJavaScript(f'updateStats({len(due_cards)}, {total_new});')

    @pyqtSlot()
    def getDecks(self):
        decks = database.get_all_decks()
        deck_list = []
        for deck in decks:
            due_count = len(database.get_due_cards(deck_id=deck.id))
            introduced_today = database.get_new_cards_introduced_today(deck_id=deck.id)
            remaining_new = max(0, deck.new_cards_limit - introduced_today)
            new_count = len(database.get_new_cards(deck_id=deck.id, limit=remaining_new))
            total_count = database.get_cards_by_deck(deck_id=deck.id)
            deck_list.append({
                'id': deck.id,
                'name': deck.name,
                'due': due_count,
                'new': new_count,
                'total': len(total_count),
                'description': deck.description,
                'new_cards_limit': deck.new_cards_limit
            })
        payload = json.dumps(deck_list)
        self.web_view.page().runJavaScript(f'updateDecks({payload});')
    
    @pyqtSlot()
    def importDeck(self):
        main_window = self.web_view.window()
        if main_window:
            main_window.import_deck()
    
    @pyqtSlot(str, str)
    def createDeck(self, deck_name, deck_description):
        if deck_name:
            database.create_deck(deck_name, deck_description)
            self.refreshStats()
    
    @pyqtSlot()
    def getCardTypes(self):
        card_types = database.get_all_card_types()
        payload = json.dumps([{
            'id': ct.id,
            'name': ct.name,
            'fields': ct.fields,
            'is_default': ct.is_default
        } for ct in card_types])
        self.web_view.page().runJavaScript(f'updateCardTypes({payload});')

    @pyqtSlot(str, str)
    def createCardType(self, name, fields_json):
        fields = json.loads(fields_json)
        fields = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if name.strip() and fields:
            database.create_card_type(name.strip(), fields)
        self.getCardTypes()

    @pyqtSlot(int, str, str)
    def updateCardType(self, card_type_id, name, fields_json):
        fields = json.loads(fields_json)
        fields = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if name.strip() and fields:
            database.update_card_type(card_type_id, name.strip(), fields)
        self.getCardTypes()

    @pyqtSlot(int)
    def deleteCardType(self, card_type_id):
        database.delete_card_type(card_type_id)
        self.getCardTypes()

    @pyqtSlot(int, int, str)
    def createCard(self, deck_id, card_type_id, fields_json):
        fields_dict = json.loads(fields_json)
        card_type = database.get_card_type_by_id(card_type_id)
        if not card_type or not fields_dict:
            return
        field_values = [str(fields_dict.get(f, '')) for f in card_type.fields]
        front = field_values[0] if field_values else ''
        back = ' / '.join(field_values[1:]) if len(field_values) > 1 else ''
        if not front:
            return
        database.create_card(deck_id, front, back, card_type_id, fields_json)
        self.refreshStats()

    @pyqtSlot(int, int)
    def saveDeckSettings(self, deck_id, new_cards_limit):
        database.update_deck_new_cards_limit(deck_id, new_cards_limit)
        self.getDecks()

    @pyqtSlot(int)
    def startReview(self, deck_id):
        deck = database.get_deck_by_id(deck_id)
        new_limit = deck.new_cards_limit if deck else 15
        introduced_today = database.get_new_cards_introduced_today(deck_id=deck_id)
        remaining_new = max(0, new_limit - introduced_today)
        due_cards = database.get_due_cards(deck_id=deck_id)
        new_cards = database.get_new_cards(deck_id=deck_id, limit=remaining_new)
        cards = []
        for card in due_cards + new_cards:
            cards.append({
                'id': card.id,
                'front': card.card_front,
                'back': card.card_back,
            })
        payload = json.dumps(cards)
        self.web_view.page().runJavaScript(f'updateReviewQueue({payload});')

    @pyqtSlot(int, int)
    def submitRating(self, card_id, rating):
        card = database.get_card_by_id(card_id)
        if card:
            new_reps, new_ease_factor, new_interval, due_date = scheduler.calculate_next_review(
                card.reps, card.ease_factor, card.interval, rating
            )
            database.update_card_after_review(card_id, new_reps, new_ease_factor, new_interval, due_date, 0)
            database.create_review(card_id, rating, new_interval, new_ease_factor)

class AppWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)

        self.web_view = QWebEngineView()
        self.web_view.page().setBackgroundColor(QColor("#242038"))

        self.bridge = AppBridge(self.web_view)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        page_path = Path(__file__).parent.parent.parent / "web" / "pages" / "app.html"
        self.web_view.setUrl(QUrl.fromLocalFile(str(page_path.absolute())))

        layout.addWidget(self.web_view)
        self.setLayout(layout)
        self.setStyleSheet("background-color: #242038;")

    def refresh_stats(self):
        self.bridge.getDecks()
        self.bridge.refreshStats()