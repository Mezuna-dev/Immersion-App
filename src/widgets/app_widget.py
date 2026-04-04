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
        decks = database.get_all_decks()
        all_stats = database.get_all_deck_stats()
        total_due = sum(s['due'] for s in all_stats.values())
        total_new = 0
        for deck in decks:
            stats = all_stats.get(deck.id, {'new_available': 0})
            introduced_today = database.get_new_cards_introduced_today(deck_id=deck.id)
            remaining_new = max(0, deck.new_cards_limit - introduced_today)
            total_new += min(stats['new_available'], remaining_new)
        self.web_view.page().runJavaScript(f'updateStats({total_due}, {total_new});')

    @pyqtSlot()
    def getDecks(self):
        decks = database.get_all_decks()
        all_stats = database.get_all_deck_stats()
        deck_list = []
        for deck in decks:
            stats = all_stats.get(deck.id, {'total': 0, 'young': 0, 'mature': 0, 'due': 0, 'new_available': 0})
            introduced_today = database.get_new_cards_introduced_today(deck_id=deck.id)
            remaining_new = max(0, deck.new_cards_limit - introduced_today)
            new_count = min(stats['new_available'], remaining_new)
            deck_list.append({
                'id': deck.id,
                'name': deck.name,
                'due': stats['due'],
                'new': new_count,
                'total': stats['total'],
                'young': stats['young'],
                'mature': stats['mature'],
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
            s = database.get_app_settings()
            database.create_deck(
                deck_name, deck_description,
                new_cards_limit=s.get('default_new_cards_limit', 15),
                learning_steps=s.get('default_learning_steps', '1 10'),
                relearning_steps=s.get('default_relearning_steps', '10'),
                study_order=s.get('default_study_order', 'new_first'),
            )
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

    @pyqtSlot(str)
    def getDailyReviewCounts(self, deck_id_str):
        deck_id = int(deck_id_str) if deck_id_str and deck_id_str != '0' else None
        data = database.get_daily_review_counts(deck_id=deck_id)
        self.web_view.page().runJavaScript(f'updateHeatmap({json.dumps(data)});')

    @pyqtSlot(str, str)
    def getRetentionStats(self, deck_id_str, period):
        from datetime import date, timedelta
        today = date.today()
        if period == 'today':
            start = end = today.strftime('%Y-%m-%d')
        elif period == 'yesterday':
            d = today - timedelta(days=1)
            start = end = d.strftime('%Y-%m-%d')
        elif period == 'last_week':
            start = (today - timedelta(days=6)).strftime('%Y-%m-%d')
            end = today.strftime('%Y-%m-%d')
        elif period == 'last_month':
            start = (today - timedelta(days=29)).strftime('%Y-%m-%d')
            end = today.strftime('%Y-%m-%d')
        elif period == 'last_year':
            start = (today - timedelta(days=364)).strftime('%Y-%m-%d')
            end = today.strftime('%Y-%m-%d')
        else:
            start = end = today.strftime('%Y-%m-%d')
        deck_id = int(deck_id_str) if deck_id_str and deck_id_str != '0' else None
        stats = database.get_retention_stats(deck_id=deck_id, start_date=start, end_date=end)
        self.web_view.page().runJavaScript(f'updateRetentionStats({json.dumps(stats)});')

    @pyqtSlot()
    def getDataInfo(self):
        info = database.get_data_info()
        self.web_view.page().runJavaScript(f'updateDataInfo({json.dumps(info)});')

    @pyqtSlot()
    def exportData(self):
        data = database.export_all_data()
        file_path, _ = QFileDialog.getSaveFileName(
            self.web_view.window(), "Export Data", "immersion_backup.json", "JSON Files (*.json)"
        )
        if file_path:
            import pathlib
            pathlib.Path(file_path).write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8'
            )
            self.web_view.page().runJavaScript('showAlert("Data exported successfully.");')

    @pyqtSlot()
    def openDataFolder(self):
        import subprocess
        subprocess.Popen(['xdg-open', str(database.BASE_DIR / 'data')])

    @pyqtSlot()
    def clearReviewHistory(self):
        database.clear_review_history()
        self.getDataInfo()

    @pyqtSlot()
    def getAppSettings(self):
        settings = database.get_app_settings()
        payload = json.dumps(settings)
        self.web_view.page().runJavaScript(f'applyAppSettings({payload});')

    @pyqtSlot(str)
    def saveAppSettings(self, settings_json):
        settings = json.loads(settings_json)
        database.save_app_settings(settings)

    @pyqtSlot(int, str, str, int, str, str, str, str)
    def saveDeckSettings(self, deck_id, name, description, new_cards_limit, learning_steps_str, relearning_steps_str, study_order, answer_display):
        database.update_deck_settings(deck_id, name, description, new_cards_limit, learning_steps_str, relearning_steps_str, study_order, answer_display)
        self.getDecks()

    @pyqtSlot(int)
    def deleteDeck(self, deck_id):
        database.delete_deck(deck_id)
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
        relearning_steps_str = deck.relearning_steps if deck else '10'
        relearning_steps = [int(s) for s in relearning_steps_str.split() if s.strip().isdigit()]
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
                'is_relearning': not bool(card.is_new) and card.learning_step is not None,
                'learning_step': card.learning_step,
            })
        media_dir = database.BASE_DIR / 'data' / 'media'
        media_dir.mkdir(parents=True, exist_ok=True)
        media_base_url = QUrl.fromLocalFile(str(media_dir)).toString() + '/'
        payload = json.dumps({'learning_steps': learning_steps, 'relearning_steps': relearning_steps, 'cards': cards, 'media_base_url': media_base_url, 'answer_display': answer_display})
        self.web_view.page().runJavaScript(f'updateReviewQueue({payload});')

    @pyqtSlot(int, int)
    def logLapse(self, card_id, rating):
        """Record a lapse review for a due card that is entering relearning steps.
        interval_after=0 signals the card is back in learning; ease_factor is unchanged."""
        card = database.get_card_by_id(card_id)
        if card:
            database.create_review(card_id, rating, 0, card.ease_factor)

    @pyqtSlot(str, str, str)
    def browseCards(self, deck_id_str, search_query, sort_by):
        deck_id = int(deck_id_str) if deck_id_str and deck_id_str != '0' else None
        sq = search_query.strip() if search_query else None
        cards = database.browse_cards(deck_id=deck_id, search_query=sq, sort_by=sort_by or None)
        payload = json.dumps(cards)
        self.web_view.page().runJavaScript(f'updateBrowseCards({payload});')

    @pyqtSlot(int, int, int, str, str, str)
    def updateCard(self, card_id, deck_id, card_type_id, fields_json, front, back):
        database.update_card_fields(card_id, deck_id, card_type_id, fields_json, front, back)

    @pyqtSlot(int)
    def deleteCardFromBrowser(self, card_id):
        database.delete_card(card_id)

    @pyqtSlot(int)
    def getCardForEdit(self, card_id):
        con = database.create_db_connection()
        cur = con.cursor()
        cur.execute("""
            SELECT c.ID, c.Deck_ID, c.Card_Front, c.Card_Back, c.Card_Type_ID, c.Fields,
                   c.Reps, c.Ease_Factor, c.Interval, c.Due_Date, c.Is_New, c.Date_Created, c.Last_Reviewed
            FROM Card c WHERE c.ID = ?
        """, (card_id,))
        row = cur.fetchone()
        con.close()
        if not row:
            return
        card_data = {
            'id': row[0], 'deck_id': row[1], 'front': row[2], 'back': row[3],
            'card_type_id': row[4], 'fields': row[5],
            'reps': row[6], 'ease_factor': round(row[7], 2), 'interval': row[8],
            'due_date': row[9], 'is_new': bool(row[10]), 'date_created': row[11], 'last_reviewed': row[12],
        }
        # Bundle card types to avoid race condition
        card_types = database.get_all_card_types()
        ct_list = [{
            'id': ct.id, 'name': ct.name, 'fields': ct.fields,
            'is_default': ct.is_default, 'front_style': ct.front_style,
            'back_style': ct.back_style, 'css_style': ct.css_style
        } for ct in card_types]
        payload = json.dumps({'card': card_data, 'card_types': ct_list})
        self.web_view.page().runJavaScript(f'loadCardForEdit({payload});')

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