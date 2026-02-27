from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import QObject, pyqtSlot, QUrl
from PyQt6.QtGui import QColor
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebChannel import QWebChannel
from pathlib import Path
import json
import database


class AppBridge(QObject):
    def __init__(self, web_view):
        super().__init__()
        self.web_view = web_view

    @pyqtSlot()
    def refreshStats(self):
        due_cards = database.get_due_cards()
        decks = database.get_all_decks()
        total_new = sum(len(database.get_new_cards(deck_id=deck.id, limit=deck.new_cards_limit)) for deck in decks)
        self.web_view.page().runJavaScript(f'updateStats({len(due_cards)}, {total_new});')

    @pyqtSlot()
    def getDecks(self):
        decks = database.get_all_decks()
        deck_list = []
        for deck in decks:
            due_count = len(database.get_due_cards(deck_id=deck.id))
            new_count = len(database.get_new_cards(deck_id=deck.id, limit=deck.new_cards_limit))
            deck_list.append({
                'id': deck.id,
                'name': deck.name,
                'due': due_count,
                'new': new_count,
            })
        payload = json.dumps(deck_list)
        self.web_view.page().runJavaScript(f'updateDecks({payload});')
    
    @pyqtSlot()
    def importDeck(self):
        main_window = self.web_view.window()
        if main_window:
            main_window.import_deck()
    
    @pyqtSlot()
    def createDeck(self, deck_name):
        if deck_name:
            database.create_deck(deck_name)
            self.refreshStats()

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