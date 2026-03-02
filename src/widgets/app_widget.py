from PyQt6.QtWidgets import QWidget, QVBoxLayout, QFileDialog
import shutil
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
            young_count = database.get_young_card_count(deck_id=deck.id)
            mature_count = database.get_mature_card_count(deck_id=deck.id)
            deck_list.append({
                'id': deck.id,
                'name': deck.name,
                'due': due_count,
                'new': new_count,
                'total': len(total_count),
                'young': young_count,
                'mature': mature_count,
                'description': deck.description,
                'new_cards_limit': deck.new_cards_limit,
                'learning_steps': deck.learning_steps or '1 10',
                'relearning_steps': deck.relearning_steps or '10',
                'study_order': deck.study_order or 'new_first',
                'answer_display': deck.answer_display or 'replace'
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
            'is_default': ct.is_default,
            'front_style': ct.front_style,
            'back_style': ct.back_style,
            'css_style': ct.css_style
        } for ct in card_types])
        self.web_view.page().runJavaScript(f'updateCardTypes({payload});')

    @pyqtSlot(str, str, str, str, str)
    def createCardType(self, name, fields_json, front_style, back_style, css_style):
        fields = json.loads(fields_json)
        fields = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if name.strip() and fields:
            database.create_card_type(name.strip(), fields, front_style, back_style, css_style)
        self.getCardTypes()

    @pyqtSlot(int, str, str, str, str, str)
    def updateCardType(self, card_type_id, name, fields_json, front_style, back_style, css_style):
        fields = json.loads(fields_json)
        fields = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if name.strip() and fields:
            database.update_card_type(card_type_id, name.strip(), fields, front_style, back_style, css_style)
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

    @pyqtSlot(int, int, str, str, str, str)
    def saveDeckSettings(self, deck_id, new_cards_limit, learning_steps_str, relearning_steps_str, study_order, answer_display):
        database.update_deck_settings(deck_id, new_cards_limit, learning_steps_str, relearning_steps_str, study_order, answer_display)
        self.getDecks()

    @pyqtSlot(int, int)
    def updateCardLearningStep(self, card_id, learning_step):
        database.update_card_learning_step(card_id, learning_step)

    @pyqtSlot(str, result=str)
    def selectMediaFile(self, file_type):
        from pathlib import Path
        media_dir = database.BASE_DIR / 'data' / 'media'
        media_dir.mkdir(parents=True, exist_ok=True)

        if file_type == 'audio':
            filter_str = "Audio Files (*.mp3 *.wav *.ogg *.m4a *.flac)"
        else:
            filter_str = "Image Files (*.png *.jpg *.jpeg *.gif *.webp *.bmp)"

        main_window = self.web_view.window()
        file_path, _ = QFileDialog.getOpenFileName(main_window, "Select File", "", filter_str)
        if not file_path:
            return ''

        stem = Path(file_path).stem
        suffix = Path(file_path).suffix.lower()
        filename = stem + suffix
        dest = media_dir / filename
        counter = 1
        while dest.exists():
            filename = f"{stem}_{counter}{suffix}"
            dest = media_dir / filename
            counter += 1
        shutil.copy2(file_path, dest)

        tag = 'sound' if file_type == 'audio' else 'image'
        return f'[{tag}:{filename}]'

    @pyqtSlot(int)
    def startReview(self, deck_id):
        deck = database.get_deck_by_id(deck_id)
        new_limit = deck.new_cards_limit if deck else 15
        learning_steps_str = deck.learning_steps if deck else '1 10'
        learning_steps = [int(s) for s in learning_steps_str.split() if s.strip().isdigit()]
        study_order = deck.study_order if deck else 'new_first'
        answer_display = deck.answer_display if deck else 'replace'
        introduced_today = database.get_new_cards_introduced_today(deck_id=deck_id)
        remaining_new = max(0, new_limit - introduced_today)
        due_cards = database.get_due_cards(deck_id=deck_id)
        new_cards = database.get_new_cards(deck_id=deck_id, limit=remaining_new)
        if study_order == 'new_first':
            ordered = new_cards + due_cards
        elif study_order == 'mix':
            ordered = [c for pair in zip(due_cards, new_cards) for c in pair]
            ordered += due_cards[len(new_cards):] + new_cards[len(due_cards):]
        else:  # new_last
            ordered = due_cards + new_cards
        card_type_map = {ct.id: ct for ct in database.get_all_card_types()}
        cards = []
        for card in ordered:
            ct = card_type_map.get(card.card_type_id)
            try:
                fields = json.loads(card.fields_json) if card.fields_json else {}
            except (TypeError, ValueError):
                fields = {}
            cards.append({
                'id': card.id,
                'front': card.card_front,
                'back': card.card_back,
                'fields': fields,
                'front_style': ct.front_style if ct else '',
                'back_style': ct.back_style if ct else '',
                'css_style': ct.css_style if ct else '',
                'is_new': bool(card.is_new),
                'learning_step': card.learning_step,
            })
        media_dir = database.BASE_DIR / 'data' / 'media'
        media_dir.mkdir(parents=True, exist_ok=True)
        media_base_url = QUrl.fromLocalFile(str(media_dir)).toString() + '/'
        payload = json.dumps({'learning_steps': learning_steps, 'cards': cards, 'media_base_url': media_base_url, 'answer_display': answer_display})
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